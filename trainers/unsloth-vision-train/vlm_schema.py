"""Dataset schema for image (vision-language) training rows. Pure stdlib: importable anywhere, no torch/unsloth.

TypeScript twin: src/lib/vlm-schema.ts (the upload form and the upload routes). Keep the two in step: the
upload accepts what this accepts, so a dataset that was stored never fails here minutes into a GPU job.
Both read the same fixture, fixtures/vlm_cases.jsonl.

One JSONL line (Unsloth / TRL conversational format):

    {"messages": [
        {"role": "system", "content": "You are a maths tutor."},
        {"role": "user", "content": [
            {"type": "image", "image": "images/q1.jpg"},
            {"type": "text", "text": "What is the area of this shape?"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "24 cm^2."}]}]}

Rules (checks run in this order; the first failure is the reason):
  * ``messages`` is a non-empty list; roles are system | user | assistant.
  * ``content`` is a string or a list of parts: {"type": "text", "text"}, {"type": "image", "image": ref} or the
    OpenAI alias {"type": "image_url", "image_url": {"url": ref}}. Images only in user / system messages.
  * an image ``ref`` is a relative path (no "..", not absolute, jpg|jpeg|png|webp), a public https:// URL, or an
    s3://bucket/key URI. Relative paths are looked up with ``image_exists`` when it is given.
  * at most ``max_images`` (default 4) images per row.
  * at least one user and one assistant message; the LAST message is the assistant's and has some text.
  Extra keys on the row (the fixture's ``_expect``, bookkeeping columns) are ignored.
"""

from __future__ import annotations

import json
import re
from typing import Callable, Iterable, Optional
from urllib.parse import urlsplit

ROLES = ("system", "user", "assistant")
IMAGE_EXTENSIONS = ("jpg", "jpeg", "png", "webp")
MAX_IMAGES_PER_ROW = 4
MAX_INVALID_RATIO = 0.02
MIN_ROWS = 20
MAX_PROBLEMS = 20

_EXT_RE = re.compile(r"\.(" + "|".join(IMAGE_EXTENSIONS) + r")$", re.IGNORECASE)
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]+:", re.IGNORECASE)
_DRIVE_RE = re.compile(r"^[A-Za-z]:[\\/]")
_S3_RE = re.compile(r"^s3://([^/]+)/(.+)$", re.IGNORECASE)
_IPV4_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)\.(\d+)$")
_PRIVATE_SUFFIX_RE = re.compile(r"\.(localhost|local|internal|lan|home|corp)$")
_BAD_HOST_RE = re.compile(r"[\s#%/:<>?@\[\\\]^|]")

ImageExists = Optional[Callable[[str], bool]]


def _is_private_ipv4(a: int, b: int) -> bool:
    return (
        a == 0 or a == 10 or a == 127 or a >= 224
        or (a == 169 and b == 254)
        or (a == 172 and 16 <= b <= 31)
        or (a == 192 and b == 168)
        or (a == 100 and 64 <= b <= 127)
    )


def is_public_https_url(u: str) -> bool:
    """https URL on a public hostname (twin of isPublicHttpsUrl in src/lib/chat-content.ts)."""
    if re.search(r"\s", u):
        return False
    try:
        parts = urlsplit(u)
        parts.port  # noqa: B018 - raises ValueError on a bad port
    except ValueError:
        return False
    if parts.scheme.lower() != "https" or parts.username or parts.password:
        return False
    hostinfo = parts.netloc.rsplit("@", 1)[-1]
    if hostinfo.startswith("["):  # IPv6 literal
        return False
    host = (parts.hostname or "").lower()
    if not host or _BAD_HOST_RE.search(host):
        return False
    if host == "localhost" or _PRIVATE_SUFFIX_RE.search(host):
        return False
    if "." not in host:  # single-label name, e.g. a Docker service alias
        return False
    m = _IPV4_RE.match(host)
    if m and _is_private_ipv4(int(m.group(1)), int(m.group(2))):
        return False
    return True


def normalize_image_path(ref: str) -> str:
    """Relative path as looked up in the dataset: a leading "./" is not part of the name."""
    while ref.startswith("./"):
        ref = ref[2:]
    return ref


def image_ref_problem(ref: str) -> str | None:
    """None when ``ref`` is a usable image reference; else why not."""
    if ref.strip() == "":
        return "is empty"
    lower = ref.lower()
    if lower.startswith("https://"):
        return None if is_public_https_url(ref) else "is not an https URL on a public host"
    if lower.startswith("http://"):
        return "must be https, not http"
    if lower.startswith("s3://"):
        m = _S3_RE.match(ref)
        if not m or any(s in ("", ".", "..") for s in m.group(2).split("/")):
            return "is not a valid s3://bucket/key URI"
        return None
    if _DRIVE_RE.match(ref) or ref.startswith("/") or ref.startswith("\\"):
        return "is an absolute path"
    if _SCHEME_RE.match(ref):
        return "uses an unsupported scheme (use a relative path, https:// or s3://)"
    if "\\" in ref or "\0" in ref:
        return "has a backslash or NUL in the path"
    segments = normalize_image_path(ref).split("/")
    if ".." in segments:
        return 'must not contain ".."'
    if any(s in ("", ".") for s in segments):
        return 'has an empty or "." path segment'
    if not _EXT_RE.search(ref):
        return "must end in " + ", ".join("." + e for e in IMAGE_EXTENSIONS)
    return None


def _is_local_ref(ref: str) -> bool:
    return not re.match(r"^(https|s3)://", ref, re.IGNORECASE)


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(p["text"] for p in content if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str))


def _json(v) -> str:
    return "nothing" if v is None else json.dumps(v)


def _check_row(row, image_exists: ImageExists, max_images: int, referenced: set | None, missing: set | None) -> str:
    if not isinstance(row, dict):
        return "row is not a JSON object"
    messages = row.get("messages")
    if not isinstance(messages, list) or not messages:
        return "messages must be a non-empty array"
    first = ""

    def fail(why: str) -> None:
        nonlocal first
        if not first:
            first = why

    images = users = assistants = 0
    last_role = None
    for i, m in enumerate(messages):
        n = i + 1
        if not isinstance(m, dict):
            fail(f"message {n} is not an object")
            continue
        role = m.get("role")
        last_role = role
        if not isinstance(role, str) or role not in ROLES:
            fail(f"message {n}: role must be system, user or assistant (got {_json(role)})")
            continue
        users += role == "user"
        assistants += role == "assistant"
        content = m.get("content")
        if isinstance(content, str):
            continue
        if not isinstance(content, list):
            fail(f"message {n}: content must be a string or an array of parts")
            continue
        if not content:
            fail(f"message {n}: content has no parts")
            continue
        for k, part in enumerate(content):
            where = f"message {n}, part {k + 1}"
            if not isinstance(part, dict):
                fail(f"{where} is not an object")
                continue
            ptype = part.get("type")
            if ptype == "text":
                if not isinstance(part.get("text"), str):
                    fail(f'{where}: text part needs a string "text"')
                continue
            if ptype not in ("image", "image_url"):
                fail(f"{where}: unsupported content part type {_json(ptype)}")
                continue
            if ptype == "image":
                ref = part.get("image")
            else:
                iu = part.get("image_url")
                ref = iu.get("url") if isinstance(iu, dict) else None
            if not isinstance(ref, str):
                fail(f'{where}: ' + ('image part needs an "image" string' if ptype == "image" else 'image_url part needs "image_url.url"'))
                continue
            images += 1
            if role == "assistant":
                fail(f"message {n}: images are only allowed in user or system messages")
                continue
            problem = image_ref_problem(ref)
            if problem:
                fail(f"{where}: image {json.dumps(ref)} {problem}")
                continue
            if _is_local_ref(ref):
                path = normalize_image_path(ref)
                if referenced is not None:
                    referenced.add(path)
                if image_exists is not None and not image_exists(path):
                    if missing is not None:
                        missing.add(path)
                    fail(f"{where}: image {json.dumps(ref)} is not in the dataset")
    if first:
        return first
    if images > max_images:
        return f"has {images} images, at most {max_images} are allowed per row"
    if users == 0:
        return "needs at least one user message"
    if assistants == 0:
        return "needs at least one assistant message"
    if last_role != "assistant":
        return "the last message must be from the assistant"
    if _text_of(messages[-1].get("content")).strip() == "":
        return "the last assistant message has no text"
    return ""


def validate_row(row: dict, image_exists: ImageExists = None, max_images: int = MAX_IMAGES_PER_ROW) -> tuple[bool, str]:
    """(valid, why). ``why`` is "" when valid. ``image_exists(path)`` is asked only for relative paths."""
    why = _check_row(row, image_exists, max_images, None, None)
    return why == "", why


def validate_rows(rows: Iterable, image_exists: ImageExists = None, max_images: int = MAX_IMAGES_PER_ROW) -> dict:
    """Validate rows (dicts, or JSON strings as read from a JSONL file); never raises on a bad row.

    Returns {total, valid, invalid, invalid_ratio, images_referenced, problems}. ``line`` in a problem is the
    1-based position among the rows given (the file line when the rows are the lines of a JSONL file without
    blank lines; pass blank-free lines, or use ``validate_jsonl_text`` which keeps real line numbers).
    ``images_referenced`` = distinct relative image paths the rows point at (valid or not; URLs not counted).
    """
    report = {"total": 0, "valid": 0, "invalid": 0, "invalid_ratio": 0.0, "images_referenced": 0, "problems": []}
    referenced: set[str] = set()
    for n, row in enumerate(rows, 1):
        report["total"] += 1
        if isinstance(row, (str, bytes)):
            try:
                row = json.loads(row)
            except ValueError:
                why = "not valid JSON"
            else:
                why = _check_row(row, image_exists, max_images, referenced, None)
        else:
            why = _check_row(row, image_exists, max_images, referenced, None)
        if why == "":
            report["valid"] += 1
            continue
        report["invalid"] += 1
        if len(report["problems"]) < MAX_PROBLEMS:
            report["problems"].append({"line": n, "why": why})
    report["invalid_ratio"] = report["invalid"] / report["total"] if report["total"] else 0.0
    report["images_referenced"] = len(referenced)
    return report


def validate_jsonl_text(text: str, image_exists: ImageExists = None, max_images: int = MAX_IMAGES_PER_ROW) -> dict:
    """Like validate_rows over a JSONL text, with real (1-based) file line numbers; blank lines are skipped."""
    if text.startswith("﻿"):
        text = text[1:]
    report = {"total": 0, "valid": 0, "invalid": 0, "invalid_ratio": 0.0, "images_referenced": 0, "problems": []}
    referenced: set[str] = set()
    for lineno, raw in enumerate(text.split("\n"), 1):
        line = raw.strip()
        if not line:
            continue
        report["total"] += 1
        try:
            why = _check_row(json.loads(line), image_exists, max_images, referenced, None)
        except ValueError:
            why = "not valid JSON"
        if why == "":
            report["valid"] += 1
            continue
        report["invalid"] += 1
        if len(report["problems"]) < MAX_PROBLEMS:
            report["problems"].append({"line": lineno, "why": why})
    report["invalid_ratio"] = report["invalid"] / report["total"] if report["total"] else 0.0
    report["images_referenced"] = len(referenced)
    return report


def dataset_problem(report: dict, min_rows: int = MIN_ROWS, max_invalid_ratio: float = MAX_INVALID_RATIO, label: str = "dataset") -> str | None:
    """Why a validated dataset cannot be trained on, or None when it can (twin of vlmDatasetProblem)."""
    first = " | ".join(f"line {p['line']}: {p['why']}" for p in report["problems"][:3])
    if report["total"] == 0:
        return f"The {label} is empty"
    if report["valid"] < min_rows:
        tail = f" {first}" if first else ""
        return f"The {label} has {report['valid']} valid rows; at least {min_rows} are needed.{tail}"
    if report["invalid_ratio"] > max_invalid_ratio:
        return (
            f"{report['invalid']} of {report['total']} {label} rows are invalid "
            f"(the trainer stops above {round(max_invalid_ratio * 100)}%). {first}"
        )
    return None
