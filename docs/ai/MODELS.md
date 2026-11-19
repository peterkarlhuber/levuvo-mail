# Local models and Levuvo's own Ollama

Levuvo Mail ships its own Ollama build and offers a fixed list of local models for it. This document
records what was checked, why the list looks the way it does, and how to update it.

## 1. The bundled runtime

| | |
|---|---|
| Version | Ollama 0.40.16 (MIT), pinned in `scripts/ollama/ollama-lock.json` |
| Source | GitHub release assets of `ollama/ollama`, each pinned by size and SHA-256 |
| Signature | macOS: `codesign --verify --strict`, Team ID `3MU9H2V9Y9`. Windows: Authenticode, signer organization `Ollama Inc.` |
| Fetch | `npm run ollama:runtime -- --arch arm64` (or `x64`), writes `build/ollama-runtime`, packaged as `resources/ollama` |
| Checks | architecture of the binary (`verify-app-arch.mjs`), `--version`, manifest `ollama-runtime.json` checked again by the signed build (`release-signed.mjs`) |
| Watch | `supply-chain.yml` weekly: GitHub security advisories and OSV for `github.com/ollama/ollama`; a newer release is reported |
| License | `resources/ollama/LICENSE-ollama.txt` (MIT, plus a note on the GPU libraries of their vendors) |

Unpacked size per installer:

| Target | Asset | Unpacked | Notes |
|---|---|---|---|
| macOS ARM64 | `ollama-darwin.tgz` (186 MB) | 607 MB | Metal (MLX) libraries included |
| Windows ARM64 | `ollama-windows-arm64.zip` (387 MB) | 500 MB | |
| Windows x64 | `ollama-windows-amd64.zip` (1.6 GB) | 1,078 MB | `lib/ollama/cuda_v12` removed; CUDA 13 and Vulkan stay. Nvidia GPUs that CUDA 13 no longer supports use Vulkan |

### Isolation

`apps/server/src/ollama-runtime.mjs` starts the runtime only when Levuvo needs it and stops it after 30
idle minutes and when the app closes.

- **Own folders:** `<app data>/ollama/models` (`OLLAMA_MODELS`) and `<app data>/ollama/home` (`HOME`,
  `USERPROFILE`); Ollama writes its key pair there, not to the user's `~/.ollama`.
- **Own port:** a free port chosen by the operating system, bound to `127.0.0.1` only
  (`OLLAMA_HOST`). An Ollama the user runs on 11434 is never contacted, started or stopped.
- **No cloud:** `OLLAMA_NO_CLOUD=1`; Ollama answers cloud models with an error (checked in CI).
- **Minimal environment:** only `PATH`, temp and locale variables and the user's HTTPS proxy reach the
  process; no `OLLAMA_*` variable of the user's own setup. `NO_PROXY` keeps the local API off the proxy.
- **Resume:** `OLLAMA_NOPRUNE=1` keeps the parts of a cancelled download, so it continues later.
- **Binary:** only the bundled one, never one from `PATH` (`LEVUVO_OLLAMA_BIN` for development).

`test/ollama-live/ollama-live.test.mjs` runs the real binary in CI (`ci.yml`, job `ollama`): private key
location, no listener on other addresses, cloud refused, a wrong pinned digest removes the model,
download of a real model with an embedding call, delete, stop.

## 2. The model list

Only models of `apps/server/src/ai-model-catalog.mjs` are downloaded into the bundled runtime. No model
ships with the installer. Each entry pins the **manifest digest** on `registry.ollama.ai`: Ollama checks
every layer against the manifest's SHA-256 while downloading, and Levuvo compares the manifest digest
that Ollama reports (`/api/tags`) with the pin. A different upload under the same name is deleted again
and reported as "checksum does not match". `scripts/ollama/check-catalog.mjs` compares the pins and sizes
with the registry in every CI run and weekly.

| Size | Model | Vendor (origin) | License | Download |
|---|---|---|---|---|
| Small (8 GB RAM) | **qwen3.5:4b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 3.3 GB |
| | gemma4:e2b | Google (US) | Apache-2.0 | 4.6 GB |
| | ministral-3:3b | Mistral AI (FR, EU) | Apache-2.0 | 3.0 GB |
| Standard (16 GB) | **qwen3.5:9b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 6.6 GB |
| | gemma4:12b | Google (US) | Apache-2.0 | 8.0 GB |
| | ministral-3:8b | Mistral AI (FR, EU) | Apache-2.0 | 6.0 GB |
| Large (32 GB) | **qwen3.8:27b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 17.7 GB |
| | mistral-small3.2:24b | Mistral AI (FR, EU) | Apache-2.0 | 15.2 GB |
| | ministral-3:14b | Mistral AI (FR, EU) | Apache-2.0 | 9.1 GB |
| Search | **bge-m3** (default) | BAAI (CN) | MIT | 1.2 GB |
| | qwen3-embedding:0.6b | Alibaba Qwen (CN) | Apache-2.0 | 0.6 GB |
| | qwen3-embedding:4b | Alibaba Qwen (CN) | Apache-2.0 | 2.5 GB |

On the first start the size is suggested from the computer's memory (from 30 GiB large, from 15 GiB
standard, else small); a model one size above is marked "tight", two sizes above asks before the download.

Decisions while checking the first proposal against the registry (19 November 2026):

- **Newer generations** replace the proposed ones: Qwen3.5 instead of Qwen3, Gemma 4 instead of Gemma 3,
  Ministral 3 instead of Ministral, Mistral Small 3.2. Qwen3.5 has no 14B, so the large default is
  Qwen3.8 27B, with Ministral 3 14B as the smaller large model.
- **EuroLLM 9B** (and Teuken) are not in Ollama's official library, only as uploads of individual users.
  Those are not reviewed by anyone and were left out.
- Licenses were read from the license layer of each manifest; the Qwen3-Embedding manifests carry none,
  their license (Apache-2.0) is taken from the model card.

### Search model: why bge-m3

`scripts/ollama/eval-embeddings.mjs` ranks 40 German test mails (`embed-eval-de.json`, invented content:
invoices, appointments, deliveries, support, HR) for 30 paraphrased German queries (CI run, 19 November
2026):

| Model | Recall@1 | Recall@3 | MRR | ms per mail |
|---|---|---|---|---|
| qwen3-embedding:0.6b, with search instruction | 0.867 | 0.967 | 0.923 | 297 |
| qwen3-embedding:0.6b, without instruction | 0.867 | 0.967 | 0.915 | 269 |
| qwen3-embedding:4b, with search instruction | 1.000 | 1.000 | 1.000 | 1,484 |
| bge-m3, with the Qwen instruction | 0.767 | 0.900 | 0.848 | 313 |
| **bge-m3, without instruction** | **0.967** | **1.000** | **0.983** | **269** |

bge-m3 finds the right mail first in 29 of 30 queries against 26 of 30 for Qwen3-Embedding 0.6B, at the
same speed, so it is the default. Qwen3-Embedding 4B is better still but five times slower and is offered
for large computers. The search instruction is set per model (`queryPrefix`); bge-m3 uses none.

Switching the search model asks first and then rebuilds the index in the background with progress.

## 3. Updating

- **Ollama:** set `version`, `size` and `sha256` of every asset in `ollama-lock.json` from the release,
  run `npm run ollama:runtime -- --arch …` on each target and `node --test test/ollama-live/*.test.mjs`
  with `LEVUVO_OLLAMA_BIN`; check the release notes for changed environment variables.
- **A model:** add or change the entry in `ai-model-catalog.mjs` with the digest and size printed by
  `npm run check:models` (it reports the registry values on a mismatch), review the license layer, and
  run the evaluation again for a search model.
