#!/usr/bin/env python3
"""Bikin dataset uji-coba kering bergaya rencana Shiro.

Bentuknya sengaja meniru dataset SFT asli nanti:
  - kolom `instruction` / `output` (skema yang disepakati)
  - `instruction` = kepala sitasi + potongan buku + pertanyaan siswa
  - `output`      = jawaban ideal beserta sitasi
  - ~20% contoh NEGATIF: konteksnya tidak memuat jawaban -> menolak dengan halus
  - register bahasa dibedakan per jenjang (SD / SMP / SMA)

Menulis train.jsonl + eval.jsonl ke direktori keluaran (95/5), supaya jalur
"direktori + split validation" di trainer ikut teruji.
"""
import json
import os
import sys

TOLAK = "Maaf, informasi itu belum ada di materi yang tersedia."

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
            ("Ada berapa wujud benda?",
             "Ada tiga wujud benda, yaitu padat, cair, dan gas."),
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
            ("Apa fungsi air liur?",
             "Air liur membantu melunakkan makanan di dalam mulut sehingga lebih mudah dicerna."),
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
            ("Apa itu gaya?",
             "Gaya adalah tarikan atau dorongan yang dapat menyebabkan benda bergerak."),
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
             "Pada segitiga siku-siku, kuadrat panjang sisi miring sama dengan jumlah kuadrat panjang kedua sisi lainnya, "
             "yaitu a kuadrat ditambah b kuadrat sama dengan c kuadrat."),
            ("Apa itu hipotenusa?",
             "Hipotenusa adalah sebutan lain untuk sisi miring, dan merupakan sisi terpanjang pada segitiga siku-siku."),
            ("Apakah teorema Pythagoras berlaku untuk semua segitiga?",
             "Tidak. Teorema Pythagoras hanya berlaku pada segitiga siku-siku."),
            ("Berikan contoh tripel Pythagoras.",
             "Contohnya 3, 4, dan 5, karena 9 ditambah 16 sama dengan 25."),
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
            ("Apa isi bagian deskripsi manfaat?",
             "Deskripsi manfaat menjelaskan kegunaan objek yang diamati."),
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
            ("Apa itu inersia?",
             "Inersia atau kelembaman adalah sifat benda mempertahankan keadaan geraknya, sebagaimana dijelaskan pada "
             "Hukum I Newton."),
            ("Bagaimana rumus Hukum II Newton?",
             "Gaya sama dengan massa dikali percepatan. Percepatan sebanding dengan resultan gaya dan berbanding "
             "terbalik dengan massa benda."),
            ("Apa yang dimaksud gaya aksi dan reaksi?",
             "Menurut Hukum III Newton, apabila suatu benda memberikan gaya pada benda lain, benda kedua memberikan "
             "gaya yang besarnya sama tetapi arahnya berlawanan."),
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
            ("Apa itu litosfer?",
             "Litosfer adalah lapisan kulit bumi paling luar yang tersusun atas batuan."),
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

# Pertanyaan yang JELAS di luar cakupan tiap potongan -> harus ditolak.
# Ini komponen terpenting: tanpa contoh negatif, model tidak pernah belajar
# mengatakan "tidak ada di materi".
NEGATIF = [
    (0, "Siapa presiden pertama Indonesia?"),
    (1, "Berapa jumlah pemain dalam satu tim sepak bola?"),
    (2, "Kapan Indonesia merdeka?"),
    (3, "Bagaimana cara menghitung luas lingkaran?"),
    (4, "Apa ibu kota negara Jepang?"),
    (5, "Apa rumus kecepatan?"),
    (6, "Siapa penemu bola lampu?"),
    (7, "Apa nama planet terbesar di tata surya?"),
    (8, "Bagaimana proses fotosintesis pada tumbuhan?"),
    (9, "Siapa penulis novel Laskar Pelangi?"),
]


def instruksi(p, pertanyaan):
    return (
        f"[{p['buku']}, {p['bab']}]\n"
        f"{p['teks']}\n\n"
        f"Jenjang siswa: {p['jenjang']}\n"
        f"Pertanyaan siswa: {pertanyaan}"
    )


def bangun():
    baris = []
    for p in P:
        for tanya, jawab in p["qa"]:
            baris.append({
                "instruction": instruksi(p, tanya),
                "output": f"{jawab} (Sumber: {p['buku']}, {p['bab']})",
            })
    for idx, tanya in NEGATIF:
        baris.append({"instruction": instruksi(P[idx], tanya), "output": TOLAK})
    return baris


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "/root/dryrun"
    os.makedirs(out_dir, exist_ok=True)
    baris = bangun()

    # Sebar contoh negatif merata, bukan menumpuk di ekor.
    baris = [b for pair in zip(baris[: len(baris) // 2], baris[len(baris) // 2:]) for b in pair] + (
        baris[len(baris) // 2 * 2:]
    )

    potong = max(1, round(len(baris) * 0.05))
    evalset, trainset = baris[:potong], baris[potong:]

    for nama, rows in (("train", trainset), ("eval", evalset)):
        path = os.path.join(out_dir, f"{nama}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"{path}: {len(rows)} baris")

    negatif = sum(1 for b in baris if b["output"] == TOLAK)
    print(f"total {len(baris)} contoh, {negatif} negatif ({negatif * 100 // len(baris)}%)")


if __name__ == "__main__":
    main()
