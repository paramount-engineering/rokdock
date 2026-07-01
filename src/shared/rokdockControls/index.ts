/**
 * RokDock shared Web Components library.
 * Each component is a custom element using Shadow DOM.
 * Internal styles reference --rokdock-* CSS custom properties.
 *
 * This file is built by Vite into out/shared/rokdock-controls.js
 * and injected into every window by the preload script.
 */

// Components are imported and registered here as they are built.
// Each import file calls customElements.define() as a side effect.

import './iconBtn'
import './toggle'
import './slider'
import './numberInput'
import './panel'
import './toolbar'
import './collapsible'
import './select'
import './chip'
import './pillInput'
import './zoomDock'
import './checkerboard'
import './tabs'
import './card'
import './remote'
import './segmented'
import './settingsGear'
