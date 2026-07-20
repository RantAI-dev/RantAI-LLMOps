#!/usr/bin/env python3
"""Bikin dataset SFT bergaya rencana Shiro.

Bentuknya meniru dataset asli nanti:
  - kolom `instruction` / `output`
  - `instruction` = BEBERAPA potongan buku (masing-masing berkepala sitasi) +
    pertanyaan siswa, meniru hasil retrieval yang mengembalikan banyak potongan
    sementara jawabannya cuma ada di salah satunya
  - `output`      = jawaban ideal beserta sitasi buku + bab yang BENAR
  - ~20% contoh NEGATIF: tidak satu pun potongan memuat jawabannya -> menolak
  - register bahasa dibedakan per jenjang (SD / SMP / SMA)

Dua mode pemakaian:

  # kecil, buat mengecek pipeline
  python3 gen-dryrun-dataset.py /path/out --rows 48 --chunks 1 1

  # besar + konteks panjang, buat UJI INFRASTRUKTUR pada model 8B
  python3 gen-dryrun-dataset.py /path/out --rows 1500

PERINGATAN untuk --rows besar: pasangan tanya-jawabnya BERULANG (variasinya ada
pada potongan pengecoh, urutannya, dan awalan pertanyaan — bukan pada isinya).
Dataset ini untuk menguji apakah training MUAT, BERAPA LAMA, dan STABIL. Model
hasil latihannya TIDAK boleh dinilai kualitasnya.
"""
import argparse
import json
import os
import random

TOLAK = "Maaf, informasi itu belum ada di materi yang tersedia."

# Variasi permukaan supaya tiap baris tidak identik walau pasangan QA-nya sama.
TANYA_AWALAN = ["", "Coba jelaskan, ", "Menurut materi, ", "Bu, mau tanya: ", "Aku masih bingung. "]

P = [
    dict(
        buku="Buku IPA Kelas 3", bab="Bab 2: Wujud Benda", jenjang="SD",
        teks=(
            "Benda di sekitar kita memiliki tiga wujud, yaitu padat, cair, dan gas. "
            "Benda padat mempunyai bentuk dan ukuran yang tetap, misalnya batu, kayu, dan buku. "
            "Benda cair bentuknya berubah mengikuti wadahnya, tetapi ukurannya tetap, misalnya air dan minyak. "
            "Benda gas mengisi seluruh ruangan yang ditempatinya, misalnya udara di dalam balon. "
            "Wujud benda dapat berubah apabila dipanaskan atau didinginkan. Es yang dipanaskan akan mencair "
            "menjadi air, dan air yang dipanaskan terus-menerus akan menguap menjadi uap air."
        ),
        qa=[
            ("Ada berapa wujud benda?", "Ada tiga wujud benda, yaitu padat, cair, dan gas."),
            ("Kenapa air bisa berubah bentuk kalau dipindah ke gelas lain?",
             "Karena air termasuk benda cair. Bentuk benda cair berubah mengikuti wadahnya, tetapi ukurannya tetap sama."),
            ("Apa yang terjadi kalau es dipanaskan?",
             "Es yang dipanaskan akan mencair menjadi air. Kalau air terus dipanaskan, air akan menguap menjadi uap air."),
            ("Sebutkan contoh benda padat.",
             "Contoh benda padat adalah batu, kayu, dan buku. Benda padat bentuk dan ukurannya tetap."),
        ],
    ),
    dict(
        buku="Buku IPA Kelas 5", bab="Bab 4: Sistem Pencernaan Manusia", jenjang="SD",
        teks=(
            "Sistem pencernaan manusia bertugas mengubah makanan menjadi sari-sari makanan yang dapat diserap tubuh. "
            "Proses pencernaan dimulai dari mulut. Di dalam mulut, gigi mengunyah makanan dan air liur membantu "
            "melunakkan makanan. Makanan kemudian turun melalui kerongkongan menuju lambung. Di lambung, makanan "
            "dicerna dengan bantuan getah lambung. Selanjutnya makanan masuk ke usus halus. Di usus halus, sari-sari "
            "makanan diserap oleh dinding usus dan diedarkan ke seluruh tubuh oleh darah. Sisa makanan yang tidak "
            "diserap masuk ke usus besar, lalu dikeluarkan melalui anus."
        ),
        qa=[
            ("Pencernaan makanan dimulai dari mana?",
             "Pencernaan makanan dimulai dari mulut. Di mulut, gigi mengunyah makanan dan air liur membantu melunakkannya."),
            ("Di organ apa sari-sari makanan diserap?",
             "Sari-sari makanan diserap di usus halus, lalu diedarkan ke seluruh tubuh oleh darah."),
            ("Apa fungsi air liur?", "Air liur membantu melunakkan makanan di dalam mulut sehingga lebih mudah dicerna."),
            ("Ke mana sisa makanan yang tidak diserap?",
             "Sisa makanan yang tidak diserap masuk ke usus besar, kemudian dikeluarkan melalui anus."),
        ],
    ),
    dict(
        buku="Buku IPA Kelas 4", bab="Bab 3: Gaya dan Gerak", jenjang="SD",
        teks=(
            "Gaya adalah tarikan atau dorongan yang dapat menyebabkan benda bergerak. Gaya tidak dapat dilihat, "
            "tetapi pengaruhnya dapat dirasakan. Gaya dapat membuat benda diam menjadi bergerak, benda bergerak "
            "menjadi diam, mengubah arah gerak benda, serta mengubah bentuk benda. Ada beberapa macam gaya, antara "
            "lain gaya otot, gaya gesek, gaya magnet, dan gaya gravitasi. Gaya gesek terjadi ketika dua permukaan "
            "benda saling bersentuhan, misalnya ketika kita mengerem sepeda. Gaya gravitasi menyebabkan benda "
            "jatuh ke bawah menuju bumi."
        ),
        qa=[
            ("Apa itu gaya?", "Gaya adalah tarikan atau dorongan yang dapat menyebabkan benda bergerak."),
            ("Kenapa buah jatuh ke bawah?",
             "Karena ada gaya gravitasi. Gaya gravitasi menyebabkan benda jatuh ke bawah menuju bumi."),
            ("Gaya apa yang bekerja saat kita mengerem sepeda?",
             "Yang bekerja adalah gaya gesek, yaitu gaya yang terjadi ketika dua permukaan benda saling bersentuhan."),
        ],
    ),
    dict(
        buku="Buku IPS Kelas 7", bab="Bab 3: Interaksi Sosial", jenjang="SMP",
        teks=(
            "Interaksi sosial adalah hubungan timbal balik antarindividu, antara individu dan kelompok, atau "
            "antarkelompok. Interaksi sosial dapat terjadi apabila memenuhi dua syarat, yaitu kontak sosial dan "
            "komunikasi. Kontak sosial dapat bersifat langsung, misalnya bertatap muka, maupun tidak langsung, "
            "misalnya melalui telepon atau surat. Komunikasi terjadi apabila pesan yang disampaikan dapat dipahami "
            "oleh penerima. Bentuk interaksi sosial dibedakan menjadi dua, yaitu proses asosiatif yang mengarah "
            "pada persatuan, seperti kerja sama dan akomodasi, serta proses disosiatif yang mengarah pada "
            "perpecahan, seperti persaingan dan konflik."
        ),
        qa=[
            ("Apa saja syarat terjadinya interaksi sosial?",
             "Ada dua syarat, yaitu kontak sosial dan komunikasi. Interaksi sosial baru terjadi apabila keduanya terpenuhi."),
            ("Apa bedanya proses asosiatif dan disosiatif?",
             "Proses asosiatif mengarah pada persatuan, contohnya kerja sama dan akomodasi. Proses disosiatif mengarah "
             "pada perpecahan, contohnya persaingan dan konflik."),
            ("Apakah menelepon termasuk kontak sosial?",
             "Ya. Kontak sosial dapat bersifat tidak langsung, misalnya melalui telepon atau surat."),
            ("Berikan contoh proses disosiatif.",
             "Contoh proses disosiatif adalah persaingan dan konflik, karena keduanya mengarah pada perpecahan."),
        ],
    ),
    dict(
        buku="Buku Matematika Kelas 8", bab="Bab 5: Teorema Pythagoras", jenjang="SMP",
        teks=(
            "Teorema Pythagoras menyatakan bahwa pada segitiga siku-siku, kuadrat panjang sisi miring sama dengan "
            "jumlah kuadrat panjang kedua sisi lainnya. Jika sisi siku-sikunya a dan b, serta sisi miringnya c, "
            "maka berlaku hubungan a kuadrat ditambah b kuadrat sama dengan c kuadrat. Sisi miring disebut juga "
            "hipotenusa dan merupakan sisi terpanjang pada segitiga siku-siku. Teorema ini hanya berlaku pada "
            "segitiga siku-siku. Tigaan bilangan yang memenuhi hubungan tersebut disebut tripel Pythagoras, "
            "misalnya 3, 4, dan 5 karena 9 ditambah 16 sama dengan 25."
        ),
        qa=[
            ("Bagaimana bunyi teorema Pythagoras?",
             "Pada segitiga siku-siku, kuadrat panjang sisi miring sama dengan jumlah kuadrat panjang kedua sisi lainnya."),
            ("Apa itu hipotenusa?",
             "Hipotenusa adalah sebutan lain untuk sisi miring, dan merupakan sisi terpanjang pada segitiga siku-siku."),
            ("Apakah teorema Pythagoras berlaku untuk semua segitiga?",
             "Tidak. Teorema Pythagoras hanya berlaku pada segitiga siku-siku."),
            ("Berikan contoh tripel Pythagoras.", "Contohnya 3, 4, dan 5, karena 9 ditambah 16 sama dengan 25."),
        ],
    ),
    dict(
        buku="Buku PPKn Kelas 9", bab="Bab 1: Dinamika Perwujudan Pancasila", jenjang="SMP",
        teks=(
            "Pancasila merupakan dasar negara sekaligus pandangan hidup bangsa Indonesia. Pancasila terdiri atas "
            "lima sila, yaitu Ketuhanan Yang Maha Esa; Kemanusiaan yang adil dan beradab; Persatuan Indonesia; "
            "Kerakyatan yang dipimpin oleh hikmat kebijaksanaan dalam permusyawaratan/perwakilan; serta Keadilan "
            "sosial bagi seluruh rakyat Indonesia. Sebagai dasar negara, Pancasila menjadi sumber dari segala "
            "sumber hukum di Indonesia. Perwujudan nilai Pancasila bersifat dinamis, artinya penerapannya "
            "menyesuaikan perkembangan zaman tanpa mengubah nilai dasarnya."
        ),
        qa=[
            ("Sebutkan sila-sila Pancasila.",
             "Sila Pancasila ada lima: Ketuhanan Yang Maha Esa; Kemanusiaan yang adil dan beradab; Persatuan Indonesia; "
             "Kerakyatan yang dipimpin oleh hikmat kebijaksanaan dalam permusyawaratan/perwakilan; serta Keadilan sosial "
             "bagi seluruh rakyat Indonesia."),
            ("Apa kedudukan Pancasila dalam hukum Indonesia?",
             "Sebagai dasar negara, Pancasila menjadi sumber dari segala sumber hukum di Indonesia."),
            ("Apa maksud perwujudan Pancasila bersifat dinamis?",
             "Artinya penerapannya menyesuaikan perkembangan zaman, tetapi nilai dasarnya tidak berubah."),
        ],
    ),
    dict(
        buku="Buku Bahasa Indonesia Kelas 10", bab="Bab 1: Teks Laporan Hasil Observasi", jenjang="SMA",
        teks=(
            "Teks laporan hasil observasi adalah teks yang memuat penjabaran umum mengenai sesuatu berdasarkan hasil "
            "pengamatan. Teks ini bersifat objektif, faktual, dan ditulis secara lengkap serta tidak memihak. "
            "Struktur teks laporan hasil observasi terdiri atas pernyataan umum atau klasifikasi, deskripsi bagian, "
            "dan deskripsi manfaat. Pernyataan umum berisi pengertian atau penggolongan objek yang diamati. "
            "Deskripsi bagian menguraikan ciri-ciri objek secara rinci. Deskripsi manfaat menjelaskan kegunaan objek "
            "tersebut. Ciri kebahasaan teks ini antara lain penggunaan kata benda umum, kata kerja relasional seperti "
            "adalah dan merupakan, serta istilah teknis sesuai bidangnya."
        ),
        qa=[
            ("Apa struktur teks laporan hasil observasi?",
             "Strukturnya terdiri atas pernyataan umum atau klasifikasi, deskripsi bagian, dan deskripsi manfaat."),
            ("Apa saja ciri kebahasaan teks laporan hasil observasi?",
             "Ciri kebahasaannya antara lain penggunaan kata benda umum, kata kerja relasional seperti adalah dan "
             "merupakan, serta istilah teknis sesuai bidangnya."),
            ("Apa isi bagian deskripsi manfaat?", "Deskripsi manfaat menjelaskan kegunaan objek yang diamati."),
            ("Apakah teks laporan hasil observasi boleh memihak?",
             "Tidak. Teks laporan hasil observasi bersifat objektif, faktual, dan ditulis secara tidak memihak."),
        ],
    ),
    dict(
        buku="Buku Fisika Kelas 10", bab="Bab 6: Hukum Newton tentang Gerak", jenjang="SMA",
        teks=(
            "Hukum Newton tentang gerak terdiri atas tiga hukum. Hukum I Newton menyatakan bahwa suatu benda akan "
            "tetap diam atau bergerak lurus beraturan apabila resultan gaya yang bekerja padanya sama dengan nol. "
            "Sifat benda mempertahankan keadaan geraknya ini disebut inersia atau kelembaman. Hukum II Newton "
            "menyatakan bahwa percepatan suatu benda sebanding dengan resultan gaya dan berbanding terbalik dengan "
            "massanya, dirumuskan sebagai gaya sama dengan massa dikali percepatan. Hukum III Newton menyatakan "
            "bahwa apabila suatu benda memberikan gaya pada benda lain, benda kedua memberikan gaya yang besarnya "
            "sama tetapi arahnya berlawanan, dikenal sebagai gaya aksi dan reaksi."
        ),
        qa=[
            ("Apa bunyi Hukum I Newton?",
             "Suatu benda akan tetap diam atau bergerak lurus beraturan apabila resultan gaya yang bekerja padanya "
             "sama dengan nol."),
            ("Apa itu inersia?", "Inersia atau kelembaman adalah sifat benda mempertahankan keadaan geraknya."),
            ("Bagaimana rumus Hukum II Newton?",
             "Gaya sama dengan massa dikali percepatan. Percepatan sebanding dengan resultan gaya dan berbanding "
             "terbalik dengan massa benda."),
            ("Apa yang dimaksud gaya aksi dan reaksi?",
             "Apabila suatu benda memberikan gaya pada benda lain, benda kedua memberikan gaya yang besarnya sama "
             "tetapi arahnya berlawanan."),
        ],
    ),
    dict(
        buku="Buku Biologi Kelas 11", bab="Bab 2: Sistem Peredaran Darah", jenjang="SMA",
        teks=(
            "Sistem peredaran darah manusia terdiri atas jantung, pembuluh darah, dan darah. Jantung manusia memiliki "
            "empat ruang, yaitu serambi kanan, serambi kiri, bilik kanan, dan bilik kiri. Pembuluh darah dibedakan "
            "menjadi arteri yang mengalirkan darah keluar dari jantung, vena yang mengalirkan darah menuju jantung, "
            "serta kapiler yang menghubungkan keduanya. Peredaran darah manusia bersifat ganda, yaitu peredaran darah "
            "kecil dari jantung ke paru-paru dan kembali ke jantung, serta peredaran darah besar dari jantung ke "
            "seluruh tubuh dan kembali ke jantung. Darah terdiri atas plasma darah, sel darah merah, sel darah putih, "
            "dan keping darah."
        ),
        qa=[
            ("Berapa ruang jantung manusia dan apa saja?",
             "Jantung manusia memiliki empat ruang, yaitu serambi kanan, serambi kiri, bilik kanan, dan bilik kiri."),
            ("Apa beda arteri dan vena?",
             "Arteri mengalirkan darah keluar dari jantung, sedangkan vena mengalirkan darah menuju jantung."),
            ("Apa yang dimaksud peredaran darah ganda?",
             "Peredaran darah ganda berarti terdapat peredaran darah kecil dari jantung ke paru-paru dan kembali ke "
             "jantung, serta peredaran darah besar dari jantung ke seluruh tubuh dan kembali ke jantung."),
            ("Apa saja komponen penyusun darah?",
             "Darah terdiri atas plasma darah, sel darah merah, sel darah putih, dan keping darah."),
        ],
    ),
    dict(
        buku="Buku Geografi Kelas 10", bab="Bab 4: Dinamika Litosfer", jenjang="SMA",
        teks=(
            "Litosfer adalah lapisan kulit bumi yang paling luar dan tersusun atas batuan. Berdasarkan proses "
            "pembentukannya, batuan dikelompokkan menjadi tiga jenis, yaitu batuan beku, batuan sedimen, dan batuan "
            "metamorf. Batuan beku terbentuk dari pembekuan magma. Batuan sedimen terbentuk dari pengendapan material "
            "hasil pelapukan dan erosi. Batuan metamorf terbentuk dari batuan yang mengalami perubahan akibat tekanan "
            "dan suhu tinggi. Tenaga yang membentuk permukaan bumi dibedakan menjadi tenaga endogen yang berasal dari "
            "dalam bumi, seperti vulkanisme dan tektonisme, serta tenaga eksogen yang berasal dari luar bumi, seperti "
            "pelapukan dan erosi."
        ),
        qa=[
            ("Apa itu litosfer?", "Litosfer adalah lapisan kulit bumi paling luar yang tersusun atas batuan."),
            ("Sebutkan tiga jenis batuan berdasarkan pembentukannya.",
             "Batuan beku, batuan sedimen, dan batuan metamorf."),
            ("Bagaimana batuan metamorf terbentuk?",
             "Batuan metamorf terbentuk dari batuan yang mengalami perubahan akibat tekanan dan suhu tinggi."),
            ("Apa beda tenaga endogen dan eksogen?",
             "Tenaga endogen berasal dari dalam bumi, seperti vulkanisme dan tektonisme. Tenaga eksogen berasal dari "
             "luar bumi, seperti pelapukan dan erosi."),
        ],
    ),
]


def potongan(p):
    """Satu potongan hasil retrieval: kepala sitasi + isinya."""
    return f"[{p['buku']}, {p['bab']}]\n{p['teks']}"


def instruksi(chunks, jenjang, tanya):
    return (
        "\n\n".join(potongan(c) for c in chunks)
        + f"\n\nJenjang siswa: {jenjang}\nPertanyaan siswa: {tanya}"
    )


def bangun(rows, n_min, n_max, rasio_negatif, rng):
    """Rakit `rows` contoh. Konteks tiap contoh berisi beberapa potongan: pada
    contoh positif salah satunya memuat jawabannya (posisinya diacak, jadi
    jawabannya tidak selalu di potongan pertama); pada negatif tidak satu pun."""
    positif = [(p, q, a) for p in P for q, a in p["qa"]]
    baris = []
    while len(baris) < rows:
        negatif = rng.random() < rasio_negatif
        n = rng.randint(n_min, n_max)
        sumber, tanya, jawab = positif[rng.randrange(len(positif))]
        awalan = rng.choice(TANYA_AWALAN)
        lain = [p for p in P if p["buku"] != sumber["buku"]]

        if negatif:
            # Pertanyaan berasal dari buku X, tapi tidak satu pun potongan dari X.
            chunks = rng.sample(lain, min(n, len(lain)))
            out = TOLAK
        else:
            chunks = [sumber] + rng.sample(lain, min(n - 1, len(lain)))
            rng.shuffle(chunks)
            out = f"{jawab} (Sumber: {sumber['buku']}, {sumber['bab']})"

        baris.append({
            "instruction": instruksi(chunks, sumber["jenjang"], awalan + tanya),
            "output": out,
        })
    return baris


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("out_dir", nargs="?", default="/root/dryrun")
    ap.add_argument("--rows", type=int, default=1500, help="jumlah baris total (default 1500)")
    ap.add_argument("--chunks", type=int, nargs=2, metavar=("MIN", "MAX"), default=[5, 9],
                    help="jumlah potongan per contoh (default 5 9 -> ~800-1600 token, "
                         "sesuai rentang konteks retrieval di rencana Shiro)")
    ap.add_argument("--negatif", type=float, default=0.2, help="porsi contoh negatif (default 0.2)")
    ap.add_argument("--eval-split", type=float, default=0.05, help="porsi untuk eval.jsonl (default 0.05)")
    ap.add_argument("--seed", type=int, default=42, help="benih acak, supaya hasilnya bisa diulang")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    baris = bangun(args.rows, args.chunks[0], args.chunks[1], args.negatif, rng)
    rng.shuffle(baris)

    os.makedirs(args.out_dir, exist_ok=True)
    potong = max(1, round(len(baris) * args.eval_split))
    evalset, trainset = baris[:potong], baris[potong:]

    for nama, rows in (("train", trainset), ("eval", evalset)):
        path = os.path.join(args.out_dir, f"{nama}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"{path}: {len(rows)} baris")

    neg = sum(1 for b in baris if b["output"] == TOLAK)
    # ~4 karakter per token: perkiraan kasar, cukup untuk memilih max_seq_length.
    panjang = [(len(b["instruction"]) + len(b["output"])) // 4 for b in baris]
    print(f"total {len(baris)} contoh, {neg} negatif ({neg * 100 // len(baris)}%)")
    print(f"panjang sampel: min ~{min(panjang)} token, rata-rata ~{sum(panjang) // len(panjang)} token, "
          f"maks ~{max(panjang)} token")
    print("CATATAN: pada --rows besar pasangan QA berulang. Dataset ini menguji kapasitas")
    print("         & kestabilan training, BUKAN untuk menilai kualitas model hasilnya.")


if __name__ == "__main__":
    main()
