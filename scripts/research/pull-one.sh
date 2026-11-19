#!/usr/bin/env bash
# Temporary research: real download of one catalog model with the bundled Ollama.
MODEL="$1"; BIN="$2"
export OLLAMA_MODELS="$RUNNER_TEMP/models" OLLAMA_HOST=127.0.0.1:11555 OLLAMA_NO_CLOUD=1 OLLAMA_NOPRUNE=1 HOME="$RUNNER_TEMP/home"
mkdir -p "$HOME"
"$BIN" serve > "$RUNNER_TEMP/serve.log" 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:11555/api/version >/dev/null && break; sleep 1; done
start=$(date +%s)
curl -sN http://127.0.0.1:11555/api/pull -d "{\"model\":\"$MODEL\"}" > "$RUNNER_TEMP/pull.jsonl"
grep -v '"completed"' "$RUNNER_TEMP/pull.jsonl" | sort -u | head -20
echo "max total per digest:"; node -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l));
const t=new Map(); for (const l of lines) if (l.digest&&l.total) t.set(l.digest,l.total);
let s=0; for (const v of t.values()) s+=v; console.log("progress total", s, "layers", t.size);' "$RUNNER_TEMP/pull.jsonl"
echo "seconds $(( $(date +%s) - start ))"
curl -s http://127.0.0.1:11555/api/tags | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const m of JSON.parse(d).models)console.log("RESULT",JSON.stringify({name:m.name,digest:m.digest,size:m.size,format:m.details?.format,runner:m.details?.runner,quant:m.details?.quantization_level}))})'
grep -iE "error|mismatch" "$RUNNER_TEMP/serve.log" | head -5
