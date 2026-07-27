# UI copy glossary (Indonesian → English)

The NQRust-LLMOps UI is English-only. This glossary keeps translations consistent
across the codebase. Use neutral, professional English (avoid casual register:
"kamu" → "you"/omit, "cuma" → "only", "nggak/ngga" → "not", "buat" → "for/to").

## Verbs / actions
| Indonesian | English |
|---|---|
| Jalankan / menjalankan | Run |
| Latih / melatih / pelatihan / terlatih | Train / Training / trained |
| Ekspos / diekspos / mengekspos | Expose / exposed |
| Unduh / download / diunduh | Download / downloaded |
| Simpan / menyimpan / tersimpan / disimpan | Save / Saving / Saved |
| Hapus / menghapus / dihapus | Delete / Deleted |
| Salin / menyalin / disalin | Copy / Copied |
| Muat / memuat / dimuat | Load / Loading / loaded |
| Pilih / memilih / dipilih | Select / choose / selected |
| Cari / mencari | Search |
| Buat / membuat / Baru | Create / New |
| Batal | Cancel |
| Kosongkan | Clear |

## Status / results
| Indonesian | English |
|---|---|
| Gagal | Failed |
| Gagal memuat | Failed to load |
| Gagal menghapus | Failed to delete |
| Gagal menyimpan | Failed to save |
| Gagal mengunggah | Failed to upload |
| Berhasil | Succeeded / successful |
| Belum ada … | No … yet |
| Tidak ada … / — tidak ada — | No … / None |
| Aktif / Nonaktif | Active / Inactive |
| Sedang berjalan / Memulai | Running / Starting |
| Selesai / Selesai sebagian | Done / Partially done |
| Belum dikonfigurasi | Not configured |
| Tidak terjangkau | Unreachable |
| Terhubung / belum terhubung | Connected / Not connected |

## Domain nouns
| Indonesian | English |
|---|---|
| Gerbang / Akses Gateway | Gateway / Gateway access |
| Klien (eksternal) | (External) client |
| Kunci / Key · Pemegang key | Key · Key holder |
| Sesi (chat) | Session |
| Adaptor | Adapter |
| Riwayat | History |
| Catatan | Note(s) |
| Pengaturan / setelan | Settings |
| Ringkasan | Summary / Overview |
| Hasil | Result(s) |
| Skor / penilaian / nilai ulang | Score / scoring / rescore |
| Cakupan | Coverage |
| Soal / jawaban | Question / answer |
| Materi / sumber | Material / source |
| Tugas | Task |
| Engine inference | Inference engines |

## Do NOT translate (functional Indonesian, not UI chrome)
- `src/lib/grounding-eval.ts`: `DEFAULT_GROUNDING_PROMPT`, `REFUSAL_PATTERNS`,
  the refusal string, `parseJenjang`/`parseSource`, and "SD/SMP/SMA" values —
  these match Indonesian model output / dataset content. Translating breaks eval scoring.
- Indonesian dataset example content shown as input placeholders (e.g. the grounding
  sample at `grounding-eval.tsx`) — illustrates the real (Indonesian) data shape.
- Code comments, enum/type/status identifiers, and test fixtures.
- `mock-banner.tsx` copy: translate to English but keep it **visible** (do not hide in a tooltip).
