#!/usr/bin/env python3
"""Turn Hugging Face image datasets into ZIPs the "Add dataset -> Vision (images)" dialog accepts.

The ZIP format (docs/RENCANA-VLM.md section 3.1): `train.jsonl` (required), `eval.jsonl` (optional) and
`images/<index>.png`; one row is {"messages": [user (image + text), assistant (the answer)]}.

Outputs (written under --out, never into the repo):
  latex-ocr-train.zip   2000 random rows of unsloth/LaTeX_OCR `train` (seed 0) + eval.jsonl with 200 OTHER `train` rows
  latex-ocr-test.zip    300 random rows of LaTeX_OCR `test`   (held-out: never used for training; the VL eval set)
  chartqa-test.zip      300 random rows of HuggingFaceM4/ChartQA `test` (answer = first item of `label`; retention eval)

    pip install datasets pillow
    python scripts/vlm/make_demo_dataset.py --out ~/Downloads/vlm-demo
    python scripts/vlm/make_demo_dataset.py --only latex-test --n-test 100

The conversion and ZIP functions take any "dataset-like" (len() and item access that gives a dict with a PIL
`image`), so they are tested without the network (test_make_demo_dataset.py). Only `load_split` needs `datasets`.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import sys
import zipfile
from pathlib import Path
from typing import Callable, Iterable, Sequence

LATEX_PROMPT = "Tulis kode LaTeX untuk rumus di gambar ini. Jawab hanya dengan kodenya."
# ChartQA is scored on short answers; without this instruction models answer in sentences ("According to the
# chart, 34.6% ...") and every row scores wrong, base and fine-tune alike.
CHARTQA_SUFFIX = "\nAnswer with a single number or a short phrase only."
LATEX_DATASET = "unsloth/LaTeX_OCR"
CHARTQA_DATASET = "HuggingFaceM4/ChartQA"
OUTPUTS = ("latex-train", "latex-test", "chartqa-test")

# Fixed timestamp: the same input gives byte-identical ZIPs.
_ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def row_for(image_path: str, user_text: str, answer: str) -> dict:
    """One training row in the section 3.1 format."""
    return {
        "messages": [
            {"role": "user", "content": [{"type": "image", "image": image_path}, {"type": "text", "text": user_text}]},
            {"role": "assistant", "content": [{"type": "text", "text": answer}]},
        ]
    }


def pick_indices(total: int, n: int, seed: int) -> list[int]:
    """`n` distinct random indices of range(total), the same for the same seed (fewer when the dataset is smaller)."""
    return random.Random(seed).sample(range(total), min(n, total))


def image_bytes(image, fmt: str = "PNG", quality: int = 95) -> bytes:
    """Encode a PIL image. PNG keeps grayscale/RGB as they are; JPEG needs RGB."""
    buf = io.BytesIO()
    if fmt.upper() == "PNG":
        img = image if image.mode in ("L", "RGB", "RGBA") else image.convert("RGB")
        img.save(buf, format="PNG", optimize=True)
    else:
        image.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def latex_item(row: dict) -> tuple[str, str]:
    """(user text, answer) of a LaTeX_OCR row: a fixed prompt, and the dataset's `text` exactly as it is."""
    return LATEX_PROMPT, str(row["text"])


def chartqa_item(row: dict) -> tuple[str, str]:
    """(user text, answer) of a ChartQA row: the `query`, and the first item of `label` (a list in the dataset)."""
    label = row["label"]
    answer = label[0] if isinstance(label, (list, tuple)) else label
    return str(row["query"]).strip() + CHARTQA_SUFFIX, str(answer)


Item = Callable[[dict], "tuple[str, str]"]


def make_rows(dataset, indices: Sequence[int], item: Item, fmt: str = "PNG", quality: int = 95) -> "list[tuple[str, bytes, dict]]":
    """[(path inside the ZIP, image bytes, row)] for the chosen dataset indices; the image is `images/<index>.<ext>`."""
    ext = "png" if fmt.upper() == "PNG" else "jpg"
    out = []
    for i in indices:
        src = dataset[int(i)]
        user_text, answer = item(src)
        path = f"images/{int(i)}.{ext}"
        out.append((path, image_bytes(src["image"], fmt, quality), row_for(path, user_text, answer)))
    return out


def _jsonl(rows: Iterable[dict]) -> bytes:
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n").encode("utf-8")


def write_zip(out_path: str | os.PathLike, train: "list[tuple[str, bytes, dict]]", eval_: "list[tuple[str, bytes, dict]] | None" = None) -> dict:
    """Write train.jsonl, eval.jsonl (when given) and images/ into a ZIP; returns counts."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()

    def add(z: zipfile.ZipFile, name: str, data: bytes, compress: int) -> None:
        info = zipfile.ZipInfo(name, date_time=_ZIP_TIME)
        info.compress_type = compress
        info.external_attr = 0o644 << 16
        z.writestr(info, data)

    with zipfile.ZipFile(out_path, "w") as z:
        add(z, "train.jsonl", _jsonl(r for _, _, r in train), zipfile.ZIP_DEFLATED)
        if eval_:
            add(z, "eval.jsonl", _jsonl(r for _, _, r in eval_), zipfile.ZIP_DEFLATED)
        for path, data, _ in [*train, *(eval_ or [])]:
            if path in seen:
                raise ValueError(f"{path} would be written twice: train and eval must use different rows")
            seen.add(path)
            add(z, path, data, zipfile.ZIP_STORED)  # PNG / JPEG are already compressed
    return {"train": len(train), "eval": len(eval_ or []), "images": len(seen), "bytes": out_path.stat().st_size}


def check_zip(path: str | os.PathLike) -> None:
    """Validate the ZIP with the same validator the training job uses (trainers/unsloth-vision-train/vlm_schema.py)."""
    here = Path(__file__).resolve().parents[2] / "trainers" / "unsloth-vision-train"
    sys.path.insert(0, str(here))
    try:
        import vlm_schema  # type: ignore
    except ImportError:  # the script was copied out of the repo: nothing to check against
        return
    finally:
        sys.path.remove(str(here))
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for part, min_rows in (("train.jsonl", 20), ("eval.jsonl", 5)):
            if part not in names:
                continue
            report = vlm_schema.validate_jsonl_text(z.read(part).decode("utf-8"), image_exists=lambda p: p in names)
            problem = vlm_schema.dataset_problem(report, min_rows=min_rows, label=part)
            if problem or report["invalid"]:
                raise ValueError(f"{path}: {problem or report['problems'][:3]}")


def build_latex_train(dataset, out_path, n_train: int = 2000, n_eval: int = 200, seed: int = 0) -> dict:
    """`n_train` random train rows + `n_eval` other train rows as eval.jsonl."""
    picked = pick_indices(len(dataset), n_train + n_eval, seed)
    train_idx, eval_idx = picked[:n_train], picked[n_train:]
    return write_zip(out_path, make_rows(dataset, train_idx, latex_item), make_rows(dataset, eval_idx, latex_item) or None)


def build_latex_test(dataset, out_path, n_test: int = 300, seed: int = 0) -> dict:
    """`n_test` random rows of the `test` split (held out: no eval.jsonl, never trained on)."""
    return write_zip(out_path, make_rows(dataset, pick_indices(len(dataset), n_test, seed), latex_item))


def build_chartqa_test(dataset, out_path, n_test: int = 300, seed: int = 0) -> dict:
    """`n_test` random rows of the ChartQA `test` split; JPEG q95 (the charts are photos of plots, PNG would be huge)."""
    return write_zip(out_path, make_rows(dataset, pick_indices(len(dataset), n_test, seed), chartqa_item, fmt="JPEG", quality=95))


def load_split(name: str, split: str):
    """The Hugging Face dataset split (needs `pip install datasets pillow`; downloads once into the HF cache)."""
    try:
        from datasets import load_dataset
    except ImportError as err:  # pragma: no cover - environment
        raise SystemExit("This needs the `datasets` and `pillow` packages: pip install datasets pillow") from err
    return load_dataset(name, split=split)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="vlm-demo", help="folder for the ZIPs (default: ./vlm-demo; keep it outside the repo)")
    ap.add_argument("--only", action="append", choices=OUTPUTS, help="build just this ZIP (repeat for several); default: all three")
    ap.add_argument("--n-train", type=int, default=2000, help="rows in latex-ocr-train.zip (default 2000)")
    ap.add_argument("--n-eval", type=int, default=200, help="rows of its eval.jsonl, other train rows (default 200)")
    ap.add_argument("--n-test", type=int, default=300, help="rows in each test ZIP (default 300)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--latex-dataset", default=LATEX_DATASET)
    ap.add_argument("--chartqa-dataset", default=CHARTQA_DATASET)
    args = ap.parse_args(argv)
    wanted = args.only or list(OUTPUTS)
    out = Path(args.out)

    jobs = {
        "latex-train": ("latex-ocr-train.zip", lambda p: build_latex_train(load_split(args.latex_dataset, "train"), p, args.n_train, args.n_eval, args.seed)),
        "latex-test": ("latex-ocr-test.zip", lambda p: build_latex_test(load_split(args.latex_dataset, "test"), p, args.n_test, args.seed)),
        "chartqa-test": ("chartqa-test.zip", lambda p: build_chartqa_test(load_split(args.chartqa_dataset, "test"), p, args.n_test, args.seed)),
    }
    for key in wanted:
        name, build = jobs[key]
        path = out / name
        print(f"{key}: building {path} ...", flush=True)
        info = build(path)
        check_zip(path)
        print(f"{key}: {info['train']} train rows, {info['eval']} eval rows, {info['images']} images, {info['bytes'] / 1e6:.1f} MB", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
