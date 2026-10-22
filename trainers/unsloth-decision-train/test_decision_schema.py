"""Run: python -m pytest trainers/unsloth-decision-train/test_decision_schema.py  (or plain python)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decision_schema import validate_row, validate_rows  # noqa: E402

GOOD = {
    "state": "Halo, saya ditagih dua kali untuk invoice #4411.",
    "questions": {
        "team": {"type": "choice", "criteria": {"billing": "tagihan", "technical": "teknis"}},
        "refund": {"type": "noul", "instructions": "Minta refund?"},
        "urgency": {"type": "score", "criteria": ["rendah", "sedang", "tinggi"]},
    },
    "gold": {"team": "billing", "refund": True, "urgency": 2},
}


def test_good_row_is_valid():
    assert validate_row(GOOD) == []


def test_answers_alias_and_dict_state():
    row = {**GOOD, "state": {"ticket": "x"}}
    row["answers"] = row.pop("gold")
    assert validate_row(row) == []


def test_soft_labels():
    row = {
        **GOOD,
        "gold": {"team": {"probabilities": {"billing": 0.9, "technical": 0.1}}, "refund": {"noul": 0.8}, "urgency": 1},
    }
    assert validate_row(row) == []


def test_list_criteria_for_choice():
    row = {"state": "x", "questions": {"q": {"type": "choice", "criteria": ["a", "b", "c"]}}, "gold": {"q": "c"}}
    assert validate_row(row) == []


def test_label_not_an_option():
    row = {**GOOD, "gold": {**GOOD["gold"], "team": "sales"}}
    errs = validate_row(row)
    assert errs and 'question "team"' in errs[0] and "not one of the options" in errs[0]


def test_score_label_out_of_range_and_fractional():
    assert validate_row({**GOOD, "gold": {**GOOD["gold"], "urgency": 3}})
    assert validate_row({**GOOD, "gold": {**GOOD["gold"], "urgency": 1.5}})
    assert validate_row({**GOOD, "gold": {**GOOD["gold"], "urgency": 2.0}}) == []


def test_noul_string_and_bad_value():
    assert validate_row({**GOOD, "gold": {**GOOD["gold"], "refund": "Ya"}})
    assert validate_row({**GOOD, "gold": {**GOOD["gold"], "refund": "TRUE"}}) == []


def test_bad_question_shapes():
    bad_type = {**GOOD, "questions": {"q": {"type": "rank"}}, "gold": {"q": 1}}
    assert "type must be one of" in validate_row(bad_type)[0]
    one_option = {"state": "x", "questions": {"q": {"type": "choice", "criteria": ["only"]}}, "gold": {"q": "only"}}
    assert "2 to 255 options" in validate_row(one_option)[0]
    too_many_levels = {"state": "x", "questions": {"q": {"type": "score", "criteria": list("abcdefghijk")}}, "gold": {"q": 0}}
    assert "2 to 10 levels" in validate_row(too_many_levels)[0]
    noul_bad = {"state": "x", "questions": {"q": {"type": "noul", "criteria": {"maybe": "?"}}}, "gold": {"q": True}}
    assert '"true" and "false"' in validate_row(noul_bad)[0]


def test_missing_parts():
    assert validate_row("not a dict")
    assert any("state" in e for e in validate_row({**GOOD, "state": "  "}))
    assert any("questions" in e for e in validate_row({"state": "x", "gold": {"a": 1}}))
    assert any("gold" in e for e in validate_row({"state": "x", "questions": GOOD["questions"]}))
    assert any("no such question" in e for e in validate_row({**GOOD, "gold": {**GOOD["gold"], "ghost": 1}}))


def test_partial_gold_is_allowed_but_not_empty():
    assert validate_row({**GOOD, "gold": {"team": "billing"}}) == []
    only_ghost = {**GOOD, "gold": {"ghost": 1}}
    assert validate_row(only_ghost)


def test_validate_rows_report():
    rows = [GOOD, {**GOOD, "gold": {**GOOD["gold"], "team": "sales"}}, GOOD]
    valid, report = validate_rows(rows)
    assert len(valid) == 2 and report["invalid"] == 1 and report["total"] == 3
    assert report["errors"][0].startswith("row 2:")
    assert report["questions"]["team"]["labels"] == {"billing": 2}
    assert report["questions"]["urgency"]["type"] == "score"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
    print(f"{len(fns)} tests ok")
