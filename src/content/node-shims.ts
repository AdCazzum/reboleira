// Node's `Buffer`, for the 0G SDKs' browser builds.
//
// The 0G Compute SDK base64-encodes its session token with `Buffer.from(...)`
// while building the Authorization header (see getHeader() in the SDK), and the
// storage SDK reaches for it too. Neither imports it: they expect the Node
// global. In a browser that throws "Buffer is not defined", which is where every
// live-inference attempt died.
//
// Why not `globalThis.Buffer = Buffer`: injected.ts runs in the MAIN world of
// whatever page the user is on, so that would publish a Node marker onto a
// third-party page and could push its libraries down Node code paths. Instead,
// vite.config.ts rewrites every bare `Buffer` identifier in the bundle to
// `globalThis.__ensightBuffer` — a name no library probes for — and this module
// fills it in. The page sees one inert extra property and no Node globals.
//
// NOTE: accessed as `BufferModule.Buffer`, a member expression, precisely
// because the build-time substitution targets bare `Buffer` identifiers: a
// plain `import { Buffer }` here would be rewritten into a self-reference.
import * as BufferModule from 'buffer';

(globalThis as any).__ensightBuffer ??= BufferModule.Buffer;
