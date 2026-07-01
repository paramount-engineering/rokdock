/**
 * Shared XML parser instances for ECP and SSDP response parsing.
 *
 * Centralizes fast-xml-parser configuration so all services use consistent
 * settings. Two variants are provided:
 *  - xmlParser: full attribute support (needed for ECP responses that use XML
 *    attributes like <app id="...">)
 *  - xmlParserSimple: no attribute parsing (faster, for device-info which uses
 *    only element content)
 */

import { XMLParser } from 'fast-xml-parser'

/** Shared XMLParser with attribute support. Reuse across all services that parse ECP/SSDP XML. */
export const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

/** Shared XMLParser without attribute parsing - for simple element-only XML like device-info. */
export const xmlParserSimple = new XMLParser()
