"""Dataset loading for the vision trainer. Deliberately free of unsloth / torch / datasets imports at module
level (Pillow, s3fs and `datasets` are imported inside the functions that need them), so everything here is
unit-tested on a CPU box without the training stack (test_vlm_data.py).

What it does, in the order train.py uses it:

  resolve_dataset(spec)      -> WHERE the data is: a local folder (a UI upload lands in the Transformer Lab
                                workspace), an s3://bucket/prefix/ pulled recursively with its images/, or a
                                Hugging Face dataset id.
  load_rows(path, ...)       -> JSONL rows, validated with vlm_schema (the same rules the upload form applied).
                                More invalid rows than the schema tolerates is an error, never silently skipped.
  to_unsloth_messages(row)   -> a row as Unsloth / TRL conversational messages: every content a list of parts,
                                the `image_url` alias normalised, relative image paths resolved against the
                                dataset folder (".." and absolute paths refused), images loaded when asked.
  VlmDataset                 -> a map-style dataset whose __getitem__ decodes the images of ONE row. Nothing is
                                decoded up front: 2000 rows never sit in memory as PIL images.
  hf_row_to_messages(row)    -> the same messages from a Hugging Face row (an Image column + prompt/answer
                                columns, or a `messages` column).
  build_datasets(spec, ...)  -> all of the above, plus the train / eval split (eval.jsonl, else a seeded 10 %
                                hold-out when there are at least 20 rows).

Failure policy: a bad image, a missing file, a malformed row raises DatasetError naming the row. A vision job
that "succeeds" having trained on half of its data is worse than one that stops.
"""

from __future__ import annotations

import glob
import io
import json
import math
import os
import random
import re
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from vlm_schema import (
    IMAGE_EXTENSIONS,
    MAX_IMAGES_PER_ROW,
    MAX_INVALID_RATIO,
    MIN_ROWS,
    dataset_problem,
    is_public_https_url,
    normalize_image_path,
    validate_row,
    validate_rows,
)

SPLIT_SEED = 3407
HOLDOUT_FRACTION = 0.1
HOLDOUT_MIN_ROWS = 20  # fewer rows than this and everything trains (no eval loss)
DEFAULT_MAX_PIXELS = 1003520  # about 1024 x 1024
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
DOWNLOAD_TIMEOUT_S = 20

_IMAGE_EXT_RE = re.compile(r"\.(" + "|".join(IMAGE_EXTENSIONS) + r")$", re.IGNORECASE)
_HF_ID_RE = re.compile(r"^[\w.-]+/[\w.-]+$")


class DatasetError(RuntimeError):
    """The dataset cannot be trained on (missing file, invalid rows, unreadable image, ...)."""


def _noop_log(_msg: str) -> None:  # pragma: no cover - trivial
    pass


# ─────────────────────────────────── where the data is ───────────────────────────────────


@dataclass
class ResolvedDataset:
    """kind "local": `base_dir` holds `train_file` (+ `eval_file`) and the images those rows point at.
    kind "hf": `hf_id` is a Hugging Face dataset id."""

    kind: str
    description: str
    base_dir: Optional[str] = None
    train_file: Optional[str] = None
    eval_file: Optional[str] = None
    hf_id: Optional[str] = None


def pick_split_file(directory: str, kind: str) -> Optional[str]:
    """`<kind>.jsonl`, else the `*_<kind>.jsonl` a Transformer Lab upload leaves behind (it prefixes the
    files it stores with the dataset id)."""
    exact = os.path.join(directory, f"{kind}.jsonl")
    if os.path.isfile(exact):
        return exact
    suffixed = sorted(f for f in os.listdir(directory) if f.endswith(f"_{kind}.jsonl"))
    return os.path.join(directory, suffixed[0]) if suffixed else None


def upload_roots(here: Optional[str] = None) -> list:
    """Where a dataset uploaded through the LLMOps UI can live. A job runs with HOME pointed at its own
    sandbox, so `~/.transformerlab` holds nothing: look at the env var the provider may set, the run
    directory's own ancestor, then the conventional /root location (same search as unsloth-llm-train)."""
    roots: list = []
    workspace = os.getenv("_TFL_WORKSPACE_DIR") or ""
    if workspace:
        roots.append(os.path.join(workspace, "datasets"))
    here = os.path.abspath(here or __file__)
    marker = "/local_provider/local_provider_runs/"
    if marker in here:
        roots += sorted(glob.glob(os.path.join(here.split(marker, 1)[0], "orgs/*/workspace/datasets")))
    for base in ("/root/.transformerlab", os.path.expanduser("~/.transformerlab")):
        roots += sorted(glob.glob(os.path.join(base, "orgs/*/workspace/datasets")))
    seen: set = set()
    return [r for r in roots if not (r in seen or seen.add(r))]


def _local_dir_dataset(directory: str, log: Callable[[str], None]) -> ResolvedDataset:
    train = pick_split_file(directory, "train")
    if not train:
        raise DatasetError(f"Directory dataset {directory!r} has no train.jsonl or *_train.jsonl")
    ev = pick_split_file(directory, "eval")
    log(f"Dataset source: local directory {directory} (train={os.path.basename(train)}, eval={os.path.basename(ev) if ev else 'none'})")
    return ResolvedDataset("local", f"local directory {directory}", base_dir=directory, train_file=train, eval_file=ev)


def default_s3_fs():  # pragma: no cover - needs s3fs and a bucket
    try:
        import s3fs
    except ImportError as e:
        raise DatasetError("An s3:// dataset needs the `s3fs` package: add it to the trainer setup.") from e
    endpoint = os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL")
    return s3fs.S3FileSystem(client_kwargs={"endpoint_url": endpoint} if endpoint else {})


def pull_s3_prefix(fs, prefix: str, dest_dir: str, log: Callable[[str], None] = _noop_log) -> int:
    """Copy EVERY object under `s3://bucket/prefix/` into `dest_dir`, keeping the relative layout (so the
    rows' `images/x.jpg` resolves). Returns the number of files. Equivalent to
    `fs.get(prefix, dest, recursive=True)`, but explicit about the destination of each key and refuses a key
    that would land outside `dest_dir`."""
    if not prefix.endswith("/"):
        prefix += "/"
    root = prefix[len("s3://"):]
    keys = [k for k in fs.find(root) if not k.endswith("/")]
    if not keys:
        raise DatasetError(f"No objects found under {prefix}")
    dest_root = os.path.realpath(dest_dir)
    dests: list = []
    for k in keys:
        rel = k[len(root):] if k.startswith(root) else os.path.basename(k)
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if not parts or ".." in parts:
            raise DatasetError(f"Refusing S3 key with an unsafe relative path: {k!r}")
        dest = os.path.join(dest_root, *parts)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        dests.append(dest)
    log(f"Pulling {len(keys)} object(s) from {prefix} -> {dest_root}")
    fs.get(keys, dests)  # fsspec batches a list pair concurrently
    return len(keys)


def resolve_dataset(
    spec: str,
    *,
    workdir: Optional[str] = None,
    log: Callable[[str], None] = _noop_log,
    s3_fs_factory: Callable[[], Any] = None,
    roots: Optional[list] = None,
) -> ResolvedDataset:
    """Find the dataset named by `spec`:

      - `s3://bucket/prefix/`      pulled recursively (train.jsonl, eval.jsonl AND images/). An s3://.../x.jsonl
                                   file means the folder that holds it.
      - a directory                train.jsonl / *_train.jsonl (+ eval) with images/ next to them
      - a *.jsonl file             its folder is the image root
      - a bare workspace name      a dataset uploaded through the UI (Transformer Lab `datasets/<name>`)
      - owner/name                 a Hugging Face dataset id (needs an Image column; see HfOptions)
    """
    spec = (spec or "").strip()
    if not spec:
        raise DatasetError("No dataset given.")
    workdir = os.path.abspath(workdir or "_dataset")

    if spec.startswith("s3://"):
        prefix = spec
        if prefix.lower().endswith(".jsonl"):
            prefix = prefix.rsplit("/", 1)[0] + "/"
        if not prefix.endswith("/"):
            prefix += "/"
        fs = (s3_fs_factory or default_s3_fs)()
        os.makedirs(workdir, exist_ok=True)
        pull_s3_prefix(fs, prefix, workdir, log)
        endpoint = os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL") or "default endpoint"
        log(f"Dataset source: S3 ({endpoint}) {prefix}")
        resolved = _local_dir_dataset(workdir, lambda _m: None)
        resolved.description = f"S3 {prefix}"
        return resolved

    if spec.startswith("http://") or spec.startswith("https://"):
        raise DatasetError(
            "An http(s) URL cannot carry the images of a vision dataset. Put the dataset in S3 "
            "(s3://bucket/prefix/ with train.jsonl and images/) or upload it through the Datasets page."
        )

    if os.path.isdir(spec):
        return _local_dir_dataset(os.path.abspath(spec), log)

    if os.path.isfile(spec):
        log(f"Dataset source: local file {spec}")
        return ResolvedDataset("local", f"local file {spec}", base_dir=os.path.dirname(os.path.abspath(spec)), train_file=os.path.abspath(spec))

    if "/" not in spec:
        # A bare name is a dataset uploaded through the UI: it lands in the workspace `datasets/<name>`.
        searched = roots if roots is not None else upload_roots()
        for root in searched:
            candidate = os.path.join(root, spec)
            if os.path.isdir(candidate):
                return _local_dir_dataset(candidate, log)
        log(f"No uploaded dataset matched {spec!r}; searched {searched}")

    if _HF_ID_RE.match(spec) or "/" not in spec:
        log(f"Dataset source: Hugging Face Hub ({spec})")
        return ResolvedDataset("hf", f"Hugging Face {spec}", hf_id=spec)

    raise DatasetError(f"Dataset {spec!r} was not found (not a folder, an s3:// prefix, an upload or a Hugging Face id).")


# ───────────────────────────────────── JSONL rows ─────────────────────────────────────


def read_jsonl(path: str) -> list:
    """Non-blank lines as dicts. A line that is not valid JSON stays a raw string: vlm_schema counts it as an
    invalid row (the same 2 % rule the upload form used) instead of failing the job on one line."""
    rows: list = []
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                rows.append(line)
    return rows


def resolve_image_path(ref: str, base_dir: str) -> str:
    """Absolute path of a relative image reference, refusing anything that could leave `base_dir`:
    absolute paths, "..", backslashes, wrong extensions, and symlinks pointing outside the dataset."""
    if not isinstance(ref, str) or not ref.strip():
        raise ValueError("empty image path")
    if ref.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", ref):
        raise ValueError(f"absolute image path not allowed: {ref!r}")
    if "\0" in ref or "\\" in ref:
        raise ValueError(f"invalid characters in image path: {ref!r}")
    rel = normalize_image_path(ref)
    segments = rel.split("/")
    if any(s in ("", ".", "..") for s in segments):
        raise ValueError(f"image path must not contain '..' or empty segments: {ref!r}")
    if not _IMAGE_EXT_RE.search(rel):
        raise ValueError(f"image path must end in one of {', '.join(IMAGE_EXTENSIONS)}: {ref!r}")
    root = os.path.realpath(base_dir)
    full = os.path.realpath(os.path.join(root, *segments))
    if full != root and not full.startswith(root + os.sep):
        raise ValueError(f"image path escapes the dataset folder: {ref!r}")
    return full


def make_image_exists(base_dir: str) -> Callable[[str], bool]:
    """`image_exists` for vlm_schema: a relative path counts when it is a file inside `base_dir`."""

    def exists(rel: str) -> bool:
        try:
            return os.path.isfile(resolve_image_path(rel, base_dir))
        except ValueError:
            return False

    return exists


@dataclass
class LoadedRows:
    rows: list  # valid rows only
    report: dict  # vlm_schema.validate_rows over ALL rows
    path: str
    dropped: int = 0


def load_rows(
    path: str,
    base_dir: Optional[str] = None,
    *,
    min_rows: int = MIN_ROWS,
    max_invalid_ratio: float = MAX_INVALID_RATIO,
    max_images: int = MAX_IMAGES_PER_ROW,
    label: str = "dataset",
) -> LoadedRows:
    """Read + validate one JSONL file. Raises DatasetError (with the first reasons) when
    `vlm_schema.dataset_problem` is non-empty; otherwise returns the valid rows (a few invalid ones, within
    the tolerated ratio, are dropped and counted)."""
    if not os.path.isfile(path):
        raise DatasetError(f"{label} file not found: {path}")
    base_dir = base_dir or os.path.dirname(os.path.abspath(path))
    raw = read_jsonl(path)
    exists = make_image_exists(base_dir)
    report = validate_rows(raw, image_exists=exists, max_images=max_images)
    problem = dataset_problem(report, min_rows=min_rows, max_invalid_ratio=max_invalid_ratio, label=label)
    if problem:
        raise DatasetError(problem)
    valid = [r for r in raw if isinstance(r, dict) and validate_row(r, exists, max_images)[0]]
    return LoadedRows(rows=valid, report=report, path=path, dropped=report["invalid"])


# ───────────────────────────────────── images ─────────────────────────────────────


def shrink_to_pixels(img, max_pixels: Optional[int]):
    """Downscale (never upscale) so width*height <= max_pixels, keeping the aspect ratio."""
    if not max_pixels or max_pixels <= 0:
        return img
    w, h = img.size
    if w * h <= max_pixels:
        return img
    from PIL import Image

    scale = math.sqrt(max_pixels / float(w * h))
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    if nw * nh > max_pixels:  # a clamped 1-pixel side can overshoot a tiny budget
        nw, nh = (max(1, max_pixels // nh), nh) if nw >= nh else (nw, max(1, max_pixels // nw))
    return img.resize((nw, nh), Image.LANCZOS)


def to_rgb(img):
    """RGB, with transparency composited on white (a plain convert("RGB") turns transparent pixels black,
    which makes a transparent-background formula or chart unreadable)."""
    from PIL import Image

    if img.mode == "P":
        img = img.convert("RGBA")
    if img.mode in ("RGBA", "LA"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.getchannel("A"))
        return bg
    return img.convert("RGB")


def download_bytes(url: str, *, timeout: float = DOWNLOAD_TIMEOUT_S, max_bytes: int = MAX_DOWNLOAD_BYTES, opener=None) -> bytes:
    """GET a public https image with a timeout and a hard size cap (never reads past max_bytes + 1)."""
    if not is_public_https_url(url):
        raise ValueError(f"refusing to download {url!r}: not an https URL on a public host")
    open_fn = opener or urllib.request.urlopen
    with open_fn(url, timeout=timeout) as resp:
        length = resp.headers.get("Content-Length") if getattr(resp, "headers", None) else None
        if length and length.isdigit() and int(length) > max_bytes:
            raise ValueError(f"{url} is {length} bytes, over the {max_bytes} byte limit")
        data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"{url} is larger than the {max_bytes} byte limit")
    return data


def _s3_bytes(ref: str, s3_fs=None) -> bytes:  # pragma: no cover - needs s3fs
    fs = s3_fs or default_s3_fs()
    with fs.open(ref[len("s3://"):], "rb") as f:
        return f.read(MAX_DOWNLOAD_BYTES + 1)


def _decode(data_or_path, max_pixels: Optional[int]):
    from PIL import Image, ImageOps

    src = io.BytesIO(data_or_path) if isinstance(data_or_path, (bytes, bytearray)) else data_or_path
    with Image.open(src) as im:
        im.load()
        im = ImageOps.exif_transpose(im)
        out = to_rgb(im)
    return shrink_to_pixels(out, max_pixels)


def load_image(ref, *, base_dir: Optional[str] = None, max_pixels: Optional[int] = None, s3_fs=None, opener=None):
    """One image as an RGB PIL image no larger than `max_pixels`. `ref` is a relative path (needs
    `base_dir`), an https URL, an s3:// URI, a PIL image, or an HF `{"bytes": ..., "path": ...}` dict."""
    from PIL import Image

    if isinstance(ref, Image.Image):
        return shrink_to_pixels(to_rgb(ref), max_pixels)
    if isinstance(ref, dict):  # an undecoded Hugging Face Image value
        if ref.get("bytes"):
            return _decode(ref["bytes"], max_pixels)
        if ref.get("path"):
            return load_image(ref["path"], base_dir=base_dir, max_pixels=max_pixels, s3_fs=s3_fs, opener=opener)
        raise ValueError("image value has neither bytes nor a path")
    if not isinstance(ref, str):
        raise ValueError(f"unsupported image value of type {type(ref).__name__}")
    low = ref.lower()
    if low.startswith("https://"):
        return _decode(download_bytes(ref, opener=opener), max_pixels)
    if low.startswith("s3://"):
        return _decode(_s3_bytes(ref, s3_fs), max_pixels)
    if not base_dir:
        raise ValueError(f"cannot resolve relative image path {ref!r} without a dataset folder")
    return _decode(resolve_image_path(ref, base_dir), max_pixels)


# ───────────────────────────── rows -> Unsloth messages ─────────────────────────────


def image_ref_of(part: dict):
    """The image reference of a part ({"type":"image","image":x} or the OpenAI {"type":"image_url"} alias);
    None when the part is not an image part."""
    t = part.get("type")
    if t == "image":
        return part.get("image")
    if t == "image_url":
        iu = part.get("image_url")
        return iu.get("url") if isinstance(iu, dict) else iu
    return None


def is_image_part(part: Any) -> bool:
    return isinstance(part, dict) and part.get("type") in ("image", "image_url")


def to_unsloth_messages(
    row: dict,
    base_dir: Optional[str] = None,
    max_pixels: Optional[int] = None,
    *,
    load_images: bool = True,
    s3_fs=None,
    opener=None,
) -> list:
    """The row's messages in Unsloth's conversational format, every `content` a list of parts:

        {"role": "user", "content": [{"type": "text", "text": ...}, {"type": "image", "image": <PIL>}]}

    With `load_images=False` the image part holds the resolved absolute path (or URL) instead of a PIL image,
    which is what the length audit and tests use when they only need the structure."""
    messages = row.get("messages")
    if isinstance(messages, str):
        messages = json.loads(messages)
    if not isinstance(messages, list) or not messages:
        raise DatasetError("row has no messages")
    out: list = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        parts: list = []
        if isinstance(content, str):
            parts.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for p in content:
                if is_image_part(p):
                    ref = image_ref_of(p)
                    if load_images:
                        img = load_image(ref, base_dir=base_dir, max_pixels=max_pixels, s3_fs=s3_fs, opener=opener)
                    elif isinstance(ref, str) and not re.match(r"^(https|s3)://", ref, re.IGNORECASE):
                        img = resolve_image_path(ref, base_dir or "")
                    else:
                        img = ref
                    parts.append({"type": "image", "image": img})
                elif isinstance(p, dict) and p.get("type") == "text":
                    parts.append({"type": "text", "text": p.get("text", "")})
                else:
                    raise DatasetError(f"unsupported content part: {p!r}")
        else:
            raise DatasetError(f"message content must be a string or a list, got {type(content).__name__}")
        out.append({"role": role, "content": parts})
    return out


def count_images(messages: list) -> int:
    return sum(1 for m in messages for p in m["content"] if p.get("type") == "image")


# ─────────────────────────────────── datasets ───────────────────────────────────


class VlmDataset:
    """Map-style dataset: `ds[i]` is `{"messages": [...]}` with the images of row i decoded on demand.

    `rows` is any indexable (a list of dicts, or a Hugging Face Dataset whose Image column decodes per
    access); `to_messages(raw_row)` builds the messages. A failure names the row, so "row 1873: ... not
    found" is what the log shows, not a bare traceback from inside a DataLoader worker."""

    def __init__(self, rows, to_messages: Callable[[Any], list], name: str = "train", indices: Optional[list] = None):
        self._rows = rows
        self._to_messages = to_messages
        self.name = name
        self._indices = list(indices) if indices is not None else None

    def __len__(self) -> int:
        return len(self._indices) if self._indices is not None else len(self._rows)

    def _raw_index(self, i: int) -> int:
        n = len(self)
        if i < 0:
            i += n
        if i < 0 or i >= n:
            raise IndexError(i)
        return self._indices[i] if self._indices is not None else i

    def raw(self, i: int):
        return self._rows[self._raw_index(i)]

    def __getitem__(self, i: int) -> dict:
        j = self._raw_index(i)
        try:
            return {"messages": self._to_messages(self._rows[j])}
        except DatasetError:
            raise
        except Exception as e:
            raise DatasetError(f"{self.name} row {j}: {type(e).__name__}: {e}") from e

    def __iter__(self):
        for i in range(len(self)):
            yield self[i]

    def subset(self, indices, name: Optional[str] = None) -> "VlmDataset":
        base = [self._raw_index(i) for i in indices]
        return VlmDataset(self._rows, self._to_messages, name or self.name, base)


def as_hf_dataset(ds: "VlmDataset"):
    """`datasets.Dataset` view of a VlmDataset (SFTTrainer refuses any other type). The images of a row are
    still decoded only when that row is read: the transform runs on access, not up front."""
    from datasets import Dataset

    base = Dataset.from_dict({"idx": list(range(len(ds)))})

    def _transform(batch):
        return {"messages": [ds[int(i)]["messages"] for i in batch["idx"]]}

    return base.with_transform(_transform)


def split_indices(n: int, *, seed: int = SPLIT_SEED, fraction: float = HOLDOUT_FRACTION, min_rows: int = HOLDOUT_MIN_ROWS):
    """(train_idx, eval_idx): a seeded hold-out of `fraction` of the rows when there are at least `min_rows`,
    else everything trains and eval is empty."""
    if n < min_rows:
        return list(range(n)), []
    n_eval = max(1, int(round(n * fraction)))
    order = list(range(n))
    random.Random(seed).shuffle(order)
    return sorted(order[n_eval:]), sorted(order[:n_eval])


# ───────────────────────────── Hugging Face datasets ─────────────────────────────


@dataclass
class HfOptions:
    """Which columns of a Hugging Face dataset hold what. `prompt_text` is the fixed instruction used when
    there is no `prompt_column` (LaTeX_OCR has only `image` and `text`)."""

    image_column: str = ""
    prompt_column: str = ""
    answer_column: str = ""
    prompt_text: str = ""
    system_prompt: str = ""
    messages_column: str = ""  # auto-detected as "messages" when present and no answer column is given
    split: str = "train"
    config: str = ""
    max_images: int = MAX_IMAGES_PER_ROW


_IMAGE_COLUMN_NAMES = ("image", "images", "img", "picture", "photo")


def _is_image_feature(feature) -> bool:
    name = type(feature).__name__
    if name == "Image":
        return True
    inner = getattr(feature, "feature", None)  # List(Image()) / Sequence(Image())
    if inner is None and isinstance(feature, (list, tuple)) and feature:
        inner = feature[0]
    return inner is not None and type(inner).__name__ == "Image"


def detect_image_column(features: dict) -> Optional[str]:
    """The Image column of a dataset: the first Image-typed feature, preferring the usual names."""
    typed = [c for c, f in features.items() if _is_image_feature(f)]
    for c in _IMAGE_COLUMN_NAMES:
        if c in typed:
            return c
    return typed[0] if typed else None


def validate_hf_options(columns: list, features: dict, opts: HfOptions) -> HfOptions:
    """Fill in / check the column names against the dataset; raises DatasetError naming the columns that exist."""
    opts = HfOptions(**opts.__dict__)
    have = f"The dataset has columns: {', '.join(columns)}."
    if not opts.messages_column and "messages" in columns and not opts.answer_column:
        opts.messages_column = "messages"
    if not opts.image_column:
        found = detect_image_column(features)
        if found:
            opts.image_column = found
    if opts.image_column and opts.image_column not in columns:
        raise DatasetError(f"image_column {opts.image_column!r} is not a column. {have}")
    if opts.messages_column:
        if opts.messages_column not in columns:
            raise DatasetError(f"messages_column {opts.messages_column!r} is not a column. {have}")
        return opts
    if not opts.image_column:
        raise DatasetError(f"No image column found; set image_column. {have}")
    if not opts.answer_column:
        raise DatasetError(f"answer_column is required (the column holding the text the model should write). {have}")
    if opts.answer_column not in columns:
        raise DatasetError(f"answer_column {opts.answer_column!r} is not a column. {have}")
    if opts.prompt_column and opts.prompt_column not in columns:
        raise DatasetError(f"prompt_column {opts.prompt_column!r} is not a column. {have}")
    if not opts.prompt_column and not opts.prompt_text.strip():
        raise DatasetError(
            "Neither prompt_column nor prompt_text is set: say what the model is asked about the image "
            "(for example prompt_text='Write the LaTeX for the formula in this image.')."
        )
    return opts


def _as_text(v) -> str:
    if isinstance(v, (list, tuple)):  # ChartQA-style `label` is a list of acceptable answers: train on the first
        v = v[0] if v else ""
    if v is None:
        return ""
    return v if isinstance(v, str) else str(v)


def _images_of(value) -> list:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [v for v in value if v is not None]
    return [value]


def hf_row_to_messages(row: dict, opts: HfOptions, max_pixels: Optional[int] = None) -> list:
    """Messages for one Hugging Face row (see HfOptions). Images are decoded here, per access."""
    images = _images_of(row.get(opts.image_column)) if opts.image_column else []
    if len(images) > opts.max_images:
        raise DatasetError(f"row has {len(images)} images, at most {opts.max_images} are allowed")

    if opts.messages_column:
        msgs = row.get(opts.messages_column)
        if isinstance(msgs, str):
            msgs = json.loads(msgs)
        if not isinstance(msgs, list) or not msgs:
            raise DatasetError(f"column {opts.messages_column!r} holds no messages")
        queue = list(images)
        out: list = []
        for m in msgs:
            content = m.get("content")
            parts: list = []
            if isinstance(content, str):
                parts.append({"type": "text", "text": content})
            else:
                for p in content or []:
                    if is_image_part(p):
                        ref = image_ref_of(p)
                        if ref is None or ref == "":  # a bare {"type": "image"} placeholder -> next image column value
                            if not queue:
                                raise DatasetError("a message has an image placeholder but the row has no (more) images")
                            ref = queue.pop(0)
                        parts.append({"type": "image", "image": load_image(ref, max_pixels=max_pixels)})
                    elif isinstance(p, dict) and p.get("type") == "text":
                        parts.append({"type": "text", "text": p.get("text", "")})
                    else:
                        raise DatasetError(f"unsupported content part: {p!r}")
            out.append({"role": m.get("role"), "content": parts})
        if not any(m["role"] == "assistant" for m in out) or out[-1]["role"] != "assistant":
            raise DatasetError("the last message must be from the assistant")
        return out

    if not images:
        raise DatasetError(f"row has no image in column {opts.image_column!r}")
    answer = _as_text(row.get(opts.answer_column)).strip()
    if not answer:
        raise DatasetError(f"row has an empty answer in column {opts.answer_column!r}")
    prompt = _as_text(row.get(opts.prompt_column)).strip() if opts.prompt_column else ""
    prompt = prompt or opts.prompt_text.strip()
    user_parts = [{"type": "image", "image": load_image(im, max_pixels=max_pixels)} for im in images]
    user_parts.append({"type": "text", "text": prompt})
    out = []
    if opts.system_prompt.strip():
        out.append({"role": "system", "content": [{"type": "text", "text": opts.system_prompt.strip()}]})
    out.append({"role": "user", "content": user_parts})
    out.append({"role": "assistant", "content": [{"type": "text", "text": answer}]})
    return out


def _hf_eval_split_name(available) -> Optional[str]:
    for name in ("validation", "val", "eval", "dev"):
        if name in available:
            return name
    return None  # "test" is deliberately NOT used: it is kept for the held-out evaluation


# ───────────────────────────────── everything together ─────────────────────────────────


@dataclass
class DataBundle:
    train: VlmDataset
    eval: Optional[VlmDataset]
    source: str
    eval_source: str  # "eval.jsonl" | "validation split" | "10% hold-out" | "none"
    n_train: int
    n_eval: int
    info: dict = field(default_factory=dict)


def build_datasets(
    spec: str,
    *,
    max_pixels: Optional[int] = DEFAULT_MAX_PIXELS,
    max_images: int = MAX_IMAGES_PER_ROW,
    hf: Optional[HfOptions] = None,
    workdir: Optional[str] = None,
    log: Callable[[str], None] = _noop_log,
    s3_fs_factory: Callable[[], Any] = None,
    roots: Optional[list] = None,
    hf_loader: Optional[Callable[..., Any]] = None,
    min_rows: int = MIN_ROWS,
) -> DataBundle:
    """Resolve `spec` and return the train (and eval) datasets. See the module docstring for the split rule."""
    res = resolve_dataset(spec, workdir=workdir, log=log, s3_fs_factory=s3_fs_factory, roots=roots)

    if res.kind == "local":
        base = res.base_dir
        train_loaded = load_rows(res.train_file, base, min_rows=min_rows, max_images=max_images, label="train set")
        to_msgs = lambda row: to_unsloth_messages(row, base, max_pixels)  # noqa: E731
        train = VlmDataset(train_loaded.rows, to_msgs, "train")
        info = {
            "rows_total": train_loaded.report["total"],
            "rows_invalid_dropped": train_loaded.dropped,
            "images_referenced": train_loaded.report["images_referenced"],
        }
        if res.eval_file:
            ev_loaded = load_rows(res.eval_file, base, min_rows=1, max_images=max_images, label="eval set")
            ev = VlmDataset(ev_loaded.rows, to_msgs, "eval")
            return DataBundle(train, ev, res.description, "eval.jsonl", len(train), len(ev), info)
        t_idx, e_idx = split_indices(len(train))
        if e_idx:
            return DataBundle(train.subset(t_idx), train.subset(e_idx, "eval"), res.description, "10% hold-out", len(t_idx), len(e_idx), info)
        return DataBundle(train, None, res.description, "none", len(train), 0, info)

    # Hugging Face dataset with an Image column
    opts = hf or HfOptions()
    if hf_loader is None:  # pragma: no cover - needs `datasets` and the Hub
        from datasets import load_dataset as hf_loader  # type: ignore[no-redef]
    args = [res.hf_id] + ([opts.config] if opts.config else [])
    dsd = hf_loader(*args)
    if opts.split not in dsd:
        raise DatasetError(f"Hugging Face dataset {res.hf_id!r} has no split {opts.split!r} (it has: {', '.join(dsd.keys())})")
    train_hf = dsd[opts.split]
    columns = list(train_hf.column_names)
    opts = validate_hf_options(columns, dict(train_hf.features), opts)
    opts.max_images = max_images
    if len(train_hf) < 1:
        raise DatasetError(f"Hugging Face dataset {res.hf_id!r} split {opts.split!r} is empty")
    to_msgs = lambda row: hf_row_to_messages(row, opts, max_pixels)  # noqa: E731
    train = VlmDataset(train_hf, to_msgs, "train")
    info = {"hf_columns": columns, "image_column": opts.image_column, "answer_column": opts.answer_column}
    ev_name = _hf_eval_split_name(dsd.keys())
    if ev_name:
        ev = VlmDataset(dsd[ev_name], to_msgs, "eval")
        return DataBundle(train, ev, res.description, f"{ev_name} split", len(train), len(ev), info)
    t_idx, e_idx = split_indices(len(train))
    if e_idx:
        return DataBundle(train.subset(t_idx), train.subset(e_idx, "eval"), res.description, "10% hold-out", len(t_idx), len(e_idx), info)
    return DataBundle(train, None, res.description, "none", len(train), 0, info)
