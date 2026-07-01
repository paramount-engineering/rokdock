/**
 * Absolute filesystem paths to bundled app resources, resolved from the main
 * process bundle location. Centralized so window-creation sites share one
 * source of truth rather than each repeating the relative path.
 */
import path from 'path'

/** Main application icon (PNG), used as the BrowserWindow icon on Windows and Linux. */
export const APP_ICON_PATH = path.join(__dirname, '../../resources/icons/icon.png')

/**
 * Absolute path to the bundled MCP stdio bridge script. The bridge is compiled
 * to a single CJS file under out/mcpBridge/ alongside the main bundle.
 * At runtime __dirname is out/main/, so we step up one level to reach out/.
 */
export const MCP_BRIDGE_PATH = path.join(__dirname, '../mcpBridge/docsToolBridge.js')
