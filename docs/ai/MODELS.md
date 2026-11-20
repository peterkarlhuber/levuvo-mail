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

### Variants: GGUF and MLX

Since Ollama 0.40 a tag on the registry can be a **manifest list** with one variant per runner:
`llamacpp` (GGUF, every platform) and `mlx` (safetensors, only Macs with Apple silicon). Ollama on such a
Mac prefers MLX, everywhere else GGUF; the variants differ in files, digest and size. Until this fix Levuvo
pinned only the GGUF variant, so on a Mac with Apple silicon Ollama downloaded the MLX variant (Qwen3.5
9B: 7.6 GB instead of 6.6 GB) and Levuvo deleted it again as "checksum does not match".

Now every entry pins the GGUF variant (`digest`, `size`) and, where the registry offers one, the MLX
variant (`mlx`). Levuvo requests the variant explicitly (`runner` in `/api/pull`), so the download never
depends on Ollama's own preference, and checks the result against that variant's pin. The size shown in
the list is the size of the variant this computer downloads. `mlx: false` marks an MLX variant that was
reviewed and not taken: Gemma 4 E2B's MLX variant is 7.5 GB, too big for the small tier, so Macs get
GGUF there too. The catalog check reports an MLX variant the registry adds but the catalog does not pin.

| Size | Model | Vendor (origin) | License | Download | Apple silicon (MLX) |
|---|---|---|---|---|---|
| Small (8 GB RAM) | **qwen3.5:4b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 3.3 GB | 4.0 GB |
| | gemma4:e2b | Google (US) | Apache-2.0 | 4.6 GB | GGUF (MLX 7.5 GB not used) |
| | ministral-3:3b | Mistral AI (FR, EU) | Apache-2.0 | 3.0 GB | GGUF |
| Standard (16 GB) | **qwen3.5:9b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 6.6 GB | 7.6 GB |
| | gemma4:12b | Google (US) | Apache-2.0 | 8.0 GB | 7.7 GB |
| | ministral-3:8b | Mistral AI (FR, EU) | Apache-2.0 | 6.0 GB | GGUF |
| Large (32 GB) | **qwen3.8:27b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 17.7 GB | 18.2 GB |
| | mistral-small3.2:24b | Mistral AI (FR, EU) | Apache-2.0 | 15.2 GB | GGUF |
| | ministral-3:14b | Mistral AI (FR, EU) | Apache-2.0 | 9.1 GB | GGUF |
| Search | **qwen3-embedding:0.6b** (default) | Alibaba Qwen (CN) | Apache-2.0 | 0.6 GB | GGUF |
| | bge-m3 | BAAI (CN) | MIT | 1.2 GB | GGUF |
| | qwen3-embedding:4b | Alibaba Qwen (CN) | Apache-2.0 | 2.5 GB | GGUF |

Choosing a model that is not on the computer downloads nothing yet: the settings show its size, the free
space and a "Download (size)" button, and the model becomes active once it is downloaded and verified.
Choosing a model that is already there only switches to it. Interrupted downloads have a line each with
"Resume" and "Discard"; discarding one model's parts also works while another model downloads.

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

### Search model: why Qwen3-Embedding 0.6B

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
same speed, and was the default up to 2.6. From 2.7.0 the default is **Qwen3-Embedding 0.6B** (product
decision, 20 November 2026): half the download (0.6 instead of 1.2 GB), the right mail is among the first
three in 29 of 30 queries, and it is the same family as the language models. bge-m3 stays in the list for
anyone who wants the last bit of accuracy on German mail. Qwen3-Embedding 4B is better still but five
times slower and is offered for large computers. The search instruction is set per model (`queryPrefix`);
bge-m3 uses none.

**Moving existing installations:** settings that still carry the old default `bge-m3` move to the new
default once, about 20 seconds after start (`adoptSearchDefault` in `routes-ai.mjs`). With search on and
Levuvo's own Ollama, the new model is downloaded first and becomes active only once it is verified; the
old index answers until then, and the semantic index then rebuilds itself for the new model (vectors are
stored per model). If the download fails (offline, disk full), it is tried again at the next start. A
search model chosen by hand later (`embedDefault` in the settings) is never changed. The bge-m3 file stays
on disk until the user deletes it.

Switching the search model asks first and then rebuilds the index in the background with progress.

**mDenseOn (LightOn, FR, EU), checked 19 and 20 November 2026 and not offered yet.** Apache-2.0, 307M parameters,
768 dimensions, 8,192 tokens context. With sentence-transformers on a CI processor and its prompts
("query: " / "document: ") it ranked the right mail first in **30 of 30** queries (Recall@1 1.000, MRR
1.000, about 120 ms per mail; without prompts 0.967), against 29 of 30 for bge-m3 in the same run. It
cannot be offered through Levuvo's Ollama yet: there is no GGUF on registry.ollama.ai or Hugging Face, and
a GGUF converted with llama.cpp (`convert_hf_to_gguf.py`, 614 MB, F16) does not load in the pinned Ollama
0.40.16 ("metaspace prepend_scheme 'always' is not supported for BPE vocab"). Once Ollama loads it and a
GGUF is published under a reviewable name, it goes into the list with the EU flag. Check on 20 November
2026: 0.40.16 is still the newest Ollama release (no newer release or release candidate on GitHub), and
registry.ollama.ai still has no mDenseOn model, so nothing changed.

## 3. Updating

- **Ollama:** set `version`, `size` and `sha256` of every asset in `ollama-lock.json` from the release,
  run `npm run ollama:runtime -- --arch …` on each target and `node --test test/ollama-live/*.test.mjs`
  with `LEVUVO_OLLAMA_BIN`; check the release notes for changed environment variables.
- **A model:** add or change the entry in `ai-model-catalog.mjs` with the digest and size of each variant
  printed by `npm run check:models -- --print` (it also prints them on a mismatch), review the license
  layer, and run the evaluation again for a search model. Pin an MLX variant only if it fits the tier
  (about the size of the GGUF one), otherwise set `mlx: false`.
- **Real downloads:** `LEVUVO_LIVE_MODELS=qwen3.5:4b,gemma4:e2b node --test test/ollama-live/*.test.mjs`
  downloads the listed models with the variant of the platform and checks digest and size; the weekly
  supply-chain job runs it on a Mac with Apple silicon.

## 4. Dictation (Whisper)

Dictation uses OpenAI's Whisper (Apache-2.0) as ONNX exports of Hugging Face's `onnx-community`, run with
transformers.js in a worker of the app window (WebGPU, else WebAssembly). Nothing ships with the installer:
`apps/server/src/speech-catalog.mjs` pins the repository revision and the size and SHA-256 of every file;
`speech-models.mjs` downloads exactly these files from `huggingface.co/{repo}/resolve/{revision}/…`,
checks each one and deletes the model on any mismatch. The app window loads them only from Levuvo's own
server (`/api/ai/speech/files/…`); remote models, the browser cache and the WebAssembly cache are off.

| Model | Files (encoder / decoder) | Download | Use |
|---|---|---|---|
| Whisper base | fp32 / q4 | 0.21 GB | fast, rough |
| Whisper small | fp32 / q4 | 0.59 GB | balanced |
| Whisper large-v3-turbo | fp16 / q4 | 1.61 GB | most accurate, needs a graphics card for good speed |

Check on 19 November 2026 (transformers.js 4.3.2 in Node on a CI processor, a synthetic German voice
reading "Hallo Anna, ich schicke dir das Angebot bis Freitag. Die Lieferung kommt in Kalenderwoche drei.
Viele Grüße, Peter."):

- base (0.9 s): "Hallo Haar, ich schick er die Pass an dem Boot, ist veraytag. …" — unusable for German;
- small (2.1 s): "Hallo Anna, ich schicke die Fass an der Boot bis Freitag. Die Lieferung kommt in kalender Woche dabei. …";
- large-v3-turbo (9.0 s): "Hallo Anna, ich schicke dir das Angebot bis Freitag. Die Lieferung kommt in kalender Woche 3. Viele Grüße, Peter."

A synthetic voice is harder than a real one, but the ranking holds: base stays in the list for weak
computers, small is the everyday choice, large-v3-turbo the accurate one.

**Updating:** take the new revision from `https://huggingface.co/api/models/{repo}`, the sizes and
`lfs.oid` (SHA-256) from `/api/models/{repo}/tree/{revision}?recursive=1`, hash the small JSON files
yourself, and check with a German recording that the files transformers.js requests are exactly those in
the list (the app's file route answers 404 for anything else).
