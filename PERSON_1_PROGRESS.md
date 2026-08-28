# Person 1 Progress

- Baseline setup completed on Windows host with Node v24.18.0 and npm 11.16.0.
- Installed dependencies with `npm ci`; approved `esbuild@0.28.1` install script for repeatable npm 11 installs.
- `npm run check` passes after making `container-codex-runner.test.ts` platform-aware for resolved `CODEX_HOME` paths.
- Production server starts on `http://127.0.0.1:3000`; verified `/`, `/api/health`, `/api/system`, `/api/agents`, and Agent create/start/stop/delete.
- Local Docker POC and Gemini Playground baseline are verified end-to-end: runtime build/mount preflight, Agent create, initial turn, follow-up resume, and Agent stop/start with workspace and thread persistence all passed.
- WSL optional features are enabled and elevated Admin WSL sees Ubuntu as default WSL2 distro, but this agent runs as `laptop-m83dgjmn\codexsandboxoffline`; non-elevated WSL still fails with `Wsl/Service/E_ACCESSDENIED`.
- Git Bash is available at `C:\Program Files\Git\bin\bash.exe`; running `scripts/start-local-poc.sh` through Git Bash works and now stops at the expected missing Docker/Ark prerequisites.
- Docker Desktop was repaired in place from 4.0.1 to 29.7.2; both `default` and `desktop-linux` contexts return a healthy server.
- Added an organizer-approved Gemini baseline adapter. `MODEL_PROVIDER=gemini` writes a Codex Responses provider targeting the local bridge, which translates to Gemini Chat Completions. Unit tests, `npm run check`, a no-key server smoke test, and live Codex turns pass.
- `scripts/start-local-poc.sh` now loads the ignored `.env` file. Keep real model credentials only in `.env`; `.env.example` is a placeholder-only template.
- The local `.env` contains only Gemini provider settings, avoiding deployment paths from `.env.example` that would override local POC defaults.
- Live Gemini bridge validation reached the provider. The configured `gemini-2.5-flash` model is unavailable for this key; local and project defaults now use the provider-recommended `gemini-3.6-flash`.
- Gemini tool-loop bridge uses native `generateContent` function calling. It recovers Codex call IDs, emits Gemini `functionResponse` values, and removes unsupported `additionalProperties` schema fields. Server tests and a live `pwd` tool-call run both pass.
- No P1 coordination-engine implementation has begun.
