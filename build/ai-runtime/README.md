# Bundled AI runtime

`npm run ai:runtime -- --arch <arm64|x64>` (scripts/build-ai-runtime.mjs) puts the Python runtime of the
AI sidecar here before an installer is built. electron-builder copies it to `resources/ai-runtime`.

**Run it before every installer build.** An installed app only uses this bundled runtime: without it the
app still works, but the AI features are unavailable. `LEVUVO_AI_PYTHON` or `python3` with `apps/ai`
are a fallback for development from the source tree only (`npm run desktop:dev`), not for installers.
The release workflow (`.github/workflows/build-desktop.yml`) builds the runtime for each architecture.
