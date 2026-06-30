#!/bin/bash
# Add a server-side chat `conversations` router to the vendored TL source,
# mirroring the existing `notes` router. Idempotent. Restart the TL backend after.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HOME/.transformerlab/src/transformerlab/routers/experiment"
EXPPY="$SRC/experiment.py"
[ -f "$EXPPY" ] || { echo "experiment.py not found at $EXPPY — is TL installed from source?"; exit 1; }
PY="${PY:-python3}"

echo "== copy conversations.py into source =="
cp "$HERE/conversations.py" "$SRC/conversations.py"

echo "== register the router in experiment.py =="
"$PY" - "$EXPPY" <<'PYEOF'
import io, sys
path = sys.argv[1]
src = io.open(path, "r", encoding="utf-8").read()
changed = False

# (a) add `conversations,` to the sub-router import tuple.
imp_old = "from transformerlab.routers.experiment import (\n    documents,\n"
imp_new = "from transformerlab.routers.experiment import (\n    conversations,\n    documents,\n"
if "    conversations,\n" not in src and imp_old in src:
    src = src.replace(imp_old, imp_new, 1); changed = True

# (b) include the router (mirror the notes block) — insert after the notes include.
if "router=conversations.router" not in src:
    anchor = (
        "router.include_router(\n"
        "    router=notes.router,\n"
        '    prefix="/{experimentId}",\n'
        '    tags=["notes"],\n'
        '    dependencies=[Depends(require_permission("experiment", "read", id_param="experimentId"))],\n'
        ")\n"
    )
    block = (
        anchor
        + "router.include_router(\n"
        "    router=conversations.router,\n"
        '    prefix="/{experimentId}",\n'
        '    tags=["conversations"],\n'
        '    dependencies=[Depends(require_permission("experiment", "read", id_param="experimentId"))],\n'
        ")\n"
    )
    if anchor in src:
        src = src.replace(anchor, block, 1); changed = True
    else:
        print("NOTES_INCLUDE_ANCHOR_NOT_FOUND (TL version changed?)"); sys.exit(1)

io.open(path, "w", encoding="utf-8").write(src)
print("PATCHED" if changed else "ALREADY_PATCHED")
PYEOF
echo "conversations router installed. Restart the TL backend for it to take effect."
