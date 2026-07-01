declare module '*.png' {
    const src: string
    export default src
}

// Side-effect CSS imports (import './foo.css'). TypeScript 6 requires a
// declaration for these; the bundler injects the styles, so there is no value.
declare module '*.css'
