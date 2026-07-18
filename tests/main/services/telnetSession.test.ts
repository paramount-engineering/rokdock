import { describe, it, expect, vi } from 'vitest'
import { TelnetSessionService } from '@main/services/telnetSession'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IAC = 0xff
const DO = 0xfd
const DONT = 0xfe
const WILL = 0xfb
const WONT = 0xfc

/** Minimal mock that satisfies the net.Socket.write call inside the stripper. */
function makeMockSocket() {
    return { write: vi.fn() } as unknown as import('net').Socket
}

/** Minimal TelnetSession stub for carryover state. */
function makeSession(): { iacCarryover: Buffer | null } {
    return { iacCarryover: null }
}

/**
 * Calls the private `stripTelnetNegotiation` method directly via a type cast.
 * The method signature is (buf, socket, session). We reuse the same session
 * across calls to accumulate carryover state between chunks.
 */
function strip(
    service: TelnetSessionService,
    socket: ReturnType<typeof makeMockSocket>,
    session: ReturnType<typeof makeSession>,
    ...chunks: number[][]
): string[] {
    const privateFn = (service as unknown as {
        stripTelnetNegotiation(
            buf: Buffer,
            socket: import('net').Socket,
            session: { iacCarryover: Buffer | null }
        ): string
    }).stripTelnetNegotiation.bind(service)

    return chunks.map(chunk => privateFn(Buffer.from(chunk), socket, session))
}

// ---------------------------------------------------------------------------
// stripTelnetNegotiation - plain data passthrough
// ---------------------------------------------------------------------------

describe('stripTelnetNegotiation - plain data', () => {
    it('passes through ASCII text unchanged', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        const [result] = strip(svc, sock, sess, [0x68, 0x65, 0x6c, 0x6c, 0x6f]) // "hello"
        expect(result).toBe('hello')
        expect(sock.write).not.toHaveBeenCalled()
    })

    it('returns an empty string for an empty buffer', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        const [result] = strip(svc, sock, sess, [])
        expect(result).toBe('')
    })
})

// ---------------------------------------------------------------------------
// stripTelnetNegotiation - complete IAC sequences in one chunk
// ---------------------------------------------------------------------------

describe('stripTelnetNegotiation - complete IAC in one chunk', () => {
    it('strips a WILL negotiation and sends DONT response', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // IAC WILL 1 followed by "ok"
        const [result] = strip(svc, sock, sess, [IAC, WILL, 0x01, 0x6f, 0x6b])
        expect(result).toBe('ok')
        expect(sock.write).toHaveBeenCalledWith(Buffer.from([IAC, DONT, 0x01]))
    })

    it('strips a DO negotiation and sends WONT response', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // IAC DO 3
        const [result] = strip(svc, sock, sess, [IAC, DO, 0x03])
        expect(result).toBe('')
        expect(sock.write).toHaveBeenCalledWith(Buffer.from([IAC, WONT, 0x03]))
    })

    it('preserves IAC IAC as a literal 0xFF byte (emitted as UTF-8 replacement)', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // IAC IAC decodes to raw byte 0xFF. 0xFF is not valid UTF-8 on its own so
        // Buffer.toString('utf-8') converts it to the Unicode replacement character.
        const [result] = strip(svc, sock, sess, [IAC, IAC])
        expect(result).toBe('\ufffd')
        expect(sock.write).not.toHaveBeenCalled()
    })

    it('strips multiple IAC sequences in sequence', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // IAC WILL 1, "hi", IAC DO 2
        const [result] = strip(svc, sock, sess, [IAC, WILL, 0x01, 0x68, 0x69, IAC, DO, 0x02])
        expect(result).toBe('hi')
        expect(sock.write).toHaveBeenCalledTimes(2)
    })
})

// ---------------------------------------------------------------------------
// stripTelnetNegotiation - IAC split across two chunks
// ---------------------------------------------------------------------------

describe('stripTelnetNegotiation - split IAC across chunk boundaries', () => {
    it('handles IAC arriving alone at end of chunk 1, command+option in chunk 2', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // Chunk 1: "abc" + IAC (incomplete)
        // Chunk 2: WILL 0x01 + "xyz"
        const [r1, r2] = strip(
            svc, sock, sess,
            [0x61, 0x62, 0x63, IAC],
            [WILL, 0x01, 0x78, 0x79, 0x7a]
        )
        expect(r1).toBe('abc')
        expect(r2).toBe('xyz')
        expect(sock.write).toHaveBeenCalledWith(Buffer.from([IAC, DONT, 0x01]))
        expect(sess.iacCarryover).toBeNull()
    })

    it('handles IAC+command arriving at end of chunk 1, option in chunk 2', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // Chunk 1: IAC DONT (missing option)
        // Chunk 2: 0x05 + "end"
        const [r1, r2] = strip(
            svc, sock, sess,
            [IAC, DONT],
            [0x05, 0x65, 0x6e, 0x64]
        )
        expect(r1).toBe('')
        expect(r2).toBe('end')
        expect(sock.write).toHaveBeenCalledWith(Buffer.from([IAC, WONT, 0x05]))
        expect(sess.iacCarryover).toBeNull()
    })

    it('carries over mid-stream and does not corrupt surrounding plain text', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        // Chunk 1: "pre" + IAC WONT (no option)
        // Chunk 2: 0x18 + "suf"
        const [r1, r2] = strip(
            svc, sock, sess,
            [0x70, 0x72, 0x65, IAC, WONT],
            [0x18, 0x73, 0x75, 0x66]
        )
        expect(r1).toBe('pre')
        expect(r2).toBe('suf')
        // WONT from the remote side triggers a DONT response.
        expect(sock.write).toHaveBeenCalledWith(Buffer.from([IAC, DONT, 0x18]))
    })

    it('leaves carryover set when chunk ends in only IAC', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        strip(svc, sock, sess, [IAC])
        expect(sess.iacCarryover).toEqual(Buffer.from([IAC]))
    })

    it('leaves carryover set when chunk ends in IAC+negotiation-command', () => {
        const svc = new TelnetSessionService()
        const sock = makeMockSocket()
        const sess = makeSession()
        strip(svc, sock, sess, [IAC, DO])
        expect(sess.iacCarryover).toEqual(Buffer.from([IAC, DO]))
    })
})

// ---------------------------------------------------------------------------
// tokenizeWithDiagnosticState - diagnostic block state machine
// ---------------------------------------------------------------------------

/**
 * Minimal TelnetSession stub with only the fields tokenizeWithDiagnosticState reads.
 * The private method receives the full session object; these are the fields it uses.
 */
function makeDiagSession() {
    return {
        diagnosticBlock: null as { severity: 'warning' | 'error'; lineCount: number } | null,
        pendingRule: null as string | null
    }
}

type DiagChunk = import('../../../src/shared/terminal').TerminalLineChunk

/**
 * Feeds one line through the private `tokenizeWithDiagnosticState` (via a type
 * cast, the same technique as strip() above) and returns the chunks it emits.
 * A buffered opening rule emits nothing until the next line resolves it, so the
 * result is zero, one, or two chunks.
 */
function tokenizeDiag(
    service: TelnetSessionService,
    session: ReturnType<typeof makeDiagSession>,
    text: string
): DiagChunk[] {
    const privateFn = (service as unknown as {
        tokenizeWithDiagnosticState(
            session: ReturnType<typeof makeDiagSession>,
            text: string
        ): DiagChunk[]
    }).tokenizeWithDiagnosticState.bind(service)
    return privateFn(session, text)
}

/** Feeds several lines and returns the flattened chunks emitted, in order. */
function feedDiag(
    service: TelnetSessionService,
    session: ReturnType<typeof makeDiagSession>,
    lines: string[]
): DiagChunk[] {
    const chunks: DiagChunk[] = []
    for (const line of lines) chunks.push(...tokenizeDiag(service, session, line))
    return chunks
}

const RULE = '================================================================='
const WARNING_HEADER = 'Warning occurred while setting a field of an RoSGNode'

describe('tokenizeWithDiagnosticState - firmware diagnostic block', () => {
    it('buffers the opening rule, then emits it tinted with the header when the block opens', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()

        // The rule alone emits nothing yet: it is held for one line of lookahead.
        expect(tokenizeDiag(svc, sess, RULE)).toEqual([])
        expect(sess.pendingRule).toBe(RULE)
        expect(sess.diagnosticBlock).toBeNull()

        // The header resolves the rule: both go out tinted and the block opens.
        const chunks = tokenizeDiag(svc, sess, WARNING_HEADER)
        expect(chunks).toHaveLength(2)
        expect(chunks[0]!.tokens[0]!.kind).toBe('warning') // opening rule
        expect(chunks[1]!.tokens[0]!.kind).toBe('warning') // header
        expect(sess.pendingRule).toBeNull()
        expect(sess.diagnosticBlock!.severity).toBe('warning')
    })

    it('detail line inside the block is warning', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        feedDiag(svc, sess, [RULE, WARNING_HEADER])

        const detail = '-- Tried to set nonexistent field "isRegwallRegistration" of a "AppScene" node'
        const chunks = tokenizeDiag(svc, sess, detail)
        expect(chunks).toHaveLength(1)
        expect(chunks[0]!.tokens[0]!.kind).toBe('warning')
        expect(sess.diagnosticBlock).not.toBeNull()
    })

    it('location line keeps the pkg:/ path as filePath over the warning wash', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        feedDiag(svc, sess, [
            RULE,
            WARNING_HEADER,
            '-- Tried to set nonexistent field "isRegwallRegistration" of a "AppScene" node'
        ])

        const location = '   at line 1802 of file pkg:/source/framework/utils.brs'
        const [chunk] = tokenizeDiag(svc, sess, location)
        const pathStart = location.indexOf('pkg:/')
        const pathToken = chunk!.tokens.find(token => token.start <= pathStart && pathStart < token.end)
        expect(pathToken?.kind).toBe('filePath')
        const beforeToken = chunk!.tokens.find(token => token.start === 0)
        expect(beforeToken?.kind).toBe('warning')
    })

    it('closing rule is warning-colored and then closes the block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        feedDiag(svc, sess, [
            RULE,
            WARNING_HEADER,
            '-- Tried to set nonexistent field "isRegwallRegistration" of a "AppScene" node',
            '   at line 1802 of file pkg:/source/framework/utils.brs'
        ])

        const [chunk] = tokenizeDiag(svc, sess, RULE)
        expect(chunk!.tokens[0]!.kind).toBe('warning')
        expect(sess.diagnosticBlock).toBeNull()
    })

    it('line after the closing rule is plain (block is closed)', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        feedDiag(svc, sess, [
            RULE,
            WARNING_HEADER,
            '-- Tried',
            '   at line 1 of file pkg:/source/utils.brs',
            RULE
        ])

        const [chunk] = tokenizeDiag(svc, sess, 'some normal log output')
        expect(chunk!.tokens[0]!.kind).not.toBe('warning')
        expect(chunk!.tokens[0]!.kind).not.toBe('error')
    })
})

describe('tokenizeWithDiagnosticState - false-positive prevention', () => {
    it('a header NOT preceded by a rule does not trigger the block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        const [chunk] = tokenizeDiag(svc, sess, WARNING_HEADER)
        expect(sess.diagnosticBlock).toBeNull()
        expect(chunk!.tokens[0]!.kind).not.toBe('warning')
    })

    it('an Error header preceded by a rule enters an error block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        tokenizeDiag(svc, sess, RULE)
        const chunks = tokenizeDiag(svc, sess, 'Error occurred while resolving component')
        expect(sess.diagnosticBlock!.severity).toBe('error')
        expect(chunks).toHaveLength(2)
        expect(chunks[0]!.tokens[0]!.kind).toBe('error') // opening rule
        expect(chunks[1]!.tokens[0]!.kind).toBe('error') // header
    })

    it('a Fatal header preceded by a rule also enters an error block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        tokenizeDiag(svc, sess, RULE)
        const chunks = tokenizeDiag(svc, sess, 'Fatal occurred: crash in renderer')
        expect(sess.diagnosticBlock!.severity).toBe('error')
        expect(chunks[1]!.tokens[0]!.kind).toBe('error')
    })

    it('a Warning header preceded by a rule enters a warning block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        tokenizeDiag(svc, sess, RULE)
        const chunks = tokenizeDiag(svc, sess, 'Warning occurred in the renderer')
        expect(sess.diagnosticBlock!.severity).toBe('warning')
        expect(chunks[1]!.tokens[0]!.kind).toBe('warning')
    })

    it('a plural "Warnings occurred" XML-component header opens a warning block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        tokenizeDiag(svc, sess, RULE)
        const chunks = tokenizeDiag(svc, sess, 'Warnings occurred while creating XML component SpotlightContentGroup')
        expect(sess.diagnosticBlock!.severity).toBe('warning')
        expect(chunks).toHaveLength(2)
        expect(chunks[0]!.tokens[0]!.kind).toBe('warning') // opening rule
        expect(chunks[1]!.tokens[0]!.kind).toBe('warning') // header

        // The "-- Tried to set nonexistent field ..." detail lines are tinted too.
        const detail = tokenizeDiag(svc, sess, '-- Tried to set nonexistent field "badgeFormat" of a "MetadataGroup" node')
        expect(detail[0]!.tokens[0]!.kind).toBe('warning')
    })

    it('a standalone rule (no header follows) is emitted as a plain separator', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        expect(tokenizeDiag(svc, sess, RULE)).toEqual([])
        // A normal line resolves the buffered rule: rule (separator) then the line.
        const chunks = tokenizeDiag(svc, sess, 'some normal log output')
        expect(chunks).toHaveLength(2)
        expect(chunks[0]!.tokens[0]!.kind).toBe('separator')
        expect(sess.diagnosticBlock).toBeNull()
    })
})

describe('tokenizeWithDiagnosticState - blank-line resilience', () => {
    // The 60ms partial-flush timer can split the byte stream so an empty fragment
    // lands between the opening rule and its header. A blank line must not resolve
    // the buffered rule as a standalone separator, or the block never opens.
    it('a blank line between the rule and header still opens the block', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        tokenizeDiag(svc, sess, RULE)
        expect(tokenizeDiag(svc, sess, '')).toEqual([]) // dropped while a rule is pending
        const chunks = tokenizeDiag(svc, sess, WARNING_HEADER)
        expect(sess.diagnosticBlock).not.toBeNull()
        expect(chunks).toHaveLength(2)
        expect(chunks[1]!.tokens[0]!.kind).toBe('warning')
    })

    it('blank lines do not start a block on their own after unrelated output', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        feedDiag(svc, sess, ['some normal log output', ''])
        const [chunk] = tokenizeDiag(svc, sess, WARNING_HEADER)
        expect(sess.diagnosticBlock).toBeNull()
        expect(chunk!.tokens[0]!.kind).not.toBe('warning')
    })
})

describe('tokenizeWithDiagnosticState - 30-line safety cap', () => {
    it('exits the block after about 30 lines even without a closing rule', () => {
        const svc = new TelnetSessionService()
        const sess = makeDiagSession()
        // The opening rule and header open the block at lineCount 2.
        feedDiag(svc, sess, [RULE, WARNING_HEADER])
        expect(sess.diagnosticBlock!.lineCount).toBe(2)

        // Feed 28 body lines to reach lineCount 30; the block is still active.
        for (let iteration = 0; iteration < 28; iteration++) {
            tokenizeDiag(svc, sess, `detail line ${iteration}`)
        }
        expect(sess.diagnosticBlock).not.toBeNull()

        // The next line takes lineCount to 31 (> 30), closing the block.
        tokenizeDiag(svc, sess, 'detail line 28')
        expect(sess.diagnosticBlock).toBeNull()
    })
})
