# Bundled AI runtime

`npm run ai:runtime` (scripts/build-ai-runtime.mjs) puts the Python runtime of the AI sidecar here
before an installer is built. electron-builder copies it to `resources/ai-runtime`. Without it the
app still works, and the AI features use `LEVUVO_AI_PYTHON` or `python3` with `apps/ai` instead.
