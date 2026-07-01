/**
 * Global type augmentation for the renderer process.
 *
 * Declares window.rokdock as the RokDockAPI type exposed by the preload
 * script so TypeScript can type-check all IPC calls in renderer components
 * without any runtime import (the actual object is injected by the preload).
 */
import type { RokDockAPI } from '../preload/preload'

declare global {
    interface Window {
        rokdock: RokDockAPI
    }
}
