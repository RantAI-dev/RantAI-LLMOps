# Serah Terima Project UGM — Adapter Elise

Dokumen serah terima untuk tim RantAI Agents: arsitektur adapter, kontrak API chat dan
penilaian, hasil evaluasi, dan status terhadap PRD MVP.

Semua angka di dokumen ini berasal dari pengukuran pada kasus di luar data latih, bukan
dari perkiraan.

---

## Daftar Isi

1. [Ringkas](#1-ringkas)
2. [Empat adapter](#2-empat-adapter)
3. [Cara memanggil model](#3-cara-memanggil-model)
4. [Kontrak prompt](#4-kontrak-prompt)
5. [Kontrak per mode](#5-kontrak-per-mode)
6. [Penilaian jawaban](#6-penilaian-jawaban)
7. [Status terhadap PRD MVP](#7-status-terhadap-prd-mvp)
8. [Yang belum siap dan alasannya](#8-yang-belum-siap-dan-alasannya)
9. [Jebakan integrasi](#9-jebakan-integrasi)
10. [Referensi](#10-referensi)

---

## 1. Ringkas

Empat adapter LoRA di atas Gemma-SEA-LION-v4-4B, disajikan bersamaan di satu GPU lewat
endpoint yang kompatibel OpenAI.

**Siap dipakai:** Tanya, Belajar, dan Latihan pilihan ganda.

**Ditunda:** Latihan isian singkat dan uraian, beserta penilaian otomatisnya. Vonis
benar/salahnya sudah akurat (96%), tetapi penjelasan yang dihasilkan berisiko
menyesatkan siswa pada 27% kasus, dan sekitar 40% soal isian/uraian yang dibuat tidak
berpijak pada teks penjelasan buku.

Pilihan ganda aman ditawarkan lebih dulu karena penilaiannya **tidak melibatkan model
sama sekali** — kunci jawaban dicocokkan kode.

---

## 2. Empat adapter

| Mode | Nama yang dilayani | Versi | Hasil uji |
|---|---|---|---|
| Tanya | `askv6` | v6 | 7/7 kasus kontrak; di luar buku diblokir 20/20 |
| Belajar | `learn` | v13 | 4/4 skenario |
| Latihan | `practice` | v4 | 48/48 jumlah soal tepat |
| Penilai | `grading` | v2 | 96% vonis benar/keliru; 91% nilai tiga tingkat |

> **Nama adapter adalah peran, bukan versi.** `learn` menunjuk v13, `practice` menunjuk
> v4. Saat versi dinaikkan, penunjuknya dipindahkan di sisi serving dan **kode kalian
> tidak berubah sama sekali**. Jangan menulis nomor versi di kode.

Keempatnya dipatri di konfigurasi serving, sehingga tetap termuat setelah engine
restart.

---

## 3. Cara memanggil model

Model dilayani lewat endpoint yang formatnya sama persis dengan OpenAI. Pakai SDK
OpenAI biasa, ganti `baseURL`, lalu pilih adapter lewat field `model`.

```ts
import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "http://10.17.254.27:11436/v1",
  apiKey: process.env.LLMOPS_API_KEY,   // wajib
})

const res = await client.chat.completions.create({
  model: "askv6",                        // adapter = mode
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Apa itu kemagnetan?" },
  ],
  temperature: 0.2,
})
```

### Endpoint

| Keperluan | Alamat |
|---|---|
| Gateway untuk klien luar | `http://10.17.254.27:11436/v1` |
| Daftar model tersedia | `GET /v1/models` |
| Chat completion | `POST /v1/chat/completions` |

### Autentikasi

Wajib membawa `Authorization: Bearer <key>`. Gateway memeriksanya sungguhan, dan
perilakunya **gagal-tertutup**: daftar key kosong berarti semua permintaan ditolak,
bukan dibuka.

API key diminta ke tim LLMOps. Simpan sebagai environment variable di sisi server —
jangan di repositori publik, kode frontend, atau tangkapan layar.

Gateway juga membatasi permukaannya: hanya `/v1/chat/completions`,
`/v1/completions`, dan `/v1/embeddings` yang diteruskan.

---

## 4. Kontrak prompt

> Memanggil endpoint saja **tidak cukup.** Adapter dilatih dengan bentuk prompt yang
> spesifik. Kalau `system` dirakit dengan urutan berbeda, atau ada baris tambahan,
> perilaku model bergeser dan angka hasil pengujian tidak lagi berlaku.

Pesan `system` dirakit dari tiga lapis, selalu dengan urutan ini, digabung dengan
**dua baris kosong** sebagai pemisah:

1. **Persona Elise sesuai mode** — berbeda untuk Tanya, Belajar, dan Latihan. Di
   dalamnya ada blok DASAR tujuh butir yang sama di ketiga mode.
2. **Instruksi platform** — aturan bahasa dan kebersihan keluaran.
3. **Blok Knowledge Base Context** — kutipan bernomor dan daftar sumber.

Pesan siswa dan riwayat percakapan dikirim terpisah sebagai `user` dan `assistant`.

### Blok Knowledge Base

```
## Knowledge Base Context

The excerpts below are your primary source for this question.

When answering:
- Treat the excerpts as the source of truth for specific facts...
- Cite each factual claim inline with a bracketed NUMBER matching the numbered
  Sources list below — e.g. `[1]`...
- Sources tagged [FIGURE] are images/charts...

Excerpts:
[1] Ilmu Pengetahuan alam Kelas IX — Bab 6 › Kemagnetan
Magnet adalah benda yang dapat menarik benda lain...

---

[2] Ilmu Pengetahuan alam Kelas IX — Bab 6 › Medan Magnet
Medan magnet adalah daerah di sekitar magnet...

Sources:
1. Ilmu Pengetahuan alam Kelas IX — Bab 6 › Kemagnetan
2. Ilmu Pengetahuan alam Kelas IX — Bab 6 › Medan Magnet
3. [FIGURE] Ilmu Pengetahuan alam Kelas IX — Bab 6 › Medan Magnet
```

### Tiga aturan yang tidak boleh dilanggar

1. **Pemisah antar kutipan** adalah baris `---` diapit baris kosong.
2. **Penomoran berbagi satu urutan.** Kutipan teks mendapat 1..M, gambar melanjutkan
   M+1..K. Nomor `[1]` yang ditulis model merujuk daftar Sources ini — kalau penomoran
   kalian berbeda, sitasinya salah tunjuk.
3. **Gambar hanya muncul di Sources**, tidak pernah sebagai entri Excerpts. Terukur:
   memasukkan gambar ke Excerpts justru menekan keluaran `[figure:N]` dari 5/5 menjadi
   0/5.

### Menggabungkan potongan dari dokumen yang sama

Beberapa potongan dari **judul dan bab yang sama** harus digabung menjadi **satu
nomor**, teksnya disambung. Tanpa ini, satu sumber terlihat seperti empat sumber
berbeda, dan model menulis `[1][2][3][4]` untuk satu fakta yang sama.

---

## 5. Kontrak per mode

### Tanya — `askv6`

Satu pertanyaan, satu jawaban langsung. Kalimat pertama berisi jawabannya, 3–6 kalimat,
tidak balik menguji siswa.

Keluarannya prosa dengan sitasi `[n]`, dan `[figure:N]` pada barisnya sendiri bila ada
gambar relevan. Buang tag `[figure:N]` yang nomornya tidak ada di Sources sebelum
ditampilkan.

### Belajar — `learn`

Model **bertanya balik dulu** sebelum menjelaskan, satu langkah per giliran. Pola yang
dilatih: giliran pertama sekitar 120 karakter berisi pertanyaan balik tanpa sitasi,
giliran kedua sekitar 300 karakter berisi penjelasan dengan sitasi.

> **Jangkar retrieval.** Untuk Belajar, retrieval memakai **topik pertama** percakapan,
> bukan pesan terakhir. Tindak lanjut pendek seperti "Kenapa begitu?" tidak membawa kata
> topik dan akan mengambil kutipan yang salah kalau dipakai sebagai kueri.

### Latihan pilihan ganda — `practice`

**Kirim tipe dan jumlah sebagai field, bukan kalimat.** Pesan siswa cukup berisi topik;
kalimat permintaan dirakit di sisi kalian dengan bentuk yang sama persis seperti data
latih:

```ts
const userMsg = `Buatkan ${jumlah} soal pilihan ganda tentang ${topik}`
```

> **Ambil topiknya saja.** Kalau siswa mengetik kalimat perintah penuh, merakit di
> atasnya membuat permintaan bertumpuk: *"Buatkan 4 soal pilihan ganda tentang Buatkan 5
> soal pilihan ganda tentang kemagnetan"*. Model menuruti yang di dalam, sehingga
> jumlahnya ikut yang diketik dan pilihan dropdown tampak diabaikan.

**Tegakkan skema dengan `response_format`:**

```ts
{
  model: "practice",
  temperature: 0.35,
  max_tokens: 400 + jumlah * 240,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "soal",
      schema: {
        type: "object",
        properties: {
          soal: {
            type: "array",
            minItems: jumlah, maxItems: jumlah,
            items: {
              type: "object",
              properties: {
                pertanyaan: { type: "string" },
                opsi: {
                  type: "object",
                  properties: { A:{type:"string"}, B:{type:"string"},
                                C:{type:"string"}, D:{type:"string"} },
                  required: ["A","B","C","D"], additionalProperties: false
                },
                kunci: { type: "string" },
                level: { type: "string", enum: ["ingatan","aplikasi"] }
              },
              required: ["pertanyaan","opsi","kunci","level"],
              additionalProperties: false
            }
          }
        },
        required: ["soal"], additionalProperties: false
      }
    }
  }
}
```

**Keluaran:**

```json
{
  "soal": [
    {
      "pertanyaan": "Benda yang dapat ditarik kuat oleh magnet disebut ....",
      "opsi": { "A": "feromagnetik", "B": "paramagnetik",
                "C": "diamagnetik", "D": "nonmagnetik" },
      "kunci": "A",
      "level": "ingatan"
    }
  ]
}
```

> **Jumlah soal tetap harus dipangkas di kode.** `minItems` dan `maxItems` **tidak
> ditegakkan** oleh guided decoding vLLM — terukur, model mengeluarkan 7 soal saat
> diminta 5 meski batasnya dipasang tepat. Skema menjamin *bentuk* tiap soal, bukan
> *cacahnya*. Setelah JSON diparse, potong sendiri: `list.slice(0, jumlah)`.

**Penilaian pilihan ganda** dilakukan di kode: bandingkan huruf pilihan siswa dengan
field `kunci`. Tidak ada pemanggilan model.

### `kunci` hanya ada pada pilihan ganda

| Tipe | Field `kunci` | Dinilai oleh |
|---|---|---|
| Pilihan ganda | huruf A–D | Kode, mencocokkan kunci |
| Isian singkat | tidak ada | Adapter penilai (ditunda) |
| Uraian | tidak ada | Adapter penilai (ditunda) |

Kunci **dihapus dari skema** untuk isian dan uraian, bukan sekadar tidak diwajibkan,
sehingga mustahil muncul.

---

## 6. Penilaian jawaban

> **Belum untuk dipakai.** Endpoint dan adapternya ada dan berfungsi, tetapi lihat
> bagian 8 sebelum mengintegrasikannya.

### Kontrak

```
POST /api/grading
{
  "soal": "Sebutkan dua kutub yang dimiliki setiap magnet.",
  "jawaban_siswa": "utara sama selatan",
  "jenjang": "SMP", "kelas": "Kelas 9",
  "excerpts": [ { "title": "…", "section": "…", "text": "…" } ]
}
```

```
{
  "dinilai": true,
  "keliru": false,            ← tampilkan ke siswa · 96%
  "kutipan_buku": [ … ],      ← kalimat asli dari buku
  "umpan_balik": "…",         ← di balik label "Penjelasan AI"
  "jawaban_benar": "…",
  "nilai_rinci": "BENAR",     ← untuk guru · 91%
  "sumber": [ { "n": 1, "judul": "…", "bagian": "…" } ],
  "model": "grading"
}
```

### Selalu kirim `excerpts`

Kutipan yang dipakai membuat soal sudah dikembalikan `/api/chat` bersama soalnya. Tanpa
itu, endpoint harus menebak ulang sumbernya lewat pencarian, dan itu **tidak bisa
dibuat bekerja** untuk soal isian yang berupa kalimat rumpang:

| Jalur | Dari 60 soal nyata |
|---|---|
| Pencarian ulang dari teks soal | 29 ditolak · 48% |
| Pencarian ulang + topik ditambahkan | 27 ditolak · 45% |
| Kutipan asal ikut dikirim | 0 ditolak · 0% |

Sebarannya bertumpang tindih: soal sah turun sampai skor 0,420 sedangkan pertanyaan di
luar buku naik sampai 0,522 — tidak ada ambang yang bisa memisahkannya.

---

## 7. Status terhadap PRD MVP

### Practice mode — hal. 11 & 13

| Kebutuhan | Status | Keterangan |
|---|---|---|
| Membuat soal dari topik | ✓ terpenuhi | practice v4 |
| Pilihan ganda: soal + kunci | ✓ terpenuhi | Bentuk JSON terjamin; 48/48 jumlah tepat |
| Soal berpijak pada isi buku | ◐ sebagian | 57–61% berpijak uraian |
| Isian/uraian: soal saja | ✓ terpenuhi | Kunci dihapus dari skema |
| Menilai isian/uraian: benar/salah | ✓ terpenuhi | grading v2 · 96% |
| Menjelaskan jawaban benar dan salah | ◐ sebagian | 27% penjelasan berisiko |
| Menghitung skor akhir | ○ belum | Sisi aplikasi RantAI Agents |
| Ringkasan penguasaan topik | ○ belum | Sisi aplikasi RantAI Agents |
| Menyimpan riwayat dan skor | ○ belum | Sisi aplikasi RantAI Agents |

### Perilaku AI — hal. 12 & 14

| Kebutuhan | Status | Keterangan |
|---|---|---|
| Berlandaskan buku, menolak di luar buku | ✓ terpenuhi | 20/20 diblokir |
| Menyatakan bila detail tidak ada di buku | ◐ sebagian | Luar topik terblokir; detail hilang belum |
| Menolak permintaan berbahaya | ◐ sebagian | Terblokir, tapi oleh gerbang grounding |
| Kegagalan AI: pesan ramah + coba ulang | ◐ sebagian | Endpoint memberi 503 jelas |

---

## 8. Yang belum siap dan alasannya

### Penjelasan penilai berisiko menyesatkan

Diukur pada 99 kasus oleh empat juri: **27 dari 99 penjelasan berisiko ditampilkan ke
siswa** — 18 memuat fakta salah, 9 salah menggambarkan jawaban siswa. Bahkan saat
vonisnya tepat, 1 dari 5 penjelasan masih menyesatkan.

Contoh nyata: siswa menjawab soal kompas dengan miskonsepsi, model memberi vonis
"keliru" dengan tepat, lalu menjelaskan bahwa *"kutub utara dan kutub selatan magnet
bumi saling berhadiran, jadi mereka saling menolak"*. Kata itu tidak ada di seluruh
korpus, dan menurut buku kutub berbeda nama justru tarik-menarik.

> **Adanya sitasi bukan bukti kebenaran.** Pengukuran sebelumnya hanya memeriksa
> *kehadiran* tanda `[1]`, bukan isinya — dan itu sempat dilaporkan sebagai
> "bersitasi 99/99", yang menyesatkan.

**Yang sudah dilakukan:** yang tampil ke siswa sekarang adalah vonis ditambah kalimat
asli dari buku, bukan parafrase model. Penjelasan model dipindah ke lipatan tertutup
berlabel "Penjelasan AI — bisa keliru".

### Soal isian dan uraian sering tidak berpijak buku

Diukur dengan juri buta pada 190 soal dari 19 topik: **hanya 57–61% soal berpijak pada
teks penjelasan**, 28–36% diambil dari bagian soal latihan buku, dan 9–16% premisnya
keliru.

Polanya berulang: adapter membangun soal dari bagian latihan di akhir bab — termasuk
butir pengecoh pilihan ganda dan soal uraian yang bukunya sendiri tidak memberi kunci.

Untuk sebagian topik SD dari Buku Guru, bacaan yang terambil memang hanya berisi langkah
kegiatan, rubrik, dan tabel kosong. Tidak ada uraian materi untuk dijadikan soal, dan
pembersihan otomatis tidak bisa menciptakan materi yang tidak ada.

**Konsekuensinya:** soal yang jawabannya tidak tertulis di buku tidak bisa dinilai
dengan benar oleh model mana pun. Untuk pilihan ganda dampaknya terbatas karena kunci
dicocokkan kode; untuk isian dan uraian, dampaknya berlipat.

---

## 9. Jebakan integrasi

### `guided_json` diterima lalu diabaikan diam-diam

Pada vLLM yang dipakai, parameter `guided_json` di tingkat atas **diterima tanpa error
lalu tidak pernah dipakai**. Permintaan sukses, sampler tidak pernah dibatasi, dan model
bebas menulis prosa. Latihan sempat terlihat baik-baik saja hanya karena adapternya
memang dilatih mengeluarkan JSON — pagarnya sendiri tidak pernah berjalan.

Pakai `response_format`.

### Batas konteks 8192 token

Prompt ditambah jawaban harus muat dalam 8192 token. Kutipan yang terlalu panjang
membuat vLLM menolak permintaan. Batasi panjang kutipan sebelum dirakit — pernah
ditemukan prompt mencapai 8207 token hanya dari penggabungan potongan satu bab.

### 503 berarti coba ulang, bukan beralih ke model dasar

Bila adapter tidak termuat, endpoint menjawab 503 dan **tidak diam-diam beralih ke
`base`**. Model dasar hanya mencapai 49%, dan peralihan diam-diam akan terlihat seperti
mutu yang anjlok tanpa sebab.

### Frasa yang mengandaikan siswa melihat kutipan

Soal kadang keluar berbunyi "Menurut bacaan, ...", padahal siswa tidak melihat kutipan
apa pun. Terukur 23,9% soal di data latih memuat frasa ini. Sementara ini dibersihkan di
kode setelah JSON diparse; obat sebenarnya ada di data latih versi berikutnya.

---

## 10. Referensi

| Sumber | Isi |
|---|---|
| Mockup di `:3090` | Ketiga mode bisa dicoba; panel kanan menampilkan prompt yang benar-benar dikirim |
| `github.com/IdhamTryCode/Agents-Mockup` | Implementasi acuan, Next.js |
| `docs/ARSITEKTUR.md` | Arsitektur RantAI-LLMOps |

### Berkas yang paling relevan di mockup

| Berkas | Isi |
|---|---|
| `src/lib/contract.ts` | Persona ketiga mode, instruksi platform, perakit blok KB |
| `src/lib/llm.ts` | Klien vLLM, termasuk penanganan `response_format` |
| `src/app/api/chat/route.ts` | Alur lengkap: retrieval, guardrail, skema, pembersihan |
| `src/lib/retrieve.ts` | Retrieval bge-m3 dan cosine |
| `src/lib/excerpts.ts` | Penggabungan potongan dan penomoran sumber |
| `src/app/api/grading/route.ts` | Endpoint penilaian (belum untuk dipakai) |

> Korpus buku (`data/chunks.json`, 25 MB) sengaja tidak diikutkan di repo karena
> reponya publik. Di produksi, RantAI Agents memakai pipeline retrieval sendiri.
