/**
 * Maps Roku `model-number` values from ECP `/query/device-info` to hardware code names
 * from Roku's published hardware specifications (marketing model vs internal code name).
 * Not every regional suffix is listed; callers normalize common patterns first
 * (`RW` / trailing `R` -> `X` for lookup; `3821R2` / `3821RW2` -> `3821X2`, etc.; EU strip; X2 -> X, etc.).
 * If still unmatched, Roku TV-style SKUs (e.g. `7112X`) fall back to `${firstDigit}000X` when that key exists (e.g. `7000X`).
 */
const ROKU_CODENAME_BY_MODEL: Record<string, string> = {
    // Current (representative set from developer.roku.com hardware spec)
    '3840X': 'Lakeport',
    '3830X': 'Bayside',
    '3820X2': 'Logan',
    '3821X2': 'Logan',
    '4850X': 'Brewster',
    '9104X': 'Lockhart',
    K8PXX: 'Avery',
    J000X: 'Trinidad',
    '7000X': 'Longview',
    '8000X': 'Midland / El Paso',
    H000X: 'Miami',
    A000X: 'Reno',
    C000X: 'Malone',
    G000X: 'Athens',
    K000X: 'Roxton',
    L000X: 'Sandia',
    M000X: 'Shiner',
    P000X: 'Damon',
    T100X: 'Alpine',
    // Updatable / common legacy
    '9100X': 'Fruitland',
    '9102X': 'Chico',
    '4800X': 'Benjamin / Benjamin-W',
    '3960X': 'Rockett',
    '3931X': 'Nemo',
    '3940X2': 'Bailey',
    '3941X2': 'Bailey',
    '3942X2': 'Bailey',
    '3600X': 'Briscoe',
    '3700X': 'Littlefield',
    '3710X': 'Littlefield',
    '3800X': 'Amarillo 1080',
    '3810X': 'Amarillo-2019',
    '3811X': 'Amarillo 2019-HP',
    '3820X': 'Madison',
    '3821X': 'Madison',
    '3900X': 'Gilbert',
    '3910X': 'Gilbert',
    '3930X': 'Nemo',
    '3930EU': 'Nemo',
    '3940X': 'Marlin',
    '3941X': 'Marlin',
    '4620X': 'Cooper',
    '4630X': 'Cooper',
    '3920X': 'Gilbert 4K',
    '3921X': 'Gilbert 4K',
    '4640X': 'Cooper',
    '4660X': 'Bryan',
    '4662X': 'Bryan-W',
    '4670X': 'Bryan 2',
    '4200X': 'Austin',
    '4210X': 'Mustang',
    '4230X': 'Mustang',
    '5000X': 'Liberty',
    '6000X': 'Ft. Worth',
    C000GB: 'Camden',
    D000X: 'Roma',
    '4400X': 'Dallas',
    '3400X': 'Jackson',
    '3420X': 'Jackson',
    '3500X': 'Sugarland',
    '2700X': 'Tyler',
    '2710X': 'Tyler',
    '2720X': 'Tyler',
    '2400X': 'Giga',
    '3000X': 'Giga',
    '3050X': 'Giga',
    '3100X': 'Giga',
    '2450X': 'Paolo',
    '2500X': 'Paolo',
    E000X: 'Bandera'
}

/**
 * Normalize regional retail letters before a trailing variant digit (and plain R/RW -> X).
 * e.g. `3821R2` / `3821RW2` -> `3821X2`; `4660R` / `4660RW` -> `4660X`.
 */
function modelWithRetailSuffixNormalized(raw: string): string {
    const trimmed = raw.trim().toUpperCase()
    if (!trimmed) return trimmed
    const rwDigits = trimmed.match(/^(\d+)RW(\d+)$/i)
    if (rwDigits) {
        return `${rwDigits[1]}X${rwDigits[2]}`
    }
    const rDigits = trimmed.match(/^(\d+)R(\d+)$/i)
    if (rDigits) {
        return `${rDigits[1]}X${rDigits[2]}`
    }
    if (trimmed.endsWith('RW')) {
        return `${trimmed.slice(0, -2)}X`
    }
    if (trimmed.endsWith('R')) {
        return `${trimmed.slice(0, -1)}X`
    }
    return trimmed
}

function normalizeModelNumberKeys(raw: string): string[] {
    const normalized = raw.trim().toUpperCase()
    if (!normalized) return []
    const keys = new Set<string>()
    const bases = [normalized]
    if (normalized.endsWith('EU') && normalized.length > 2) {
        bases.push(normalized.slice(0, -2))
    }
    for (const base of bases) {
        keys.add(base)
        const retailNorm = modelWithRetailSuffixNormalized(base)
        if (retailNorm !== base) {
            keys.add(retailNorm)
        }
    }
    for (const k of [...keys]) {
        const variant = k.match(/^(.+X)\d+$/i)
        if (variant?.[1]) {
            keys.add(variant[1].toUpperCase())
        }
    }
    return [...keys]
}

/** When no exact map hit: `7112X` -> `7000X` if `7000X` is in the table (Roku TV line families). */
function codenameFromFirstDigitFamily(modelNumber: string): string {
    let modelUpper = modelNumber.trim().toUpperCase()
    if (modelUpper.endsWith('EU') && modelUpper.length > 2) {
        modelUpper = modelUpper.slice(0, -2)
    }
    let normalized = modelWithRetailSuffixNormalized(modelUpper)
    if (!normalized) return ''
    // 3820X2 -> 3820X before family rule (same as normalizeModelNumberKeys variant strip)
    normalized = normalized.replace(/^(.*X)\d+$/i, '$1')
    const candidate = normalized.match(/^(\d)(\d{2,})X$/)
    if (!candidate) return ''
    const familyModel = `${candidate[1]}000X`
    return ROKU_CODENAME_BY_MODEL[familyModel] ?? ''
}

/** Best-effort code name from ECP `model-number` (and common regional suffixes). */
export function rokuCodenameFromModelNumber(modelNumber: string): string {
    for (const key of normalizeModelNumberKeys(modelNumber)) {
        const hit = ROKU_CODENAME_BY_MODEL[key]
        if (hit) return hit
    }
    return codenameFromFirstDigitFamily(modelNumber)
}

type DeviceInfoXml = Record<string, unknown>

function stringField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

/**
 * Prefer an explicit code name from device-info XML when Roku adds it; otherwise derive
 * from `model-number` using {@link rokuCodenameFromModelNumber}.
 */
export function rokuCodenameFromDeviceInfoXml(info: DeviceInfoXml): string {
    const direct =
        stringField(info['codename'])
        || stringField(info['hardware-codename'])
        || stringField(info['roku-codename'])
    if (direct) return direct
    return rokuCodenameFromModelNumber(stringField(info['model-number']))
}
