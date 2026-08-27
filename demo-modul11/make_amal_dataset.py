#!/usr/bin/env python3
"""
AMAL — dataset klasifikasi malware family (v4, "static-feature, NO leakage").

Diselaraskan dengan modul "Konstruksi Dataset": tiap sampel = STATIC FEATURE
RECORD hasil analisis statis PE (sha256, imports/IAT, sections + entropy,
max_section_entropy, YARA matches, strings) -> label malware family.

PERBEDAAN vs v3: menghapus LABEL LEAKAGE. Di v3 nama YARA (mis. "Emotet_Loader")
dan sebagian string (".wncry", "RyukReadMe.txt") memuat nama family, sehingga
model tinggal menyalin -> akurasi 100% (menipu). Di v4:
  - YARA diganti KATEGORI PERILAKU yang DIPAKAI BERSAMA beberapa family
    (Ransomware_FileCrypto, Process_Injection, DotNet_Obfuscation, ...).
  - String yang mengeja family dibuang; diganti indikator perilaku generik
    (path registry, pola C2, ekstensi netral).
  - Instruksi mencantumkan DAFTAR KANDIDAT family (closed-set) supaya
    perbandingan base adil dan bukan tebak-tebakan label space.
Akibatnya model WAJIB menggabungkan sinyal imports+entropy+kategori yara ->
akurasi realistis ~90-95% dengan confusion antar family mirip
(WannaCry<->Ryuk ransomware, AgentTesla<->RedLine .NET stealer,
Emotet<->TrickBot<->Zeus loader/banker).

8 family, semua Windows PE. LLMOps trainer melatih pasangan instruction->output
(kolom `input` diabaikan), jadi feature record ditempel DI DALAM `instruction`.
"""
import json, random, os
from collections import Counter

SEED = 3407
random.seed(SEED)
OUT_DIR = os.path.join(os.path.dirname(__file__), "data")
TRAIN_PER_FAMILY = 180
TEST_PER_FAMILY = 45

# Per-family static signatures. TIDAK ada nama family di fitur manapun.
# Pembeda datang dari KOMBINASI imports + string perilaku + kategori yara + entropy.
FAMILIES = {
    "Emotet": {  # downloader / loader
        "imports": ["URLDownloadToFileW", "WinHttpConnect", "WinHttpSendRequest", "CreateProcessA", "RegSetValueExA", "CryptStringToBinaryA", "ShellExecuteA"],
        "strings": ["Mozilla/5.0", "POST /gate.php", "Content-Type: application/x-www-form-urlencoded", "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", "%s\\%s.exe"],
        "yara": ["Downloader_Behavior", "Packed_Section_HighEntropy"],
        "ent": 7.1,
    },
    "TrickBot": {  # process injector / modular banker
        "imports": ["VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread", "NtUnmapViewOfSection", "HttpSendRequestA", "CreateProcessW"],
        "strings": ["ModuleConfig", "\\Windows\\rundll32.exe", "POST /req.php", "system32\\svchost.exe", "group_tag"],
        "yara": ["Process_Injection", "Modular_Config"],
        "ent": 7.0,
    },
    "WannaCry": {  # ransomware + SMB worm
        "imports": ["CryptEncrypt", "CryptGenKey", "CryptAcquireContextA", "MoveFileExA", "WNetOpenEnumW", "InternetOpenA", "InternetOpenUrlA"],
        "strings": ["cmd.exe /c vssadmin", "icacls . /grant Everyone:F", "taskdl.exe", "SystemDrive", "%s\\%s"],
        "yara": ["Ransomware_FileCrypto", "Network_Spread_SMB", "Packed_Section_HighEntropy"],
        "ent": 7.4,
    },
    "Conficker": {  # network worm
        "imports": ["NetServerEnum", "WNetAddConnection2W", "CreateServiceA", "GetSystemDirectoryA", "LoadLibraryA", "GetAdaptersInfo"],
        "strings": ["autorun.inf", "\\\\%s\\IPC$", "RECYCLER", "rundll32.exe %s,%s", "%d.%d.%d.%d"],
        "yara": ["Network_Spread_SMB", "Service_Persistence"],
        "ent": 6.7,
    },
    "AgentTesla": {  # .NET keylogger / stealer
        "imports": ["mscoree.dll:_CorExeMain", "GetAsyncKeyState", "SetWindowsHookExA", "GetClipboardData", "GetForegroundWindow"],
        "strings": ["smtp.", "System.Net.Mail", "MailMessage", "[ENTER]", "[CTRL]"],
        "yara": ["DotNet_Obfuscation", "Keylogger_Behavior", "Credential_Harvest"],
        "ent": 7.3,
    },
    "Ryuk": {  # targeted ransomware (no worm)
        "imports": ["CryptEncrypt", "CryptGenKey", "CryptAcquireContextW", "DeleteFileA", "WNetEnumResourceW", "CreateProcessA"],
        "strings": ["cmd.exe /c vssadmin delete shadows /all /quiet", "net stop", "bcdedit /set {default}", "\\users\\public\\", "%s.locked"],
        "yara": ["Ransomware_FileCrypto", "ShadowCopy_Deletion"],
        "ent": 7.5,
    },
    "Zeus": {  # native banking trojan (webinject)
        "imports": ["InternetReadFile", "HttpOpenRequestA", "HttpSendRequestA", "RegCreateKeyExA", "CryptDecrypt", "CreateProcessW"],
        "strings": ["POST %s HTTP/1.1", "config.bin", "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", "%BOTID%", "*.dll"],
        "yara": ["Banker_WebInject", "Config_Decrypt"],
        "ent": 6.9,
    },
    "RedLine": {  # .NET infostealer (browser/wallet)
        "imports": ["mscoree.dll:_CorExeMain", "InternetOpenA", "GetLogicalDrives", "RegOpenKeyExA", "FindFirstFileA", "GetUserNameA"],
        "strings": ["\\AppData\\Local\\", "logins.json", "cookies.sqlite", "\\Wallets\\", "SELECT * FROM"],
        "yara": ["DotNet_Obfuscation", "Credential_Harvest", "Browser_Data_Access"],
        "ent": 7.2,
    },
}

SHARED_IMPORTS = ["LoadLibraryA", "GetProcAddress", "CreateFileA", "VirtualAlloc", "Sleep", "GetModuleHandleA", "WriteFile", "CloseHandle", "GetTickCount"]
SHARED_STRINGS = ["kernel32.dll", "This program cannot be run in DOS mode", "advapi32.dll", "GetLastError", "ntdll.dll"]
SHARED_YARA = ["Suspicious_API_Combo", "Generic_Packer"]

# family mirip -> ~12% sampel disisipi satu import khas tetangga (confusion realistis)
CONFUSABLE = {
    "Emotet": ["TrickBot", "Zeus"], "TrickBot": ["Emotet", "Zeus"],
    "WannaCry": ["Ryuk"], "Ryuk": ["WannaCry"],
    "AgentTesla": ["RedLine"], "RedLine": ["AgentTesla", "Zeus"],
    "Zeus": ["Emotet", "RedLine"], "Conficker": ["WannaCry"],
}

LABELS = list(FAMILIES.keys())
SECTION_NAMES = [".text", ".rdata", ".data", ".rsrc", ".reloc"]

def rand_sha256():
    return "".join(random.choice("0123456789abcdef") for _ in range(64))

def make_sections(max_ent):
    n = random.randint(3, 5)
    names = [".text"] + random.sample([s for s in SECTION_NAMES if s != ".text"], n - 1)
    secs = []
    hi_idx = random.randrange(n)
    for i, nm in enumerate(names):
        e = round(max_ent + random.uniform(-0.15, 0.05), 2) if i == hi_idx else round(random.uniform(4.8, 6.4), 2)
        secs.append((nm, e))
    return secs, max(e for _, e in secs)

def make_sample(fam):
    sig = FAMILIES[fam]
    imports = random.sample(sig["imports"], random.randint(2, min(4, len(sig["imports"]))))
    imports += random.sample(SHARED_IMPORTS, random.randint(1, 3))
    strings = random.sample(sig["strings"], random.randint(1, min(3, len(sig["strings"]))))
    strings += random.sample(SHARED_STRINGS, random.randint(1, 2))
    yara = list(sig["yara"]) if random.random() < 0.85 else random.sample(sig["yara"], 1)
    if random.random() < 0.35:
        yara.append(random.choice(SHARED_YARA))
    ent = sig["ent"] + random.uniform(-0.3, 0.2)
    if CONFUSABLE[fam] and random.random() < 0.12:
        other = random.choice(CONFUSABLE[fam])
        imports.append(random.choice(FAMILIES[other]["imports"]))
    # dedup + acak urutan
    imports = list(dict.fromkeys(imports)); strings = list(dict.fromkeys(strings)); yara = list(dict.fromkeys(yara))
    random.shuffle(imports); random.shuffle(strings); random.shuffle(yara)
    secs, maxent = make_sections(ent)
    rec = []
    rec.append(f"sha256: {rand_sha256()}")
    rec.append(f"imports: {', '.join(imports)}")
    rec.append("sections:")
    for nm, e in secs:
        rec.append(f"  - {nm}  entropy={e}")
    rec.append(f"max_section_entropy: {round(maxent,2)}")
    rec.append(f"yara_matches: {', '.join(yara) if yara else '(none)'}")
    rec.append(f"strings: {', '.join(repr(s) for s in strings)}")
    body = "\n".join(rec)
    instr = (
        "Tentukan malware family dari fitur analisis statis PE berikut. "
        f"Pilih salah satu dari: {', '.join(LABELS)}. "
        "Jawab hanya dengan nama family.\n\n" + body + "\n\nFamily:"
    )
    return {"instruction": instr, "output": fam}

def gen(n_per):
    rows = []
    for fam in FAMILIES:
        seen, made, tries = set(), 0, 0
        while made < n_per and tries < n_per * 120:
            tries += 1
            s = make_sample(fam)
            if s["instruction"] in seen:
                continue
            seen.add(s["instruction"]); rows.append(s); made += 1
    random.shuffle(rows)
    return rows

def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    train, test = gen(TRAIN_PER_FAMILY), gen(TEST_PER_FAMILY)
    tk = {r["instruction"] for r in train}
    test = [r for r in test if r["instruction"] not in tk]
    write_jsonl(os.path.join(OUT_DIR, "amal_train.jsonl"), train)
    write_jsonl(os.path.join(OUT_DIR, "amal_test.jsonl"), test)
    json.dump({"families": LABELS}, open(os.path.join(OUT_DIR, "labels.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"families: {len(FAMILIES)} | train: {len(train)} | test: {len(test)}")
    print("per-family train:", dict(Counter(r["output"] for r in train)))
    print("\n=== SAMPLE ROW ===")
    print(train[0]["instruction"])
    print("-> OUTPUT:", train[0]["output"])

if __name__ == "__main__":
    main()
