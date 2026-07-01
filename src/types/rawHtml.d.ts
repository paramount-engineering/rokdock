declare module '*.html?raw' {
    const content: string
    export default content
}

declare module '*.svg?raw' {
    const content: string
    export default content
}

declare module '*.js?url' {
    const url: string
    export default url
}
