"""Pure helpers of the vision trainer (no unsloth / torch import; numpy only, and only when a check is run), so
the parts that decide whether a run trains on the RIGHT tokens are unit-tested on CPU (test_vlm_train_utils.py).

  VisionParams / read_params     the `lab.get_config()` keys with their defaults and validation
  derive_turn_markers            instruction / response markers from the model's OWN chat template
  check_mask / MaskReport        the first-batch mask check (0 % or 100 % trainable, image tokens trainable,
                                 end-of-turn token not trainable, images missing from the batch)
  mask_image_labels              force image tokens out of the loss
  audit_lengths                  "N/M samples exceed max_seq_length" and the 20 % failure rule
  apply_max_pixels               max_pixels on the processor, where the processor has such a knob
  image_token_ids                the ids of the image placeholder tokens of a model/processor
"""

from __future__ import annotations

import os
import random
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional, Sequence

IGNORE_INDEX = -100
MAX_OVER_FRACTION = 0.2  # fail the run when more than this share of audited samples is too long
AUDIT_SAMPLES = 200

# ───────────────────────────────────── parameters ─────────────────────────────────────

DEFAULT_MODEL = "aisingapore/Gemma-SEA-LION-v4-4B-VL"


class ParamError(ValueError):
    pass


@dataclass
class VisionParams:
    model_name: str = DEFAULT_MODEL
    dataset: str = ""
    lr: float = 2e-4
    num_train_epochs: float = 1
    batch_size: int = 1
    gradient_accumulation_steps: int = 8
    warmup_steps: int = 5
    max_steps: int = -1
    max_seq_length: int = 4096
    lora_r: int = 16
    lora_alpha: int = 16
    lora_dropout: float = 0.0
    logging_steps: int = 1
    save_steps: int = 50
    eval_steps: int = 50
    weight_decay: float = 0.01
    dataloader_num_workers: int = 0
    optim: str = "adamw_torch"
    finetune_vision_layers: bool = False
    finetune_language_layers: bool = True
    max_pixels: int = 1003520
    max_images_per_sample: int = 4
    # 0 = use every row. A cap makes the run length predictable (about 1 s per row on the GB10).
    max_train_rows: int = 0
    max_eval_rows: int = 500
    # Hugging Face datasets with an Image column
    image_column: str = ""
    prompt_column: str = ""
    answer_column: str = ""
    prompt_text: str = ""
    system_prompt: str = ""
    hf_split: str = "train"
    hf_config: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _as_bool(v: Any, default: bool) -> bool:
    if v is None:
        return default
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("1", "true", "yes", "on"):
            return True
        if s in ("0", "false", "no", "off", ""):
            return False
        raise ParamError(f"not a boolean: {v!r}")
    return bool(v)


def read_params(config: dict) -> VisionParams:
    """Parameters from `lab.get_config()`, coerced to the right types and validated. Unknown keys are ignored
    (the app may add some); a value that cannot be coerced or is out of range raises ParamError naming it."""
    p = VisionParams()
    for name, default in asdict(p).items():
        if name not in config or config[name] is None:
            continue
        raw = config[name]
        try:
            if isinstance(default, bool):
                val = _as_bool(raw, default)
            elif isinstance(default, int):
                f = float(raw)
                if f != int(f):
                    raise ValueError("not a whole number")
                val = int(f)
            elif isinstance(default, float):
                val = float(raw)
            else:
                val = str(raw).strip()
        except (TypeError, ValueError) as e:
            raise ParamError(f"parameter {name!r} must be a {type(default).__name__}, got {raw!r} ({e})") from e
        setattr(p, name, val)
    problems = []
    if not p.model_name:
        problems.append("model_name is empty")
    if not p.dataset:
        problems.append("dataset is empty")
    for name in ("batch_size", "gradient_accumulation_steps", "max_seq_length", "lora_r", "lora_alpha", "max_images_per_sample", "logging_steps", "save_steps", "eval_steps"):
        if getattr(p, name) < 1:
            problems.append(f"{name} must be >= 1")
    if p.max_pixels < 1:
        problems.append("max_pixels must be >= 1")
    for name in ("max_train_rows", "max_eval_rows"):
        if getattr(p, name) < 0:
            problems.append(f"{name} must be >= 0 (0 = no limit)")
    if p.max_steps == 0 or p.max_steps < -1:
        problems.append("max_steps must be -1 or a positive number")
    if not (0.0 <= p.lora_dropout < 1.0):
        problems.append("lora_dropout must be in [0, 1)")
    if p.lr <= 0:
        problems.append("lr must be > 0")
    if p.num_train_epochs <= 0:
        problems.append("num_train_epochs must be > 0")
    if not (p.finetune_vision_layers or p.finetune_language_layers):
        problems.append("at least one of finetune_vision_layers / finetune_language_layers must be on")
    if problems:
        raise ParamError("; ".join(problems))
    return p


# ───────────────────────────── turn markers from the chat template ─────────────────────────────
#
# Origin: the sentinel technique of trainers/unsloth-llm-train/train.py (the "Completion-only loss (A1)" block,
# L711-835): render the model's OWN chat template around sentinel strings and read the markers off the result,
# so Gemma / Qwen / Llama need no hardcoded markers. This is a re-derivation, not a copy, because the original
# builds its markers from a no-system render and a with-system render, and for Gemma (which folds the system
# turn into the first user turn) that yielded the instruction marker "\n" -- harmless for single-line answers,
# wrong for anything with a newline in it. Here the markers come from ONE four-turn conversation
# (U1 A1 U2 A2), which every chat template renders with the same turn structure:
#
#   <pre> U1 <end of user turn + start of assistant turn> A1 <end of assistant turn + start of user turn> U2 ...
#
#   instruction_part = the start-of-user marker = the common suffix of <pre> and the A1->U2 gap
#   terminator       = the A1->U2 gap without that marker (what ENDS a turn: "<end_of_turn>\n")
#   response_part    = the U1->A1 gap without the leading terminator (the start-of-assistant marker)
#
# Gemma-3:  instruction "<start_of_turn>user\n"  response "<start_of_turn>model\n"      terminator "<end_of_turn>\n"
# ChatML:   instruction "<|im_start|>user\n"     response "<|im_start|>assistant\n"    terminator "<|im_end|>\n"
#
# train_on_responses_only trains from the END of response_part up to the START of the next instruction_part, so
# the terminator sits inside the trainable span and the model learns to END its turn (the "never stops" bug the
# original comment documents for learn v10).

_U1, _A1, _U2, _A2 = "%%RANTAI_U1%%", "%%RANTAI_A1%%", "%%RANTAI_U2%%", "%%RANTAI_A2%%"
_S = "%%RANTAI_SYS%%"


class MarkerError(RuntimeError):
    pass


@dataclass
class TurnMarkers:
    instruction_part: str
    response_part: str
    terminator: str  # may be "" for a template that has no explicit end-of-turn text
    notes: list = field(default_factory=list)


def _common_suffix(a: str, b: str) -> str:
    n = 0
    while n < min(len(a), len(b)) and a[-1 - n] == b[-1 - n]:
        n += 1
    return a[len(a) - n:] if n else ""


def _render_either(render: Callable[[list], str], turns: list) -> str:
    """Render with plain-string contents; templates that insist on parts (some VL templates index
    `content[0]["type"]`) get `[{"type": "text", "text": ...}]` instead."""
    plain = [{"role": r, "content": c} for r, c in turns]
    try:
        return render(plain)
    except Exception as first:  # noqa: BLE001 - jinja raises assorted errors
        parts = [{"role": r, "content": [{"type": "text", "text": c}]} for r, c in turns]
        try:
            return render(parts)
        except Exception:
            raise MarkerError(f"the chat template cannot render a plain conversation: {first}") from first


def derive_turn_markers(render: Callable[[list], str], sample_text: Optional[str] = None) -> TurnMarkers:
    """Markers for train_on_responses_only from `render(messages) -> str` (the chat template, no generation
    prompt). `sample_text`, when given, is a real formatted training sample: the markers must occur in it."""
    text = _render_either(render, [("user", _U1), ("assistant", _A1), ("user", _U2), ("assistant", _A2)])
    for s in (_U1, _A1, _U2):
        if text.count(s) != 1:
            raise MarkerError(f"sentinel {s} occurs {text.count(s)}x in the rendered template (expected once); template output: {text!r}")
    i_u1, i_a1, i_u2 = text.index(_U1), text.index(_A1), text.index(_U2)
    pre = text[:i_u1]
    gap_ua = text[i_u1 + len(_U1):i_a1]  # end of user turn + start of assistant turn
    gap_au = text[i_a1 + len(_A1):i_u2]  # end of assistant turn + start of user turn
    notes: list = []

    instruction = _common_suffix(pre, gap_au)
    # Two different special tokens can share their last characters ("<bos>" before the first turn, "<|eot_id|>"
    # between turns share "|>"/">"), which the common suffix would pull into the marker: drop closing
    # characters that sit in front of the next special token.
    instruction = re.sub(r"^[|>\])]+(?=<)", "", instruction)
    if not instruction or instruction == gap_au and pre.endswith(gap_au) and len(pre) > len(gap_au):
        # `pre` already ends with a whole A->U gap (a default system turn precedes the user turn), so the
        # common suffix swallowed the terminator. Fall back to the system-sentinel render.
        with_sys = _render_either(render, [("system", _S), ("user", _U1), ("assistant", _A1)])
        if _S in with_sys and _U1 in with_sys:
            between_sys = with_sys[with_sys.index(_S) + len(_S):with_sys.index(_U1)]
            cand = _common_suffix(gap_au, between_sys)
            if cand:
                instruction = cand
                notes.append("instruction marker taken from the system-turn render")
    if not instruction:
        raise MarkerError(f"cannot find the start-of-user marker in the chat template (before user: {pre!r}, between turns: {gap_au!r})")
    terminator = gap_au[: len(gap_au) - len(instruction)]
    response = gap_ua[len(terminator):] if terminator and gap_ua.startswith(terminator) else gap_ua
    if not response:
        raise MarkerError(f"cannot find the start-of-assistant marker (user->assistant gap: {gap_ua!r})")
    if not terminator:
        notes.append("the template has no explicit end-of-turn text: the end-of-turn check is skipped")

    if sample_text is not None:
        for what, marker in (("instruction", instruction), ("response", response)):
            if marker not in sample_text:
                raise MarkerError(f"the {what} marker {marker!r} does not occur in a formatted training sample; completion-only masking would be degenerate")
    return TurnMarkers(instruction, response, terminator, notes)


def count_assistant_turns(messages: Sequence[dict]) -> int:
    return sum(1 for m in messages if m.get("role") == "assistant")


# ───────────────────────────────────── first-batch mask check ─────────────────────────────────────


def _rows(x) -> list:
    """A 2-D batch (torch tensor, numpy array or nested lists) as a list of int lists."""
    if hasattr(x, "tolist"):
        x = x.tolist()
    if x and not isinstance(x[0], (list, tuple)):
        x = [x]
    return [list(r) for r in x]


@dataclass
class MaskReport:
    rows: int = 0
    tokens: int = 0  # non-padding positions
    trainable: int = 0
    image_tokens: int = 0
    image_tokens_trainable: int = 0
    eot_trainable: int = 0
    eot_expected: int = 0  # over the rows that were not truncated
    eot_checked: bool = False
    problems: list = field(default_factory=list)

    @property
    def fraction(self) -> float:
        return self.trainable / self.tokens if self.tokens else 0.0

    @property
    def ok(self) -> bool:
        return not self.problems

    def summary(self) -> str:
        s = f"mask check: {self.trainable}/{self.tokens} tokens trainable ({self.fraction:.0%}) over {self.rows} sample(s); image tokens {self.image_tokens} ({self.image_tokens_trainable} trainable)"
        if self.eot_checked:
            s += f"; end-of-turn trainable {self.eot_trainable}/{self.eot_expected}"
        return s


def check_mask(
    input_ids,
    labels,
    *,
    image_token_ids: Sequence[int] = (),
    eot_token_ids: Sequence[int] = (),
    expected_eot_per_row: Sequence[int] = (),
    attention_mask=None,
    max_length: Optional[int] = None,
    expect_images: bool = False,
    ignore_index: int = IGNORE_INDEX,
) -> MaskReport:
    """Inspect one collated batch. Works on torch tensors, numpy arrays or nested lists.

    Problems (any makes `report.ok` False):
      * nothing trainable, or everything trainable (non-padding positions only);
      * an image token is trainable (the model would be trained to emit image placeholders);
      * `expect_images` but the batch has no image token at all (the processor dropped the images: the run
        would silently train a text-only model);
      * the end-of-turn token of an assistant turn is masked out (the model never learns to stop). Rows that
        reach `max_length` are skipped for this check: truncation can legitimately cut the last terminator.
    """
    ids, labs = _rows(input_ids), _rows(labels)
    if len(ids) != len(labs):
        raise ValueError("input_ids and labels have different batch sizes")
    attn = _rows(attention_mask) if attention_mask is not None else None
    img = set(int(i) for i in image_token_ids)
    eot = set(int(i) for i in eot_token_ids)
    rep = MaskReport(rows=len(ids))
    for r, (row_ids, row_labs) in enumerate(zip(ids, labs)):
        if len(row_ids) != len(row_labs):
            raise ValueError("input_ids and labels have different lengths")
        mask = attn[r] if attn is not None else [1] * len(row_ids)
        length = sum(1 for m in mask if m)
        truncated = max_length is not None and length >= max_length
        row_eot = 0
        for tok, lab, m in zip(row_ids, row_labs, mask):
            if not m:
                continue
            rep.tokens += 1
            on = lab != ignore_index
            rep.trainable += on
            if tok in img:
                rep.image_tokens += 1
                rep.image_tokens_trainable += on
            if on and tok in eot:
                row_eot += 1
        if eot and expected_eot_per_row and not truncated:
            rep.eot_checked = True
            rep.eot_trainable += row_eot
            rep.eot_expected += expected_eot_per_row[r] if r < len(expected_eot_per_row) else 0
    if rep.tokens == 0:
        rep.problems.append("the batch has no tokens")
        return rep
    if rep.trainable == 0:
        rep.problems.append("0% of the tokens are trainable: the response marker did not match, every label is masked")
    elif rep.trainable == rep.tokens:
        rep.problems.append("100% of the tokens are trainable: the prompt (and the image) are not masked, the instruction/response markers did not match")
    if rep.image_tokens_trainable:
        rep.problems.append(f"{rep.image_tokens_trainable} image token(s) are trainable: image placeholders must be masked out of the loss")
    if expect_images and rep.image_tokens == 0 and img:
        rep.problems.append("the batch has no image tokens although the samples have images: the processor did not insert them")
    if rep.eot_checked and rep.eot_trainable < rep.eot_expected:
        rep.problems.append(
            f"only {rep.eot_trainable} of {rep.eot_expected} assistant turns have their end-of-turn token inside the trainable span; "
            "the model would never learn to stop"
        )
    return rep


def mask_image_labels(batch: dict, image_token_ids: Sequence[int], ignore_index: int = IGNORE_INDEX) -> dict:
    """Set labels to `ignore_index` wherever input_ids is an image token. Safe to call on a batch that is
    already masked. Works on torch tensors (masked_fill) and numpy arrays; returns the batch."""
    ids = [int(i) for i in image_token_ids]
    if not ids or "labels" not in batch or "input_ids" not in batch:
        return batch
    labels, input_ids = batch["labels"], batch["input_ids"]
    if hasattr(labels, "masked_fill"):  # torch
        hit = None
        for tid in ids:
            m = input_ids == tid
            hit = m if hit is None else (hit | m)
        batch["labels"] = labels.masked_fill(hit, ignore_index)
    else:
        import numpy as np

        batch["labels"] = np.where(np.isin(np.asarray(input_ids), ids), ignore_index, np.asarray(labels))
    return batch


def image_token_ids(model_config: Any, processor: Any = None, tokenizer: Any = None) -> list:
    """Ids of the image placeholder tokens: what the processor expands every image into (Gemma-3:
    <image_soft_token>; Qwen-VL: <|image_pad|>, plus the vision start/end tokens). Collected from the model
    config and the processor/tokenizer; returned sorted and de-duplicated."""
    ids: set = set()
    for attr in ("image_token_id", "image_token_index", "vision_start_token_id", "vision_end_token_id", "boi_token_id", "eoi_token_id", "video_token_id"):
        v = getattr(model_config, attr, None)
        if isinstance(v, int) and v >= 0:
            ids.add(v)
    tok = tokenizer or getattr(processor, "tokenizer", None)
    if tok is not None and hasattr(tok, "convert_tokens_to_ids"):
        unk = getattr(tok, "unk_token_id", None)
        names = []
        for holder in (processor, tok):
            for attr in ("image_token", "boi_token", "eoi_token", "vision_start_token", "vision_end_token"):
                v = getattr(holder, attr, None)
                if isinstance(v, str) and v:
                    names.append(v)
        for n in names:
            try:
                i = tok.convert_tokens_to_ids(n)
            except Exception:  # noqa: BLE001
                continue
            if isinstance(i, int) and i >= 0 and i != unk:
                ids.add(i)
    return sorted(ids)


# ───────────────────────────────────── length audit ─────────────────────────────────────


@dataclass
class LengthAudit:
    n: int
    over: int
    max_seq_length: int
    longest: int
    fraction: float
    failed: bool
    message: str


def sample_indices(n: int, k: int = AUDIT_SAMPLES, seed: int = 3407) -> list:
    if n <= k:
        return list(range(n))
    return sorted(random.Random(seed).sample(range(n), k))


def audit_lengths(lengths: Sequence[int], max_seq_length: int, max_fraction: float = MAX_OVER_FRACTION) -> LengthAudit:
    """`lengths` are token counts INCLUDING image tokens. A sample longer than max_seq_length is truncated at
    the END, which in a vision sample is the answer behind the image: its label is cut away. More than
    `max_fraction` of them over the limit fails the run."""
    n = len(lengths)
    over = sum(1 for x in lengths if x > max_seq_length)
    frac = over / n if n else 0.0
    longest = max(lengths) if n else 0
    failed = frac > max_fraction
    msg = f"{over}/{n} samples exceed max_seq_length={max_seq_length} (longest {longest} tokens, image tokens included)"
    if failed:
        msg += f": more than {max_fraction:.0%}, the answers would be cut off. Raise max_seq_length or max_pixels down."
    elif over:
        msg += "; those will be truncated"
    return LengthAudit(n, over, max_seq_length, longest, frac, failed, msg)


# ───────────────────────────────────── processor knobs ─────────────────────────────────────


def apply_max_pixels(processor: Any, max_pixels: int) -> str:
    """Cap the pixels the processor feeds the vision tower, where it has such a knob (Qwen-VL image
    processors: `max_pixels` and `size["longest_edge"]`). A fixed-size processor (Gemma-3 resizes every image
    to 896x896) has none: nothing is changed and the returned line says so. Images are ALSO shrunk to
    `max_pixels` when they are loaded (vlm_data.load_image), which bounds decode time and memory either way."""
    ip = getattr(processor, "image_processor", None)
    if ip is None:
        return "no image_processor on the processor: max_pixels only applies at image load time"
    changed = []
    try:
        if hasattr(ip, "max_pixels"):
            ip.max_pixels = int(max_pixels)
            changed.append("max_pixels")
        size = getattr(ip, "size", None)
        if isinstance(size, dict) and "longest_edge" in size:
            size["longest_edge"] = int(max_pixels)
            changed.append('size["longest_edge"]')
    except Exception as e:  # noqa: BLE001 - never let a knob break the run
        return f"could not set max_pixels on the processor ({e}); it still applies at image load time"
    if changed:
        return f"processor max_pixels={max_pixels} ({', '.join(changed)})"
    return f"this processor has a fixed image size (no max_pixels knob): max_pixels={max_pixels} only applies when images are loaded"


def skip_trackio_model_card() -> str:
    """TRL writes a model card on every checkpoint save, and to do so it imports `trackio` (to link a Space).
    In the Transformer Lab venv `trackio` is installed but built against an older `huggingface_hub`, so the
    import raises ImportError and kills the run at the first checkpoint, after all the training is done.
    The card is of no use here (push_to_hub is off), so its trackio lookup is replaced by "no Space".
    Returns a log line; never raises."""
    patched = []
    for name in ("trl.trainer.base_trainer", "trl.trainer.utils", "trl.trainer.sft_trainer"):
        try:
            mod = __import__(name, fromlist=["_"])
        except Exception:  # noqa: BLE001 - this TRL version does not have the module
            continue
        if hasattr(mod, "get_trackio_space_url"):
            mod.get_trackio_space_url = lambda: None
            patched.append(name.rsplit(".", 1)[-1])
    return f"model card: trackio Space lookup disabled in {', '.join(patched)}" if patched else "model card: no trackio lookup to disable"


def prune_checkpoints(directory: str, keep: int = 2) -> list:
    """Delete all but the newest `keep` `checkpoint-<step>` folders in `directory`; return the removed names.

    lab.save_checkpoint copies each checkpoint into the job folder and never prunes it, so `save_total_limit`
    (which only applies to the trainer's own output_dir) does not bound it: a 2,500-step run left 50 copies of
    380 MB (19 GB) and filled the box's disk. Only folders named checkpoint-<number> are touched."""
    import shutil

    if not directory or not os.path.isdir(directory) or keep < 1:
        return []
    ckpts = [d for d in os.listdir(directory) if d.startswith("checkpoint-") and d.split("-")[-1].isdigit()
             and os.path.isdir(os.path.join(directory, d))]
    old = sorted(ckpts, key=lambda d: int(d.split("-")[-1]))[:-keep]
    for d in old:
        shutil.rmtree(os.path.join(directory, d), ignore_errors=True)
    return old


# ───────────────────────────────────── saved adapter ─────────────────────────────────────

_VISION_KEY_HINTS = ("vision_tower", "vision_model", "visual", "multi_modal_projector", "embed_vision", "merger", "vision_embed")


def adapter_key_report(keys: Sequence[str]) -> dict:
    """What a saved LoRA adapter touches: {total, lora, vision}. `vision` counts LoRA keys inside the vision
    tower / projector (a language-only adapter must have 0; one trained with finetune_vision_layers must
    have some). The box smoke test saved 476 keys, 0 vision, for the Gemma-3 4B language-layers recipe."""
    keys = list(keys)
    lora = [k for k in keys if "lora_" in k]
    vision = [k for k in lora if any(h in k for h in _VISION_KEY_HINTS)]
    return {"total": len(keys), "lora": len(lora), "vision": len(vision)}


def read_mem_available_gib(path: str = "/proc/meminfo") -> Optional[float]:
    """MemAvailable in GiB (the number that matters on the GB10's shared 128 GB), or None when unknown."""
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return round(int(line.split()[1]) / 1024 / 1024, 1)
    except (OSError, ValueError, IndexError):
        pass
    return None
