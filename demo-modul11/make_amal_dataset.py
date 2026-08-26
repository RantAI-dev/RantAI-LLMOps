#!/usr/bin/env python3
"""
AMAL — Analisis Malware & Atribusi LoRA (synthetic demo dataset).

Generates a proper-looking malware-family CLASSIFICATION dataset in the
instruction -> output format expected by the LLMOps fine-tune trainer.

IMPORTANT (matches the LLMOps trainer gotcha): everything the model needs is put
in `instruction`; there is NO separate `input` column (the trainer ignores it).
Output is the family label only, so accuracy / macro-F1 are well defined.

Split is STRATIFIED per malware family (not a random row split), mirroring the
module's "held-out test set dipisahkan SEBELUM training" note.
"""
import json, random, os

SEED = 3407
random.seed(SEED)

OUT_DIR = os.path.join(os.path.dirname(__file__), "data")
TRAIN_PER_FAMILY = 150
TEST_PER_FAMILY = 40

# Each family: signature indicators across behaviour / static / network / target.
# Overlap is intentional (credential theft, C2, etc. recur) so the task is real,
# but each family carries a recognisable combination.
FAMILIES = {
    "Emotet": {
        "type": "Loader / Banking Trojan",
        "ind": [
            "dikirim via email spam dengan lampiran dokumen Office bermakro",
            "makro VBA men-download payload tahap kedua dari URL eksternal",
            "melakukan C2 beaconing HTTP POST terenkripsi secara periodik",
            "menyuntikkan diri ke proses explorer.exe untuk persistensi",
            "modular: mengunduh modul spam, pencuri kredensial, dan spreader",
            "mengumpulkan daftar kontak Outlook untuk kampanye spam lanjutan",
            "membuat scheduled task dengan nama acak untuk auto-start",
            "menyalin diri ke %AppData% dengan nama file teracak",
        ],
    },
    "TrickBot": {
        "type": "Banking Trojan / Modular",
        "ind": [
            "menggunakan web-inject untuk mencuri kredensial perbankan online",
            "mengunduh modul tambahan (pwgrab, injectDll, shareDll) dari C2",
            "melakukan lateral movement lewat SMB dan eksploitasi EternalBlue",
            "meng-harvest kredensial dari browser dan aplikasi email",
            "menonaktifkan Windows Defender melalui perubahan registry",
            "sering menjadi pengantar (dropper) untuk ransomware Ryuk",
            "menyimpan konfigurasi terenkripsi dalam folder %AppData%",
        ],
    },
    "WannaCry": {
        "type": "Ransomware / Worm",
        "ind": [
            "mengeksploitasi kerentanan SMBv1 EternalBlue untuk menyebar otomatis",
            "mengenkripsi berkas dan menambahkan ekstensi .wncry",
            "menampilkan ransom note @Please_Read_Me@.txt meminta Bitcoin",
            "memeriksa domain kill-switch sebelum eksekusi payload",
            "menyebar seperti worm ke host lain pada subnet yang sama",
            "menghapus volume shadow copy dengan vssadmin delete shadows",
            "menjatuhkan komponen DoublePulsar sebagai backdoor",
        ],
    },
    "Mirai": {
        "type": "IoT Botnet",
        "ind": [
            "melakukan brute-force Telnet/SSH memakai daftar kredensial default",
            "menargetkan perangkat IoT (router, kamera CCTV, DVR) berbasis Linux",
            "menjalankan serangan DDoS (SYN flood, UDP flood) atas perintah C2",
            "menghapus berkas biner dirinya dari disk dan berjalan di memori",
            "membunuh proteksi watchdog agar perangkat tidak melakukan reboot",
            "menyimpan tabel kredensial default ter-hardcode dalam biner",
            "berkomunikasi dengan server C2 melalui port TCP non-standar",
        ],
    },
    "AgentTesla": {
        "type": "Infostealer / RAT (.NET)",
        "ind": [
            "melakukan keylogging dan menangkap isi clipboard secara berkala",
            "mencuri kredensial tersimpan dari browser dan klien email",
            "meng-exfiltrasi data melalui SMTP, FTP, atau Telegram Bot API",
            "ditulis dalam .NET dan di-obfuscate menggunakan packer",
            "mengambil screenshot desktop korban secara periodik",
            "membuat entri Run pada registry untuk persistensi",
            "melakukan process hollowing ke RegAsm.exe atau MSBuild.exe",
        ],
    },
    "Ryuk": {
        "type": "Ransomware (targeted)",
        "ind": [
            "enkripsi tertarget setelah kompromi jaringan secara manual",
            "menghentikan layanan backup dan basis data sebelum enkripsi",
            "menghapus shadow copy dan menonaktifkan Windows recovery",
            "menambahkan ekstensi .RYK pada berkas terenkripsi",
            "menuntut tebusan besar dalam Bitcoin lewat RyukReadMe.txt",
            "sering dijatuhkan setelah infeksi TrickBot atau Emotet",
            "menyebar via PsExec ke seluruh host domain",
        ],
    },
    "Zeus": {
        "type": "Banking Trojan",
        "ind": [
            "melakukan form-grabbing untuk mencegat input formulir web",
            "menjalankan serangan man-in-the-browser pada sesi perbankan",
            "mengunduh berkas konfigurasi terenkripsi dari server C2",
            "menyuntik kode ke proses browser (iexplore.exe, firefox.exe)",
            "membentuk botnet yang dikendalikan lewat panel kontrol",
            "menyimpan data curian di folder tersembunyi sebelum exfiltrasi",
        ],
    },
    "RedLine": {
        "type": "Infostealer (MaaS)",
        "ind": [
            "mencuri data autofill, cookie, dan kata sandi dari browser",
            "menargetkan dompet cryptocurrency dan ekstensi wallet",
            "meng-harvest kredensial VPN, FTP, dan klien game/Discord",
            "dijual sebagai Malware-as-a-Service pada forum bawah tanah",
            "mengirim data curian sebagai arsip ZIP ke C2 via SOAP/HTTP",
            "mengumpulkan info sistem (HWID, lokasi, daftar aplikasi)",
        ],
    },
}

GENERIC_NOISE = [
    "menampilkan aktivitas jaringan keluar yang tidak biasa",
    "melakukan pemeriksaan anti-analisis terhadap lingkungan sandbox",
    "menggunakan teknik obfuscation untuk menghindari deteksi statis",
    "menulis entri ke Windows Event Log yang kemudian dihapus",
]

INSTRUCTION_TEMPLATES = [
    "Anda adalah analis malware. Tentukan malware family dari sampel berdasarkan indikator yang diamati.\n\nIndikator:\n{bullets}\n\nJawab hanya dengan nama family-nya.",
    "Klasifikasikan sampel malware berikut ke dalam satu malware family.\n\nPerilaku & indikator teramati:\n{bullets}\n\nFamily:",
    "Berdasarkan laporan analisis dinamis berikut, sebutkan malware family yang paling sesuai.\n\n{bullets}\n\nMalware family:",
]

def make_sample(fam):
    pool = FAMILIES[fam]["ind"]
    k = random.randint(3, min(5, len(pool)))
    picks = random.sample(pool, k)
    if random.random() < 0.35:
        picks.append(random.choice(GENERIC_NOISE))
    random.shuffle(picks)
    bullets = "\n".join(f"- {p}" for p in picks)
    tmpl = random.choice(INSTRUCTION_TEMPLATES)
    return {"instruction": tmpl.format(bullets=bullets), "output": fam}

def gen(n_per):
    rows = []
    for fam in FAMILIES:
        seen = set()
        made = 0
        tries = 0
        while made < n_per and tries < n_per * 40:
            tries += 1
            s = make_sample(fam)
            key = s["instruction"]
            if key in seen:
                continue
            seen.add(key); rows.append(s); made += 1
    random.shuffle(rows)
    return rows

def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # Build the full stratified pool first, THEN split per family -> held-out test
    # is separated BEFORE training and is disjoint from train.
    train = gen(TRAIN_PER_FAMILY)
    test = gen(TEST_PER_FAMILY)
    # Guarantee disjoint (regenerate test rows that collide with train instructions)
    train_keys = {r["instruction"] for r in train}
    test = [r for r in test if r["instruction"] not in train_keys]
    write_jsonl(os.path.join(OUT_DIR, "amal_train.jsonl"), train)
    write_jsonl(os.path.join(OUT_DIR, "amal_test.jsonl"), test)
    with open(os.path.join(OUT_DIR, "labels.json"), "w", encoding="utf-8") as f:
        json.dump({"families": list(FAMILIES.keys())}, f, ensure_ascii=False, indent=2)
    from collections import Counter
    ctr_tr = Counter(r["output"] for r in train)
    ctr_te = Counter(r["output"] for r in test)
    print(f"families: {len(FAMILIES)}")
    print(f"train: {len(train)} | test: {len(test)}")
    print("per-family (train/test):")
    for fam in FAMILIES:
        print(f"  {fam:12} {ctr_tr[fam]:4} / {ctr_te[fam]:3}")
    print("\nsample train row:")
    print(json.dumps(train[0], ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
