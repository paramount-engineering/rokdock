/**
 * Default Telnet port configurations for Roku BrightScript debugging.
 * Each port has a label and color used in the tab bar and terminal header.
 *
 * Users can enable/disable individual ports and add custom ports via Settings.
 * The defaults match Roku's standard debug port assignments.
 */

import type { PortConfig } from './types'

/** Roku External Control Protocol (ECP) port. All ECP HTTP requests target this port. */
export const ECP_PORT = 8060

export const DEFAULT_PORT_CONFIGS: PortConfig[] = [
    { port: 8085, label: 'BrightScript Debug', color: '#81c784', enabled: true },
    { port: 8080, label: 'Commands', color: '#4fc3f7', enabled: true },
    { port: 8087, label: 'Screensaver', color: '#ffb74d', enabled: true }
]

/**
 * Returns a shallow clone of the default port configurations.
 * Callers should use this rather than referencing {@link DEFAULT_PORT_CONFIGS}
 * directly to avoid mutating the shared constant.
 *
 * @returns A new array of {@link PortConfig} objects with default values.
 */
export function cloneDefaultPortConfigs(): PortConfig[] {
    return DEFAULT_PORT_CONFIGS.map(config => ({ ...config }))
}

/**
 * Returns the human-readable label for a port number.
 * Falls back to `"Port <n>"` for ports not in the default configuration.
 *
 * @param port - The TCP port number to look up.
 * @returns The label string for the port.
 */
export function getPortLabel(port: number): string {
    const match = DEFAULT_PORT_CONFIGS.find(config => config.port === port)
    return match?.label ?? `Port ${port}`
}
