// The fixed list of speech recognition models for dictation (Whisper, ONNX from Hugging Face).
// Every file is pinned by repository revision, size and SHA-256; update with docs/ai/MODELS.md §4.
// The files are exactly those transformers.js loads for the given dtype (checked in CI on
// 19 November 2026 with a German sample).

const COMMON = {
  vendor: 'OpenAI (Whisper), ONNX export by Hugging Face onnx-community',
  origin: 'US',
  license: 'Apache-2.0',
  licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  languages: 'multilingual (99 languages, including German and English)'
};

const PRE_BASE = {
  path: 'preprocessor_config.json',
  size: 339,
  sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'
};
const TOK_BASE = {
  path: 'tokenizer.json',
  size: 2480466,
  sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566'
};

export const SPEECH_CATALOG = Object.freeze([
  {
    ...COMMON,
    id: 'whisper-base',
    name: 'Whisper base',
    repo: 'onnx-community/whisper-base',
    revision: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c',
    quality: 'fast',
    device: 'any',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: [
      { path: 'config.json', size: 2243, sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b' },
      {
        path: 'generation_config.json',
        size: 3832,
        sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0'
      },
      PRE_BASE,
      TOK_BASE,
      {
        path: 'tokenizer_config.json',
        size: 282682,
        sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573'
      },
      {
        path: 'onnx/encoder_model.onnx',
        size: 82468078,
        sha256: 'a9f3b752833b49e880dec91ee5b6d936112be7c3ea07c221024ba493439f46fe'
      },
      {
        path: 'onnx/decoder_model_merged_q4.onnx',
        size: 123602419,
        sha256: '09f83b71ceedc97dab1d90b914715dc532a646a147abda11d83c64867b7c319c'
      }
    ]
  },
  {
    ...COMMON,
    id: 'whisper-small',
    name: 'Whisper small',
    repo: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    quality: 'balanced',
    device: 'any',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    files: [
      { path: 'config.json', size: 2227, sha256: '457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18' },
      {
        path: 'generation_config.json',
        size: 3893,
        sha256: 'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0'
      },
      PRE_BASE,
      TOK_BASE,
      {
        path: 'tokenizer_config.json',
        size: 282683,
        sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce'
      },
      {
        path: 'onnx/encoder_model.onnx',
        size: 352825870,
        sha256: 'b37cd6625dc36f9178ec7539a1876b9680ea26a910097e092be39dc766320c7b'
      },
      {
        path: 'onnx/decoder_model_merged_q4.onnx',
        size: 233149327,
        sha256: '795c61b344576719c2b249cc9911c78b4cc552c8c6a5407be21a3380a0791b13'
      }
    ]
  },
  {
    ...COMMON,
    id: 'whisper-large-v3-turbo',
    name: 'Whisper large-v3-turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    quality: 'best',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    files: [
      { path: 'config.json', size: 1332, sha256: '35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1' },
      {
        path: 'generation_config.json',
        size: 3897,
        sha256: '16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f'
      },
      {
        path: 'preprocessor_config.json',
        size: 340,
        sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711'
      },
      {
        path: 'tokenizer.json',
        size: 2480617,
        sha256: '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca'
      },
      {
        path: 'tokenizer_config.json',
        size: 282843,
        sha256: '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389'
      },
      {
        path: 'onnx/encoder_model_fp16.onnx',
        size: 1274342603,
        sha256: 'fdadc70836e6b028fd5e580417c312208dad073d2d01e509e2d127c1373399d8'
      },
      {
        path: 'onnx/decoder_model_merged_q4.onnx',
        size: 334147222,
        sha256: '8b933ac24074a24a1635084d06a4ed37e387ef22d980f184a5fc27418e9ceeb8'
      }
    ]
  }
]);
