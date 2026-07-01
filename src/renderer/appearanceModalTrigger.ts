/**
 * Registers the in-window Appearance modal opener for a tool window.
 *
 * The settings gear (the shared <rokdock-settings-gear> control) and the Docs
 * gear button both dispatch a 'rokdock-open-appearance' DOM event. This listener
 * lazily imports the React modal on first open, so the modal (and React) stay out
 * of the lean vanilla tool-window boot bundles and load only when needed.
 *
 * Each bundled tool-window entry imports this module once for its side effect.
 */

let loading = false

document.addEventListener('rokdock-open-appearance', () => {
    if (loading) return
    loading = true
    void import('./components/settings/appearanceModal')
        .then(mod => mod.mountAppearanceModal())
        .finally(() => { loading = false })
})
