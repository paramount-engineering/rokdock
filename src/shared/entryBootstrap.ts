// Shared bootstrap for bundled tool-window entries: registers the rokdock web
// components and loads the shared component + font styles (side-effect imports),
// and re-exports the theme boot so an entry needs a single import for all of it.
import './rokdockControls'
import './rokdockComponents.css'
import './fonts.css'
export { bootBundledTheme } from './themeBoot'
