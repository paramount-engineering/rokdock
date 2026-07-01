import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterPages } from './quickOpenSearch'
import type { QuickOpenPage } from './quickOpenSearch'

export interface QuickOpenProps {
    pages: QuickOpenPage[]
    isOpen: boolean
    onClose: () => void
    onOpen: (path: string) => void
}

export function QuickOpen({ pages, isOpen, onClose, onOpen }: QuickOpenProps): React.JSX.Element | null {
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLUListElement>(null)

    // Reset query and selection whenever the palette opens.
    useEffect(() => {
        if (isOpen) {
            setQuery('')
            setActiveIndex(0)
            // Focus the input on the next frame so the DOM is mounted.
            requestAnimationFrame(() => inputRef.current?.focus())
        }
    }, [isOpen])

    // Close on Escape from anywhere while open, not only when the input holds
    // focus, so closing never races the focus above.
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    const results = useMemo(() => filterPages(pages, query), [pages, query])

    // Scroll the active row into view when the keyboard moves it.
    useEffect(() => {
        const list = listRef.current
        if (!list) return
        const active = list.querySelector<HTMLElement>('[aria-selected="true"]')
        active?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex])

    const openResult = useCallback(
        (page: QuickOpenPage): void => {
            onOpen(page.path)
            onClose()
        },
        [onOpen, onClose],
    )

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex(i => Math.min(i + 1, Math.max(0, results.length - 1)))
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
                e.preventDefault()
                const target = results[activeIndex]
                if (target) openResult(target)
            }
            // Escape is handled by a window-level listener (see above) so it
            // closes regardless of where focus currently sits.
        },
        [results, activeIndex, openResult],
    )

    const onQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
        setQuery(e.target.value)
        setActiveIndex(0)
    }, [])

    if (!isOpen) return null

    const listId = 'docs-quickopen-listbox'

    return (
        <div
            className="docs-quickopen-backdrop"
            onMouseDown={(e) => {
                // Close only when clicking the backdrop itself, not the panel.
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div
                className="docs-quickopen"
                role="dialog"
                aria-modal="true"
                aria-label="Quick open"
            >
                <input
                    ref={inputRef}
                    type="text"
                    className="docs-quickopen-input"
                    placeholder="Jump to page..."
                    role="combobox"
                    aria-label="Search pages"
                    aria-autocomplete="list"
                    aria-controls={listId}
                    aria-activedescendant={results[activeIndex] ? `docs-quickopen-item-${activeIndex}` : undefined}
                    value={query}
                    onChange={onQueryChange}
                    onKeyDown={onKeyDown}
                />
                {results.length === 0 && (
                    <div className="docs-quickopen-empty">
                        No pages match
                    </div>
                )}
                <ul
                    id={listId}
                    ref={listRef}
                    className="docs-quickopen-list"
                    role="listbox"
                    aria-label="Pages"
                >
                    {results.map((page, index) => (
                        <li
                            key={page.path}
                            id={`docs-quickopen-item-${index}`}
                            className={`docs-quickopen-item${index === activeIndex ? ' docs-quickopen-item--active' : ''}`}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseDown={() => openResult(page)}
                            onMouseEnter={() => setActiveIndex(index)}
                        >
                            <span className="docs-quickopen-item-title">{page.title}</span>
                            <span className="docs-quickopen-item-section">{page.section}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
