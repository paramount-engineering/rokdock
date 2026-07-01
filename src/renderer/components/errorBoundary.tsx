/**
 * Top-level React error boundary.
 *
 * Catches render errors in the component tree via getDerivedStateFromError and
 * componentDidCatch. On error the tree is replaced with a centered fallback UI
 * that uses existing --rokdock-* CSS variables so it respects the active theme.
 * A "Reload" button calls location.reload() to let the user recover without
 * restarting the whole app.
 *
 * componentDidCatch forwards the error to the main process log file via
 * window.rokdock.app.logError (guarded for existence so this works even if the
 * preload has not fully initialized).
 */

import React, { Component } from 'react'
import type { ErrorInfo, ReactNode, CSSProperties } from 'react'
import { formatError, reportRendererError } from '../utils/errorLogging'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    errorMessage: string
}

const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100vw',
    background: 'var(--rokdock-bg, #1a1a1a)',
    color: 'var(--rokdock-text, #e0e0e0)',
    fontFamily: 'var(--rokdock-font-family, system-ui, sans-serif)',
    padding: '2rem',
    boxSizing: 'border-box',
    gap: '1rem',
    textAlign: 'center',
}

const headingStyle: CSSProperties = {
    fontSize: '1.25rem',
    fontWeight: 600,
    margin: 0,
    color: 'var(--rokdock-text, #e0e0e0)',
}

const messageStyle: CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--rokdock-text-secondary, #999)',
    maxWidth: 480,
    wordBreak: 'break-word',
    margin: 0,
}

const reloadButtonStyle: CSSProperties = {
    marginTop: '0.5rem',
    padding: '0.5rem 1.25rem',
    borderRadius: 'var(--rokdock-radius, 4px)',
    border: '1px solid var(--rokdock-brand-primary, #4fc3f7)',
    background: 'transparent',
    color: 'var(--rokdock-brand-primary, #4fc3f7)',
    fontSize: '0.875rem',
    cursor: 'pointer',
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, errorMessage: '' }
    }

    static getDerivedStateFromError(error: unknown): State {
        const message =
            error instanceof Error ? error.message : String(error)
        return { hasError: true, errorMessage: message }
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        const detail = `${formatError(error)}\n\nComponent stack:${info.componentStack ?? ''}`
        reportRendererError('renderer:ErrorBoundary', detail)
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div style={containerStyle}>
                    <p style={headingStyle}>Something went wrong</p>
                    {this.state.errorMessage ? (
                        <p style={messageStyle}>{this.state.errorMessage}</p>
                    ) : null}
                    <button
                        style={reloadButtonStyle}
                        onClick={() => location.reload()}
                    >
                        Reload
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
