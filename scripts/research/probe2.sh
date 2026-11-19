#!/usr/bin/env bash
git clone -q --depth 1 --branch v0.40.16 https://github.com/ollama/ollama /tmp/ollama 2>/dev/null
cd /tmp/ollama
echo "=== images.go 80-140"; sed -n 80,140p server/images.go
echo "=== pull"; grep -n "func PullModel\|func pullModelManifest\|func pullWithTransfer\|runnerSelection\|RunnerPreference\|Preference\|Accept\|User-Agent\|X-Ollama\|Vary" server/images.go | head -60
L=$(grep -n "func PullModel" server/images.go | cut -d: -f1); sed -n "$L,$((L+140))p" server/images.go
L=$(grep -n "func pullModelManifest" server/images.go | cut -d: -f1); sed -n "$L,$((L+60))p" server/images.go
echo "=== env"; grep -rn "OLLAMA_[A-Z_]*" envconfig/config.go | grep -iE "runner|mlx|format|engine|prefer" 
echo "=== preference"; grep -rn --include=*.go -iE "runner ?pref|preferredRunner|RunnerPreference|runnerSelection" . | grep -v _test | head -40
echo "=== api pull request"; grep -n "type PullRequest" -A 25 api/types.go
