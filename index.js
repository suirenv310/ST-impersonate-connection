import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { secret_state, SECRET_KEYS } from '/scripts/secrets.js';
import { installRouter, validateProfile, providerOverrides } from './router.js';

const KEY = 'impersonateConnection';
const context = () => SillyTavern.getContext();
const defaults = { enabled: false, profileId: '', model: '', maxTokens: 512, timeoutSeconds: 180,
    vertexAuthMode: 'full', vertexRegion: '', vertexProjectId: '' };
// Secret state contains labels/IDs/active flags, never plaintext credential values.
const getActiveVertexSecretId = mode => {
    const key = mode === 'full' ? SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT : SECRET_KEYS.VERTEXAI;
    return secret_state[key]?.find(secret => secret.active)?.id;
};
const settings = () => context().extensionSettings[KEY];
context().extensionSettings[KEY] = { ...defaults, ...context().extensionSettings[KEY] };
let statusElement;
let transport;
const setStatus = text => { if (statusElement) statusElement.textContent = text; };

// Interceptors are skipped on dry runs by ST. No current generation type is stored globally.
globalThis.impersonateConnectionGuard = async (_chat, _size, abort, type) => {
    if (!settings().enabled || type !== 'impersonate') return;
    try {
        if (context().mainApi !== 'openai') throw new Error('This version requires Chat Completion as the main API.');
        const profile = validateProfile(context(), ConnectionManagerRequestService, settings().profileId);
        providerOverrides(context(), profile, settings(), getActiveVertexSecretId);
    } catch (error) {
        abort(true);
        setStatus(error.message);
        toastr.warning(error.message, 'Impersonate Connection');
    }
};

function mount() {
    if (document.getElementById('impersonate-connection')) return;
    const root = document.createElement('div');
    root.id = 'impersonate-connection';
    root.className = 'extension_container';
    root.innerHTML = `<div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header"><b>Impersonate Connection</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" data-field="enabled"><span>Use a separate profile for Impersonate</span></label>
        <label>Connection profile<select class="text_pole" data-field="profileId"></select></label>
        <label>Model override (optional)<input class="text_pole" data-field="model" type="text" autocomplete="off" placeholder="Use model saved in profile"></label>
        <label>Maximum reply tokens<input class="text_pole" data-field="maxTokens" type="number" min="1" max="32768"></label>
        <label>Timeout in seconds<input class="text_pole" data-field="timeoutSeconds" type="number" min="10" max="3600"></label>
        <label>Vertex AI authentication (Vertex profiles only)<select class="text_pole" data-field="vertexAuthMode"><option value="full">Full — Service Account JSON</option><option value="express">Express — API key</option></select></label>
        <label>Vertex AI region (optional)<input class="text_pole" data-field="vertexRegion" type="text" placeholder="Profile region, or us-central1; use global if required"></label>
        <label>Vertex Express project ID (optional)<input class="text_pole" data-field="vertexProjectId" type="text" placeholder="Express mode only"></label>
        <div class="ic-buttons"><button type="button" class="menu_button" data-action="refresh">Refresh profiles</button><button type="button" class="menu_button" data-action="stop">Stop pinned request</button></div>
        <p>Main API must be Chat Completion. The profile needs a saved Secret selection. Main connection settings stay unchanged.</p>
        <p role="status" aria-live="polite" data-status></p>
      </div></div>`;
    document.getElementById('extensions_settings')?.append(root);
    statusElement = root.querySelector('[data-status]');
    for (const input of root.querySelectorAll('[data-field]')) {
        const field = input.dataset.field;
        if (field === 'enabled') input.checked = settings()[field];
        else input.value = settings()[field];
        input.addEventListener('change', () => {
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.type === 'number') {
                value = Math.max(Number(input.min), Math.min(Number(input.max), Number(value) || defaults[field]));
                input.value = value;
            }
            settings()[field] = value;
            context().saveSettingsDebounced();
            setStatus('Settings saved');
        });
    }
    function refresh() {
        const select = root.querySelector('[data-field="profileId"]');
        select.replaceChildren(new Option('Select a profile…', ''));
        for (const profile of context().extensionSettings.connectionManager?.profiles || []) {
            const api = context().CONNECT_API_MAP?.[profile.api];
            if (api && ConnectionManagerRequestService.isProfileSupported(profile)) {
                select.add(new Option(profile.name, profile.id));
            }
        }
        if (settings().profileId && !Array.from(select.options).some(o => o.value === settings().profileId)) {
            select.add(new Option('Selected profile is missing', settings().profileId));
        }
        select.value = settings().profileId;
    }
    refresh();
    root.querySelector('[data-action="refresh"]').addEventListener('click', refresh);
    root.querySelector('[data-action="stop"]').addEventListener('click', () => transport.stop());
    const ctx = context();
    for (const name of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED']) {
        ctx.eventSource.on(ctx.eventTypes[name], refresh);
    }
    setStatus('Ready');
}

transport = installRouter({ host: globalThis, origin: location.origin,
    getSettings: settings, getContext: context, service: ConnectionManagerRequestService, getActiveVertexSecretId, onStatus: setStatus });
context().eventSource.on(context().eventTypes.GENERATION_STOPPED, () => transport.stop());
context().eventSource.on(context().eventTypes.CHAT_CHANGED, () => transport.stop());
context().eventSource.on(context().eventTypes.APP_READY, mount);
window.addEventListener('pagehide', () => transport.stop());
