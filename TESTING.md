# Validation

## Automated tests

From this extension folder run:

```sh
node --test tests/router.test.js
```

The tests use stubbed services, synthetic `Response` streams, and no live providers. They exercise request scoping, normal-request passthrough, simultaneous normal/pinned requests, main-state preservation, credential isolation, model override, text target formatting, missing/disabled profiles, sanitized errors, no fallback, streaming adaptations, cancellation and safe fetch disposal.

Build verification (1.0.1): **20 automated tests passed**, plus JavaScript syntax checks. An additional isolated check evaluated the actual audited upstream `ConnectionManagerRequestService` and `ChatCompletionService` classes against a synthetic backend: the pinned model and secret reference reached that backend, with no recursive dispatch or inherited main proxy/header credentials. Vertex Full mode, region and secret reference also survived that actual service stack. This check used upstream source as scratch input and is not bundled as a live-provider test. Vertex regression tests cover Full, Express, profile region fallback and blocking mismatched active credentials.

## Manual acceptance checks (not yet executed)

Use disposable chats and already-configured test profiles. Do not copy keys into screenshots, test fixtures or bug reports.

| Check | Expected result |
| --- | --- |
| Choose main model A and pinned profile model B; run native Impersonate | Input box gets B's reply; API selection still shows A |
| Send the generated user text | Ordinary character reply uses A |
| Use `/impersonate await=true Write a short greeting` | Native slash behavior completes using B |
| Pin a second provider, e.g. OpenRouter to Claude or vice versa | Text appears correctly with streaming on and off |
| Main provider Claude, Gemini/Vertex or Cohere; target a different provider | Native stream reader displays normalized text |
| Pin Text Completion with a saved instruct template and explicit secret | Target receives formatted native Impersonate messages |
| Make unsaved main model/prompt/sampler changes, then Impersonate | All main settings remain unchanged |
| Normal Stop during connection establishment or streaming | Target aborts; native UI becomes usable |
| Panel Stop, timeout or chat change during streaming | Target aborts; no reply is inserted into the new chat |
| Invalid model, deleted profile, deleted secret or provider error | Clear failure; no request sent to main as fallback |
| Prompt-only/dry-run action | No target request and no connection switch |
| Group chat Impersonate | Native group prompt behavior preserved; only actual impersonation request routes |
| Disconnected main API | Core can exit early; connecting main allows normal operation |
| Main API Text Completion with routing enabled | Guard blocks Impersonate with a compatibility message |
| Reload during generation | No main profile restoration is needed |
| Disable and reload | Native behavior restored |

Observe provider/model routing using your server/provider's safe request metadata, never by exporting full request headers or secret files. A browser console can contain SillyTavern's own prompt/debug output; sanitize it before sharing.
