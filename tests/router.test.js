import test from 'node:test';
import assert from 'node:assert/strict';
import { installRouter, validateProfile, providerOverrides, streamChunk, ENDPOINT } from '../router.js';

function fixture(overrides = {}, options = {}) {
    const passthrough = [];
    const requests = [];
    const mainSettings = { model: 'main-model', endpoint: 'main', secretSelection: 'main-secret' };
    const settings = { enabled: true, profileId: 'pin', model: '', maxTokens: 256, timeoutSeconds: 10 };
    const profile = { id: 'pin', api: 'openai', model: 'other-model', 'secret-id': 'opaque-reference' };
    const ctx = { mainApi: 'openai', extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [profile], selectedProfile: 'main' } }, CONNECT_API_MAP: { openai: { selected: 'openai', source: 'openai' }, local: { selected: 'textgenerationwebui', type: 'koboldcpp' } } };
    const service = {
        isProfileSupported: () => true,
        constructPrompt: messages => 'formatted:' + messages[0].content,
        async sendRequest(...args) { requests.push(args); return { content: 'Pinned reply' }; },
        ...overrides,
    };
    const base = async (...args) => { passthrough.push(args); return Response.json({ main: true }); };
    const host = { fetch: base };
    const router = installRouter({ host, origin: 'http://localhost:8000', getSettings: () => settings, getContext: () => ctx, service, ...options });
    const payload = { type: 'impersonate', messages: [{ role: 'user', content: 'hello' }], stream: false, chat_completion_source: 'openai', model: 'main-model', reverse_proxy: 'do-not-forward', proxy_password: 'do-not-forward', secret_id: 'do-not-forward', max_tokens: 128 };
    const send = (patch = {}, signal) => host.fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ ...payload, ...patch }), signal });
    return { passthrough, requests, mainSettings, settings, ctx, profile, host, router, base, payload, send };
}

test('only native same-origin Impersonate is intercepted', async () => {
    const f = fixture();
    for (const type of ['normal', 'quiet', 'continue', 'swipe']) await f.send({ type });
    await f.host.fetch('https://example.com' + ENDPOINT, { method: 'POST', body: JSON.stringify(f.payload) });
    await f.host.fetch(ENDPOINT, { method: 'GET' });
    await f.host.fetch(ENDPOINT, { method: 'POST', body: 'invalid JSON' });
    await f.host.fetch(new Request('http://localhost:8000' + ENDPOINT, { method: 'POST', body: JSON.stringify(f.payload) }));
    assert.equal(f.requests.length, 0);
    assert.equal(f.passthrough.length, 8);
    f.router.dispose();
});

test('routes pin without forwarding main credentials or mutating connection state', async () => {
    const f = fixture();
    const before = structuredClone(f.ctx);
    const result = await (await f.send()).json();
    assert.equal(result.choices[0].message.content, 'Pinned reply');
    assert.equal(f.passthrough.length, 0);
    assert.equal(f.requests[0][0], 'pin');
    assert.deepEqual(f.requests[0][1], f.payload.messages);
    assert.equal(f.requests[0][2], 256);
    assert.deepEqual(f.requests[0][4], {});
    assert.equal(f.requests[0][3].includePreset, false);
    assert.equal(JSON.stringify(f.requests).includes('do-not-forward'), false);
    assert.deepEqual(f.ctx, before);
    await f.send({ type: 'normal' });
    assert.equal(f.passthrough.length, 1);
    f.router.dispose();
});

test('uses model override and formats text completion target', async () => {
    const f = fixture();
    f.settings.model = '  other-version  ';
    f.profile.api = 'local';
    f.profile['api-url'] = 'http://target.local';
    await f.send();
    assert.equal(f.requests[0][1], 'formatted:hello');
    assert.deepEqual(f.requests[0][4], { model: 'other-version' });
    f.router.dispose();
});

test('invalid, deleted and disabled profiles fail closed', async () => {
    for (const change of [f => f.settings.profileId = 'missing', f => f.ctx.extensionSettings.disabledExtensions.push('connection-manager'), f => delete f.profile['secret-id'], f => delete f.profile.model]) {
        const f = fixture();
        change(f);
        await assert.rejects(f.send(), /No fallback request was sent/);
        assert.equal(f.passthrough.length, 0);
        assert.equal(f.requests.length, 0);
        f.router.dispose();
    }
});

test('provider failures are sanitized and do not fall back', async () => {
    const f = fixture({ async sendRequest() { throw new Error('private-provider-diagnostic'); } });
    await assert.rejects(f.send(), error => !error.message.includes('private-provider-diagnostic') && /No fallback/.test(error.message));
    assert.equal(f.passthrough.length, 0);
    f.router.dispose();
});

test('disabled extension is a transparent pass-through', async () => {
    const f = fixture();
    f.settings.enabled = false;
    await f.send();
    assert.equal(f.requests.length, 0);
    assert.equal(f.passthrough.length, 1);
    f.router.dispose();
});

test('streaming adapts cumulative profile output into native provider deltas', async () => {
    for (const source of ['openai', 'claude', 'makersuite', 'vertexai', 'cohere', 'openrouter']) {
        const f = fixture({ async sendRequest() { return async function* () { yield { text: 'Hi' }; yield { text: 'Hi there' }; }; } });
        const response = await f.send({ stream: true, chat_completion_source: source });
        assert.equal(response.headers.get('content-type'), 'text/event-stream');
        const frames = (await response.text()).split('\n\n').filter(Boolean).map(frame => frame.slice(6));
        assert.deepEqual(JSON.parse(frames[0]), streamChunk(source, 'Hi'));
        assert.deepEqual(JSON.parse(frames[1]), streamChunk(source, ' there'));
        assert.equal(frames[2], '[DONE]');
        f.router.dispose();
    }
});

test('pre-aborted request never reaches provider', async () => {
    const f = fixture();
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.send({}, controller.signal));
    assert.equal(f.requests.length, 0);
    f.router.dispose();
});

test('Stop aborts the in-flight profile signal', async () => {
    let signal;
    const f = fixture({ async sendRequest(_id, _prompt, _max, options) {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    } });
    const pending = f.send();
    f.router.stop();
    await assert.rejects(pending);
    assert.equal(signal.aborted, true);
    assert.equal(f.passthrough.length, 0);
    f.router.dispose();
});

test('Stop after Response creation closes the synthetic stream', async () => {
    const f = fixture({ async sendRequest() { return async function* () { yield { text: 'Hi' }; await new Promise(() => {}); }; } });
    const response = await f.send({ stream: true });
    f.router.stop();
    await assert.rejects(response.text());
    f.router.dispose();
});

test('simultaneous normal request uses original fetch during pinned work', async () => {
    let release;
    const f = fixture({ sendRequest() { return new Promise(resolve => release = resolve); } });
    const pinned = f.send();
    const normal = await (await f.send({ type: 'normal' })).json();
    assert.equal(normal.main, true);
    release({ content: 'Done' });
    await pinned;
    assert.equal(f.passthrough.length, 1);
    f.router.dispose();
});

test('dispose restores only its own fetch wrapper', async () => {
    const f = fixture();
    f.router.dispose();
    assert.equal(f.host.fetch, f.base);
    const g = fixture();
    const own = g.host.fetch;
    g.host.fetch = (...args) => own(...args);
    const later = g.host.fetch;
    g.router.dispose();
    assert.equal(g.host.fetch, later);
    await g.send();
    assert.equal(g.requests.length, 0);
});

test('guard rejects missing explicit key reference without reading secrets', () => {
    const f = fixture();
    delete f.profile['secret-id'];
    assert.throws(() => validateProfile(f.ctx, { isProfileSupported: () => true }, 'pin'), /Secret/);
    f.router.dispose();
});

test('text targets must not inherit the active server URL', async () => {
    const f = fixture();
    f.profile.api = 'local';
    await assert.rejects(f.send(), /No fallback/);
    assert.equal(f.requests.length, 0);
    f.router.dispose();
});

test('timeout aborts target work and does not fall back', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    const f = fixture({ sendRequest(_id, _prompt, _max, options) {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    } });
    const pending = f.send();
    t.mock.timers.tick(10000);
    await assert.rejects(pending);
    assert.equal(signal.aborted, true);
    assert.equal(f.passthrough.length, 0);
    f.router.dispose();
});

test('parent signal cancellation propagates after dispatch', async () => {
    let signal;
    const f = fixture({ sendRequest(_id, _prompt, _max, options) {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    } });
    const parent = new AbortController();
    const pending = f.send({}, parent.signal);
    parent.abort();
    await assert.rejects(pending);
    assert.equal(signal.aborted, true);
    f.router.dispose();
});

test('Vertex Service Account explicitly sends full auth mode without inheriting main auth', async () => {
    const f = fixture({}, { getActiveVertexSecretId: () => 'opaque-reference' });
    f.ctx.CONNECT_API_MAP.openai.source = 'vertexai';
    f.settings.vertexAuthMode = 'full';
    f.settings.vertexRegion = 'global';
    await f.send({ vertexai_auth_mode: 'express', vertexai_region: 'unwanted-main-region' });
    assert.deepEqual(f.requests[0][4], { vertexai_auth_mode: 'full', vertexai_region: 'global', vertexai_express_project_id: '' });
    assert.equal(JSON.stringify(f.requests).includes('unwanted-main-region'), false);
    f.router.dispose();
});

test('Vertex defaults to full auth and uses region saved in profile', async () => {
    const f = fixture({}, { getActiveVertexSecretId: () => 'opaque-reference' });
    f.ctx.CONNECT_API_MAP.openai.source = 'vertexai';
    f.profile['api-url'] = 'europe-west4';
    await f.send();
    assert.equal(f.requests[0][4].vertexai_auth_mode, 'full');
    assert.equal(f.requests[0][4].vertexai_region, 'europe-west4');
    f.router.dispose();
});

test('Vertex Express passes explicit auth and project fields', () => {
    const f = fixture();
    f.ctx.CONNECT_API_MAP.openai.source = 'vertexai';
    let inspectedMode;
    const result = providerOverrides(f.ctx, f.profile, { vertexAuthMode: 'express', vertexRegion: 'global', vertexProjectId: 'test-project' }, mode => { inspectedMode = mode; return 'opaque-reference'; });
    assert.equal(inspectedMode, 'express');
    assert.deepEqual(result, { vertexai_auth_mode: 'express', vertexai_region: 'global', vertexai_express_project_id: 'test-project' });
    f.router.dispose();
});

test('Vertex mismatched active credential fails closed instead of authenticating as another account', async () => {
    const f = fixture({}, { getActiveVertexSecretId: () => 'different-account' });
    f.ctx.CONNECT_API_MAP.openai.source = 'vertexai';
    await assert.rejects(f.send(), /No fallback/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.passthrough.length, 0);
    f.router.dispose();
});
