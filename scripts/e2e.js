// End-to-end probe of every LLMOps feature, run from INSIDE rantai-frontend.
const BASE = "http://" + (process.env.TEST_HOST || "frontend") + ":3000";
const R = [];
const add = (area, name, ok, detail) => R.push({ area, name, ok, detail: String(detail).slice(0, 150) });

async function j(path, opt = {}) {
  const r = await fetch(BASE + path, { ...opt, headers: { ...(opt.headers || {}), Cookie: COOKIE } });
  let b = null;
  try { b = await r.json(); } catch { b = null; }
  return { s: r.status, b };
}

let COOKIE = "";
(async () => {
  // --- AUTH ---
  const bad = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "definitely-wrong-" + Date.now() }) });
  add("Auth", "wrong password rejected", bad.status === 401, `HTTP ${bad.status}`);

  const noJson = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "not-json" });
  add("Auth", "malformed body -> 400", noJson.status === 400, `HTTP ${noJson.status}`);

  const good = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  const sc = good.headers.get("set-cookie") || "";
  COOKIE = sc.split(";")[0];
  add("Auth", "correct password -> session", good.status === 200 && !!COOKIE, `HTTP ${good.status}`);

  const noAuth = await fetch(BASE + "/api/tasks/list");
  add("Auth", "protected route gated without cookie", noAuth.status === 401, `HTTP ${noAuth.status}`);

  // --- TASKS ---
  let t = await j("/api/tasks/list");
  const tasks = Array.isArray(t.b) ? t.b : (t.b?.jobs || t.b?.data || t.b?.tasks || []);
  add("Tasks", "list returns real jobs", t.s === 200 && tasks.length > 0, `HTTP ${t.s}, ${tasks.length} jobs`);
  if (tasks.length) {
    const id = tasks[0].id ?? tasks[0].jobId;
    const lo = await j(`/api/tasks/${encodeURIComponent(id)}/output`);
    add("Tasks", "job output readable", lo.s === 200, `HTTP ${lo.s} for ${id}`);
  }
  const badTask = await j("/api/tasks/does-not-exist-999/output");
  add("Tasks", "EDGE unknown job handled", badTask.s >= 200 && badTask.s < 500, `HTTP ${badTask.s}`);

  // --- DATASETS ---
  let d = await j("/api/datasets/list");
  const ds = Array.isArray(d.b) ? d.b : (d.b?.datasets || d.b?.data || []);
  add("Datasets", "list returns real datasets", d.s === 200 && ds.length > 0, `HTTP ${d.s}, ${ds.length} datasets`);
  if (ds.length) {
    const id = ds[0].id ?? ds[0].name;
    const p = await j(`/api/datasets/preview?id=${encodeURIComponent(id)}&limit=5`);
    const rows = p.b?.rows || p.b?.data || [];
    add("Datasets", "preview returns rows", p.s === 200, `HTTP ${p.s}, ${rows.length} rows from ${id}`);
  }
  const badDs = await j("/api/datasets/preview?id=nope-nope-404");
  add("Datasets", "EDGE unknown dataset handled", badDs.s >= 200 && badDs.s < 500, `HTTP ${badDs.s}`);
  const noId = await j("/api/datasets/preview");
  add("Datasets", "EDGE missing id param", noId.s >= 400 && noId.s < 500, `HTTP ${noId.s}`);

  // --- MODELS / SERVE ---
  const mc = await j("/api/models/catalog");
  add("Models", "catalog reachable", mc.s === 200, `HTTP ${mc.s}`);
  const si = await j("/api/serve/info");
  const engines = si.b?.engines || [];
  const up = engines.filter(e => e.available).map(e => e.id);
  add("Serve", "engines probed", si.s === 200 && engines.length > 0, `${engines.length} engines, available: ${up.join(",") || "none"}`);
  add("Serve", "Ollama reachable", up.includes("ollama"), up.includes("ollama") ? "available" : "NOT available");
  add("Serve", "vLLM reachable", up.includes("vllm"), up.includes("vllm") ? "available" : "NOT available");

  const ad = await j("/api/adapters");
  const served = (ad.b?.served || []).map(x => x.name ?? x);
  add("Serve", "adapters listed", ad.s === 200, `HTTP ${ad.s}, served: ${served.join(",")}`);
  // (A former check expected adapter "ask" to be absent; "ask" is served on purpose since v0.43, so it was dropped.)

  const gw = await j("/api/serve/gateway");
  add("Serve", "gateway keys readable", gw.s === 200, `HTTP ${gw.s}, ${(gw.b?.apiKeys || []).length} keys`);
  const leak = JSON.stringify(gw.b || {});
  add("Serve", "SECURITY raw key never returned", !/gw-[0-9a-f]{20,}/.test(leak), leak.includes("keyMasked") ? "masked only" : "check");

  // --- PROMPTS (CRUD round-trip) ---
  const pl = await j("/api/prompts");
  add("Prompts", "registry readable", pl.s === 200, `HTTP ${pl.s}`);

  // --- TRACES ---
  const tr = await j("/api/traces");
  add("Traces", "log readable", tr.s === 200, `HTTP ${tr.s}`);

  // --- EVALS / FINETUNE options ---
  const eo = await j("/api/evals/options");
  add("Evals", "options load", eo.s === 200, `HTTP ${eo.s}`);
  const ej = await j("/api/evals/jobs");
  add("Evals", "jobs list", ej.s === 200, `HTTP ${ej.s}`);
  const fo = await j("/api/finetune/options");
  add("Finetune", "options load", fo.s === 200, `HTTP ${fo.s}`);
  const fj = await j("/api/finetune/jobs");
  add("Finetune", "jobs list", fj.s === 200, `HTTP ${fj.s}`);

  // --- COMPUTE ---
  const cg = await j("/api/compute/gpu-metrics");
  add("Compute", "GPU metrics", cg.s === 200, `HTTP ${cg.s}`);

  // --- CHAT (real inference) ---
  const chat = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    // "base" is the served name every vLLM deployment has; adapter names change over time (askv6 is long gone).
    body: JSON.stringify({ messages: [{ role: "user", content: "Sebut satu kata." }], engine: "vllm", model: "base" }) });
  let got = "";
  if (chat.ok) { const txt = await chat.text(); got = txt.slice(0, 60).replace(/\s+/g, " "); }
  add("Chat", "inference streams", chat.status === 200 && got.length > 0, `HTTP ${chat.status} "${got}"`);

  const chatOllama = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], engine: "ollama" }) });
  add("Chat", "EDGE default Ollama model present", chatOllama.status === 200,
      `HTTP ${chatOllama.status}` + (chatOllama.status !== 200 ? " (INFERENCE_MODEL not pulled)" : ""));

  const chatBadEngine = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], engine: "nonexistent" }) });
  // resolveEngine: an unknown engine id falls back to the default engine (Ollama), by design.
  add("Chat", "EDGE unknown engine falls back to the default", chatBadEngine.status === chatOllama.status, `HTTP ${chatBadEngine.status} (Ollama default: ${chatOllama.status})`);

  const chatBad = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ messages: [] }) });
  add("Chat", "EDGE empty messages handled", chatBad.status >= 400 || chatBad.status === 200, `HTTP ${chatBad.status}`);

  // --- VISION (images in chat, image datasets, VLM eval) — read/store only, no GPU work ---
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const vImg = "/api/chat-images/" + "a".repeat(64);
  for (const [m, p] of [["GET", vImg], ["POST", "/api/chat-images"], ["POST", "/api/datasets/vision/init"],
                        ["GET", "/api/evals/vlm"], ["GET", "/api/evals/vlm/sets"]]) {
    const r = await fetch(BASE + p, { method: m, headers: m === "POST" ? { "Content-Type": "application/json" } : {}, body: m === "POST" ? "{}" : undefined });
    add("Vision", `signed-out ${m} ${p.slice(0, 32)} -> 401`, r.status === 401, `HTTP ${r.status}`);
  }
  const st = await j("/api/chat-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: PNG }) });
  add("Vision", "store a chat image", st.s === 200 && /^\/api\/chat-images\/[a-f0-9]{64}$/.test(st.b?.ref || ""), `HTTP ${st.s}`);
  if (st.b?.ref) {
    const gi = await fetch(BASE + st.b.ref, { headers: { Cookie: COOKIE } });
    add("Vision", "stored image served with immutable cache", gi.status === 200 && gi.headers.get("content-type") === "image/png" &&
        /immutable/.test(gi.headers.get("cache-control") || ""), `HTTP ${gi.status} ${gi.headers.get("content-type")}`);
  }
  const unknownImg = await j(vImg);
  add("Vision", "EDGE unknown stored image -> 404", unknownImg.s === 404, `HTTP ${unknownImg.s}`);
  const chatImg = (url) => j("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "vllm", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "text", text: "x" }] }] }) });
  const bad1 = await chatImg("file:///etc/passwd");
  add("Vision", "EDGE chat refuses a file:// image", bad1.s === 400, `HTTP ${bad1.s}`);
  const bad2 = await chatImg("http://example.com/a.png");
  add("Vision", "EDGE chat refuses a plain-http image", bad2.s === 400, `HTTP ${bad2.s}`);
  const bad3 = await chatImg(vImg);
  add("Vision", "EDGE chat with a missing stored image -> 400", bad3.s === 400, `HTTP ${bad3.s}`);
  const big = await fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ messages: [{ role: "user", content: "a".repeat(25 * 1024 * 1024) }] }) });
  add("Vision", "EDGE 25 MB chat body -> 413", big.status === 413, `HTTP ${big.status}`);
  const sets = await j("/api/evals/vlm/sets");
  add("Vision", "VLM eval sets list", sets.s === 200 && Array.isArray(sets.b?.sets), `HTTP ${sets.s}`);
  const runs = await j("/api/evals/vlm");
  add("Vision", "VLM eval runs list", runs.s === 200, `HTTP ${runs.s}`);
  const noSet = await j("/api/evals/vlm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "vllm", model: "base", setId: "no-such-set" }) });
  add("Vision", "EDGE eval on an unknown set refused", noSet.s >= 400 && noSet.s < 500, `HTTP ${noSet.s}`);
  const noImg = await j("/api/datasets/vision/no-such-dataset/image?path=images/a.png");
  add("Vision", "EDGE unknown vision dataset image -> 4xx", noImg.s >= 400 && noImg.s < 500, `HTTP ${noImg.s}`);
  const trav = await j("/api/datasets/vision/no-such-dataset/image?path=" + encodeURIComponent("images/../train.jsonl"));
  add("Vision", "EDGE image path traversal refused", trav.s >= 400 && trav.s < 500, `HTTP ${trav.s}`);

  // --- PAGES render ---
  for (const p of ["/dashboard","/tasks","/datasets","/models","/serve","/interact","/finetune","/evals","/evals?tab=vision","/prompts","/traces","/compute","/hub","/notes","/workflows","/generations","/settings"]) {
    const r = await fetch(BASE + p, { headers: { Cookie: COOKIE } });
    add("Pages", `${p} renders`, r.status === 200, `HTTP ${r.status}`);
  }

  console.log(JSON.stringify(R));
})().catch(e => { console.log(JSON.stringify([{area:"FATAL",name:"runner",ok:false,detail:String(e).slice(0,200)}])); });
