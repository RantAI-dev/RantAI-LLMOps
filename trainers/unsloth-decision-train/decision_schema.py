"""Dataset schema for decision-model training rows (no heavy dependencies, importable anywhere).

A row is one decision request with its answers:

    {"state":     "free text" | {...any JSON...},
     "questions": {"<name>": {"type": "noul" | "choice" | "score",
                              "instructions": "optional text",
                              "criteria": ...}},
     "gold":      {"<name>": <label>}}          # "answers" is accepted as an alias

    noul    yes/no. criteria is optional and may only hold "true" / "false".
            label: true | false | "true" | "false" | {"noul": p} | {"probabilities": {...}}
    choice  one option. criteria: {option_id: description} or ["option", ...] (2..255 options).
            label: "<option_id>" | {"label": id, "probabilities": {id: p}}
    score   an ordinal level. criteria: ["lowest", ..., "highest"] (2..10 levels).
            label: <int level, 0-based> | {"probabilities": {"0": p0, "1": p1, ...}}

The checks mirror what Unsloth's `FastDecisionModel.build_dataset` accepts
(unsloth/models/_decision_common.py) and the Decision API's limits
(studio/backend/routes/systemone.py), so a row that passes here is not rejected later and
the error message names the row and the question instead of "row 37 skipped".

The TypeScript twin used by the dataset upload form is src/lib/decision-schema.ts; keep the
two in step.
"""

from __future__ import annotations

import json
import math
from collections import Counter

QUESTION_TYPES = ("noul", "choice", "score")
MAX_QUESTIONS = 64
MIN_CHOICES, MAX_CHOICES = 2, 255
MIN_LEVELS, MAX_LEVELS = 2, 10
MAX_NAME_CHARS = 200   # question names and option ids in a served request
MAX_TEXT_CHARS = 4000  # instructions and option descriptions in a served request


def _options(kind: str, criteria) -> list[str] | None:
    """The option ids of a question, or None when its criteria are unusable."""
    if kind == "noul":
        return ["false", "true"]
    if kind == "choice":
        if isinstance(criteria, list) and criteria and all(isinstance(c, str) for c in criteria):
            return [str(c) for c in criteria]
        if isinstance(criteria, dict) and criteria:
            return [str(k) for k in criteria]
        return None
    if kind == "score":
        if isinstance(criteria, list) and criteria:
            return [str(i) for i in range(len(criteria))]
        return None
    return None


def _question_error(kind, criteria) -> str | None:
    if kind not in QUESTION_TYPES:
        return f'type must be one of {", ".join(QUESTION_TYPES)} (got {kind!r})'
    if kind == "noul":
        if criteria is not None and (not isinstance(criteria, dict) or set(criteria) - {"true", "false"}):
            return 'criteria may only have "true" and "false"'
        return None
    options = _options(kind, criteria)
    if options is None:
        return "choice needs criteria naming its options" if kind == "choice" else "score needs a list of criteria levels"
    if kind == "choice":
        if len(set(options)) != len(options):
            return "has repeated options"
        if not MIN_CHOICES <= len(options) <= MAX_CHOICES:
            return f"needs {MIN_CHOICES} to {MAX_CHOICES} options (got {len(options)})"
    if kind == "score" and not MIN_LEVELS <= len(options) <= MAX_LEVELS:
        return f"needs {MIN_LEVELS} to {MAX_LEVELS} levels (got {len(options)})"
    return None


def _gold_error(kind, options: list[str], gold) -> str | None:
    """None when `gold` yields a usable target, as Unsloth's `_target_for` decides it."""
    if not isinstance(gold, dict):
        gold = {"label": gold}
    probabilities = gold.get("probabilities")
    if kind == "noul" and not isinstance(probabilities, dict):
        noul = gold.get("noul")
        probabilities = {"true": noul} if isinstance(noul, (int, float)) and not isinstance(noul, bool) else None
    if isinstance(probabilities, dict):
        try:
            if any(isinstance(v, bool) for v in probabilities.values()):
                raise TypeError("bool")
            values = {str(k): float(v) for k, v in probabilities.items()}
        except (TypeError, ValueError):
            return "probabilities must be numbers"
        if not all(math.isfinite(v) for v in values.values()):
            return "probabilities must be finite numbers"
        if kind == "noul" and len(values.keys() & {"false", "true"}) == 1:
            known = "true" if "true" in values else "false"
            values["false" if known == "true" else "true"] = 1.0 - values[known]
        weight = sum(max(0.0, values.get(o, 0.0)) for o in options)
        if 0 < weight < math.inf:
            return None
    label = gold.get("label")
    if label is None:
        return "has no label or usable probabilities"
    if kind == "score":
        try:
            level = float(label)
        except (TypeError, ValueError):
            return f"score label must be a level number (got {label!r})"
        if isinstance(label, bool) or not level.is_integer():
            return f"score label must be a whole level number (got {label!r})"
        label = str(int(level))
    elif kind == "noul":
        label = str(label).strip().lower()
    else:
        label = str(label)
    if label not in options:
        shown = ", ".join(options[:6]) + (" ..." if len(options) > 6 else "")
        return f"label {label!r} is not one of the options ({shown})"
    return None


def _json_field(value):
    """A field some exporters store as a JSON string (Hugging Face parquet does): parse it, else leave it."""
    if isinstance(value, str) and value.strip()[:1] in ("{", "["):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def normalize_row(row):
    """The row as the trainer reads it: stringified `questions`/`gold` parsed, extra columns dropped.

    LocalLLaMA/typed-decisions (the dataset Unsloth's guide trains on) keeps questions and gold as
    JSON strings next to bookkeeping columns (id, workflow, factors, ...). `state` is left as it is:
    a string stays the text the model reads. Anything that is not an object is returned unchanged
    so validate_row reports it.
    """
    if not isinstance(row, dict):
        return row
    out = {"state": row.get("state"), "questions": _json_field(row.get("questions"))}
    gold = (row.get("gold") if row.get("gold") is not None else row.get("answers"))
    out["gold"] = _json_field(gold)
    return out


def validate_row(row) -> list[str]:
    """Every problem with one row, as short messages (empty list = valid)."""
    if not isinstance(row, dict):
        return ["row is not a JSON object"]
    errors: list[str] = []
    state = row.get("state")
    if state is None or (isinstance(state, str) and not state.strip()) or state == {} or state == []:
        errors.append("state is missing or empty")
    questions = row.get("questions")
    if not isinstance(questions, dict) or not questions:
        errors.append("questions must be a non-empty object of name -> question")
        return errors
    if len(questions) > MAX_QUESTIONS:
        errors.append(f"has {len(questions)} questions, at most {MAX_QUESTIONS} are allowed")
    gold = (row.get("gold") if row.get("gold") is not None else row.get("answers"))
    if not isinstance(gold, dict) or not gold:
        errors.append('"gold" (or "answers") must be a non-empty object of question name -> label')
        return errors
    labelled = 0
    for name, question in questions.items():
        if not isinstance(question, dict):
            errors.append(f'question "{name}" is not an object')
            continue
        kind, criteria = question.get("type"), question.get("criteria")
        problem = _question_error(kind, criteria)
        if problem:
            errors.append(f'question "{name}": {problem}')
            continue
        if name not in gold:
            continue
        labelled += 1
        problem = _gold_error(kind, _options(kind, criteria) or [], gold[name])
        if problem:
            errors.append(f'question "{name}": gold {problem}')
    extra = [n for n in gold if n not in questions]
    if extra:
        errors.append(f'gold names no such question: {", ".join(map(str, extra[:3]))}')
    if not labelled and not errors:
        errors.append("no question has a gold label")
    return errors


def validate_questions(questions) -> list[str]:
    """Problems with the `questions` object of a Decision API request (empty = valid).

    The serving twin of validate_row: same per-question rules and limits, but there is no gold to
    check. docker/decision/server.py calls it so a malformed request is a 422 naming the question,
    not an exception from inside the model.
    """
    if not isinstance(questions, dict) or not questions:
        return ["questions must be a non-empty object of name -> question"]
    errors: list[str] = []
    if len(questions) > MAX_QUESTIONS:
        errors.append(f"has {len(questions)} questions, at most {MAX_QUESTIONS} are allowed")
    for name, question in questions.items():
        if not isinstance(name, str) or not name.strip():
            errors.append("question names must be non-empty strings")
            continue
        if not isinstance(question, dict):
            errors.append(f'question "{name}" is not an object')
            continue
        problem = _question_error(question.get("type"), question.get("criteria")) or _text_error(question)
        if len(name) > MAX_NAME_CHARS:
            problem = f"name is longer than {MAX_NAME_CHARS} characters"
        if problem:
            errors.append(f'question "{name[:60]}": {problem}')
    return errors


def _text_error(question: dict) -> str | None:
    """Length/type limits on the free text of a served question, so one request cannot hand the model
    megabytes of instructions or option descriptions (the state has its own limit in the server)."""
    instructions = question.get("instructions")
    if instructions is not None and not isinstance(instructions, str):
        return "instructions must be text"
    if isinstance(instructions, str) and len(instructions) > MAX_TEXT_CHARS:
        return f"instructions are longer than {MAX_TEXT_CHARS} characters"
    criteria = question.get("criteria")
    texts = list(criteria.values()) if isinstance(criteria, dict) else (criteria if isinstance(criteria, list) else [])
    keys = list(criteria.keys()) if isinstance(criteria, dict) else []
    if any(isinstance(t, str) and len(t) > MAX_TEXT_CHARS for t in texts) or any(len(str(k)) > MAX_NAME_CHARS for k in keys):
        return f"an option is longer than {MAX_TEXT_CHARS} characters (or its id longer than {MAX_NAME_CHARS})"
    return None


def validate_rows(rows, max_report: int = 10) -> tuple[list, dict]:
    """Split `rows` into the valid ones and a report.

    report = {"total", "valid", "invalid", "errors": [first max_report "row N: message"],
              "questions": {name: {"type", "rows", "labels": {label: count}}}}
    The per-question summary is for the job log: a quick look at it catches a label that
    never occurs, or a question type used for the wrong kind of target.
    """
    valid, errors = [], []
    summary: dict[str, dict] = {}
    for i, row in enumerate(rows):
        row = normalize_row(row)
        problems = validate_row(row)
        if problems:
            if len(errors) < max_report:
                errors.append(f"row {i + 1}: {'; '.join(problems[:3])}")
            continue
        valid.append(row)
        gold = (row.get("gold") if row.get("gold") is not None else row.get("answers"))
        for name, question in row["questions"].items():
            entry = summary.setdefault(name, {"type": question["type"], "rows": 0, "labels": Counter()})
            if name in gold:
                entry["rows"] += 1
                g = gold[name]
                label = g.get("label") if isinstance(g, dict) else g
                if label is None and isinstance(g, dict):
                    probs = g.get("probabilities")
                    if isinstance(probs, dict) and probs:
                        label = max(probs, key=lambda k: float(probs[k]))
                entry["labels"][str(label)] += 1
    report = {
        "total": len(rows),
        "valid": len(valid),
        "invalid": len(rows) - len(valid),
        "errors": errors,
        "questions": {
            name: {"type": e["type"], "rows": e["rows"], "labels": dict(e["labels"].most_common(12))}
            for name, e in summary.items()
        },
    }
    return valid, report


# Training parameters: the job refuses values that would train nothing or train wrongly, before any GPU
# time. The TypeScript twin (decisionParamProblems in src/lib/decision-schema.ts) refuses the same at
# submit, so the form says it instead of a failed job.
PARAM_RANGES = {
    # name: (low, high, low_inclusive, high_inclusive)
    "lr": (0.0, 1.0, False, True),
    "head_lr": (0.0, 1.0, False, True),
    "num_train_epochs": (0.0, 1000.0, True, True),
    "batch_size": (1, 512, True, True),
    "gradient_accumulation_steps": (1, 1024, True, True),
    "warmup_ratio": (0.0, 0.5, True, True),
    "weight_decay": (0.0, 1.0, True, True),
    "max_seq_length": (256, 65536, True, True),
    "lora_r": (1, 1024, True, True),
    "lora_alpha": (0.0, 1e6, False, True),
    "lora_dropout": (0.0, 1.0, True, False),
    "head_warmup_steps": (0, 1_000_000, True, True),
    "holdout_fraction": (0.0, 0.5, False, True),
    "label_smoothing": (0.0, 0.5, True, False),
    "brier_weight": (0.0, 100.0, True, True),
    "kl_weight": (0.0, 100.0, True, True),
    "predict_rows": (0, 1_000_000, True, True),
}


def param_problems(params: dict) -> list[str]:
    """Problems with decision training parameters (empty = fine). Missing keys are not problems."""
    errors = []
    for key, (low, high, low_in, high_in) in PARAM_RANGES.items():
        if key not in params or params[key] is None:
            continue
        value = params[key]
        if isinstance(value, bool):
            errors.append(f"{key} must be a number")
            continue
        try:
            v = float(value)
        except (TypeError, ValueError):
            errors.append(f"{key} must be a number")
            continue
        if not math.isfinite(v) or (v < low if low_in else v <= low) or (v > high if high_in else v >= high):
            errors.append(f"{key} must be {'>=' if low_in else '>'} {low:g} and {'<=' if high_in else '<'} {high:g} (got {value})")
    epochs = params.get("num_train_epochs")
    steps = params.get("max_steps")
    try:
        no_epochs = epochs is not None and float(epochs) <= 0
        no_steps = steps is None or int(float(steps)) <= 0
    except (TypeError, ValueError):
        no_epochs, no_steps = False, False
        errors.append("max_steps must be a whole number")
    if no_epochs and no_steps:
        errors.append("num_train_epochs must be > 0 (or set max_steps > 0): otherwise nothing is trained")
    return errors
