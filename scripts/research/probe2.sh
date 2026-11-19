#!/usr/bin/env bash
git clone -q --depth 1 --branch v0.40.16 https://github.com/ollama/ollama /tmp/ollama 2>/dev/null
cd /tmp/ollama
echo "=== consts"; grep -n "MediaType\|Runner[A-Z][a-zA-Z]* *=\|= \"mlx\"\|llama" manifest/manifest.go | head -40
echo "=== prefs"; sed -n 680,900p manifest/manifest.go
echo "=== pullSelectedManifest"; L=$(grep -n "func pullSelectedManifest" server/images.go | cut -d: -f1); sed -n "$L,$((L+70))p" server/images.go
echo "=== makeRequest"; L=$(grep -n "^func makeRequest(" server/images.go | cut -d: -f1); sed -n "$L,$((L+50))p" server/images.go
echo "=== auth"; grep -n "func getAuthorizationToken" -A60 server/auth.go
echo "=== Manifest struct"; grep -n "type Manifest struct" -A30 manifest/manifest.go
echo "=== routes runner"; grep -n "Runner" server/routes.go | head -30
