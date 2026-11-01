// No SillyTavern imports: the transport boundary can be exercised without credentials.
export const ENDPOINT = '/api/backends/chat-completions/generate';
const FAILURE = 'Impersonate connection failed. Check the selected profile and its connection in SillyTavern. No fallback request was sent.';

export function validateProfile(context, service, id) {
    if (context.extensionSettings.disabledExtensions?.includes('connection-manager')) {
        throw new Error('Enable the built-in Connection Manager first.');
    }
    const profile = context.extensionSettings.connectionManager?.profiles?.find(p => p.id === id);
    const api = context.CONNECT_API_MAP?.[profile?.api];
    if (!profile || !api || !service.isProfileSupported(profile)) {
        throw new Error('Select a supported connection profile.');
    }
    if (!profile.model && api.selected === 'openai') {
        throw new Error('Save a model in the selected profile first.');
    }
    if ((api.selected === 'textgenerationwebui' || api.source === 'custom') && !profile['api-url']) {
        throw new Error('Save a server URL in the selected profile first.');
    }
    // Require an explicit reference, so the request cannot silently use the active API key.
    if (!profile['secret-id']) {
        throw new Error('Save a specific API key selection in the profile (Secret field).');
    }
    return profile;
}

export function streamChunk(source, text) {
    if (source === 'claude') return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
    if (source === 'makersuite' || source === 'vertexai') return { candidates: [{ content: { parts: [{ text }] } }] };
    if (source === 'cohere') return { delta: { message: { content: { text } } } };
    return { choices: [{ index: 0, delta: { content: text } }] };
}

export function providerOverrides(context, profile, config, getActiveVertexSecretId) {
    if (context.CONNECT_API_MAP[profile.api].source !== 'vertexai') return {};
    const mode = config.vertexAuthMode || 'full';
    if (!['full', 'express'].includes(mode)) throw new Error('Select a valid Vertex AI authentication mode.');
    // ST 1.19.0's getVertexAIAuth reads the active credential, ignoring secret_id.
    // Require the pinned reference to match it; never rotate global credentials.
    if (getActiveVertexSecretId?.(mode) !== profile['secret-id']) {
        throw new Error('Vertex AI: activate the same saved credential used by this profile in SillyTavern, then update the profile Secret selection.');
    }
    return {
        vertexai_auth_mode: mode,
        vertexai_region: (config.vertexRegion || profile['api-url'] || 'us-central1').trim(),
        vertexai_express_project_id: mode === 'express' ? (config.vertexProjectId || '').trim() : '',
    };
}

// Only the exact same-origin POST used by native Chat Completion Impersonate is routed.
// Ordinary, quiet, dry-run and extension profile-service requests pass through untouched.
export function installRouter({ host, origin, getSettings, getContext, service, getActiveVertexSecretId, onStatus = () => {} }) {
    const previousFetch = host.fetch;
    const active = new Set();
    let installed = true;
    const status = value => { try { onStatus(value); } catch { /* UI must never break transport. */ } };

    async function wrapper(input, init) {
        if (!installed || !getSettings().enabled) return previousFetch.call(host, input, init);
        // Native ST uses string URLs and JSON strings. Do not consume arbitrary Request bodies.
        if (typeof input !== 'string' && !(input instanceof URL)) return previousFetch.call(host, input, init);
        const url = new URL(String(input), origin);
        if (url.origin !== origin || url.pathname !== ENDPOINT || url.search || url.hash
            || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') {
            return previousFetch.call(host, input, init);
        }
        let body;
        try { body = JSON.parse(init.body); } catch { return previousFetch.call(host, input, init); }
        if (body?.type !== 'impersonate') return previousFetch.call(host, input, init);

        const controller = new AbortController();
        const parent = init.signal;
        const abort = () => controller.abort();
        parent?.addEventListener('abort', abort, { once: true });
        if (parent?.aborted) controller.abort();
        const config = { ...getSettings() };
        const timeoutMs = Math.max(10, Number(config.timeoutSeconds) || 180) * 1000;
        const timer = setTimeout(abort, timeoutMs);
        active.add(controller);
        let cleaned = false;
        const clean = () => {
            if (cleaned) return;
            cleaned = true;
            clearTimeout(timer);
            parent?.removeEventListener('abort', abort);
            active.delete(controller);
            status(active.size ? 'Generating…' : 'Ready');
        };
        const fail = () => {
            clean();
            status(controller.signal.aborted ? 'Stopped or timed out' : 'Request failed; no fallback sent');
            return new Error(FAILURE);
        };
        try {
            controller.signal.throwIfAborted();
            const context = getContext();
            const profile = validateProfile(context, service, config.profileId);
            const provider = providerOverrides(context, profile, config, getActiveVertexSecretId);
            if (!Array.isArray(body.messages)) throw new Error('Missing messages');
            const api = context.CONNECT_API_MAP[profile.api];
            const prompt = api.selected === 'textgenerationwebui'
                ? service.constructPrompt(structuredClone(body.messages), profile.id)
                : structuredClone(body.messages);
            const maxTokens = Math.max(1, Math.min(32768, Number(config.maxTokens) || 512));
            status('Generating…');
            // Build a fresh profile request. Never forward main-connection credentials, URLs,
            // proxy passwords, tools or provider-specific payload fields to another provider.
            const result = await service.sendRequest(profile.id, prompt, maxTokens, {
                stream: Boolean(body.stream), signal: controller.signal,
                // ST's preset converter starts with a clone of the active settings.
                // Skip it to prevent inherited headers, URLs or proxy credentials.
                extractData: true, includePreset: false, includeInstruct: true,
            }, { ...provider, ...(config.model.trim() ? { model: config.model.trim() } : {}) });
            controller.signal.throwIfAborted();
            if (!body.stream) {
                if (typeof result?.content !== 'string') throw new Error('Invalid result');
                clean();
                return Response.json({ choices: [{ message: { role: 'assistant', content: result.content } }] });
            }
            if (typeof result !== 'function') throw new Error('Invalid stream');
            const iterator = result();
            const encoder = new TextEncoder();
            let text = '';
            const abortStream = () => {
                try { streamController?.error(new DOMException('Aborted', 'AbortError')); } catch { /* Already closed. */ }
                clean();
            };
            let streamController;
            controller.signal.addEventListener('abort', abortStream, { once: true });
            const finish = () => {
                controller.signal.removeEventListener('abort', abortStream);
                clean();
            };
            const stream = new ReadableStream({
                start(c) { streamController = c; },
                async pull(c) {
                    try {
                        controller.signal.throwIfAborted();
                        const next = await iterator.next();
                        controller.signal.throwIfAborted();
                        if (next.done) {
                            c.enqueue(encoder.encode('data: [DONE]\n\n'));
                            c.close();
                            finish();
                            return;
                        }
                        const full = next.value?.text;
                        if (typeof full !== 'string' || !full.startsWith(text)) throw new Error('Invalid stream text');
                        const delta = full.slice(text.length);
                        text = full;
                        c.enqueue(encoder.encode(`data: ${JSON.stringify(streamChunk(body.chat_completion_source, delta))}\n\n`));
                    } catch {
                        finish();
                        try { c.error(fail()); } catch { /* Already aborted. */ }
                    }
                },
                cancel() {
                    controller.abort();
                    finish();
                    // Abort the network first; do not wait on a generator blocked on a read.
                    void iterator.return?.().catch(() => {});
                },
            });
            return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
        } catch {
            throw fail();
        }
    }
    host.fetch = wrapper;
    return {
        stop() { for (const controller of active) controller.abort(); },
        dispose() {
            installed = false;
            for (const controller of active) controller.abort();
            // Do not remove a wrapper installed later by another extension.
            if (host.fetch === wrapper) host.fetch = previousFetch;
        },
    };
}
