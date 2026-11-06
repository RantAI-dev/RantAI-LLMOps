#!/usr/bin/env python3
"""Make tests/fixtures/vision-dataset.zip: a small VALID image dataset (25 rows, 10 images) for the upload tests,
and, with --broken, the same ZIP with one image removed (the "broken ZIP" of the demo and the Phase 3 gate).

    python scripts/vlm/make_fixture_zip.py                      # (re)writes tests/fixtures/vision-dataset.zip
    python scripts/vlm/make_fixture_zip.py --broken out.zip     # one image removed: must be refused, in the browser and by the server

The images are generated with Pillow (a number drawn on a coloured tile), so nothing is downloaded.
"""

from __future__ import annotations

import argparse
import io
import json
import zipfile
from pathlib import Path

N_IMAGES = 10
N_ROWS = 25
_TIME = (2026, 1, 1, 0, 0, 0)
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "vision-dataset.zip"


def make_image_bytes(n: int) -> bytes:
    from PIL import Image, ImageDraw

    tile = Image.new("RGB", (96, 48), ((n * 37) % 200 + 40, (n * 91) % 200 + 40, (n * 53) % 200 + 40))
    ImageDraw.Draw(tile).text((8, 16), f"No. {n}", fill=(255, 255, 255))
    buf = io.BytesIO()
    tile.save(buf, format="PNG")
    return buf.getvalue()


def make_rows() -> list[dict]:
    rows = []
    for i in range(N_ROWS):
        n = i % N_IMAGES
        rows.append({
            "messages": [
                {"role": "system", "content": "Kamu membaca angka pada gambar."},
                {"role": "user", "content": [{"type": "image", "image": f"images/{n}.png"}, {"type": "text", "text": "Angka berapa yang tertulis di gambar ini?"}]},
                {"role": "assistant", "content": [{"type": "text", "text": str(n)}]},
            ]
        })
    return rows


def write_fixture(out: Path, drop: str | None = None) -> Path:
    """Write the fixture ZIP; `drop` (e.g. "images/3.png") leaves that image out of the archive."""
    out.parent.mkdir(parents=True, exist_ok=True)

    def add(z: zipfile.ZipFile, name: str, data: bytes, compress: int) -> None:
        info = zipfile.ZipInfo(name, date_time=_TIME)
        info.compress_type = compress
        info.external_attr = 0o644 << 16
        z.writestr(info, data)

    with zipfile.ZipFile(out, "w") as z:
        add(z, "train.jsonl", ("\n".join(json.dumps(r, ensure_ascii=False) for r in make_rows()) + "\n").encode("utf-8"), zipfile.ZIP_DEFLATED)
        for n in range(N_IMAGES):
            if drop == f"images/{n}.png":
                continue
            add(z, f"images/{n}.png", make_image_bytes(n), zipfile.ZIP_STORED)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--broken", metavar="OUT", help="write the broken variant (images/3.png missing) to OUT instead")
    ap.add_argument("--drop", default="images/3.png", help="which image the broken variant leaves out")
    args = ap.parse_args()
    if args.broken:
        print(write_fixture(Path(args.broken), drop=args.drop))
    else:
        print(write_fixture(DEFAULT_OUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
