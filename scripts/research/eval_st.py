"""Temporary: the same German test as scripts/ollama/eval-embeddings.mjs, with sentence-transformers."""
import json, sys, time
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer

data = json.loads(Path("scripts/ollama/embed-eval-de.json").read_text())
docs = [f"{m['subject']}\n{m['from']}\n{m['text']}" for m in data["mails"]]
for name in sys.argv[1:]:
    try:
        model = SentenceTransformer(name, trust_remote_code=True, device="cpu")
    except Exception as e:
        print("LOAD FAILED", name, repr(e)); continue
    prompts = getattr(model, "prompts", {}) or {}
    print("MODEL", name, "prompts", prompts, "max_seq", model.max_seq_length,
          "params", sum(p.numel() for p in model.parameters()))
    variants = [("noprompt", None, None)]
    if prompts:
        qk = next((k for k in prompts if "query" in k.lower()), None)
        dk = next((k for k in prompts if "doc" in k.lower() or "passage" in k.lower()), None)
        variants.append(("prompts", qk, dk))
    for label, qk, dk in variants:
        t0 = time.time()
        d = model.encode(docs, prompt_name=dk, normalize_embeddings=True)
        ms = (time.time() - t0) * 1000 / len(docs)
        q = model.encode([x["q"] for x in data["queries"]], prompt_name=qk, normalize_embeddings=True)
        r1 = r3 = mrr = 0
        for i, x in enumerate(data["queries"]):
            ranked = [data["mails"][j]["id"] for j in np.argsort(-(d @ q[i]))]
            rank = min(ranked.index(r) for r in x["relevant"]) + 1
            r1 += rank == 1; r3 += rank <= 3; mrr += 1 / rank
            if rank > 1: print("  miss", name, label, x["q"], rank)
        n = len(data["queries"])
        print("RESULT", json.dumps({"model": name, "variant": label, "dims": int(d.shape[1]), "r1": round(r1 / n, 3),
              "r3": round(r3 / n, 3), "mrr": round(mrr / n, 3), "ms_per_mail_cpu": round(ms)}))
