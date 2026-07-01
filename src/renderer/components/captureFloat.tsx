/**
 * Picture-in-Picture floating overlay rendered via ReactDOM.createPortal into
 * document.body.
 *
 * Appears when captureMode is 'pip'. The user can drag it by its toolbar to
 * any corner of the window, resize it from any corner handle, and pop it out
 * to the dedicated Capture Popout window. The position and size are persisted
 * in appStore (pipBounds) so they survive re-renders and tab switches.
 *
 * Drag and resize are handled via pointer capture (setPointerCapture) to
 * keep the interaction smooth even when the pointer leaves the handle bounds.
 * The bounds are clamped to the viewport on every move to prevent the window
 * from being dragged off-screen.
 *
 * Corner handles (HANDLE_SIZE px squares) are positioned absolutely at each
 * corner. Resizing from a corner adjusts both dimensions simultaneously and
 * also repositions the origin for top-left and top-right corners so the
 * opposite corner stays anchored.
 *
 * Renders CapturePreview in 'pip' mode and CaptureVolumeControl as an
 * overlay on the right edge.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useAppStore } from '../store/appStore'
import CapturePreview from './capturePreview'
import IconButton from './common/iconButton'
import CaptureVolumeControl from './captureVolumeControl'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faArrowUpRightFromSquare,
    faWindowMaximize,
} from '@fortawesome/free-solid-svg-icons'
import { TOOLBAR_HEIGHT } from '../../shared/toolbarConstants'

const DEFAULT_WIDTH = 400
const MIN_WIDTH = 240
const HANDLE_SIZE = 14

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const CORNER_CURSORS: Record<Corner, string> = {
    tl: 'nwse-resize',
    tr: 'nesw-resize',
    bl: 'nesw-resize',
    br: 'nwse-resize',
}

const CORNER_POSITIONS: Record<Corner, React.CSSProperties> = {
    tl: { top: 0, left: 0 },
    tr: { top: 0, right: 0 },
    bl: { bottom: 0, left: 0 },
    br: { bottom: 0, right: 0 },
}

interface DragState {
    startX: number
    startY: number
    origX: number
    origY: number
}

interface ResizeState {
    corner: Corner
    startX: number
    startY: number
    origX: number
    origY: number
    origW: number
}

/**
 * Floating PiP capture overlay portalled into document.body.
 * Visible only when captureMode === 'pip'. Supports pointer-captured drag
 * on the toolbar and corner resize handles, with bounds clamped to the viewport.
 */
export default function CaptureFloat() {
    const captureMode = useAppStore(state => state.captureMode)
    const capturePipBounds = useAppStore(state => state.capturePipBounds)
    const setCapturePipBounds = useAppStore(state => state.setCapturePipBounds)
    const captureDeviceId = useAppStore(state => state.captureDeviceId)
    const captureMuted = useAppStore(state => state.captureMuted)
    const setCaptureMode = useAppStore(state => state.setCaptureMode)

    const dockCapture = () => setCaptureMode('docked')
    const openPopout = () => {
        setCaptureMode('popout')
        void window.rokdock.capture.openPopout(captureDeviceId!, captureMuted)
    }

    const aspectRatio = capturePipBounds ? (capturePipBounds.w / capturePipBounds.h) : 16 / 9

    // Default to bottom-right of window
    const defaultX = () => Math.max(40, window.innerWidth - DEFAULT_WIDTH - 60)
    const defaultY = () => Math.max(40, window.innerHeight - Math.round(DEFAULT_WIDTH / (16 / 9)) - 80)

    const [pos, setPos] = useState({ x: capturePipBounds?.x ?? defaultX(), y: capturePipBounds?.y ?? defaultY() })
    const [width, setWidth] = useState(capturePipBounds?.w ?? DEFAULT_WIDTH)

    const dragRef = useRef<DragState | null>(null)
    const resizeRef = useRef<ResizeState | null>(null)
    const posRef = useRef(pos)
    // The portal container and the video-wrapper, mutated directly during a
    // drag/resize gesture so the high-frequency pointermove path never re-renders
    // the live <video>; React state is committed only on gesture end.
    const containerRef = useRef<HTMLDivElement | null>(null)
    const bodyRef = useRef<HTMLDivElement | null>(null)
    // Latest persisted bounds kept in a ref so the pip-entry restore can seed from them
    // without re-running on every drag or resize that writes new bounds. Assigned during
    // render so it is always current before any effect reads it.
    const capturePipBoundsRef = useRef(capturePipBounds)
    capturePipBoundsRef.current = capturePipBounds

    /**
     * Computes the height from the current aspect ratio and persists the full
     * pip bounds (x, y, w, h) to appStore so they survive re-renders.
     */
    const persistBounds = useCallback((x: number, y: number, w: number) => {
        const h = Math.round(w / aspectRatio)
        setCapturePipBounds({ x, y, w, h })
    }, [aspectRatio, setCapturePipBounds])

    // Restore persisted bounds when entering pip mode. The bounds are seeded from the
    // ref so they apply only on mode-entry; reading the store value reactively would
    // re-run this after every drag or resize (those persist new bounds), redundantly
    // re-applying values this component just wrote and triggering extra renders.
    useEffect(() => {
        const bounds = capturePipBoundsRef.current
        if (captureMode === 'pip' && bounds) {
            setPos({ x: bounds.x, y: bounds.y })
            setWidth(bounds.w)
        }
    }, [captureMode])

    useEffect(() => { posRef.current = pos }, [pos])

    useEffect(() => {
        function handleResize() {
            const cur = posRef.current
            const h = Math.round(width / aspectRatio) + TOOLBAR_HEIGHT
            const clampedX = Math.max(0, Math.min(cur.x, window.innerWidth - width))
            const clampedY = Math.max(0, Math.min(cur.y, window.innerHeight - h))
            if (clampedX === cur.x && clampedY === cur.y) return
            setPos({ x: clampedX, y: clampedY })
            persistBounds(clampedX, clampedY, width)
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [width, aspectRatio, persistBounds])

    // --- Drag handlers ---
    /** Initiates toolbar drag by capturing the pointer and recording the start position. */
    const onDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }, [pos])

    /** Updates position live during a toolbar drag by mutating the container's
     *  style directly (no setState), clamped to x >= 0, y >= 0. */
    const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current || !containerRef.current) return
        const x = Math.max(0, dragRef.current.origX + (e.clientX - dragRef.current.startX))
        const y = Math.max(0, dragRef.current.origY + (e.clientY - dragRef.current.startY))
        containerRef.current.style.left = `${x}px`
        containerRef.current.style.top = `${y}px`
    }, [])

    /** Finalises the toolbar drag and persists the new position to appStore. */
    const onDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return
        const newX = Math.max(0, dragRef.current.origX + (e.clientX - dragRef.current.startX))
        const newY = Math.max(0, dragRef.current.origY + (e.clientY - dragRef.current.startY))
        dragRef.current = null
        setPos({ x: newX, y: newY })
        persistBounds(newX, newY, width)
    }, [width, persistBounds])

    // --- Corner resize handlers ---
    /**
     * Returns a pointerdown handler for the given corner resize handle.
     * Captures the pointer so resize events continue even if the cursor leaves
     * the handle element.
     */
    const makeResizeStart = useCallback((corner: Corner) => (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        resizeRef.current = {
            corner,
            startX: e.clientX,
            startY: e.clientY,
            origX: pos.x,
            origY: pos.y,
            origW: width,
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }, [pos, width])

    /**
     * Updates width and position live during a corner resize. Left-side corners
     * grow the window leftward; top corners grow it upward, keeping the opposite
     * corner anchored in place.
     */
    const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!resizeRef.current || !containerRef.current) return
        const resize = resizeRef.current
        const dx = e.clientX - resize.startX

        // For left-side corners, dragging left increases width
        const widthDelta = (resize.corner === 'tl' || resize.corner === 'bl') ? -dx : dx
        const newW = Math.max(MIN_WIDTH, resize.origW + widthDelta)
        const newH = Math.round(newW / aspectRatio)
        const oldH = Math.round(resize.origW / aspectRatio)

        let newX = resize.origX
        let newY = resize.origY

        // Adjust position for left-side corners (width grows leftward)
        if (resize.corner === 'tl' || resize.corner === 'bl') {
            newX = resize.origX - (newW - resize.origW)
        }
        // Adjust position for top corners (height grows upward)
        if (resize.corner === 'tl' || resize.corner === 'tr') {
            newY = resize.origY - (newH - oldH)
        }

        // Mutate the DOM directly during the gesture, state commits on end.
        const element = containerRef.current
        element.style.left = `${Math.max(0, newX)}px`
        element.style.top = `${Math.max(0, newY)}px`
        element.style.width = `${newW}px`
        if (bodyRef.current) {
            bodyRef.current.style.width = `${newW}px`
            bodyRef.current.style.height = `${newH}px`
        }
    }, [aspectRatio])

    /** Finalises a corner resize and persists the resulting bounds to appStore. */
    const onResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!resizeRef.current) return
        const resize = resizeRef.current
        const dx = e.clientX - resize.startX
        const widthDelta = (resize.corner === 'tl' || resize.corner === 'bl') ? -dx : dx
        const newW = Math.max(MIN_WIDTH, resize.origW + widthDelta)
        const newH = Math.round(newW / aspectRatio)
        const oldH = Math.round(resize.origW / aspectRatio)

        let newX = resize.origX
        let newY = resize.origY
        if (resize.corner === 'tl' || resize.corner === 'bl') {
            newX = resize.origX - (newW - resize.origW)
        }
        if (resize.corner === 'tl' || resize.corner === 'tr') {
            newY = resize.origY - (newH - oldH)
        }

        resizeRef.current = null
        newX = Math.max(0, newX)
        newY = Math.max(0, newY)
        setWidth(newW)
        setPos({ x: newX, y: newY })
        persistBounds(newX, newY, newW)
    }, [aspectRatio, persistBounds])

    if (captureMode !== 'pip') return null

    const height = Math.round(width / aspectRatio)

    return ReactDOM.createPortal(
        <div ref={containerRef} style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            width,
            zIndex: 1000,
            borderRadius: 'var(--rokdock-radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--rokdock-shadow-elevated)',
            display: 'flex',
            flexDirection: 'column',
            userSelect: 'none',
        }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: TOOLBAR_HEIGHT,
                    cursor: 'grab',
                    background: 'var(--rokdock-bg-surface)',
                    borderBottom: '1px solid var(--rokdock-border)',
                    flexShrink: 0,
                    position: 'relative',
                }}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
            >
                <div style={{ display: 'flex', gap: 3, alignItems: 'center', opacity: 0.4 }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} style={{
                            width: 3, height: 3, borderRadius: '50%',
                            background: 'var(--rokdock-text)',
                        }} />
                    ))}
                </div>
                <div
                    style={{
                        position: 'absolute', right: 2, top: 0, bottom: 0,
                        display: 'flex', alignItems: 'center', gap: 0, cursor: 'default',
                    }}
                    onPointerDown={e => e.stopPropagation()}
                >
                    <CaptureVolumeControl disabled={!captureDeviceId} />
                    <IconButton size="sm" title="Pop out capture window" onClick={openPopout} disabled={!captureDeviceId}>
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </IconButton>
                    <IconButton size="sm" title="Dock capture" onClick={dockCapture}>
                        <FontAwesomeIcon icon={faWindowMaximize} />
                    </IconButton>
                </div>
            </div>
            <div ref={bodyRef} style={{ width, height, flexShrink: 0, overflow: 'hidden' }}>
                <CapturePreview mode="pip" active={true} />
            </div>
            {/* Corner resize handles */}
            {(['tl', 'tr', 'bl', 'br'] as Corner[]).map(corner => (
                <div
                    key={corner}
                    style={{
                        position: 'absolute',
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        cursor: CORNER_CURSORS[corner],
                        zIndex: 1001,
                        ...CORNER_POSITIONS[corner],
                    }}
                    onPointerDown={makeResizeStart(corner)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeEnd}
                />
            ))}
        </div>,
        document.body
    )
}
