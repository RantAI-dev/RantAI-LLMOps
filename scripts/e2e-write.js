// WRITE-PATH end-to-end probe. Creates REAL objects on the box, verifies them,
// then cleans up what it can. Run from INSIDE rantai-frontend.
const BASE = "http://" + (process.env.TEST_HOST || "frontend") + ":3000";
const R = [];
const add = (area, name, ok, detail) => R.push({ area, name, ok, detail: String(detail).slice(0, 180) });
const STAMP = "e2e-" + Date.now().toString(36);
let COOKIE = "";

async function j(path, opt = {}) {
  const r = await fetch(BASE + path, { ...opt, headers: { ...(opt.headers || {}), Cookie: COOKIE } });
  let b = null; try { b = await r.json(); } catch {}
  return { s: r.status, b };
}
const jsonPost = (path, body) => j(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  COOKIE = (login.headers.get("set-cookie") || "").split(";")[0];
  if (!COOKIE) { console.log(JSON.stringify([{area:"FATAL",name:"login",ok:false,detail:"no cookie"}])); return; }

  // ========== 1. PROMPT REGISTRY — full CRUD round-trip ==========
  const pName = STAMP + "-prompt";
  let c = await jsonPost("/api/prompts", { name: pName, text: "Kamu asisten uji. Jawab singkat.", tags: ["e2e"] });
  add("Prompts", "create", c.s === 201, `HTTP ${c.s}`);
  const pid = c.b?.prompt?.id ?? c.b?.id ?? pName;

  let list = await j("/api/prompts");
  const all = list.b?.prompts || list.b?.data || (Array.isArray(list.b) ? list.b : []);
  add("Prompts", "created prompt appears in list", all.some(p => (p.name ?? p.id) === pName), `${all.length} prompts`);

  // new version
  const meta = await j(`/api/prompts/${encodeURIComponent(pid)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "diubah oleh uji e2e", tags: ["e2e", "diperbarui"] }) });
  add("Prompts", "update metadata", meta.s === 200, `HTTP ${meta.s}`);

  const alias = await j(`/api/prompts/${encodeURIComponent(pid)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias: "produksi", version: 1 }) });
  add("Prompts", "set alias", alias.s === 200, `HTTP ${alias.s}`);

  const ghost = await j("/api/prompts/tidak-ada-999", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "x" }) });
  add("Prompts", "EDGE unknown prompt -> 404", ghost.s === 404, `HTTP ${ghost.s}`);

  const dup = await jsonPost("/api/prompts", { name: pName, text: "dup" });
  add("Prompts", "EDGE duplicate name rejected", dup.s >= 400, `HTTP ${dup.s}`);

  const empty = await jsonPost("/api/prompts", { name: "", text: "" });
  const noText = await jsonPost("/api/prompts", { name: STAMP + "-notext", text: "   " });
  add("Prompts", "EDGE blank text rejected", noText.s === 400, `HTTP ${noText.s}`);
  add("Prompts", "EDGE empty name rejected", empty.s >= 400, `HTTP ${empty.s}`);

  const del = await j(`/api/prompts/${encodeURIComponent(pid)}`, { method: "DELETE" });
  add("Prompts", "CLEANUP delete", del.s >= 200 && del.s < 300, `HTTP ${del.s}`);

  // ========== 2. DATASET UPLOAD — real file onto the box ==========
  const dsName = STAMP + "-ds";
  const rows = [
    { prompt: "Apa ibu kota Indonesia?", completion: "Jakarta." },
    { prompt: "Sebutkan warna bendera Indonesia.", completion: "Merah dan putih." },
    { prompt: "Berapa 2+2?", completion: "4." },
  ].map(r => JSON.stringify(r)).join("\n");

  const fd = new FormData();
  fd.append("name", dsName);
  fd.append("file", new File([rows], "train.jsonl", { type: "application/jsonl" }));
  const up = await fetch(BASE + "/api/datasets/upload", { method: "POST", headers: { Cookie: COOKIE }, body: fd });
  let upBody = null; try { upBody = await up.json(); } catch {}
  add("Datasets", "upload real JSONL", up.status === 200, `HTTP ${up.status} ${JSON.stringify(upBody).slice(0,90)}`);

  const dl = await j("/api/datasets/list");
  const dss = dl.b?.datasets || dl.b?.data || [];
  add("Datasets", "uploaded dataset appears", dss.some(d => d.id === dsName), `${dss.length} datasets`);

  const pv = await j(`/api/datasets/preview?id=${encodeURIComponent(dsName)}&limit=10`);
  const pvRows = pv.b?.rows || pv.b?.data || [];
  add("Datasets", "uploaded rows readable", pv.s === 200 && pvRows.length === 3, `HTTP ${pv.s}, ${pvRows.length} rows`);

  // edge cases
  const fdBad = new FormData();
  fdBad.append("name", STAMP + "-bad");
  fdBad.append("file", new File(["not,a,jsonl"], "bad.txt", { type: "text/plain" }));
  const upBad = await fetch(BASE + "/api/datasets/upload", { method: "POST", headers: { Cookie: COOKIE }, body: fdBad });
  add("Datasets", "EDGE wrong extension rejected", upBad.status >= 400, `HTTP ${upBad.status}`);

  const fdNoName = new FormData();
  fdNoName.append("file", new File(["{}"], "x.jsonl"));
  const upNoName = await fetch(BASE + "/api/datasets/upload", { method: "POST", headers: { Cookie: COOKIE }, body: fdNoName });
  add("Datasets", "EDGE missing name rejected", upNoName.status === 400, `HTTP ${upNoName.status}`);

  // ========== 3. FINE-TUNE — submit a REAL job on the GPU ==========
  const ftBad = await jsonPost("/api/finetune/submit", { baseModel: "x" });
  add("Finetune", "EDGE missing fields rejected", ftBad.s === 400, `HTTP ${ftBad.s}`);

  const adaptor = STAMP + "-adaptor";
  const ft = await jsonPost("/api/finetune/submit", {
    baseModel: "Qwen/Qwen2.5-0.5B-Instruct",
    dataset: dsName,
    adaptorName: adaptor,
    epochs: 1, batchSize: 1, learningRate: "2e-4", maxSeqLength: 256,
  });
  const jobId = ft.b?.jobId;
  add("Finetune", "REAL job submitted to GPU", ft.s === 200 && !!jobId, `HTTP ${ft.s} job=${jobId ?? JSON.stringify(ft.b).slice(0,80)}`);

  if (jobId) {
    await new Promise(r => setTimeout(r, 8000));
    const jl = await j("/api/finetune/jobs");
    const jobs = jl.b?.jobs || jl.b?.data || (Array.isArray(jl.b) ? jl.b : []);
    const mine = jobs.find(x => String(x.id) === String(jobId));
    add("Finetune", "job visible in list", !!mine, mine ? `status=${mine.status}` : `not found among ${jobs.length}`);
    const out = await j(`/api/tasks/${encodeURIComponent(jobId)}/output`);
    add("Finetune", "job log readable", out.s === 200, `HTTP ${out.s}`);
  }

  // ========== 4. EVALS — submit a real eval ==========
  const evBad = await jsonPost("/api/evals/submit", { model: "x" });
  add("Evals", "EDGE missing benchmark rejected", evBad.s === 400, `HTTP ${evBad.s}`);

  // ========== 5. GATEWAY KEY — create + revoke (real state change) ==========
  const kc = await jsonPost("/api/serve/gateway", { action: "createKey", name: STAMP + "-key" });
  const newKey = kc.b?.created;
  add("Gateway", "create API key", kc.s === 200 && !!newKey?.key, `HTTP ${kc.s}`);
  add("Gateway", "raw key returned exactly once", !!newKey?.key && newKey.key.startsWith("gw-"), newKey?.key ? "yes (masked hereafter)" : "no");

  if (newKey?.id) {
    const after = await j("/api/serve/gateway");
    const keys = after.b?.apiKeys || [];
    const found = keys.find(k => k.id === newKey.id);
    add("Gateway", "key is masked on re-read", !!found && !!found.keyMasked && !found.key, found ? "masked" : "missing");
    const rv = await jsonPost("/api/serve/gateway", { action: "revokeKey", id: newKey.id });
    const left = (rv.b?.apiKeys || []).some(k => k.id === newKey.id);
    add("Gateway", "CLEANUP revoke key", rv.s === 200 && !left, `HTTP ${rv.s}`);
  }

  // ========== 6. CHAT default model (the bug we fixed) ==========
  const chatDefault = await fetch(BASE + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
  add("Chat", "default model works (no engine/model given)", chatDefault.status === 200, `HTTP ${chatDefault.status}`);

  console.log("__RESULTS__" + JSON.stringify(R) + "__END__");
  console.log("ARTIFACTS: dataset=" + dsName + " adaptor=" + adaptor);
})().catch(e => console.log("__RESULTS__" + JSON.stringify([{area:"FATAL",name:"runner",ok:false,detail:String(e).slice(0,200)}]) + "__END__"));
