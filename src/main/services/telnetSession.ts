/**
 * Telnet session service for Roku BrightScript debug terminal connections.
 *
 * Manages persistent TCP sockets to Roku debug ports (8085, 8080, 8087). Each session
 * handles the full lifecycle: connect, reconnect, write, and graceful disconnect.
 *
 * Line processing pipeline:
 *  1. Raw bytes arrive from the socket and are accumulated in a per-session read buffer.
 *  2. A debounced partial-flush timer (60ms) sends buffered content that does not end
 *     in a newline. This is necessary for prompts like "BrightScript Debugger>".
 *  3. Complete lines are extracted and passed through tokenizeTerminalLine() to produce
 *     TerminalLineChunk objects with syntax highlighting spans and interactive overlays.
 *  4. The chunks are emitted via 'data' events and forwarded to the renderer over IPC.
 *
 * Telnet negotiation: IAC (0xFF) command sequences are stripped from the stream so
 * they don't appear as garbage characters in the terminal output.
 *
 * The session ID format is "<ip>:<port>:<timestamp>" for uniqueness across reconnects.
 */

import net from 'net'
import { EventEmitter } from 'events'
import { tokenizeTerminalLine } from '../utils/terminalTokenizer'
import type { TerminalLineChunk } from '../../shared/terminal'

const SOCKET_CONNECT_TIMEOUT_MS = 10000
const PARTIAL_FLUSH_MS = 60
const SOCKET_DISCONNECT_GRACE_MS = 400
/** Cap partial-line buffer so a runaway session cannot grow memory without bound. */
const READ_BUFFER_MAX_CHARS = 2_000_000

/** A line of five or more '=' (with optional surrounding space) opening/closing a block. */
const DIAGNOSTIC_RULE_RE = /^\s*={5,}\s*$/
/** The header that opens a firmware diagnostic block, e.g. "Warning occurred while...". */
const DIAGNOSTIC_HEADER_RE = /^(Warning|Error|Fatal) occurred\b/i
/** Close a block after about this many lines if the closing rule never arrives. */
const DIAGNOSTIC_BLOCK_MAX_LINES = 30

/** The severity a diagnostic header opens with, or null when the line is not a header. */
function diagnosticHeaderSeverity(text: string): 'warning' | 'error' | null {
    const match = DIAGNOSTIC_HEADER_RE.exec(text)
    if (match === null) return null
    return match[1]!.toLowerCase() === 'warning' ? 'warning' : 'error'
}

interface TelnetSession {
    id: string
    socket: net.Socket
    deviceIp: string
    deviceName: string
    port: number
    killed: boolean
    readBuffer: string
    partialTimer: NodeJS.Timeout | null
    disconnectTimer: NodeJS.Timeout | null
    /** Incomplete IAC sequence bytes carried over from the previous socket chunk. */
    iacCarryover: Buffer | null
    /**
     * Active firmware diagnostic block, or null when no block is in progress.
     * Tracks severity and the number of lines emitted inside the block so the
     * 30-line safety cap can exit the block if the closing rule never arrives.
     */
    diagnosticBlock: { severity: 'warning' | 'error'; lineCount: number } | null
    /**
     * A rule line held back for one line of lookahead, or null. A rule may be the
     * opening rule of a diagnostic block, which is only known when the next line
     * proves to be a header. Buffering lets the opening rule be tinted as the
     * first line of the block instead of having already gone out as a plain
     * separator. Flushed plain on close if no line ever resolves it.
     */
    pendingRule: string | null
}

type EmitDataPayload = { id: string; chunk: TerminalLineChunk }
type EmitExitPayload = { id: string; exitCode: number }
type EmitStatusPayload = { id: string; status: string; error?: string }

const IAC = 255
const DO = 253
const DONT = 254
const WILL = 251
const WONT = 252

/**
 * Manages a pool of Telnet sessions, one per active terminal tab.
 *
 * Extends `EventEmitter` and emits:
 * - `'data'` with `{ id, chunk: TerminalLineChunk }` for each processed output line.
 * - `'status'` with `{ id, status, error? }` on lifecycle changes.
 * - `'exit'` with `{ id, exitCode }` when a session ends.
 */
export class TelnetSessionService extends EventEmitter {
    private sessions = new Map<string, TelnetSession>()

    /**
     * Creates and connects a new Telnet session.
     *
     * @param deviceIp - IPv4 address of the Roku device.
     * @param deviceName - Human-readable device name used in connection messages.
     * @param port - TCP port to connect to (e.g. 8085 for the BrightScript debugger).
     * @returns A unique session ID of the form `"<ip>:<port>:<timestamp>"`.
     */
    createSession(deviceIp: string, deviceName: string, port: number): string {
        const id = `${deviceIp}:${port}:${Date.now()}`
        this.createSessionWithId(id, deviceIp, deviceName, port)
        return id
    }

    /**
     * Internal session factory that accepts an explicit ID.
     * Used by `createSession` (new ID) and `reconnect` (reuses existing ID).
     *
     * @param id - Session ID to register.
     * @param deviceIp - Device IPv4 address.
     * @param deviceName - Human-readable device name.
     * @param port - TCP port number.
     */
    private createSessionWithId(id: string, deviceIp: string, deviceName: string, port: number): void {
        const socket = new net.Socket()
        const session: TelnetSession = {
            id,
            socket,
            deviceIp,
            deviceName,
            port,
            killed: false,
            readBuffer: '',
            partialTimer: null,
            disconnectTimer: null,
            iacCarryover: null,
            diagnosticBlock: null,
            pendingRule: null
        }
        this.sessions.set(id, session)
        this.attachSocket(session)
        socket.setTimeout(SOCKET_CONNECT_TIMEOUT_MS)
        socket.connect(port, deviceIp)
    }

    /**
     * Writes raw data (e.g. keyboard input) to the session's TCP socket.
     * Silently no-ops if the session does not exist or the socket is already destroyed.
     *
     * @param id - Session ID.
     * @param data - String to send to the remote host.
     */
    write(id: string, data: string): void {
        const session = this.sessions.get(id)
        if (!session || session.socket.destroyed) return
        if (!data) return
        session.socket.write(data)
    }

    /**
     * Terminates a session, emitting `'disconnected'` and `'exit'` before closing the socket.
     *
     * Prefers a graceful TCP shutdown (`socket.end()`) with a `SOCKET_DISCONNECT_GRACE_MS`
     * fallback to `destroy()` in case the remote end does not acknowledge the FIN.
     *
     * @param id - Session ID to terminate.
     */
    kill(id: string): void {
        const session = this.sessions.get(id)
        if (!session) return
        session.killed = true
        this.clearPartialTimer(session)
        this.clearDisconnectTimer(session)
        this.emitStatus({ id, status: 'disconnected' })
        this.emit('exit', { id, exitCode: 0 } as EmitExitPayload)
        if (!session.socket.destroyed) {
            // Prefer graceful shutdown first so the remote endpoint sees a proper disconnect.
            session.socket.end()
            session.disconnectTimer = setTimeout(() => {
                session.disconnectTimer = null
                if (!session.socket.destroyed) session.socket.destroy()
            }, SOCKET_DISCONNECT_GRACE_MS)
        }
        this.sessions.delete(id)
    }

    /**
     * Kills the existing session (if any) and creates a new one with the same ID.
     *
     * Caller may supply overrides for connection parameters; values from the previous
     * session are used as fallbacks. The call is a no-op if no connection details
     * can be resolved.
     *
     * @param id - Session ID to reconnect.
     * @param deviceIp - Optional IP override.
     * @param deviceName - Optional display name override.
     * @param port - Optional port override.
     */
    reconnect(id: string, deviceIp?: string, deviceName?: string, port?: number): void {
        const session = this.sessions.get(id)
        const targetIp = session?.deviceIp ?? deviceIp
        const targetName = session?.deviceName ?? deviceName
        const targetPort = session?.port ?? port
        if (!targetIp || !targetName || typeof targetPort !== 'number') return
        this.kill(id)
        this.createSessionWithId(id, targetIp, targetName, targetPort)
    }

    /**
     * Kills all active sessions. Typically called on app shutdown or when switching devices.
     */
    killAll(): void {
        for (const [id] of this.sessions) {
            this.kill(id)
        }
    }

    /**
     * Registers all socket event listeners for a session.
     * Emits an initial `'connecting'` status and handles `connect`, `data`,
     * `timeout`, `error`, and `close` events.
     *
     * @param session - The session whose socket should be wired up.
     */
    private attachSocket(session: TelnetSession): void {
        const { id, socket, deviceIp, port } = session
        this.emitStatus({ id, status: 'connecting' })

        socket.on('connect', () => {
            if (this.sessions.get(id) !== session) return
            socket.setTimeout(0)
            this.emitStatus({ id, status: 'connected' })
            this.emitLine(id, `Connected to ${deviceIp}:${port}`)
        })

        socket.on('data', (buf: Buffer) => {
            if (this.sessions.get(id) !== session) return
            const text = this.stripTelnetNegotiation(buf, socket, session)
            if (!text) return
            session.readBuffer += text
            if (session.readBuffer.length > READ_BUFFER_MAX_CHARS) {
                session.readBuffer = session.readBuffer.slice(-READ_BUFFER_MAX_CHARS)
            }
            this.flushCompletedLines(session)
            this.schedulePartialFlush(session)
        })

        socket.on('timeout', () => {
            if (this.sessions.get(id) !== session) return
            this.emitStatus({ id, status: 'error', error: 'Connection timed out' })
            socket.destroy()
        })

        socket.on('error', (err: Error) => {
            if (this.sessions.get(id) !== session) return
            this.emitStatus({ id, status: 'error', error: err.message })
            this.emitLine(id, `Error: ${err.message}`)
        })

        socket.on('close', () => {
            this.clearPartialTimer(session)
            this.clearDisconnectTimer(session)
            if (this.sessions.get(id) !== session) return
            this.flushPendingRule(session)
            this.flushRemainder(session)
            if (!session.killed) {
                this.emitStatus({ id, status: 'disconnected' })
                this.emit('exit', { id, exitCode: 0 } as EmitExitPayload)
            }
            this.sessions.delete(id)
        })
    }

    /**
     * Strips Telnet IAC command sequences from a raw buffer and responds to
     * WILL/WONT/DO/DONT negotiations by refusing all options.
     *
     * The two-byte IAC-IAC escape (literal 0xFF) is preserved as a single byte.
     *
     * When an IAC sequence is split across two socket recv() boundaries (e.g. the
     * chunk ends with just IAC, or IAC+command), the incomplete trailing bytes are
     * stored in `session.iacCarryover` and prepended to the next incoming chunk so
     * the sequence is processed whole.
     *
     * @param buf - Raw bytes received from the socket.
     * @param socket - The socket to write negotiation responses to.
     * @param session - The owning session, used to persist split-boundary carryover.
     * @returns The cleaned UTF-8 string with all IAC sequences removed.
     */
    private stripTelnetNegotiation(buf: Buffer, socket: net.Socket, session: TelnetSession): string {
        // Prepend any bytes that were left over from the previous chunk.
        const working = session.iacCarryover ? Buffer.concat([session.iacCarryover, buf]) : buf
        session.iacCarryover = null

        const data: number[] = []
        for (let i = 0; i < working.length; i++) {
            const byte = working[i]
            if (byte !== IAC) {
                data.push(byte)
                continue
            }
            // IAC with no following byte: save it and wait for the next chunk.
            if (i + 1 >= working.length) {
                session.iacCarryover = working.slice(i)
                break
            }
            const command = working[i + 1]
            if (command === IAC) {
                // IAC IAC is the escaped literal 0xFF byte.
                data.push(IAC)
                i += 1
                continue
            }
            // Three-byte negotiation: IAC <WILL|WONT|DO|DONT> <option>.
            if (command === WILL || command === WONT || command === DO || command === DONT) {
                // IAC + command present but option byte missing: save both and wait.
                if (i + 2 >= working.length) {
                    session.iacCarryover = working.slice(i)
                    break
                }
                const option = working[i + 2]
                const response = command === WILL || command === WONT
                    ? Buffer.from([IAC, DONT, option])
                    : Buffer.from([IAC, WONT, option])
                socket.write(response)
                i += 2
                continue
            }
            // Unknown IAC command: skip the IAC and let the command byte through
            // (we cannot know the sequence length, so conservatively drop only the IAC).
        }
        return Buffer.from(data).toString('utf-8')
    }

    /**
     * Extracts all complete lines (terminated by `\n` or `\r\n`) from the session's
     * read buffer, tokenizes each, and emits them as `'data'` events.
     * The last (potentially incomplete) fragment is left in the buffer.
     *
     * @param session - Session whose buffer should be flushed.
     */
    private flushCompletedLines(session: TelnetSession): void {
        const lines = session.readBuffer.split(/\r?\n/)
        if (lines.length <= 1) return
        session.readBuffer = lines.pop() ?? ''
        for (const line of lines) {
            this.emitChunks(session.id, this.tokenizeWithDiagnosticState(session, line))
        }
    }

    /**
     * Emits whatever partial text remains in the read buffer as a terminal chunk,
     * then clears the buffer. Called on socket close and by the partial-flush timer.
     *
     * @param session - Session to flush.
     */
    private flushRemainder(session: TelnetSession): void {
        if (!session.readBuffer) return
        this.emitChunks(session.id, this.tokenizeWithDiagnosticState(session, session.readBuffer))
        session.readBuffer = ''
    }

    /**
     * Emits a rule line that was buffered for lookahead as a plain separator,
     * because no following line ever arrived to prove it opened a block. Called
     * on socket close so a trailing rule is not silently dropped.
     *
     * @param session - Session whose pending rule should be flushed.
     */
    private flushPendingRule(session: TelnetSession): void {
        if (session.pendingRule === null) return
        this.emitChunk(session.id, tokenizeTerminalLine(session.pendingRule))
        session.pendingRule = null
    }

    /**
     * Debounces `flushRemainder` with a `PARTIAL_FLUSH_MS` delay so that prompts
     * (which do not end in a newline) are still sent to the terminal promptly.
     * Resets the timer each time new data arrives.
     *
     * @param session - Session for which to schedule the flush.
     */
    private schedulePartialFlush(session: TelnetSession): void {
        this.clearPartialTimer(session)
        session.partialTimer = setTimeout(() => {
            session.partialTimer = null
            this.flushRemainder(session)
        }, PARTIAL_FLUSH_MS)
    }

    /**
     * Cancels the pending partial-flush timer, if any.
     *
     * @param session - Session whose timer should be cleared.
     */
    private clearPartialTimer(session: TelnetSession): void {
        if (!session.partialTimer) return
        clearTimeout(session.partialTimer)
        session.partialTimer = null
    }

    /**
     * Cancels the pending graceful-disconnect fallback timer, if any.
     *
     * @param session - Session whose timer should be cleared.
     */
    private clearDisconnectTimer(session: TelnetSession): void {
        if (!session.disconnectTimer) return
        clearTimeout(session.disconnectTimer)
        session.disconnectTimer = null
    }

    /**
     * Tokenizes a plain text string and emits it as a `'data'` event.
     * Used for synthetic lines such as the "Connected to ..." message.
     *
     * @param id - Session ID.
     * @param text - Raw text line to emit.
     */
    private emitLine(id: string, text: string): void {
        const session = this.sessions.get(id)
        if (session) {
            this.emitChunks(id, this.tokenizeWithDiagnosticState(session, text))
        } else {
            // Session not found (e.g. called during teardown). Fall back to plain tokenization.
            this.emitChunk(id, tokenizeTerminalLine(text))
        }
    }

    /**
     * Tokenizes one terminal line using per-session diagnostic-block state so that
     * firmware SceneGraph diagnostic blocks are tinted by severity.
     *
     * The firmware format is:
     *   =====...=====            (opening rule: first tinted line of the block)
     *   Warning/Error occurred   (header: opens the block)
     *   ... detail lines ...
     *   =====...=====            (closing rule: last tinted line, then closes the block)
     *
     * A rule line is held for one line of lookahead (session.pendingRule): if the
     * next non-blank line is a header the rule is emitted tinted as the block's
     * first line, otherwise it is emitted as a plain separator. Blank lines between
     * the rule and the header are line-delivery artifacts (the 60ms partial flush
     * can split an empty line in between) and are dropped while a rule is pending,
     * so the block opens regardless of how the bytes were chunked. A cap of about
     * 30 lines prevents runaway tinting when the closing rule never arrives.
     *
     * @param session - The session whose diagnostic-block state is read and mutated.
     * @param text - Raw text of the line being tokenized.
     * @returns Zero, one, or two chunks: a buffered rule emits nothing until
     *   resolved, and the resolving header emits both the rule and itself.
     */
    private tokenizeWithDiagnosticState(session: TelnetSession, text: string): TerminalLineChunk[] {
        const isRule = DIAGNOSTIC_RULE_RE.test(text)

        // Inside a block: tint every line until the closing rule or the safety cap.
        if (session.diagnosticBlock !== null) {
            const block = session.diagnosticBlock
            block.lineCount++
            const chunk = tokenizeTerminalLine(text, block.severity)
            if (isRule || block.lineCount > DIAGNOSTIC_BLOCK_MAX_LINES) {
                session.diagnosticBlock = null
            }
            return [chunk]
        }

        // A rule is buffered: resolve it now that the following line is known.
        if (session.pendingRule !== null) {
            if (text.trim() === '') return []
            const severity = diagnosticHeaderSeverity(text)
            const rule = session.pendingRule
            session.pendingRule = null
            if (severity !== null) {
                // Rule + header open the block; both are its first tinted lines.
                session.diagnosticBlock = { severity, lineCount: 2 }
                return [tokenizeTerminalLine(rule, severity), tokenizeTerminalLine(text, severity)]
            }
            // The rule was a standalone separator. Emit it plain, then handle this line.
            const ruleChunk = tokenizeTerminalLine(rule)
            if (isRule) {
                session.pendingRule = text
                return [ruleChunk]
            }
            return [ruleChunk, tokenizeTerminalLine(text)]
        }

        // A fresh rule outside any block: hold it for one line of lookahead.
        if (isRule) {
            session.pendingRule = text
            return []
        }

        return [tokenizeTerminalLine(text)]
    }

    /**
     * Emits a `'data'` event with the given terminal chunk.
     *
     * @param id - Session ID.
     * @param chunk - Tokenized terminal line chunk.
     */
    private emitChunk(id: string, chunk: TerminalLineChunk): void {
        this.emit('data', { id, chunk } as EmitDataPayload)
    }

    /**
     * Emits a `'data'` event for each chunk in order. The diagnostic tokenizer can
     * return zero chunks (a buffered rule) or two (a resolving header emits the
     * held rule and itself).
     *
     * @param id - Session ID.
     * @param chunks - Tokenized terminal line chunks to emit in order.
     */
    private emitChunks(id: string, chunks: TerminalLineChunk[]): void {
        for (const chunk of chunks) this.emitChunk(id, chunk)
    }

    /**
     * Emits a `'status'` event with connection lifecycle information.
     *
     * @param payload - Status payload including session ID, status string, and optional error.
     */
    private emitStatus(payload: EmitStatusPayload): void {
        this.emit('status', payload)
    }
}
