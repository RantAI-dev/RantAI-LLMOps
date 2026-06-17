# AI Knowledge Log

File ini adalah sumber pengetahuan proyek yang wajib di-update oleh AI setiap kali melakukan pekerjaan (analisis, perubahan file, instalasi, fix, atau keputusan penting).

## Aturan Update

- Selalu tambahkan entry baru (append), jangan hapus histori lama.
- Gunakan waktu lokal dan jelaskan perubahan secara ringkas tapi jelas.
- Jika ada perubahan file, sebutkan path yang terdampak.
- Jika tidak ada perubahan file (mis. investigasi), tetap tulis insight/keputusan.

## Format Entry

```md
## YYYY-MM-DD HH:mm (UTC+7) - <agent/assistant>
- Task: <apa yang dikerjakan>
- Action: <aksi yang dilakukan>
- Files: `<path-1>`, `<path-2>` (atau `none`)
- Result: <hasil/keputusan>
- Next: <langkah lanjutan jika ada>
```

---

## 2026-05-09 15:59 (UTC+7) - codex
- Task: Inisialisasi knowledge base AI project.
- Action: Membuat file log terpusat dan menyiapkan aturan update untuk semua agent AI.
- Files: `AI_KNOWLEDGE_LOG.md`, `AGENTS.md`
- Result: Tersedia satu sumber kebenaran untuk histori kerja AI.
- Next: Setiap pekerjaan AI berikutnya wajib append entry baru.

## 2026-05-09 16:00 (UTC+7) - codex
- Task: Menegakkan kewajiban update knowledge oleh semua AI.
- Action: Menambahkan aturan mandatory di panduan agent project.
- Files: `AGENTS.md`
- Result: Instruksi global project kini mewajibkan update `AI_KNOWLEDGE_LOG.md` di setiap aktivitas penting AI.
- Next: Terapkan pattern entry yang sama di semua task berikutnya.

## 2026-05-09 17:08 (UTC+7) - codex
- Task: Analisis kebutuhan implementasi dashboard dari Figma.
- Action: Meninjau struktur project Next.js + shadcn, membaca panduan Next docs lokal, autentikasi MCP Figma, mengambil design context dan screenshot node dashboard.
- Files: `AGENTS.md`, `app/page.tsx`, `components/ui/button.tsx`, `components/ui/surface.tsx`, `components/ui/typography.tsx`, `app/layout.tsx`, `app/globals.css`, `package.json`, `AI_KNOWLEDGE_LOG.md`
- Result: Struktur UI target, style utama, dan komponen yang dibutuhkan sudah terpetakan untuk implementasi presisi.
- Next: Implement halaman dashboard baru dengan komponen shadcn serta validasi lint/functionality.

## 2026-05-09 17:18 (UTC+7) - codex
- Task: Implementasi dashboard presisi berbasis Figma dengan komponen shadcn.
- Action: Mengganti baseline page menjadi layout dashboard lengkap (sidebar, topbar, metric cards, tabs, top models), menambahkan komponen UI `card`, `input`, `progress`, `avatar`, `tabs`, dan menghubungkan state interaktif (menu aktif, tab aktif, pencarian model).
- Files: `app/page.tsx`, `components/ui/card.tsx`, `components/ui/input.tsx`, `components/ui/progress.tsx`, `components/ui/avatar.tsx`, `components/ui/tabs.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Tampilan halaman kini mendekati desain Figma dan fitur utama UI bisa dipakai (filter/search, perpindahan tab, highlight menu).
- Next: Jalankan lint dan cek tampilan akhir di dev server untuk memastikan tidak ada regresi.

## 2026-05-09 17:20 (UTC+7) - codex
- Task: Validasi kualitas implementasi dashboard.
- Action: Menjalankan `npm run lint`, memperbaiki warning (unused import, aksesibilitas tabs, dan struktur avatar), lalu menjalankan lint ulang dan cek diagnostics editor.
- Files: `app/page.tsx`, `components/ui/avatar.tsx`, `components/ui/tabs.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Lint bersih tanpa error/warning pada file yang diubah.
- Next: User dapat review visual langsung di `localhost:3000` untuk fine-tuning pixel-level jika diperlukan.

## 2026-05-09 17:24 (UTC+7) - codex
- Task: Menyesuaikan ulang sidebar agar fungsional dan ikon lebih relevan.
- Action: Menambah state `isSidebarOpen` untuk toggle buka/tutup sidebar dari navbar, membuat mode collapsed yang tetap interaktif, memperbaiki highlight item aktif di dua grup menu, serta mengganti ikon sidebar agar sesuai konteks fitur.
- Files: `app/page.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Sidebar sekarang bisa collapse/expand dengan tombol toggle, menu tetap berfungsi saat terbuka maupun tertutup, dan ikon menu lebih representatif.
- Next: Lanjutkan fine-tuning spacing/typography sidebar jika user ingin presisi visual yang lebih ketat terhadap Figma.

## 2026-05-10 10:20 (UTC+7) - assistant
- Task: Menyesuaikan menu sidebar (termasuk Dashboard), dan tipografi default 14px.
- Action: Menyusun ulang `mainNav` + `workspaceNav` dengan item Dashboard pertama dan Tasks memakai ikon terpisah; default aktif Dashboard; konten utama hanya penuh di Dashboard, menu lain placeholder; skala tipografi terpusat (`ui` constants) — judul `text-2xl`, subheading `text-base`, section `text-lg`, angka KPI `text-2xl`, sisanya 14px; memperbarui `input`, `tabs`, `card`, `avatar`, `button`, `typography` agar konsisten 14px pada teks UI.
- Files: `app/page.tsx`, `components/ui/input.tsx`, `components/ui/tabs.tsx`, `components/ui/card.tsx`, `components/ui/avatar.tsx`, `components/ui/button.tsx`, `components/ui/typography.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Sidebar punya Dashboard, hierarki font lebih seimbang, dan komponen UI dasar selaras dengan baseline 14px.
- Next: Isi placeholder per menu saat modul backend siap.

## 2026-05-10 11:05 (UTC+7) - assistant
- Task: Menggunakan logo NQ dari folder `public` di UI.
- Action: Mengganti placeholder teks "NQ" di header sidebar dengan `next/image` memuat `/nq-logo.png` (`public/nq-logo.png`), ukuran 32×32, `object-contain`, `priority`.
- Files: `app/page.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Branding sidebar memakai aset logo resmi dari `public`.
- Next: Jika perlu ukuran berbeda saat sidebar collapsed, sesuaikan `width`/`height` atau class container.

## 2026-05-17 14:30 (UTC+7) - assistant
- Task: Membangun halaman Tasks (AI Job Control Center) untuk demo LLM Ops.
- Action: Menambah types/mock data/hook `useTasks` dengan simulasi progress, filter/sort, CRUD actions (start/pause/stop/retry/clone/delete), sheet create task, drawer detail (overview, config, timeline, resources, logs, artifacts), summary cards, dan integrasi ke shell `app/page.tsx` saat menu Tasks aktif.
- Files: `types/tasks.ts`, `lib/tasks/mock-tasks.ts`, `lib/tasks/utils.ts`, `hooks/use-tasks.ts`, `components/tasks/*`, `app/page.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Build production sukses; demo flow lengkap dari overview, list, filter, create & queue, run dengan progress hidup, hingga detail task.
- Next: Hubungkan ke API backend / WebSocket untuk log dan resource usage real-time.

## 2026-05-17 15:10 (UTC+7) - assistant
- Task: Refactor struktur proyek ke `src/` dengan folder per modul dan satu file per komponen.
- Action: Memindahkan `app`, `components/ui`, `lib`, `hooks`, `types`, `styles` ke `src/`; mengelompokkan fitur Tasks ke `src/modules/tasks/` (`components/`, `hooks/`, `lib/`, `data/`, `constants/`, `types.ts`, `index.ts`); update `tsconfig` alias `@/*` → `./src/*`, `components.json`, import di seluruh modul, dan `README.md`.
- Files: `src/**`, `tsconfig.json`, `components.json`, `README.md`, `AI_KNOWLEDGE_LOG.md` (menghapus root `app/`, `components/`, dll. yang kosong)
- Result: Build sukses; modul Tasks self-contained; shell import `TasksPage` dari `@/modules/tasks`.
- Next: Modul baru (Evals, Documents, dll.) ikuti pola `src/modules/<nama>/components/<komponen>.tsx`.

## 2026-05-17 15:15 (UTC+7) - assistant
- Task: Fix Internal Server Error setelah migrasi ke `src/`.
- Action: Set `turbopack.root` di `next.config.ts` agar root proyek `nqllmops` (bukan parent `Nexus/`); hapus cache `.next`; error `ENOENT scandir .../app` karena dev server lama masih jalan dan memindai folder `app/` yang sudah dihapus.
- Files: `next.config.ts`, `AI_KNOWLEDGE_LOG.md`
- Result: Build OK; dev baru di port bersih mengembalikan HTTP 200.
- Next: User stop `npm run dev` lama lalu jalankan ulang sekali setelah pull config.

## 2026-05-17 16:00 (UTC+7) - assistant
- Task: Sesuaikan shadcn Button primary dengan Figma LLM-Ops (node 81:916).
- Action: Ambil token Figma (`#ff5001`, `#f8fafc`, radius 6px, px-16, text 14/20); update `design-tokens.css` dan variant `default` + size `default` di `button.tsx`.
- Files: `src/styles/design-tokens.css`, `src/components/ui/button.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: `<Button>` default memakai brand orange Figma; tetap shadcn + CVA.
- Next: Selaraskan variant outline/secondary jika ada frame Figma terpisah.

## 2026-05-17 16:20 (UTC+7) - assistant
- Task: Sesuaikan search bar & filter Tasks dengan design Figma Input (5:6096).
- Action: Token `--input` #e2e8f0, placeholder #551d00; update `Input` shadcn; refactor `task-filters` (toolbar tanpa gray box, search max 372px, ikon orange); komponen `filter-select` dengan chevron; selaraskan navbar search.
- Files: `src/modules/tasks/components/task-filters.tsx`, `filter-select.tsx`, `constants/task-ui.ts`, `src/components/ui/input.tsx`, `src/styles/design-tokens.css`, `src/app/page.tsx`
- Result: Filter/search konsisten dengan design system Figma.
- Next: —

## 2026-05-17 16:45 (UTC+7) - assistant
- Task: Refactor konsep Project → Experiment di modul Tasks (naming & UI saja).
- Action: Tambah type `Experiment`, field `experimentId`/`experimentName` pada `AITask`; mock experiments + update mock tasks; filter experiment; form create pakai select experiment; update list/detail/search/clone/create.
- Files: `src/modules/tasks/types.ts`, `data/mock-experiments.ts`, `data/mock-tasks.ts`, `hooks/use-tasks.ts`, `components/*`, `index.ts`
- Result: Build OK; tidak ada referensi Project tersisa di modul Tasks; flow task tidak berubah.
- Next: Modul Experiments terpisah jika perlu CRUD experiment di luar Tasks.

## 2026-05-17 18:30 (UTC+7) - assistant
- Task: Tambah modul Experiment (parent entity Task) — list, create, detail, overview dari task terkait, actions.
- Action: `LlmOpsProvider` state bersama tasks+experiments; `src/modules/experiments/` (types, mock, utils, summary/filters/card/form/detail/page); integrasi sidebar Experiments + wrap `LlmOpsProvider` di `page.tsx`; create task dari detail dengan experiment preset & field terkunci; filter status pakai `deriveExperimentStatus`.
- Files: `src/modules/experiments/**`, `src/modules/llm-ops/context/llm-ops-provider.tsx`, `src/app/page.tsx`, `src/modules/tasks/components/create-task-sheet.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Build OK; flow list → create → detail → create task → overview otomatis dari task; modul Task tidak diubah perilakunya.
- Next: Navigasi lintas modul (buka task dari experiment ke drawer global) opsional; sinkron bestScore dari task completed.

## 2026-05-17 19:00 (UTC+7) - assistant
- Task: Polish tampilan experiment card agar lebih seamless.
- Action: Redesign `experiment-card.tsx` — padding tunggal, footer progress terintegrasi, metrik satu strip dengan divider, meta dengan ikon, tag pill, menu on-hover, hover border/shadow halus.
- Files: `src/modules/experiments/components/experiment-card.tsx`, `experiments-page.tsx` (grid gap)
- Result: Kartu lebih rapi dan konsisten dengan design system; build OK.
- Next: —

## 2026-05-17 20:00 (UTC+7) - assistant
- Task: Fix hydration error breadcrumb (`<li>` inside `<li>`).
- Action: `BreadcrumbNav` render separator sebagai sibling `<li>` di `<ol>`, bukan anak `BreadcrumbItem`.
- Files: `src/components/ui/breadcrumb.tsx`
- Result: Console hydration error hilang; build OK.
- Next: —

## 2026-05-17 19:45 (UTC+7) - assistant
- Task: Redesign halaman detail experiment — layout padat, activity log modal.
- Action: Satukan overview + performance + task distribution dalam satu panel; toolbar kompak (Activity modal, Create Task, menu ⋯); hapus kartu terpisah & blank space; tambah `experiment-activity-modal.tsx`, `experiment-detail-toolbar.tsx`.
- Files: `experiment-detail-view.tsx`, `experiment-activity-modal.tsx`, `experiment-detail-toolbar.tsx`
- Result: Detail lebih jelas dan ringkas; activity history via popup; build OK.
- Next: —

## 2026-05-17 19:15 (UTC+7) - assistant
- Task: Breadcrumb navigasi kembali di halaman detail experiment.
- Action: Tambah `src/components/ui/breadcrumb.tsx` + `BreadcrumbNav`; ganti tombol back di `experiment-detail-view` dengan `Experiments > {nama}`.
- Files: `src/components/ui/breadcrumb.tsx`, `src/modules/experiments/components/experiment-detail-view.tsx`
- Result: Klik "Experiments" kembali ke list; build OK.
- Next: —

## 2026-05-24 16:30 (UTC+7) - assistant
- Task: Sidebar tetap diam saat konten utama di-scroll.
- Action: Shell `h-dvh overflow-hidden`; aside `h-full shrink-0`; area konten `overflow-y-auto`; `body` `overflow-hidden`; hapus scroll ganda di halaman modul.
- Files: `src/app/layout.tsx`, `src/app/page.tsx`, `experiments-page.tsx`, `tasks-page.tsx`, `datasets-page.tsx`, `experiment-detail-view.tsx`, `dataset-detail-view.tsx`
- Result: Hanya main content yang scroll; sidemenu fixed.
- Next: —

## 2026-05-24 16:15 (UTC+7) - assistant
- Task: Hapus deskripsi dan meta owner/update dari header dataset detail.
- Action: Hapus blok description + baris `Owner · Updated` di `dataset-detail-view.tsx` (info tetap di tab Overview).
- Files: `src/modules/datasets/components/dataset-detail-view.tsx`
- Result: Header detail lebih ringkas seperti experiment detail.
- Next: —

## 2026-05-24 16:00 (UTC+7) - assistant
- Task: Polish Dataset Library UI agar selaras dengan Experiments/Tasks.
- Action: Filter pakai pola `ExperimentFiltersBar` + `FilterSelect`; wizard modal + `DatasetWizardStepper`; form `DatasetFormField`; detail header kompak + `DatasetDetailToolbar`; token UI dari `task-ui` (`searchFieldClassName`, `selectClassName`).
- Files: `src/modules/datasets/components/**`, `src/modules/datasets/constants/dataset-ui.ts`
- Result: Tampilan lebih clean dan konsisten; build OK.
- Next: —

## 2026-05-24 14:30 (UTC+7) - assistant
- Task: Modul Dataset Library untuk LLM Ops (list, create wizard 6 langkah, detail 8 tab).
- Action: Tambah `src/modules/datasets/` (types, mock data, `DatasetsProvider` + localStorage, komponen list/card/filters/wizard/detail); wire sidebar **Dataset** di `src/app/page.tsx` dengan `DatasetsProvider`.
- Files: `src/modules/datasets/**`, `src/app/page.tsx`
- Result: Dataset Library aktif di menu Workspace; interaksi mock (create, archive, validate again, versioning, split, schema mapping); build OK.
- Next: Hubungkan ke API backend; sinkron dataset picker di Experiments/Tasks.

## 2026-05-31 12:00 (UTC+7) - assistant
- Task: Buat halaman Model Registry lengkap untuk LLM Ops (list, import HF, detail 8 tab).
- Action: Tambah modul `src/modules/model-registry/` dengan types, mock data (6 model awal + katalog HF), `ModelRegistryProvider` (filter, import wizard mock, deploy/eval/archive, toast), komponen list/table/filters/summary, import sheet 5 langkah, register local sheet, detail view 8 tab; wire sidebar **Model Registry** di `src/app/page.tsx`.
- Files: `src/modules/model-registry/**`, `src/app/page.tsx`
- Result: Model Registry aktif di menu Workspace; interaksi front-end mock (search, filter, import HF, validate token, deploy, evaluation, archive, toast); build OK.
- Next: Hubungkan ke API Hugging Face/backend; integrasi Playground dan fine-tune flow.

## 2026-05-31 14:30 (UTC+7) - assistant
- Task: Tambah import dataset dari Hugging Face di halaman Dataset Library.
- Action: Tambah source `Hugging Face`, types (`HuggingFaceDatasetCatalogEntry`, `HuggingFaceImportConfig`, `HuggingFaceDatasetSource`), mock katalog 6 dataset HF, extend `DatasetsProvider` (search, validate token, import flow mock), komponen `ImportHuggingFaceDatasetSheet` 5 langkah dengan field `load_dataset` (path/repo_id, name/config, split, revision, token, streaming, trust_remote_code), auto schema mapping dari features; wire tombol Import di `datasets-page`, opsi HF di create wizard, tab Hugging Face Source di detail view.
- Files: `src/modules/datasets/types.ts`, `src/modules/datasets/data/mock-huggingface-datasets-catalog.ts`, `src/modules/datasets/context/datasets-provider.tsx`, `src/modules/datasets/components/import-huggingface-dataset-sheet.tsx`, `src/modules/datasets/components/datasets-page.tsx`, `src/modules/datasets/components/create-dataset-wizard.tsx`, `src/modules/datasets/components/dataset-detail-view.tsx`, `src/modules/datasets/lib/utils.ts`, `src/modules/datasets/constants/dataset-ui.ts`, `src/modules/datasets/data/initial-datasets.ts`
- Result: Import HF dataset mock berfungsi (search, preview configs/splits/features, configure, import progress); dataset tersimpan dengan metadata HF; build OK.
- Next: Hubungkan ke Hugging Face Hub API / backend `datasets.load_dataset` untuk import nyata.

## 2026-05-31 14:45 (UTC+7) - assistant
- Task: Hapus bahasa "demo" dari UI import Hugging Face dataset.
- Action: Hapus panel petunjuk demo token di `import-huggingface-dataset-sheet.tsx`; rename entri katalog gated tanpa label "Demo".
- Files: `src/modules/datasets/components/import-huggingface-dataset-sheet.tsx`, `src/modules/datasets/data/mock-huggingface-datasets-catalog.ts`
- Result: UI import HF tanpa teks demo; build tidak diubah.
- Next: —

## 2026-06-06 10:00 (UTC+7) - assistant
- Task: Analisis ketersediaan fitur RAG (upload dokumen, manage knowledge base, RAG evaluation) vs referensi TransformerLab.
- Action: Audit modul `datasets`, `tasks`, `experiments`, `model-registry`, navigasi `src/app/page.tsx`; bandingkan dengan alur RAG TransformerLab (Documents → Generate QA → Train embedding → Interact Query Docs → DeepEval).
- Files: `none` (investigasi saja)
- Result: RAG belum diimplementasi end-to-end; hanya scaffolding taxonomy (`RAG Knowledge Base` di Dataset, embedding model BGE di Model Registry, task Evaluation/Benchmark generik). Menu Documents, Interact, Evals masih placeholder.
- Next: Perluas modul existing — Dataset detail untuk KB/index, Tasks untuk indexing/QA gen/embedding eval, Interact untuk Query Docs, Experiments/Evals untuk metrik RAG (contextual precision, answer relevancy).

## 2026-06-06 11:30 (UTC+7) - assistant
- Task: Implementasi fitur RAG end-to-end (upload dokumen, manage KB, query, evaluasi) tanpa modul baru.
- Action: Extend types (`RagKnowledgeBase`, documents, chunks, index config, eval metrics); mock data WMS KB; provider actions (upload, remove, reindex, query); tab RAG di dataset detail; halaman Documents, Interact Query Docs, Evals RAG; task types RAG + mock tasks + engines; wire navigasi di `page.tsx`.
- Files: `src/modules/datasets/types.ts`, `src/modules/datasets/data/rag-mock-data.ts`, `src/modules/datasets/lib/rag-utils.ts`, `src/modules/datasets/context/datasets-provider.tsx`, `src/modules/datasets/components/rag/*`, `src/modules/datasets/components/documents-page.tsx`, `src/modules/datasets/components/interact-rag-page.tsx`, `src/modules/datasets/components/evals-rag-page.tsx`, `src/modules/datasets/components/dataset-detail-view.tsx`, `src/modules/datasets/components/datasets-page.tsx`, `src/modules/datasets/constants/dataset-ui.ts`, `src/modules/datasets/data/initial-datasets.ts`, `src/modules/datasets/index.ts`, `src/modules/tasks/types.ts`, `src/modules/tasks/data/mock-tasks.ts`, `src/modules/tasks/lib/utils.ts`, `src/modules/tasks/components/create-task-sheet.tsx`, `src/modules/llm-ops/context/llm-ops-provider.tsx`, `src/modules/experiments/types.ts`, `src/app/page.tsx`
- Result: RAG pipeline UI mock berfungsi (upload → index → query → eval); build OK; alur selaras TransformerLab (Documents → Generate QA → Train embedding → Query Docs → DeepEval).
- Next: Hubungkan ke backend RAG (vector store, embedding API, DeepEval runner).

## 2026-06-06 12:15 (UTC+7) - assistant
- Task: Perbaiki copy UI fitur RAG ke sudut pandang produk.
- Action: Rewrite teks user-facing di Documents, Interact, Evals, tab RAG dataset detail, mock tasks/eval runs; hapus referensi TransformerLab/mock/plugin; ganti istilah teknis (chunks → passages, DeepEval Runner → RAG Evaluator).
- Files: `src/modules/datasets/components/**`, `src/modules/datasets/data/rag-mock-data.ts`, `src/modules/datasets/data/initial-datasets.ts`, `src/modules/datasets/context/datasets-provider.tsx`, `src/modules/datasets/constants/dataset-ui.ts`, `src/modules/tasks/types.ts`, `src/modules/tasks/data/mock-tasks.ts`, `src/modules/tasks/components/create-task-sheet.tsx`, `src/modules/tasks/components/task-detail-drawer.tsx`
- Result: Copy konsisten berorientasi pengguna produk; build OK.
- Next: —

## 2026-06-06 13:45 (UTC+7) - assistant
- Task: Lengkapi halaman Documents menjadi modul app utuh (selaras Dataset/Model Registry).
- Action: Tambah summary cards, filters, tabs All documents/Knowledge bases, documents table, KB detail view in-page (Documents/Search settings/Passages), upload sheet, create KB wizard preset; navigasi ke Interact/Evals tanpa redirect ke Dataset.
- Files: `src/modules/datasets/components/documents-page.tsx`, `documents-summary-cards.tsx`, `documents-filters.tsx`, `documents-table.tsx`, `document-kb-detail-view.tsx`, `upload-document-sheet.tsx`, `constants/documents-ui.ts`, `lib/documents-utils.ts`, `create-dataset-wizard.tsx`, `src/app/page.tsx`, `src/modules/datasets/index.ts`
- Result: Documents berdiri sendiri sebagai hub manajemen dokumen & knowledge base; build OK.
- Next: Hubungkan global header search ke filter Documents; persist selected KB across navigation.

## 2026-06-13 16:55 (UTC+7) - assistant
- Task: Push project ke GitHub.
- Action: Commit seluruh perubahan (115 files, migrasi ke `src/`, modul LLM Ops UI); buat repo `NexusQuantum/nqllmops` via GitHub API; tambah remote `origin`; push branch `main`.
- Files: seluruh working tree; `.git/config` (remote origin)
- Result: Push sukses ke https://github.com/NexusQuantum/nqllmops — branch `main` tracking `origin/main`.
- Next: —

## 2026-06-15 (UTC+7) - assistant
- Task: Audit code-quality / best-practices menyeluruh sebelum integrasi backend (React/Next correctness, state management, TypeScript, arsitektur komponen, newbie mistakes).
- Action: Membaca shell `src/app/page.tsx`, ketiga context provider, modul tasks end-to-end, dan menelusuri keempat feature module (tasks/experiments/datasets/model-registry) via sub-agent. Tidak ada perubahan kode — hanya investigasi & laporan prioritas.
- Files: none (read-only audit)
- Result: Temuan utama — (1) ketiga provider tidak me-`useMemo` object `value` (re-render storm), diperparah setInterval 1.2s di llm-ops-provider; (2) tidak ada data-fetching seam, mock diimpor langsung & state mutasi lokal → swap ke API mahal; (3) duplikasi lintas modul (statusStyles, StatusBadge, FilterSelect, hook pass-through); (4) warna hardcode `#ff5001` 153x; (5) `page.tsx` shell 464 baris pakai if/else routing & inline dashboard; localStorage persist hanya di datasets. Health: ~6/10 (rapi & type-safe, tapi belum siap backend).
- Next: Tambahkan service layer (async getX/mutateX), memoize context value atau pecah provider, ekstrak komponen UI bersama, sentralisasi design tokens.

## 2026-06-15 (UTC+7) - assistant
- Task: Cek realisme fitur UI nqllmops terhadap kemampuan nyata backend Transformer Lab (`d:\Project\transformerlab-app\api`), karena user pilih Jalur A (pakai backend TL apa adanya).
- Action: Memetakan endpoint REST TL (routers `data`, `model`, `experiment/jobs`, `experiment/task`, `experiment/documents`, `compute_provider`, `serverinfo`) lalu membandingkan dengan janji UI per modul. Investigasi saja, tidak ada perubahan kode.
- Files: none (analisis lintas-repo)
- Result: (A) FANTASI/tidak didukung backend TL: RAG end-to-end (embedding/vector store Chroma-FAISS-Qdrant, chunk, query chat dgn similarity, metrik Contextual Precision/Answer Relevancy/Faithfulness) — `documents` TL hanya file storage; live GPU/VRAM/CPU/Memory % realtime (TL tak expose metrik GPU realtime); cost estimate per task/request; Deploy to Staging/Production + endpointUrl + replica + rollback (TL inference = launch job vLLM/Ollama lalu ekstrak tunnel URL dari log); analitik usage per-model (requests/latency/token/GPU%); data-quality auto (PII/toxic/quality score); dataset source Database/API/Cloud. (B) REALISTIS: experiments CRUD+tags+status, model registry (list/import HF/upload/PEFT/delete), dataset library (upload/HF download/preview features), job logs (SSE `stream_output`/`task_logs`), artifacts/checkpoints, metrics.jsonl polling, asset versioning+rollback, training Unsloth via gallery task, compute providers. (C) SALAH KONSEP: UI menyebut "Task" untuk eksekusi+progress+log — di TL itu "Job"; "Task" TL = template (task.yaml). Documents/Datasets/Models di TL scoped per-experiment, di UI global. (D) UNDER-BUILT (backend punya, UI placeholder): Compute (provider cloud/cluster), Tasks Gallery (import dari gallery), Teams/permission/quota.
- Next: Susun peta integrasi endpoint→modul; pisahkan konsep Task(template) vs Job(run); putuskan RAG/deploy/cost/GPU-metrics jadi roadmap "butuh service sendiri" atau dibuang dari UI fase 1.

## 2026-06-15 (UTC+7) - assistant
- Task: Fase 1 — tandai fitur "fantasi" (tanpa backend TL) di UI secara berlapis (sidebar + banner + badge) tanpa menghapus, pakai satu registry sebagai sumber tunggal. (Keputusan user: Jalur A, mark dulu.)
- Action: Tambah registry `src/lib/feature-status.ts` (status live/simplified/mock/planned + map nav→fitur), komponen `MockBadge` & `MockBanner` (merah, warna terpusat di 2 komponen). Terapkan: titik merah di sidebar untuk Interact/Evals/Documents (`src/app/page.tsx`); banner di Interact, Evals, RAG Index tab, tab Validation dataset detail, step Validate wizard dataset; banner di Model detail tab Deployment/Evaluation/Usage; badge di Task detail (Resource Usage + Est. cost); badge "No backend" pada source dataset API & Cloud Storage di wizard. Verifikasi `npm run build` (Next 16) — sukses, TypeScript lolos.
- Files: `src/lib/feature-status.ts` (baru), `src/components/ui/mock-badge.tsx` (baru), `src/components/ui/mock-banner.tsx` (baru), `src/app/page.tsx`, `src/modules/datasets/components/interact-rag-page.tsx`, `evals-rag-page.tsx`, `rag/rag-index-tab.tsx`, `create-dataset-wizard.tsx`, `dataset-detail-view.tsx`, `src/modules/model-registry/components/model-detail-view.tsx`, `src/modules/tasks/components/task-detail-drawer.tsx`, `AI_KNOWLEDGE_LOG.md`
- Result: Fitur mock tetap tampil tapi jelas ditandai merah; build hijau. Sumber penanda terpusat (ubah 1 registry untuk reklasifikasi fitur).
- Next: Fase 2 — perbaiki konsep Task(template) vs Job(run) + scoping experiment; Fase 3 — sederhanakan fitur partial (import HF, schema mapping, eval artifact); Fase 4 — bangun under-built (Tasks Gallery import plugin Unsloth, Compute provider/cluster). Tandai juga `simplified` saat fase 3.

## 2026-06-15 (UTC+7) - assistant
- Task: Fase 2 — perbaiki salah konsep: pisahkan **Task (template/recipe)** dari **Run/Job (eksekusi)**, selaras model Transformer Lab (`/experiment/{id}/task` vs `/experiment/{id}/jobs`).
- Action: (types) tambah `TaskRun` (semua state eksekusi: status/progress/startedAt/finishedAt/durationMs/outputStatus/logs/artifacts/resourceUsage/timeline) + `RunStatus`; `Task` jadi template berisi config + `runs: TaskRun[]` (terbaru dulu); `AITask` di-alias ke `Task` agar file yang hanya pakai sebagai tipe prop tetap kompilasi; `TaskStatus` derivasi (Draft bila belum ada run). (lib/utils) tambah `latestRun`/`taskStatus`/`taskProgress`/`generateRunId`; `averageDurationMs`/`activeGpuUsage` baca dari run. (mock-tasks) pertahankan literal sebagai `TaskSeed[]` lalu `toTask()` memetakan ke Task+run #1 (seed Draft → tanpa run). (provider) state `tasks: Task[]`; aksi berbasis run — `startTask` resume run Paused/Queued atau buat run baru bila template fresh/terminal, `pauseTask`/`stopTask`/`retryTask` (retry = run baru), `cloneTask` duplikat template (runs kosong), `createTask` membuat template + queue run #1; interval 1.2s mensimulasi run latest. (UI) task-table baca latest run + jumlah run; task-detail-drawer jadi detail Run (+ section "Runs" history, label Run/Resume/Start); task-summary-cards & experiments/lib/utils (deriveExperimentStatus, getExperimentTaskStats, countTasksByStatus) derive via taskStatus/taskProgress/latestRun.
- Files: `src/modules/tasks/types.ts`, `src/modules/tasks/lib/utils.ts`, `src/modules/tasks/data/mock-tasks.ts`, `src/modules/llm-ops/context/llm-ops-provider.tsx`, `src/modules/tasks/components/task-table.tsx`, `task-summary-cards.tsx`, `task-detail-drawer.tsx`, `create-task-sheet.tsx`, `src/modules/experiments/lib/utils.ts`
- Result: `npm run build` (Next 16) sukses, TypeScript lolos; `npm run lint` tidak menambah error baru di file yang diubah (6 error lint sisa semuanya pre-existing: set-state-in-effect di register-local-sheet/create-task-sheet/experiment-form-sheet, unused var di tasks-page, dll). Konsep kini benar: 1 Task → banyak Run; status/progress task adalah derivasi run terbaru.
- Next: Fase 3 — sederhanakan fitur partial agar pas TL (import HF dipangkas, schema mapping jadi helper, eval dari artifact) + tandai `simplified`; Fase 4 — Tasks Gallery (import plugin Unsloth) + Compute. Opsional: bereskan 6 lint error pre-existing di fase code-quality.

## 2026-06-15 (UTC+7) - assistant
- Task: Fase 3 — sederhanakan fitur "sebagian nyata" agar selaras backend TL + tandai status `simplified` (amber, beda dari mock merah).
- Action: Tambah komponen `SimplifiedNote` (amber informational) dan status `simplified` di registry untuk `model.huggingFaceImport`, `dataset.huggingFaceImport`, `dataset.schemaMapping`. Terapkan note yang menjelaskan endpoint TL nyata + menandai bagian yang hanya bantuan UI: (1) HF dataset import step Configure → TL unduh penuh via `/data/download` (`load_dataset(path,name,split,revision)`); Import Mode Streaming/Metadata, Access Level, Owner = UI-only; (2) HF model import step Configure → TL unduh + validasi `config.json`/deteksi arsitektur (`/model/finalize`); Target Storage S3/MinIO, Serving Engine, checklist vLLM/hardware = UI-only; judul checklist diubah jadi "Pre-import hints (heuristic — not verified by backend)"; (3) schema mapping (wizard step 3 + tab Schema dataset detail) → TL deteksi fitur otomatis via `/data/info`, mapping manual hanya bantuan UI.
- Files: `src/components/ui/simplified-note.tsx` (baru), `src/lib/feature-status.ts`, `src/modules/datasets/components/import-huggingface-dataset-sheet.tsx`, `src/modules/datasets/components/create-dataset-wizard.tsx`, `src/modules/datasets/components/dataset-detail-view.tsx`, `src/modules/model-registry/components/import-huggingface-sheet.tsx`
- Result: `npm run build` (Next 16) sukses, TypeScript lolos. Fitur partial kini jujur soal batas TL tanpa menghapus flow. Catatan: penyederhanaan dilakukan via klarifikasi/relabel (bukan menghapus field wizard) agar rendah risiko; trimming field bisa menyusul saat integrasi nyata.
- Next: Fase 4 — bangun under-built (Tasks Gallery import plugin Unsloth dari gallery TL, Compute provider/cluster). Lalu fase code-quality (service layer, memoize context, dedup) + bereskan lint pre-existing.

## 2026-06-15 (UTC+7) - assistant
- Task: Revisi Fase 3 (keputusan user) — daripada menandai `simplified`, langsung **pangkas opsi yang TL tidak dukung** lalu hapus penanda, sehingga UI benar-benar = TL dan tak perlu ditandai.
- Action: HF dataset import — hapus select "Import Mode" (Full/Streaming/Metadata) + baris `streaming: c.importMode === "Streaming"`; hapus import `HF_IMPORT_MODES` & `SimplifiedNote`. HF model import — hapus "Import Mode", "Target Storage" (S3/MinIO), dan panel checklist vLLM/hardware; hapus import `IMPORT_MODES`/`TARGET_STORAGES`/`IMPORT_VALIDATION_CHECKS`/`SimplifiedNote` (perbaiki 1 `</div>` outer yang ikut terhapus). Field metadata sah dipertahankan (Target Registry, Revision, Serving Engine, Model Owner, Initial Status, Access Level, Owner, Split). Schema mapping — hapus note di wizard step 3 & tab Schema dataset detail; mapping tetap sebagai metadata app (TL auto-detect via /data/info). Hapus 3 entri `simplified` di `feature-status.ts` dan **hapus komponen `simplified-note.tsx`** (jadi dead code).
- Files: `src/modules/datasets/components/import-huggingface-dataset-sheet.tsx`, `src/modules/model-registry/components/import-huggingface-sheet.tsx`, `src/modules/datasets/components/create-dataset-wizard.tsx`, `src/modules/datasets/components/dataset-detail-view.tsx`, `src/lib/feature-status.ts`, hapus `src/components/ui/simplified-note.tsx`
- Result: `npm run build` (Next 16) sukses, TypeScript lolos; `npm run lint` tetap 15 problems (6 error, 9 warning) — identik baseline, tak ada masalah baru. UI import HF kini selaras endpoint TL (`/data/download`, `/model/finalize`) tanpa opsi fiktif; tak ada penanda amber lagi. Status `simplified` masih ada di type `FeatureStatus` untuk dipakai nanti bila perlu.
- Next: Fase 4 — Tasks Gallery (import plugin Unsloth) + Compute provider/cluster.

## 2026-06-15 (UTC+7) - assistant
- Task: Fase 4 — bangun modul under-built yang backend TL sudah punya tapi UI masih placeholder: **Tasks Gallery** (import recipe/plugin termasuk Unsloth) & **Compute** (provider/cluster). Grounding ke struktur TL nyata agar match saat integrasi.
- Action: Pelajari `task-gallery.json` (shape: title/description/github_repo_dir/metadata{category,modality,framework}/supportedAccelerators) + `compute_providers/models.py` (ClusterState up/init/stopped/down/failed/unknown, JobState, ClusterStatus, ResourceInfo). Modul **tasks-gallery**: `types.ts`, `data/gallery-tasks.ts` (10 entri nyata TL termasuk 3 Unsloth: LLM/GRPO/TTS), `lib/gallery-mapping.ts` (framework→engine, category→TaskType, accelerator→gpuCount), komponen card + import sheet + page (filter category/framework/modality + search). Import → `useLlmOps.createTask` membuat Task template (+queued run) di experiment. Modul **compute**: `types.ts` (provider types Local/SkyPilot/Slurm/RunPod/dstack/AWS/GCP/Azure/Vast.ai; Cluster/Accelerator/ClusterJob), `data/initial-compute.ts` (Local+RunPod+AWS dgn cluster/job), page summary+provider cards (status/default/clusters/accelerators) + add-provider sheet; state lokal `useState` (tanpa context baru, hindari re-render storm). Wire sidebar Tasks Gallery + Compute di `page.tsx` (sebelumnya placeholder). Perbaiki 1 lint set-state-in-effect baru di import sheet → ganti pola useEffect-reset jadi remount via `key`.
- Files: `src/modules/tasks-gallery/**` (types, data/gallery-tasks, lib/gallery-mapping, components/{gallery-task-card,import-gallery-task-sheet,tasks-gallery-page}, index), `src/modules/compute/**` (types, data/initial-compute, components/{compute-page,add-provider-sheet}, index), `src/app/page.tsx`
- Result: `npm run build` (Next 16) sukses, TypeScript lolos; `npm run lint` kembali 15 problems (6 error, 9 warning) = baseline, nol masalah baru dari modul baru. Tasks Gallery & Compute kini fungsional (mock) dan terpetakan ke endpoint TL (`/task/gallery`, `/compute_provider/*`). Fitur backend TL tak lagi mubazir di UI.
- Next: Fase code-quality (service layer mock→API seam, memoize/split context provider, dedup StatusBadge/FilterSelect, sentralisasi token #ff5001) + beresin 6 lint error pre-existing. Keputusan arsitektur experiment-scoping ditunda ke fase integrasi.

## 2026-06-15 (UTC+7) - assistant
- Task: Fase code-quality (pass aman & berdampak) + fix bug UI filter Tasks Gallery (3 select melebar full karena `selectClassName` punya `w-full`).
- Action: (1) Tasks Gallery — ganti 3 `<select className={selectClassName}>` jadi komponen bersama `FilterSelect` (width terkontrol `w-[150-170px]`, chevron, dedup). (2) `llm-ops-provider` interval progress: tambah guard `hasActiveRun` → kalau tak ada run aktif, updater kembalikan `prev` (referensi sama) sehingga React bail-out, hilangkan rerender tiap 1.2s saat idle. (3) Dedup `StatusBadge`: buat primitive `src/components/ui/status-badge.tsx`; `TaskStatusBadge` & `ExperimentStatusBadge` delegasi ke sana (hapus markup identik). (4) Lint: hapus `openCreateTask` unused di tasks-page; `key={i}` → `key={\`hour-\${i}\`}` di model-detail-view chart.
- Files: `src/components/ui/status-badge.tsx` (baru), `src/modules/tasks-gallery/components/tasks-gallery-page.tsx`, `src/modules/llm-ops/context/llm-ops-provider.tsx`, `src/modules/tasks/components/task-status-badge.tsx`, `src/modules/experiments/components/experiment-status-badge.tsx`, `src/modules/tasks/components/tasks-page.tsx`, `src/modules/model-registry/components/model-detail-view.tsx`
- Result: `npm run build` sukses, TypeScript lolos; `npm run lint` 14 problems (6 error, 8 warning), turun dari 15. Filter Tasks Gallery rapi.
- Catatan (sengaja DITUNDA, bukan dilewat): sisa `set-state-in-effect` di form-sheet (register-local/create-task/experiment-form/create-dataset-wizard) butuh pola key-remount + ubah call-site (berisiko untuk mode edit) → follow-up terukur. Hydrate localStorage di `datasets-provider` (165) adalah pola SAH (client-only hydration utk hindari mismatch SSR), bukan bug — jangan diubah ke lazy-init. Service-layer seam, memoize/split mega-context, sentralisasi token #ff5001 (153×) = besar & terkait integrasi → dibahas di brainstorm integrasi.
- Next: Brainstorm keputusan integrasi (service seam, experiment-scoping global vs per-experiment, lisensi AGPL).

## 2026-06-15 (UTC+7) - assistant
- Task: Brainstorm + keputusan integrasi nqllmops ↔ Transformer Lab.
- Action: Diskusi 5 area (koneksi BFF vs direct, scoping entitas, fitur fantasi, auth/multiuser, lisensi AGPL). Keputusan user: (1) nqllmops akan **open source (AGPL-kompatibel)** → AGPL bukan penghalang; (2) **vendor backend TL ke repo** (bukan submodule/image) as-is, lisensi & konsolidasi diurus belakangan; (3) ada rencana **refactor besar + migrasi ke Rust** nanti → TL diperlakukan scaffolding sementara; (4) wiring integrasi fase-1 **dibahas dulu, belum ngoding**. Eksekusi vendoring: copy `transformerlab-app/api` (3.8MB, 416 file, bersih tanpa junk, tanpa path-dep lab-sdk) → `nqllmops/backend/`; salin `LICENSE` (AGPL) untuk atribusi; tambah `backend/README.VENDORED.md` (provenance: release v0.40.0 / api 0.27.0) + `backend/.gitignore` (abaikan .venv/envs/miniforge3/*.db/.env/secrets/workspace/logs).
- Files: `backend/**` (vendored TL api, 417 file), `backend/LICENSE`, `backend/README.VENDORED.md`, `backend/.gitignore`
- Result: Backend TL hidup di repo nqllmops, siap dijalankan (`cd backend && ./install.sh && ./run.sh` di WSL/Linux). Belum ada wiring nqllmops↔API (sesuai permintaan "bahas dulu"). Catatan: copy = fork manual; karena akan di-rewrite ke Rust, jangan diedit kecuali perlu.
- Next: Bahas wiring fase-1 (BFF Next route handlers → :8338, JWT + X-Team-Id; service-layer seam mock→fetch; peta endpoint→modul) sebelum implementasi.

## 2026-06-15 (UTC+7) - assistant
- Task: Mulai wiring integrasi fase-1 — fondasi service-layer seam + transport (keputusan user: koneksi **direct** browser→TL; auth ya; mock tetap default, flip-ready).
- Action: Verifikasi auth TL dari source vendored: fastapi-users, login `POST /auth/jwt/login` (form-urlencoded username+password → `{access_token}`), team via `/users/me/teams`. Buat fondasi `src/lib/api/`: `config.ts` (`API_BASE_URL` env `NEXT_PUBLIC_TL_API_URL` default :8338; flag `USE_REAL_API` env, default false=mock), `session.ts` (token+teamId di localStorage, SSR-guarded, no-dep utk hindari circular), `client.ts` (`apiFetch` + Authorization Bearer + X-Team-Id + JSON + `ApiError`), `auth.ts` (`login` form-encoded real / mock-token saat off; `resolveActiveTeam`; `logout`). Service seam: `experiments/services/experiments-service.ts` (`seedExperiments` sync mock + `fetchExperiments` async: mock now / `GET /experiment/` + mapper saat real), `tasks/services/tasks-service.ts` (`seedTasks` + `fetchTasks` stub — real per-experiment job aggregation = TODO). Wire `llm-ops-provider`: state di-seed via `seedTasks`/`seedExperiments` (mock instan, tanpa flash), + `useEffect` sekali yang fetch real HANYA bila `USE_REAL_API` (async setState, bukan set-state-in-effect sinkron). Tambah `.env.example`.
- Files: `src/lib/api/{config,session,client,auth}.ts` (baru), `src/modules/experiments/services/experiments-service.ts` (baru), `src/modules/tasks/services/tasks-service.ts` (baru), `src/modules/llm-ops/context/llm-ops-provider.tsx`, `.env.example`
- Result: `npm run build` sukses, TypeScript lolos; `npm run lint` tetap 14 (6 error/8 warning) = baseline, nol baru. Default = mock (UI identik sekarang); set `NEXT_PUBLIC_USE_REAL_API=true` → experiments fetch dari TL nyata. Seam siap: swap mock→real cukup di file service, bukan di komponen.
- Next: Login UI (form → `auth.login`), lengkapi mapper experiments real, lalu vertical slice tasks/jobs (create task → launch job Unsloth → poll status/log). Prasyarat: TL nyala di :8338 + CORS allow origin nqllmops (:3000).

## 2026-06-15 (UTC+7) - assistant
- Task: UI Login + polish kecil (favicon, title, logo→home, profil real + logout).
- Action: Modul auth baru `src/modules/auth/`: `AuthProvider` (user + isAuthenticated + isLoading + login/logout; restore sesi saat mount via async-IIFE → hindari set-state-in-effect; mock: user dari email tersimpan, real: `GET /users/me`), `LoginScreen` (form email/password, prefill admin di mock + hint "any credentials work", error state, loading), `AuthGate` (loading spinner → LoginScreen bila belum auth → app). Tambah `session.ts` simpan email user; `auth.ts` tambah `fetchCurrentUser` (`/users/me`) + `nameFromEmail`. Wire `page.tsx`: bungkus `AuthProvider > AuthGate > providers > HomeShell`; HomeShell pakai `useAuth`. Polish: logo sidebar jadi tombol → Dashboard; nama "Rust/LLM-OPS" → "NQR/LLMOps"; profil kiri-bawah pakai `user.name`/`user.email` real + inisial dinamis + popover **Log out** (ganti gear Settings). `layout.tsx` metadata: title "NQR - LLMOps" + `icons` /nq-logo.png (favicon).
- Files: `src/modules/auth/**` (provider, login-screen, auth-gate, index), `src/lib/api/session.ts`, `src/lib/api/auth.ts`, `src/app/layout.tsx`, `src/app/page.tsx`
- Result: `npm run build` sukses, TypeScript lolos; `npm run lint` tetap 14 (6/8) = baseline, nol baru. Default mock: login terima kredensial apa pun, profil tampilkan email login, sesi persist di refresh, logout balik ke login. Saat real (`USE_REAL_API=true`): login asli `/auth/jwt/login`, profil dari `/users/me`.
- Next: lengkapi mapper experiments real + vertical slice tasks/jobs (create→launch Unsloth→poll log).

## 2026-06-15 (UTC+7) - assistant
- Task: Audit + migrasi ke shadcn (user mau clean Tailwind+shadcn). Temuan: cuma `button.tsx` yang benar-benar shadcn (base-ui, style base-nova); banyak elemen mentah (12 overlay sheet/dialog, 13 `<select>`, 9 `<table>`, 7 dropdown, 4 textarea, 4 checkbox, 1 toast custom) tanpa primitive shadcn. Scope dipilih user: generate primitive + migrasi Dialog/Sheet + Select dulu (pakai CLI, jangan tulis tangan).
- Action: Generate 8 primitive via `npx shadcn add` (base-nova/base-ui): dialog, sheet, select, table, textarea, checkbox, dropdown-menu, sonner. Catatan CLI: pertama nyangkut di prompt "overwrite button.tsx? (y/N)" karena dialog/sheet depend ke Button → diatasi `yes n |` (jawab N → button TIDAK ditimpa, brand `--primary` aman; dialog/sheet tetap ter-generate). Migrasi: `FilterSelect` → shadcn `Select` (base-ui `value`/`onValueChange` string|null → guard non-null; `items` utk label) sehingga SEMUA filter bar (tasks/models/datasets/experiments/gallery) naik sekaligus; 3 Dialog (archive-model, delete-experiment, experiment-activity-modal) → `<Dialog>` (pola `if(!x) return null` + `open onOpenChange`); 2 Sheet (add-provider, import-gallery-task) → `<Sheet><SheetContent side=right>` + select→Select.
- Files: `src/components/ui/` (8 primitive baru), `src/modules/tasks/components/filter-select.tsx`, `archive-model-dialog.tsx`, `delete-experiment-dialog.tsx`, `experiment-activity-modal.tsx`, `compute/components/add-provider-sheet.tsx`, `tasks-gallery/components/import-gallery-task-sheet.tsx`
- Result: `npm run build` sukses tiap fase, TypeScript lolos; `npm run lint` tetap 14 (6/8) = baseline. button.tsx tak berubah (git diff kosong).
- Next (lanjutan scope): migrasi sisa Sheet + select-nya → register-local-sheet, create-task-sheet, experiment-form-sheet, task-detail-drawer, import-huggingface-sheet (model), import-huggingface-dataset-sheet, create-dataset-wizard, upload-document-sheet. Lalu (scope lain) Table, DropdownMenu, Checkbox, Textarea, Sonner.

## 2026-06-15 (UTC+7) - assistant
- Task: Lanjut migrasi Sheet batch 2 (5 file) ke shadcn.
- Action: register-local-sheet, task-detail-drawer, experiment-form-sheet, create-task-sheet, upload-document-sheet → overlay buatan tangan diganti `<Sheet><SheetContent side=right>` + `SheetHeader/Title/Description/Footer` (close X bawaan, hapus X manual). Select di dalamnya → shadcn `Select` (helper `FormSelect` di experiment-form; `items` utk label saat value≠label spt experiment/KB). Textarea → `<Textarea>` (experiment-form, create-task). Checkbox → `<Checkbox onCheckedChange>` (create-task enableCheckpoint/eval, upload-document index). Pola aman dipertahankan: `if(!open) return null` + `<Sheet open onOpenChange>`; useEffect reset-on-open tetap (set-state-in-effect = baseline lint, tak ditambah/dikurangi).
- Files: `model-registry/components/register-local-sheet.tsx`, `tasks/components/task-detail-drawer.tsx`, `experiments/components/experiment-form-sheet.tsx`, `tasks/components/create-task-sheet.tsx`, `datasets/components/upload-document-sheet.tsx`
- Result: build sukses tiap file, TypeScript lolos; lint tetap 14 (6/8) = baseline. Total migrasi shadcn sejauh ini: semua filter bar (Select), 3 Dialog, 7 Sheet (add-provider, import-gallery, register-local, task-detail-drawer, experiment-form, create-task, upload-document).
- Next: 3 wizard besar tersisa → `import-huggingface-sheet` (model), `import-huggingface-dataset-sheet`, `create-dataset-wizard` (overlay→Sheet + banyak Select). Lalu scope lain: Table, DropdownMenu, Sonner.

## 2026-06-15 (UTC+7) - assistant
- Task: Tuntaskan migrasi shadcn scope Dialog/Sheet + Select — 3 wizard besar + sisa select non-sheet.
- Action: `import-huggingface-sheet` (model) & `import-huggingface-dataset-sheet` → overlay→`<Sheet><SheetContent side=right>`, semua `<select>`→`Select` (helper `ConfigSelect`; `items` utk label saat value≠label spt config/split; textarea→`Textarea`). `create-dataset-wizard` (modal terpusat) → `<Dialog><DialogContent className="max-w-5xl ...">`, 2 select metadata→`WizardSelect`, schema-mapping select pakai sentinel `__none__` utk opsi kosong (base-ui Select tak suka value=""), 2 textarea→`Textarea`. Sisa select non-sheet: `interact-rag-page` (KB + answer model), `rag-index-tab` (embedding + vector store), `experiment-detail-toolbar` (status, sekalian pakai `EXPERIMENT_STATUSES` bukan array hardcode) → semua `Select`. Bersihkan import unused (selectClassName, datasetUi, X).
- Files: `model-registry/components/import-huggingface-sheet.tsx`, `datasets/components/import-huggingface-dataset-sheet.tsx`, `create-dataset-wizard.tsx`, `interact-rag-page.tsx`, `rag/rag-index-tab.tsx`, `experiments/components/experiment-detail-toolbar.tsx`
- Result: build sukses, TypeScript lolos, lint 14 (baseline). **Verifikasi: `grep <select` = NONE, `grep bg-black/40` = NONE.** Scope Dialog/Sheet + Select 100% selesai: 8 primitive, semua filter+form select → Select, 4 Dialog (3 modal + create-dataset-wizard), 9 Sheet, + bonus Textarea/Checkbox di form yang tersentuh.
- Next (scope lain, opsional): Table (9 `<table>` mentah), DropdownMenu (menu toolbar/row/profil buatan tangan), Sonner (ganti model-toast custom). Plus 6 lint error set-state-in-effect pre-existing.

## 2026-06-15 (UTC+7) - assistant
- Task: Migrasi Table + DropdownMenu + Sonner ke shadcn (scope lanjutan).
- Action: **Sonner** — `sonner.tsx` (+ next-themes, sudah ter-install via CLI) dipasang `<Toaster richColors position=bottom-right>` global di `layout.tsx`; `model-registry-provider.showToast` di-rewrite memanggil `toast.success/error/warning/info` (buang state `toasts` + `dismissToast`); `models-page` buang `ModelToastContainer` (2 render) + destructure; **hapus** `model-toast.tsx`. **DropdownMenu** (base-ui: Trigger pakai `render={<Button/>}`, Item pakai `onClick`, destructive via `className="text-destructive"`) — migrasi row menu `task-table` & `model-table`: hapus state `openMenuId`/overlay manual + helper `MenuItem`/`ActionItem`, ganti `<DropdownMenu><DropdownMenuTrigger render=Button/><DropdownMenuContent align=end>...<DropdownMenuItem>`.
- Files: `src/components/ui/sonner.tsx` (dipakai), `src/app/layout.tsx`, `model-registry/context/model-registry-provider.tsx`, `model-registry/components/models-page.tsx`, hapus `model-toast.tsx`; `tasks/components/task-table.tsx`, `model-registry/components/model-table.tsx`
- Result: build sukses tiap langkah, lint 14 (baseline). Sonner selesai 100%. DropdownMenu 2/7.
- Next: sisa DropdownMenu (page profil, experiment-card, dataset/experiment/model detail toolbar — experiment-detail-toolbar punya Select status di dalamnya, jadikan submenu/biarkan) + Table (9 file: task-table, model-table, documents-table, dataset-detail, evals-rag, create-dataset-wizard preview, model-detail files, rag-documents-tab).

## 2026-06-15 (UTC+7) - assistant
- Task: Selesaikan DropdownMenu (7) + mulai Table.
- Action: **DropdownMenu 100%** — page profil (sidebar; `DropdownMenuLabel`+`Separator`+Log out, hapus state `isProfileMenuOpen`), experiment-card (trigger opacity via `data-[popup-open]`), dataset-detail-toolbar, model-detail-toolbar, experiment-detail-toolbar (status jadi `DropdownMenuSub`+`RadioGroup`/`RadioItem`). Semua: hapus state `menuOpen`/overlay manual + helper `MenuItem`/`MenuRow`/`ActionItem`; `render={<Button/>}` trigger, `onClick` item, destructive via `className`. **Table dimulai** — task-table `<table>`→`<Table>` (TableHeader/Body/Row/Head/Cell), buang wrapper overflow ganda + className padding manual.
- Files: `app/page.tsx`, `experiments/components/experiment-card.tsx`, `experiment-detail-toolbar.tsx`, `datasets/components/dataset-detail-toolbar.tsx`, `model-registry/components/model-detail-toolbar.tsx`, `tasks/components/task-table.tsx`
- Result: build sukses tiap langkah, lint 14 (baseline). Verifikasi `grep "fixed inset-0 z-40"` = NONE (0 menu custom). DropdownMenu 7/7 ✅. Table 1/9.
- Next: Table 8 file tersisa — model-table, documents-table, rag-documents-tab, dataset-detail-view, evals-rag-page, model-detail-view (files), import-huggingface-dataset-sheet (preview), create-dataset-wizard (preview/schema). Pola: `<table>`→`<Table>`, thead→TableHeader, tbody→TableBody, tr→TableRow, th→TableHead, td→TableCell.

## 2026-06-15 (UTC+7) - assistant
- Task: Tutup migrasi shadcn (Table tuntas) + verifikasi akhir menyeluruh.
- Action: Migrasi `model-table` (saya) lalu 7 file tabel sisa via subagent (documents-table, rag-documents-tab, dataset-detail-view [4 tabel], evals-rag-page, model-detail-view [files], import-huggingface-dataset-sheet [features], create-dataset-wizard [preview+schema+issues]) → semua `<table>` → primitive `Table`. Hapus `tableWrapClassName` yang jadi unused di file terdampak.
- Files: `model-registry/components/model-table.tsx` + 7 file datasets/model-registry (lihat entry subagent di atas)
- Result: Verifikasi final: `npm run build` sukses, TypeScript bersih, `npm run lint` 14 (baseline, nol baru). `grep` konfirmasi NONE untuk: `<table>` (selain primitive), `<select>`, overlay `bg-black/40`, dropdown `fixed inset-0 z-40`, custom toast. **Migrasi shadcn lengkap**: 8 primitive (dialog/sheet/select/table/textarea/checkbox/dropdown-menu/sonner) + semua elemen mentah terkait sudah jadi komponen shadcn.
- Next: (opsional) bereskan 6 lint error pre-existing `set-state-in-effect` di form-sheet (pola key-remount); sentralisasi token warna `#ff5001`; lalu balik ke integrasi TL.

## 2026-06-15 (UTC+7) - assistant
- Task: Bereskan 6 lint error + sentralisasi warna brand `#ff5001`.
- Action: **Lint (6 error → 0):** (1) 4 form-sheet (create-task, register-local, experiment-form, create-dataset-wizard) reset-on-open `useEffect` → pola **key-remount**: state lazy-init dari props/preset + parent kasih `key={open?...:...}` (tasks-page, experiment-detail-view, models-page, experiments-page ×2, datasets-page, documents-page); buang `useEffect` import. (2) `datasets-provider` hydrate localStorage → **lazy useState initializer** (`loadDatasetsFromStorage`), buang state `hydrated`, write-effect disederhanakan (aman: provider mount client-only di belakang AuthGate). (3) `datasets-page` prop→seleksi → restrukturisasi early-return (rule tak lagi flag). (4) `interact-rag-page` purity `Date.now()` di handler → `useRef` counter (`msgIdRef.current++`) untuk id pesan. **Warna:** sed `[#ff5001]` → `primary` di semua `.ts/.tsx` (195 occurrence / 59 file); valid karena `--primary: #ff5001` + Tailwind `--color-primary: var(--primary)`, jadi `text-[#ff5001]`→`text-primary` identik. design-tokens.css (definisi `--primary`) tak disentuh.
- Files: form-sheets + call-site pages (8 file), `datasets-provider.tsx`, `datasets-page.tsx`, `interact-rag-page.tsx`, + 59 file untuk warna (className saja)
- Result: `npm run build` sukses, TypeScript lolos; `npm run lint` **8 problems (0 error, 8 warning)** — turun dari 14 (6 error hilang). 8 warning sisa = unused-vars pre-existing (DEFAULT_VALIDATION_ISSUES, idx, now, modelRegistryUi, dll), bukan error.
- Next: (opsional) bersihkan 8 unused-var warning; lalu balik ke integrasi TL (vertical slice login→experiments→jobs).

## 2026-06-15 (UTC+7) - assistant
- Task: Bersihkan 8 lint warning (unused vars/imports) → lint 0/0.
- Action: Hapus import/var tak terpakai: `DEFAULT_VALIDATION_ISSUES` (create-dataset-wizard), `formatDateTime` (import-huggingface-dataset-sheet), `tableWrapClassName` (rag-chunks-tab), `modelRegistryUi`+`COMPATIBILITY_STATUSES` (model-filters), `now` (datasets-provider reindex), loop param `idx` (dataset-detail-view schema map), param `id` (models-page onTest).
- Files: `create-dataset-wizard.tsx`, `import-huggingface-dataset-sheet.tsx`, `rag/rag-chunks-tab.tsx`, `model-filters.tsx`, `datasets-provider.tsx`, `dataset-detail-view.tsx`, `models-page.tsx`
- Result: `npm run build` sukses, `npm run lint` **0 problem (0 error, 0 warning)**. Build + lint sepenuhnya bersih.
- Catatan kejujuran (belum 100% "sempurna"): (a) primitive avatar/breadcrumb/card/input/progress/surface/tabs/typography masih versi hand-written (CVA, konsisten) — bukan hasil generate shadcn CLI; (b) sentralisasi warna baru `#ff5001`→`--primary`; hex lain (`#5d5d5d`, `#551d00`, `#fff0e8`, `#c2410c`, `#e2e8f0`, shadow rgba) masih hardcode; (c) arsitektur: service-layer seam baru di experiments, mega-context belum dipecah, mock masih in-memory. Lint-clean ≠ arsitektur final.
- Next: balik ke integrasi TL (vertical slice login→experiments→jobs) atau lanjut design-token shades lain.

## 2026-06-17 (UTC+7) - assistant
- Task: Selesaikan migrasi Table shadcn untuk 7 file `<table>` mentah yang tersisa.
- Action: Migrasi 7 file (12 tabel total) `<table>`→`<Table>` (TableHeader/TableBody/TableRow/TableHead/TableCell). Pola: buang wrapper `overflow-x-auto` (Table punya container sendiri) + `border-collapse text-left`, drop padding `px-3 py-2`/`p-2` dan `border-t`/`border-b`/`last:border-none`, header row jadi `<TableRow className="bg-[#fafafa]">` (drop uppercase/text-size), simpan class warna/font/lebar/`tabular-nums`/`max-w`/`min-w` + Select/badge/onClick di dalam cell. Wrapper luar diganti `overflow-hidden rounded-lg border border-[#e2e8f0] bg-white` (menggantikan `tableWrapClassName` yang punya `overflow-x-auto`). Hapus import `tableWrapClassName` yang jadi unused di file yang sudah tak memakainya (documents-table, rag-documents-tab, evals-rag-page, model-detail-view, dataset-detail-view, create-dataset-wizard). import-huggingface-dataset-sheet tabelnya hanya `mt-2 overflow-x-auto` (tanpa border) → Table langsung dengan `className="mt-2"`.
- Files: `datasets/components/documents-table.tsx`, `datasets/components/rag/rag-documents-tab.tsx`, `datasets/components/evals-rag-page.tsx`, `datasets/components/dataset-detail-view.tsx` (4 tabel: versions/preview/schema/issues), `model-registry/components/model-detail-view.tsx` (files), `datasets/components/import-huggingface-dataset-sheet.tsx` (schema features), `datasets/components/create-dataset-wizard.tsx` (3 tabel: preview/schema-mapping/validation-issues)
- Result: `grep "<table" src/` = hanya `components/ui/table.tsx` (primitive). `npm run build` sukses (TS clean). `npm run lint` = 14 problems (6 errors, 8 warnings) = baseline, tidak naik. Table migration 9/9 file ✅ (task-table & model-table sudah sebelumnya).
- Next: Tidak ada. Migrasi `<table>` mentah ke shadcn Table tuntas seluruhnya.

## 2026-06-17 (UTC+7) - assistant
- Task: Tokenisasi warna shades lain (design-token "penuh") + regenerate primitive lama jadi shadcn resmi (scope: hanya yang berdampak).
- Action (A) Tokenisasi warna: inventaris awal ~60 hex / ~900 occurrence. Definisikan 50 token semantik dgn nilai hex PERSIS (color-identical) di `design-tokens.css` + map `--color-*` di `globals.css @theme`, lalu sed-replace per-hex (2 batch). Batch 1 (18 shade neutral/brand/surface/hairline/status-utama): `#551d00→ink`, `#5d5d5d→ink-soft`, `#a1a1aa→ink-faint`, `#71717a→ink-faint-strong`, `#fafafa→surface`, `#f4f4f5→surface-2`, `#e2e8f0→hairline`, `#fff0e8→primary-soft`, `#c2410c→primary-strong`, `#ff9c6d→primary-light`, `#15803d→success`, `#ecfdf3→success-soft`, `#b45309→warning`, `#fff7e6→warning-soft`, `#dc2626→danger`, `#fef2f2→danger-soft`, `#2563eb→info`, `#eff6ff→info-soft`. Batch 2 (32 shade varian status solid/soft/border/strong + purple/pink + neutral extra + brand tint): success-solid/bright/border, warning-solid/soft-2/soft-3/border/strong/strong-2/gold, danger-solid/border/strong/strong-2, info-solid/strong/bright/light, purple(+solid/soft/strong/light/bright), pink(+solid/soft), ink-strong(#52525b), hairline-2(#e5e7eb), surface-3(#f0f0f0), primary-tint(#fff7ed)/-2(#fffaf7). Verifikasi: bundle CSS berisi `text-ink-soft{color:var(--ink-soft)}` dst + nilai hex-nya → render identik. Sisa 16 occurrence / 12 hex one-off dekoratif (avatar gradient #ffddb8/#7a2900, strip-tab #ffe7d8, terminal log #1a1a1a/#e4e4e7, hover #e64800, misc gray) sengaja dibiarkan inline. ~98% occurrence tertokenisasi.
- Action (B) Regenerate primitive: audit → input/card/breadcrumb sudah setara shadcn (skip), surface/typography app-specific (bukan shadcn), hanya avatar/progress/tabs yang hand-rolled & kurang a11y → regenerate via `npx shadcn add avatar progress tabs --overwrite` (style base-nova / `@base-ui/react`). Re-tune brand: Tabs active `text-primary` + hover primary + padding px-3 py-1 + hapus flex-1 (tab app rata-kiri); Progress di-rewrite agar API satu-panggil lama tetap (`<Progress value className/>`, className → tinggi bar via Track) tapi ARIA (role=progressbar) didelegasikan ke base-ui; Avatar default `rounded-lg` + dapat `AvatarImage`/`AvatarGroup`. API kompatibel — TS lolos tanpa ubah call-site.
- Files: `src/styles/design-tokens.css`, `src/app/globals.css`, ~59 file (className token), `src/components/ui/{avatar,progress,tabs}.tsx`
- Result: `npm run build` sukses + TypeScript lolos; `npm run lint` 0 problem. Warna identik (terverifikasi di bundle). 3 primitive kini base-ui-backed (keyboard nav tabs, ARIA progress, AvatarImage).
- Catatan: perubahan visual yg perlu dicek mata di dev = tab (padding/active color sedikit beda dari versi hand-roll lama); Progress/Avatar dipertahankan setara.
- Next: integrasi TL (vertical slice login→experiments→jobs).

## 2026-06-17 (UTC+7) - assistant
- Task: Migrasi navigasi dari single-page `activeMenu` state ke Next.js App Router (URL routing).
- Action: page.tsx lama (god-component 539 baris: provider chain + sidebar + header + switch render semua menu via `activeMenu` useState) dibongkar. (1) Root `app/page.tsx` → `redirect("/dashboard")`. (2) Route group `app/(app)/layout.tsx` (server component) = provider chain `AuthProvider>AuthGate>LlmOpsProvider>DatasetsProvider>ModelRegistryProvider>AppShell` — layout App Router tak remount saat pindah sibling route → state mock provider persist (UX SPA lama terjaga). (3) `src/components/layout/app-shell.tsx` (client) = sidebar+header, `setActiveMenu`→`<Link href>` + `usePathname()` untuk active state (`aria-current`), logo→`/dashboard`, sidebar collapse + search box (state lokal) tetap di shell. (4) 11 route page di `(app)/`: dashboard (JSX dashboard dipindah + `activeTab` state lokal), experiments/tasks/interact/evals/models/datasets/tasks-gallery/compute (thin wrapper server-component render module page), documents (client, `onNavigate`→`useRouter().push`), notes (placeholder). Map label→path: Dashboard=/dashboard, Model Registry=/models, Dataset=/datasets, Tasks Gallery=/tasks-gallery, dst.
- Perubahan perilaku sengaja: search header dulu filter 4 model mock dashboard (coupling lintas-halaman) → kini placeholder visual global; dashboard tampilkan semua model. Nav-intent Documents→Dataset meng-drop kbId (parity dgn lama; `?kb=` bisa diwire nanti via DatasetsPage.initialSelectedId).
- Files: `src/app/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/{dashboard,experiments,tasks,interact,evals,documents,notes,models,datasets,tasks-gallery,compute}/page.tsx`, `src/components/layout/app-shell.tsx`
- Result: `npm run build` sukses — 13 route ter-generate (`/`,`/dashboard`,`/experiments`,`/tasks`,`/interact`,`/evals`,`/documents`,`/notes`,`/models`,`/datasets`,`/tasks-gallery`,`/compute`, semua ○ Static). TypeScript lolos, `npm run lint` 0 problem. URL kini berubah per-menu → deep-link, back/forward, refresh-persist, code-split per route. page.tsx tak lagi god-component.
- Next: cek mata di `npm run dev` (navigasi, login gate, persist state antar-menu); lalu integrasi TL (vertical slice login→experiments→jobs) — `/experiments/[id]` jadi natural untuk fetch per-resource.

## 2026-06-17 (UTC+7) - assistant
- Task: Isi menu "Notes" yang kosong — cek apakah ada BE di TL, lalu bangun.
- Investigasi: TL punya fitur notes TAPI **per-experiment**, bukan global. Router `backend/transformerlab/routers/experiment/notes.py` (prefix `/notes`, di-mount di bawah experiment): `GET /experiment/{id}/notes` (return string markdown dari `notes/readme.md`, fallback legacy `readme.md`), `POST /experiment/{id}/notes` (body=string markdown), `POST/GET /experiment/{id}/notes/assets/{file}` (gambar, .png/.jpg/.gif/.svg, max 20MB). Jadi menu Notes global = fantasy (tak ada BE global). Tipe `Experiment` sudah punya field `notes: string` (selama ini read-only di detail view).
- Keputusan (user pilih): bangun editor markdown **per-experiment** + ubah `/notes` global jadi **index** (daftar experiment → buka notes-nya).
- Action: (1) Service seam `experiments-service.ts`: tambah `fetchExperimentNotes`/`saveExperimentNotes` (mock no-op; real `GET/POST /experiment/{id}/notes`). (2) Provider `llm-ops-provider`: action `updateExperimentNotes(id, notes)` — update field `notes`+`updatedAt`+activity, mirror ke `saveExperimentNotes`. (3) `markdown-preview.tsx`: renderer markdown minimal AMAN (React elements, tanpa `dangerouslySetInnerHTML`/dependency) — heading #/##/###, fenced ```code```, bullet -/*, paragraf, inline **bold** + `code`. (4) `experiment-notes-editor.tsx`: editor 2-panel (Textarea markdown ↔ live preview), tombol Save (disabled kalau tak dirty), MockBadge, toast sonner; akses experiment via `getExperimentById`. (5) Route: `/notes` jadi index (daftar experiment + snippet notes + tanggal, Link ke `/notes/[id]`, MockBanner jelaskan ini per-experiment); `/notes/[experimentId]` render editor (client, `useParams`). (6) Experiment detail view: blok Notes selalu tampil + Link "Open/Add notes" → `/notes/[id]`. (7) Export `ExperimentNotesEditor` dari `@/modules/experiments`.
- Files: `experiments/services/experiments-service.ts`, `llm-ops/context/llm-ops-provider.tsx`, `experiments/components/{markdown-preview,experiment-notes-editor}.tsx`, `experiments/components/experiment-detail-view.tsx`, `experiments/index.ts`, `app/(app)/notes/page.tsx`, `app/(app)/notes/[experimentId]/page.tsx`
- Result: `npm run build` sukses (route `/notes` ○ static + `/notes/[experimentId]` ƒ dynamic), TS lolos, lint 0. Notes kini = lab notebook markdown per-experiment, siap di-wire ke TL notes endpoint saat `USE_REAL_API` on.
- Catatan: upload gambar/asset (TL `/notes/assets`) belum dibuat (text-only dulu); markdown link/tabel/image belum dirender (pakai react-markdown nanti kalau perlu GFM penuh).
- Next: cek mata di dev; integrasi TL.

## 2026-06-17 (UTC+7) - assistant
- Task: Audit hygiene final + commit & push semua changes ke branch baru `dev`.
- Action: Audit grep seluruh `src/` (newbie-mistake): 0 `any`, 0 `console.*`, 0 `@ts-ignore`/`eslint-disable`, 0 raw `<img>`, 0 `dangerouslySetInnerHTML` (1 hit cuma komentar). `Date.now()`/`Math.random()` (28×) semua di ID-gen/seed/simulasi-callback/relative-time (bukan render). Loose-equality (8×) semua `!= null`/`== null` (idiom benar utk Select base-ui `string|null`). Sisa minor: 1 `key={idx}` di markdown-preview (list re-derived, acceptable). Gating: `npm run build` sukses + TS lolos; `npm run lint` EXIT=0, 0 problem. Lalu `git checkout -b dev`, `git add -A`, commit, `git push -u origin dev`.
- Catatan: `git add -A` menyertakan `backend/` (vendored TL api ~417 file, untracked sebelumnya) sesuai keputusan vendoring + instruksi "semua changes". Branch baru `dev` (bukan main).
- Best-practice yang masih kurang (bukan bug, kerjaan fase integrasi): seam `services/` baru di experiments+tasks (datasets/model-registry/compute belum); provider gemuk (llm-ops 864, datasets 822, model-registry 690 baris); 0 test frontend.
- Result: commit `04d5348` (544 file, +85340/-3072), push sukses ke `origin/dev` (NexusQuantum/nqllmops).
- Next: integrasi TL (vertical slice login→experiments→jobs).

## 2026-06-17 (UTC+7) - assistant
- Task: Fresh-start repo baru — pindahkan seluruh isi branch dev ke repo kosong `NexusQuantum/NQRust-LLMOps` dengan riwayat git baru.
- Action: User pilih "fresh start". Verifikasi dulu kerja aman di `origin/dev` GitHub (nqllmops, commit `04d5348`) + `.gitignore` exclude node_modules/.next. Lalu `rm -rf .git` (buang riwayat lama termasuk commit Create-Next-App + nqllmops), `git init`, `git branch -M main`, `git add -A` (hormati .gitignore), commit awal, `git remote add origin https://github.com/NexusQuantum/NQRust-LLMOps.git`, `git push -u origin main`.
- Catatan: Repo lama (nqllmops) di GitHub TETAP utuh (main + dev) — fresh start hanya mengubah repo LOKAL agar menunjuk ke NQRust-LLMOps; tidak ada data hilang di remote lama. Nama "NQRust" sejalan rencana rewrite backend ke Rust nanti.
- Result: lihat hash + ringkasan push di bawah / git log.
- Next: integrasi TL.

## 2026-06-17 09:50 (UTC+7) - assistant
- Task: Code-quality pass frontend (editor mode) — 5 prioritas + guard NaN, dengan syarat build & lint WAJIB bersih tiap fase. Plus README komprehensif deploy-ready.
- Action (prasyarat): `npm install` di NQRust-LLMOps (repo baru belum punya node_modules) → 629 paket, exit 0.
- Action #1 (memoize context value, HIGH): bungkus objek `value` dengan `useMemo` + dep array lengkap di KEEMPAT provider (`auth`, `llm-ops`, `datasets`, `model-registry`); `useCallback` untuk arrow inline `resetTaskFilters`/`resetExperimentFilters`/`resetFilters`/`login`/`logout`. Sebelumnya `value` dibangun ulang tiap render → semua konsumen re-render, membatalkan `useCallback`/`useMemo` di bawahnya. Guard NaN: ganti `Math.round(d.validRows/d.totalRows*100)` di `datasets-provider.validateAgain` dengan helper aman `computeQualityScore` (sudah guard `totalRows<=0`). Verifikasi: `npm run lint` EXIT=0, `npm run build` sukses, 15 route.
- Action #3 (ekstrak komponen bersama): (a) buat `components/ui/summary-card-grid.tsx` (`SummaryCardGrid`) → refactor 5 file summary-card (task/experiment/dataset/documents/model) jadi config array + komponen tunggal, tampilan identik via style props (cardClassName/headerClassName/titleClassName/contentClassName/metricClassName, columns 4/6/7). (b) buat `components/ui/filter-bar.tsx` (`FilterBar`) → refactor 4 filter bar (task/experiment/dataset/documents); `model-filters` dibiarkan (layout beda, outlier disengaja). (c) rutekan `DatasetStatusBadge` & `ModelStatusBadge` ke primitive `StatusBadge` (hapus JSX duplikat). Reset button distandarkan ke varian hover yang lebih kaya.
- Action #4 (service seam): buat 4 service `seedX()`/`fetchX()` (gated `USE_REAL_API`) untuk `datasets`, `model-registry`, `compute`, `tasks-gallery` — mirror pola experiments/tasks. Wire consumer: provider/page pakai `useState(seedX)` + efek mount `if(USE_REAL_API) fetchX().then(setX)`. Hapus import mock langsung. Kini swap mock→real terlokalisasi di file service untuk SEMUA modul.
- Action #2 (pecah god-object provider, public API tetap sama): (a) `llm-ops` → pindah 5 helper run-engine pure (ZERO_RESOURCE/appendRunLog/runningResourceUsage/completeRun/startNewRun + buildRunArtifacts privat) ke modul baru `tasks/lib/run-engine.ts` (~120 baris keluar). (b) `datasets-provider` (822→~470 baris) → ekstrak HF-import ke `hooks/use-huggingface-dataset-import.ts` dan subsistem RAG ke `hooks/use-rag-knowledge-bases.ts`; pindah helper `updateDataset` ke `lib/utils.ts`; provider mengompos `...hf`/`...rag` (return hook di-`useMemo` agar memo #1 tetap efektif). (c) `model-registry-provider` (690→~430 baris) → ekstrak HF-import + `catalogToModel` + `defaultImportConfig` ke `hooks/use-huggingface-model-import.ts`.
- Action #5 (tokenisasi typography): codemod `text-[14px]`→`text-sm` (91×) & `text-[12px]`→`text-xs` (93×) via sed di seluruh `src` — IDENTIK di Tailwind v4 (text-sm=14/20px=leading-5, text-xs=12/16px=leading-4, sesuai pasangan yang dipakai proyek). `text-[11px]`(55)/`text-[13px]`(117)/`text-[15px]`(6) SENGAJA dibiarkan literal: tak ada token Tailwind standar, konversi = keputusan desain + risiko geser ukuran/line-height.
- Action (README + deploy): tulis ulang `README.md` jadi komprehensif (overview, stack, quick start, env vars table, scripts, arsitektur FE+BE, build & deploy notes Vercel/Node, conventions, license AGPL). Tambah `.env.example` (NEXT_PUBLIC_TL_API_URL + NEXT_PUBLIC_USE_REAL_API) + pengecualian `!.env.example` di `.gitignore`.
- Files: `src/modules/{auth,llm-ops,datasets,model-registry}/context/*-provider.tsx`, `src/components/ui/{summary-card-grid,filter-bar}.tsx` (baru), 5 `*-summary-cards.tsx`, 4 `*-filters.tsx`, `dataset-status-badge.tsx`, `model-badges.tsx`, `src/modules/{datasets,model-registry,compute,tasks-gallery}/services/*.ts` (4 baru), `compute-page.tsx`, `tasks-gallery-page.tsx`, `src/modules/tasks/lib/run-engine.ts` (baru), `src/modules/datasets/hooks/{use-huggingface-dataset-import,use-rag-knowledge-bases}.ts` (baru), `src/modules/model-registry/hooks/use-huggingface-model-import.ts` (baru), `src/modules/datasets/lib/utils.ts` (+updateDataset), ~68 file untuk codemod token, `README.md`, `.env.example` (baru), `.gitignore`.
- Result: SEMUA fase terverifikasi `npm run lint` **EXIT=0 (0 problem)** + `npm run build` **sukses (TS bersih, 15 route)**. Provider lebih kecil & terfokus, public context API tidak berubah (konsumen tak disentuh). Mock→real kini 1 flag untuk semua modul.
- Catatan (jujur, sengaja ditunda): (a) `model-registry/lib/utils.ts` masih menyimpan ~700 baris mock data (`initialModels`/`defaultFiles`/`defaultAuditLogs`) — idealnya pindah ke `data/`; service seam sudah melokalisasi sumbernya, relokasi blok besar = follow-up mekanis. (b) `text-[11px]/[13px]/[15px]` belum tertokenisasi (butuh keputusan token desain). (c) `model-filters` belum disatukan ke `FilterBar` (layout beda). (d) dedup objek typografi `*Ui` lintas modul (M4) belum dilakukan.
- Next: integrasi TL vertical slice (login→experiments→jobs); opsional bereskan catatan di atas.
