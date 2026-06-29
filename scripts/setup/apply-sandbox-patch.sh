#!/bin/bash
# Patch Transformer Lab's local-provider sandbox for WSL2.
#
# Problem: each provider job runs inside bubblewrap (bwrap). On WSL2,
# /etc/resolv.conf is a symlink into the /mnt/wsl submount, which `--ro-bind / /`
# doesn't include — so bwrap fails with "Can't create file at /etc/resolv.conf"
# and every job FAILS. This binds the /mnt/wsl submount and skips the broken
# resolv override on WSL. Idempotent.
set -e
SB="$HOME/.transformerlab/src/transformerlab/compute_providers/sandbox.py"
[ -f "$SB" ] || { echo "sandbox.py not found at $SB — is TL installed from source?"; exit 1; }
PY="${PY:-python3}"

"$PY" - "$SB" <<'PYEOF'
import io, sys
path = sys.argv[1]
src = io.open(path, "r", encoding="utf-8").read()
changed = False

# (a) bind the /mnt/wsl submount so the resolv.conf symlink resolves.
if "NQR_WSL_RESOLV_PATCH" not in src:
    anchor = "    # DNS resolution fix: /etc/resolv.conf is often a symlink into a systemd"
    if anchor not in src:
        print("ANCHOR_A_NOT_FOUND (TL version changed?)"); sys.exit(1)
    insert = (
        "    # NQR_WSL_RESOLV_PATCH: bind /mnt/wsl so the WSL resolv.conf symlink resolves.\n"
        "    _resolv_tgt = os.path.realpath(\"/etc/resolv.conf\")\n"
        "    if _resolv_tgt.startswith(\"/mnt/wsl/\") and os.path.isdir(\"/mnt/wsl\"):\n"
        "        args += [\"--ro-bind\", \"/mnt/wsl\", \"/mnt/wsl\"]\n\n"
    )
    src = src.replace(anchor, insert + anchor, 1); changed = True

# (b) skip the explicit /etc/resolv.conf override on WSL (it fails there).
old = (
    '    resolv_real = os.path.realpath("/etc/resolv.conf")\n'
    "    if os.path.isfile(resolv_real):\n"
)
new = (
    '    resolv_real = os.path.realpath("/etc/resolv.conf")\n'
    "    # NQR_WSL_RESOLV_PATCH (b): skip the override on WSL (/mnt/wsl, read-only).\n"
    '    if os.path.isfile(resolv_real) and not resolv_real.startswith("/mnt/wsl/"):\n'
)
if "NQR_WSL_RESOLV_PATCH (b)" not in src and old in src:
    src = src.replace(old, new, 1); changed = True

io.open(path, "w", encoding="utf-8").write(src)
print("PATCHED" if changed else "ALREADY_PATCHED")
PYEOF
echo "sandbox.py patched. Restart the TL backend for it to take effect."
