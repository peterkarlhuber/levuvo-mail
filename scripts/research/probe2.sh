#!/usr/bin/env bash
set -x
R=https://registry.ollama.ai/v2/library/qwen3.5
curl -s -D - -o /tmp/b.json "$R/blobs/sha256:d63f830f28d515fefea546f213fca7a75e9dd5176ef51a6deabc952d1c99a911" | head -20
head -c 1500 /tmp/b.json; echo; sha256sum /tmp/b.json
for t in 9b-mlx 9b-mlx-nvfp4 9b-nvfp4 9b-safetensors; do curl -s -o /dev/null -w "$t %{http_code}\n" -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' "$R/manifests/$t"; done
curl -s -D - -o /tmp/m.json -H 'Accept: application/vnd.oci.image.index.v1+json' "$R/manifests/9b" | head -20
git clone -q --depth 1 --branch v0.40.16 https://github.com/ollama/ollama /tmp/ollama || git clone -q --depth 1 https://github.com/ollama/ollama /tmp/ollama
cd /tmp/ollama && git log -1 --format=%H%n%s
grep -rn --include=*.go -iE "darwin|mlx|platform|runtime.GOOS|runtime.GOARCH" server/images.go server/download.go server/pull*.go server/internal/registry 2>/dev/null | grep -v _test | head -60
grep -rln --include=*.go -iE "manifests/" server types x 2>/dev/null | grep -v _test | head -20
