# Routing and safety design

## Why the extension does not switch profiles

The inspected release is SillyTavern 1.19.0 at commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (release branch head checked 26 October 2026).

`Generate()` emits `GENERATION_STARTED` before processing slash commands and caching the instruct-mode decision. `GENERATION_AFTER_COMMANDS` comes after that cache. There are early returns and failures before the generation's request/finalization section. `GENERATION_ENDED` is emitted by `hideStopButton()` only when the stop button had been visible. Event listener exceptions are caught by the event emitter; throwing in a listener is not a reliable fail-closed cancellation mechanism. Thus a global profile swap tied only to these lifecycle events cannot guarantee timely restoration.

Instead, this extension keeps every connection setting unchanged and substitutes the transport for an individual native Impersonate request. Restoration is unnecessary. The browser `fetch` wrapper is an explicit compatibility boundary, not an advertised official request-override API.

## Request path

1. The manifest generation interceptor sees an explicit generation type. It aborts Impersonate with unsupported main APIs or invalid profile selections. SillyTavern skips generation interceptors during dry runs.
2. Native Chat Completion builds its full prompt and calls `sendOpenAIRequest(type, messages, signal)`. The resulting JSON payload carries `type: 'impersonate'`.
3. The wrapper only claims same-origin `POST /api/backends/chat-completions/generate`, with a string JSON body and that exact type. It neither consumes arbitrary `Request` objects nor matches by a remembered global generation mode. It passes ordinary, quiet, swipe, continue, profile-service, other-origin and unrelated requests through to the previous fetch unchanged.
4. It snapshots the extension's small options for this request, validates the selected profile, copies only the messages, and invokes `ConnectionManagerRequestService.sendRequest()`. The fresh target request does not inherit the main payload's auth, URL, tools or proxy fields. A model override is passed as a structured object, never as executable slash-command text.
5. The built-in service resolves the profile by ID and routes it through ChatCompletionService or TextCompletionService. Its own requests have a different/no generation type, so they pass through the wrapper without recursion. No slash commands are generated and no global profile is selected.
6. Extracted target text is converted to a minimal native reply. Streaming cumulative text is converted into deltas shaped for the original main provider's stream reader. This avoids parsing Claude/Gemini target events with an OpenAI reader, or the reverse. Reasoning and metadata are intentionally omitted.
7. Parent abort signal, normal Stop, panel Stop, chat change, page hide and timeout cancel target work. Completion/failure/cancel removes timers and parent listeners. A transport failure rejects the original native fetch, letting the core generation error path unlock the UI; there is no retry to the main model.

The wrapper's disposal routine restores the previous fetch only if it still owns the fetch slot. A later wrapper is never overwritten. Normal extension enable/disable in SillyTavern should be followed by reload.

## Credentials and preset isolation

The extension requires a nonempty saved `secret-id`, an opaque reference, so it cannot accidentally rely on the globally selected credential. No secret endpoint is called by the extension. Profiles and keys remain owned by SillyTavern.

Vertex-specific correction in 1.0.1: the profile service omits `vertexai_auth_mode`, while the backend defaults missing mode to Express. The extension now provides an explicit Full/Express mode, region and optional Express project ID without copying active main settings. Full is the default for Service Account users. Also, upstream `getVertexAIAuth()` in `src/endpoints/google.js` reads the active Vertex secret without passing `request.body.secret_id`, even though the later project lookup does pass that ID. The extension therefore requires the selected profile's credential ID to match the active secret ID of the chosen Vertex auth mode. Only secret metadata is inspected, via `secret_state`; no secret values are requested and global credentials are not rotated. This is a compatibility restriction until upstream supports request-scoped Vertex authentication consistently.

In this release, `ChatCompletionService.presetToGeneratePayload()` clones the current `oai_settings` before merging a preset. Missing fields can therefore inherit active headers or routing data. The extension sets `includePreset: false` on purpose. Generation sampler settings are provider defaults; the target profile's route/secret/proxy and an explicit maximum token limit are supplied to a fresh request. Proxy credentials are accessed only within SillyTavern's own profile service. Users needing custom literal headers must configure/test an appropriate provider connection; arbitrary header inheritance is not supported.

## Source evidence

All links are pinned to the audited commit:

- [`public/script.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js): `Generate`, `hideStopButton`, `sendGenerationRequest`, `sendStreamingRequest`, `extractMessageFromData`.
- [`public/scripts/openai.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js): `createGenerationParameters` includes request type; `sendOpenAIRequest` sends the native endpoint; `getStreamingReply` branches on provider.
- [`public/scripts/extensions/shared.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/shared.js): `ConnectionManagerRequestService.sendRequest`, `constructPrompt`, `isProfileSupported`.
- [`public/scripts/custom-request.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/custom-request.js): profile services, extracted text, cumulative stream generator, preset conversion.
- [`public/scripts/extensions.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js): manifest interceptors and abort callback.
- [`public/lib/eventemitter.js`](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/lib/eventemitter.js): event exceptions are caught.

## Scope of guarantees

The guarantees apply to the inspected native Chat Completion request path with this wrapper/interceptor intact. They do not cover other extensions replacing that path or future breaking changes. Current source inspection and isolated tests are completed; real browser/provider integration must be confirmed on the user's installation using TESTING.md. Main-API Text Completion support requires a reliable request-level type or a core hook before it can be added without ambiguous global state.
