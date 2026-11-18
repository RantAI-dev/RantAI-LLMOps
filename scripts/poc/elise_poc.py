#!/usr/bin/env python3
"""POC: play the UGM app against the Elise API (RantAI Agents) and show where each behaviour comes from.

UGM reported that "discussion" chats do not follow the earlier turns, and that citations and inline figures are
inconsistent. Their app is closed source, so this script plays it: it calls the same endpoint with the same kind of
key, once as an app that sends the conversation and once as an app that sends only the latest message, and checks
every citation and figure in the answers against the `sources` and `figures` the API returns.

    python3 scripts/poc/elise_poc.py --topic "Jelaskan struktur jantung manusia." [--base http://10.17.254.27:8099/api]

The key (rantai_sk_..., one Tanya assistant) is read from ~/.rantai_poc_key (or RANTAI_POC_KEY) and never printed.
Writes a Markdown report next to the script (elise_poc_report.md) and prints it.
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request

CITE = re.compile(r"\[(\d+)\]")
FIG = re.compile(r"\[figure:\s*(\d+)\]", re.I)


def key():
    k = os.environ.get("RANTAI_POC_KEY") or open(os.path.expanduser("~/.rantai_poc_key")).read()
    k = k.strip()
    if not re.fullmatch(r"rantai_sk_[A-Za-z0-9_-]{32}", k):
        raise SystemExit("the key does not look like rantai_sk_ + 32 characters")
    return k


def chat(base, k, messages, **extra):
    body = {"messages": messages, "stream": False, **extra}
    req = urllib.request.Request(f"{base.rstrip('/')}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {k}"})
    t0 = time.time()
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as e:
        return {"_error": f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}", "_s": round(time.time() - t0, 1)}
    r["_s"] = round(time.time() - t0, 1)
    return r


def text(r):
    try:
        return r["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


def check_refs(r):
    """Every [n] must name a source; every [figure:N] a figure source; `figures` must match the tags."""
    ans, sources, figures = text(r), r.get("sources") or [], r.get("figures") or []
    cites = [int(x) for x in CITE.findall(ans)]
    tags = [int(x) for x in FIG.findall(ans)]
    is_fig = lambda n: 1 <= n <= len(sources) and (sources[n - 1].get("chunkType") == "figure")
    return {
        "sources": len(sources),
        "figure_sources": sum(1 for s in sources if s.get("chunkType") == "figure"),
        "citations": len(cites),
        "citations_outside_sources": sum(1 for n in cites if not 1 <= n <= len(sources)),
        "figure_tags": len(tags),
        "figure_tags_not_a_figure": sum(1 for n in tags if not is_fig(n)),
        "figures_returned": len(figures),
        "figures_cited": sum(1 for f in figures if f.get("cited")),
        "grounded": r.get("grounded"),
    }


def conversation(base, k, topic, send_history):
    """Three turns: introduce a name with the topic question, a short follow-up, then ask what was said."""
    turns = [f"Halo, aku Dimas. {topic}", "Kasih contohnya dong.", "Namaku siapa? Terus tadi pertanyaan pertamaku tentang apa?"]
    history, out = [], []
    for u in turns:
        msgs = history + [{"role": "user", "content": u}] if send_history else [{"role": "user", "content": u}]
        r = chat(base, k, msgs)
        a = text(r)
        out.append({"user": u, "answer": a, "error": r.get("_error"), "seconds": r.get("_s"), "refs": check_refs(r)})
        history += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://10.17.254.27:8099/api")
    ap.add_argument("--topic", default="Jelaskan struktur jantung manusia.")
    ap.add_argument("--figure-question", default="Jelaskan struktur jantung manusia.")
    ap.add_argument("--repeat", type=int, default=3)
    a = ap.parse_args()
    k = key()

    lines = [f"# POC Elise API: {time.strftime('%Y-%m-%d %H:%M')}", "", f"Endpoint `{a.base}/v1/chat/completions`, one Tanya key.", ""]
    for label, hist in (("A: the app sends the conversation", True), ("B: the app sends only the latest message", False)):
        lines += [f"## {label}", ""]
        for i in range(a.repeat):
            conv = conversation(a.base, k, a.topic, hist)
            last = conv[-1]["answer"]
            remembered = "dimas" in last.lower()
            lines.append(f"- run {i + 1}: name recalled **{'yes' if remembered else 'no'}** | turn 3: {last[:220]!r}")
            for t in conv:
                if t["error"]:
                    lines.append(f"  - error on {t['user']!r}: {t['error']}")
        lines.append("")

    lines += ["## Citations and figures (`inline_figures: true`)", "",
              "| run | sources | figure sources | [n] | [n] outside sources | [figure:N] | tags not a figure | figures returned | cited | grounded |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for i in range(a.repeat):
        r = chat(a.base, k, [{"role": "user", "content": a.figure_question}], inline_figures=True)
        if r.get("_error"):
            lines.append(f"| {i + 1} | error: {r['_error']} |||||||||")
            continue
        c = check_refs(r)
        lines.append(f"| {i + 1} | {c['sources']} | {c['figure_sources']} | {c['citations']} | {c['citations_outside_sources']} | "
                     f"{c['figure_tags']} | {c['figure_tags_not_a_figure']} | {c['figures_returned']} | {c['figures_cited']} | {c['grounded']} |")
    report = "\n".join(lines) + "\n"
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "elise_poc_report.md")
    open(path, "w", encoding="utf-8").write(report)
    print(report)
    print(f"report: {path}")


if __name__ == "__main__":
    main()
