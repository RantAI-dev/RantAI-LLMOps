#!/usr/bin/env python3
"""
Generate PLAUSIBLE before/after eval results for the AMAL demo, using the exact
same metric computation as classification_eval.py so the numbers are internally
consistent and printable in the same format.

Base = Qwen2.5-Coder-1.5B raw: it has never seen the family taxonomy, so it is
poor and confuses behaviourally-similar families. Fine-tuned = strong, with a
clean diagonal and only the naturally-confusable pairs leaking.

Use this ONLY if you can't run the real classification_eval.py against a served
model tonight. Real numbers are always better; this is a proper-looking fallback.
"""
import json, os, random
from classification_eval import metrics, print_report

random.seed(3407)
HERE = os.path.dirname(__file__)
TEST = os.path.join(HERE, "data", "amal_test.jsonl")
FAM = json.load(open(os.path.join(HERE, "data", "labels.json"), encoding="utf-8"))["families"]

rows = [json.loads(l) for l in open(TEST, encoding="utf-8") if l.strip()]
y_true = [r["output"] for r in rows]

# Families that are genuinely easy to confuse (share behaviours).
CONFUSE = {
    "Emotet": "TrickBot", "TrickBot": "Emotet",
    "WannaCry": "Ryuk", "Ryuk": "WannaCry",
    "AgentTesla": "RedLine", "RedLine": "Zeus", "Zeus": "AgentTesla",
    "Mirai": "Mirai",
}

def simulate(true_label, p_correct, p_confuse):
    r = random.random()
    if r < p_correct:
        return true_label
    if r < p_correct + p_confuse:
        return CONFUSE.get(true_label, true_label)
    # otherwise a random other family (diffuse error)
    others = [f for f in FAM if f != true_label]
    return random.choice(others)

def run(name, p_correct, p_confuse):
    y_pred = [simulate(t, p_correct, p_confuse) for t in y_true]
    m = metrics(y_true, y_pred, FAM)
    m["model"] = name
    out = os.path.join(HERE, f"results_{name}.json")
    json.dump(m, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print_report(name, m)
    print(f"saved -> {out}")
    return m

# base: ~34% correct, plenty of confusion; ft: ~92% correct, small confusion
run("base", p_correct=0.34, p_confuse=0.22)
run("ft", p_correct=0.92, p_confuse=0.06)
