#!/usr/bin/env python3
"""
Offline classification eval for the AMAL malware-family task — the metrics the
LLMOps app does NOT compute in-app (Accuracy / Macro-F1 / Precision / Recall /
confusion matrix). Run it against a served model (base or fine-tuned) over an
OpenAI-compatible /v1 endpoint, and it prints a proper before/after report.

Dependency-free (stdlib only). Example:

  # base
  python classification_eval.py --test data/amal_test.jsonl \
      --base-url http://10.17.254.27:8000/v1 --model base --out results_base.json
  # fine-tuned adapter
  python classification_eval.py --test data/amal_test.jsonl \
      --base-url http://10.17.254.27:8000/v1 --model amal --out results_ft.json

Then compare the two JSONs for the slide, or feed both to make_report.py.
"""
import argparse, json, re, sys, urllib.request, urllib.error
from collections import defaultdict

def load_labels(path):
    try:
        return json.load(open(path, encoding="utf-8"))["families"]
    except Exception:
        return None

def predict(base_url, model, api_key, instruction, timeout=60):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": instruction}],
        "temperature": 0.0,
        "max_tokens": 24,
    }).encode()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions",
                                 data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    return d["choices"][0]["message"]["content"]

def parse_family(text, families):
    t = text.strip()
    low = t.lower()
    # exact-ish: the label appears as a token
    for fam in families:
        if re.search(r"\b" + re.escape(fam.lower()) + r"\b", low):
            return fam
    # fallback: first word matched loosely
    for fam in families:
        if fam.lower() in low:
            return fam
    return "UNKNOWN"

def metrics(y_true, y_pred, families):
    labels = list(families)
    idx = {l: i for i, l in enumerate(labels)}
    n = len(labels)
    cm = [[0] * n for _ in range(n)]  # rows=true, cols=pred
    unknown = 0
    for t, p in zip(y_true, y_pred):
        if p not in idx:
            unknown += 1
            continue
        cm[idx[t]][idx[p]] += 1
    correct = sum(cm[i][i] for i in range(n))
    total = len(y_true)
    acc = correct / total if total else 0.0
    per = {}
    f1s, precs, recs, supports = [], [], [], []
    for i, l in enumerate(labels):
        tp = cm[i][i]
        fp = sum(cm[r][i] for r in range(n)) - tp
        fn = sum(cm[i]) - tp
        support = sum(cm[i]) + (0)  # true count present in matrix
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        sup_true = y_true.count(l)
        per[l] = {"precision": prec, "recall": rec, "f1": f1, "support": sup_true}
        f1s.append(f1); precs.append(prec); recs.append(rec); supports.append(sup_true)
    macro_f1 = sum(f1s) / n if n else 0.0
    macro_p = sum(precs) / n if n else 0.0
    macro_r = sum(recs) / n if n else 0.0
    tot_sup = sum(supports) or 1
    weighted_f1 = sum(f1s[i] * supports[i] for i in range(n)) / tot_sup
    return {
        "accuracy": acc, "macro_f1": macro_f1, "macro_precision": macro_p,
        "macro_recall": macro_r, "weighted_f1": weighted_f1,
        "unknown_predictions": unknown, "total": total,
        "per_class": per, "labels": labels, "confusion_matrix": cm,
    }

def print_report(name, m):
    print(f"\n===== {name} =====")
    print(f"Accuracy      : {m['accuracy']*100:6.2f}%")
    print(f"Macro-F1      : {m['macro_f1']*100:6.2f}%")
    print(f"Macro-Precision: {m['macro_precision']*100:6.2f}%")
    print(f"Macro-Recall  : {m['macro_recall']*100:6.2f}%")
    print(f"Weighted-F1   : {m['weighted_f1']*100:6.2f}%")
    print(f"Unknown/parse-fail: {m['unknown_predictions']}/{m['total']}")
    print(f"\n{'family':14}{'prec':>8}{'recall':>8}{'f1':>8}{'support':>9}")
    for l in m["labels"]:
        c = m["per_class"][l]
        print(f"{l:14}{c['precision']*100:7.1f}%{c['recall']*100:7.1f}%{c['f1']*100:7.1f}%{c['support']:9}")
    print("\nConfusion matrix (rows=true, cols=pred):")
    labs = m["labels"]
    print(" " * 12 + "".join(f"{l[:8]:>9}" for l in labs))
    for i, l in enumerate(labs):
        print(f"{l:12}" + "".join(f"{m['confusion_matrix'][i][j]:>9}" for j in range(len(labs))))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", required=True)
    ap.add_argument("--base-url", required=True, help="OpenAI-compatible /v1 base")
    ap.add_argument("--model", required=True, help="served model / adapter name")
    ap.add_argument("--api-key", default="")
    ap.add_argument("--labels", default=None, help="labels.json (default: alongside --test)")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--limit", type=int, default=0, help="only first N rows (debug)")
    a = ap.parse_args()

    import os
    labels_path = a.labels or os.path.join(os.path.dirname(a.test) or ".", "labels.json")
    families = load_labels(labels_path)
    rows = [json.loads(l) for l in open(a.test, encoding="utf-8") if l.strip()]
    if a.limit:
        rows = rows[:a.limit]
    if not families:
        families = sorted({r["output"] for r in rows})

    y_true, y_pred = [], []
    for i, r in enumerate(rows, 1):
        try:
            out = predict(a.base_url, a.model, a.api_key, r["instruction"])
            pred = parse_family(out, families)
        except Exception as e:
            pred = "UNKNOWN"
            sys.stderr.write(f"[{i}] request failed: {e}\n")
        y_true.append(r["output"]); y_pred.append(pred)
        if i % 25 == 0:
            sys.stderr.write(f"  {i}/{len(rows)}\n")

    m = metrics(y_true, y_pred, families)
    m["model"] = a.model
    json.dump(m, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print_report(a.model, m)
    print(f"\nsaved -> {a.out}")

if __name__ == "__main__":
    main()
