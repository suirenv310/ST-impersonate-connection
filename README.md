# Impersonate Connection 1.0.1

Pin a separate saved connection profile and optional model for SillyTavern's native **Impersonate** action. Ordinary replies keep using the current main connection. Works with the Impersonate menu/button and `/impersonate`, including `await=true`.

**Compatibility:** built against SillyTavern **1.19.0**, release commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, inspected on 26 October 2026. The **main API must be Chat Completion**. The pinned profile can use a supported Chat Completion or Text Completion provider. NovelAI, Horde, and native Text Completion as the main API are not supported in this version. SillyTavern's Connection Manager must be enabled.

## Cài nhanh

1. Giải nén ZIP. Chép nguyên thư mục `impersonate-connection` vào thư mục extension bên dưới, để `manifest.json` nằm trực tiếp trong đó.
2. Tải lại trang SillyTavern. Trong **API Connections → Connection Profiles**, tạo profile cho model dùng để Impersonate. Chọn API, model, địa chỉ máy chủ nếu cần và **Secret** cụ thể, rồi lưu/update profile. Hãy thử kết nối đó trước.
3. Quay về kết nối chính thường dùng. Kết nối chính phải ở **Chat Completion**.
4. Mở **Extensions → Impersonate Connection**, chọn profile vừa tạo và bật **Use a separate profile for Impersonate**.
5. Có thể nhập **Model override** nếu muốn ghi đè model trong profile. Bấm Impersonate như bình thường. Reply của nhân vật vẫn dùng kết nối chính.

Extension không có ô nhập API key. Hãy quản lý key trong SillyTavern. Bản này yêu cầu profile lưu một Secret cụ thể; kết nối local không có key chưa được hỗ trợ. Nếu thiếu profile/key hoặc kết nối bị lỗi, yêu cầu Impersonate bị chặn hoặc báo lỗi, không tự chuyển về model chính.

## Install

Stop any ongoing generation before installing/updating. Extract the ZIP and put the entire `impersonate-connection` folder in either:

- Per-user installation: `<SillyTavern>/data/<user-handle>/extensions/impersonate-connection/` (the default user handle is commonly `default-user`). Respect `dataRoot` if you configured a different data folder.
- Shared installation: `<SillyTavern>/public/scripts/extensions/third-party/impersonate-connection/`.

Reload the SillyTavern browser page. No server plugin, build, npm installation, or pasted key is required. Do not install a second copy in the other location.

To install directly in SillyTavern, open **Extensions → Install Extension** and paste:

```text
https://github.com/suirenv310/ST-impersonate-connection.git
```

Reload the page after installation. If you previously installed the ZIP manually, remove that old extension folder before installing through GitHub so that only one copy runs. The built-in installer accepts a Git repository URL, not a ZIP download URL.

## Configure and use

1. Enable the built-in **Connection Manager**, then create a connection profile for the impersonation provider. Save its API, model, endpoint where required, and explicit **Secret** selection. A proxy, if needed, must be saved in this profile too. Do not exclude the Secret field.
2. Verify that profile works in SillyTavern, then return to your usual main Chat Completion connection.
3. In **Extensions → Impersonate Connection**, select the profile and enable the switch.
4. Optionally set an exact model ID, reply token limit (default 512), and timeout (default 180 seconds). The override changes this extension's request only; it does not edit the profile.
5. Use the native Impersonate button/menu or `/impersonate`. The generated text appears in SillyTavern's input box as usual. Sending it afterwards uses the main connection for the character reply.

Use the normal Stop control or **Stop pinned request** to cancel. Changing chats cancels pinned requests. Disabling routing affects future requests; stop an existing request separately. Refresh profiles if you edited them in another interface. Profiles are tracked by ID, so renaming a profile does not break the pin; deleting it does.

### Vertex AI with Service Account JSON

Version 1.0.1 fixes a missing `vertexai_auth_mode` field that made the server incorrectly default to Express mode and report that an API key was required.

1. In SillyTavern's Vertex AI connection, select **Full / Service Account**, validate/save the JSON there, and select the saved Service Account credential. Never paste JSON into this extension.
2. Update the pinned connection profile with this credential in its **Secret** field, and save its region.
3. In the extension select **Vertex AI authentication → Full — Service Account JSON**. The default is Full. Leave region blank to use the profile region, or specify the region required by your model (for example `global`).
4. Return to the main connection and use Impersonate.

SillyTavern 1.19.0's Vertex authentication helper uses the **active saved Vertex credential**, ignoring the request secret ID during authentication. The extension checks credential IDs/active flags (no secret values) and blocks requests if that active credential differs from the profile's saved reference. It never rotates credentials globally. Using two different Vertex accounts simultaneously requires an upstream authentication fix; it cannot be safely simulated with a profile switch here.

For Express mode choose **Express — API key**, use its matching active saved Vertex API key reference, and optionally specify the Express project ID. These fields apply only when the target provider is Vertex AI.

## Behavior and limits

- Main connection settings, selected profile, model, API key selection, prompt presets, and unsaved edits are not switched or rewritten by this extension. There is no recovery journal or temporary profile to clean up after cancellation, failure, timeout, or reload.
- Uses the native main connection's assembled Impersonate prompt, including its character/persona, prompt manager, world information, extension injections, and context budgeting. The target profile's prompt-manager preset and context limit are **not** applied. Keep the main context budget within the target model's limit.
- The target profile supplies the API, model, endpoint, explicit secret reference and optional proxy. Text Completion targets also use the profile's instruct template. Generation sampler presets are deliberately **not applied**: the current SillyTavern converter can inherit the active connection's headers/proxy fields. Except for the configured token limit, target provider defaults apply.
- Streams text through an adapter for native OpenAI-compatible, Claude, Gemini/Vertex and Cohere readers. Non-streaming works too. Native stream mode is determined by the main connection. Target/provider streaming must be supported when main streaming is enabled.
- This is **text impersonation**: reasoning, tool calls, image/audio outputs, token probabilities and provider usage metadata are not forwarded. Multimodal input support depends on the target; text-only prompts are the supported baseline. Prompt Inspector still describes the main prompt construction and may show the main model rather than the routed target.
- The main Chat Completion connection must be usable: core SillyTavern can return before dispatch if it is disconnected. The extension does not bypass this core check.
- Native Text Completion as main is rejected by the generation interceptor when routing is enabled. It lacks an explicit request-level Impersonate type at the transport boundary. Disable this extension to use unsupported main modes normally.
- Other extensions that replace `fetch`, remove the request type, replace this extension's interceptor, or bypass native generation can interfere. Reload after enabling/disabling extensions. Direct arbitrary extension requests are outside this extension's guarantee.

## Privacy

Extension settings contain only enable state, profile ID, optional model ID, token limit, timeout and non-secret Vertex authentication mode/region/project ID. It never requests, displays, logs, exports or persists plaintext API keys, prompts, payloads or provider diagnostics. SillyTavern's own request service resolves credentials server-side; see the Vertex active-credential limitation above. A saved proxy password is handled by SillyTavern's service in memory and sent to your own SillyTavern backend as needed. No analytics or third-party service is added.

The selected provider receives the Impersonate prompt. Existing SillyTavern server/provider logging remains outside this extension's control. Do not put credentials in model IDs, profile names or URLs. Do not share your SillyTavern settings/profile/secret files when sharing this extension.

## Troubleshooting

- **Select a supported connection profile:** refresh the list, check that the profile still exists, and enable Connection Manager.
- **Save a specific API key selection:** edit the saved profile's Secret field in SillyTavern and update the profile. Do not paste the key into this extension.
- **Request failed:** test the pinned profile normally, check its exact model ID and endpoint, and verify that the configured secret is valid. For a proxy/custom API, confirm that the profile contains the correct routing fields. Increase timeout if needed. There is no automatic fallback.
- **Nothing happens:** use a connected main Chat Completion API and open a chat first. If the panel is missing, verify that the folder contains `manifest.json` and reload the page.
- **Target rejects the prompt:** reduce the main connection's context size or remove unsupported media. A model override must be supported by the saved provider.
- **Text stream fails:** disable streaming in the main connection and try again. A future SillyTavern release may need a reader adapter update.

## Uninstall

Stop any pinned request, disable the extension, remove its folder, and reload the page. The main connection needs no restoration. You may leave the small `impersonateConnection` settings object in SillyTavern's settings; it contains no keys.

## Validation

Run `npm test` or `node --test tests/router.test.js` inside this folder with a modern Node.js. There are no dependencies and the tests make no real network requests. See [TESTING.md](TESTING.md) for integration checks. Automated tests are not a claim of live provider/browser testing; no user's keys or running SillyTavern installation were available in this task.

## Source references

- [SillyTavern UI extension API](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [Connection Profiles documentation](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/)
- [Audited release commit](https://github.com/SillyTavern/SillyTavern/commit/06bde939fb1e9c4c8d8641d810f0a916b5bce127)
- [Implementation design and source evidence](ARCHITECTURE.md)
