"""Tests for make_demo_dataset.py and make_fixture_zip.py: no network, no `datasets` package (a tiny fake dataset).
Run: python -m pytest scripts/vlm/test_make_demo_dataset.py"""

import json
import sys
import zipfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "trainers" / "unsloth-vision-train"))

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

import make_demo_dataset as m  # noqa: E402
import make_fixture_zip as fx  # noqa: E402
import vlm_schema  # noqa: E402


class FakeDataset:
    """What `load_dataset(...)[split]` gives: len() and item access with a PIL image."""

    def __init__(self, n, label_key="text", mode="RGB"):
        self.n, self.label_key, self.mode = n, label_key, mode
        self.touched = []

    def __len__(self):
        return self.n

    def __getitem__(self, i):
        self.touched.append(i)
        img = Image.new(self.mode, (20 + i % 5, 10), 255 if self.mode == "L" else (i * 7 % 256, 10, 20))
        if self.label_key == "text":
            return {"image": img, "text": rf"\frac {{ {i} }} {{ 2 }}"}
        return {"image": img, "query": f"What is bar {i}?", "label": [f"{i}", "ignored"]}


def zip_rows(path, name="train.jsonl"):
    with zipfile.ZipFile(path) as z:
        return [json.loads(line) for line in z.read(name).decode().splitlines() if line]


def test_latex_train_zip(tmp_path):
    ds = FakeDataset(100)
    info = m.build_latex_train(ds, tmp_path / "t.zip", n_train=30, n_eval=6, seed=0)
    assert info["train"] == 30 and info["eval"] == 6 and info["images"] == 36
    with zipfile.ZipFile(tmp_path / "t.zip") as z:
        assert set(z.namelist()) >= {"train.jsonl", "eval.jsonl"}
        assert all(n.startswith("images/") and n.endswith(".png") for n in z.namelist() if n.endswith("png"))
        names = set(z.namelist())
    train, ev = zip_rows(tmp_path / "t.zip"), zip_rows(tmp_path / "t.zip", "eval.jsonl")
    # The row format of the spec: user = image + the fixed Indonesian prompt, assistant = the dataset's text as it is.
    user = train[0]["messages"][0]["content"]
    assert user[1] == {"type": "text", "text": m.LATEX_PROMPT}
    path = user[0]["image"]
    assert path in names and path.startswith("images/")
    index = int(Path(path).stem)
    assert train[0]["messages"][1]["content"][0]["text"] == rf"\frac {{ {index} }} {{ 2 }}"
    # train and eval are different rows, and both validate with the training job's validator.
    t_imgs = {r["messages"][0]["content"][0]["image"] for r in train}
    e_imgs = {r["messages"][0]["content"][0]["image"] for r in ev}
    assert not (t_imgs & e_imgs)
    m.check_zip(tmp_path / "t.zip")


def test_same_seed_same_zip_other_seed_other_rows(tmp_path):
    ds = FakeDataset(200)
    m.build_latex_train(ds, tmp_path / "a.zip", n_train=25, n_eval=5, seed=0)
    m.build_latex_train(ds, tmp_path / "b.zip", n_train=25, n_eval=5, seed=0)
    m.build_latex_train(ds, tmp_path / "c.zip", n_train=25, n_eval=5, seed=1)
    assert (tmp_path / "a.zip").read_bytes() == (tmp_path / "b.zip").read_bytes()
    assert zip_rows(tmp_path / "a.zip") != zip_rows(tmp_path / "c.zip")


def test_test_zip_has_no_eval_and_takes_only_n_rows(tmp_path):
    ds = FakeDataset(500)
    m.build_latex_test(ds, tmp_path / "test.zip", n_test=40, seed=0)
    with zipfile.ZipFile(tmp_path / "test.zip") as z:
        assert "eval.jsonl" not in z.namelist()
    assert len(zip_rows(tmp_path / "test.zip")) == 40
    assert len(set(ds.touched)) == 40  # nothing else was decoded
    m.check_zip(tmp_path / "test.zip")


def test_smaller_dataset_than_requested(tmp_path):
    info = m.build_latex_test(FakeDataset(24), tmp_path / "s.zip", n_test=300)
    assert info["train"] == 24
    info = m.build_latex_train(FakeDataset(30), tmp_path / "s2.zip", n_train=2000, n_eval=200)
    assert info["train"] == 30 and info["eval"] == 0  # everything went to train; no eval file


def test_chartqa_uses_query_and_first_label_and_jpeg(tmp_path):
    ds = FakeDataset(60, label_key="label")
    m.build_chartqa_test(ds, tmp_path / "c.zip", n_test=25, seed=0)
    rows = zip_rows(tmp_path / "c.zip")
    first = rows[0]["messages"]
    path = first[0]["content"][0]["image"]
    index = int(Path(path).stem)
    assert path.endswith(".jpg")
    assert first[0]["content"][1]["text"] == f"What is bar {index}?" + m.CHARTQA_SUFFIX
    assert first[1]["content"][0]["text"] == str(index)  # label[0], not "ignored"
    with zipfile.ZipFile(tmp_path / "c.zip") as z:
        assert z.read(path)[:3] == b"\xff\xd8\xff"
    m.check_zip(tmp_path / "c.zip")


def test_png_encoding_handles_palette_and_grayscale():
    for mode in ("L", "P", "RGBA", "1"):
        img = Image.new(mode, (4, 4))
        assert m.image_bytes(img)[:4] == b"\x89PNG"


def test_label_may_be_a_plain_string():
    assert m.chartqa_item({"query": "q", "label": "7"}) == ("q" + m.CHARTQA_SUFFIX, "7")


def test_duplicate_image_paths_are_refused(tmp_path):
    rows = m.make_rows(FakeDataset(10), [1, 2], m.latex_item)
    with pytest.raises(ValueError, match="twice"):
        m.write_zip(tmp_path / "x.zip", rows, rows)


def test_cli_only_flag_validates_choices(capsys):
    with pytest.raises(SystemExit):
        m.main(["--only", "nope"])


def test_cli_builds_selected_outputs_with_a_fake_loader(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "load_split", lambda name, split: FakeDataset(120) if "LaTeX" in name else FakeDataset(60, "label"))
    assert m.main(["--out", str(tmp_path), "--n-train", "22", "--n-eval", "5", "--n-test", "21", "--only", "latex-train", "--only", "chartqa-test"]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == ["chartqa-test.zip", "latex-ocr-train.zip"]


# ---- the small fixture ZIP -------------------------------------------------------------------------------


def test_committed_fixture_zip_is_valid():
    path = fx.DEFAULT_OUT
    assert path.exists(), "run python scripts/vlm/make_fixture_zip.py"
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        rows = [json.loads(line) for line in z.read("train.jsonl").decode().splitlines() if line]
    assert len(rows) == 25
    assert len([n for n in names if n.startswith("images/")]) == 10
    report = vlm_schema.validate_rows(rows, image_exists=lambda p: p in names)
    assert report["valid"] == 25 and report["images_referenced"] == 10
    assert vlm_schema.dataset_problem(report) is None


def test_broken_variant_is_refused(tmp_path):
    broken = fx.write_fixture(tmp_path / "broken.zip", drop="images/3.png")
    with zipfile.ZipFile(broken) as z:
        names = set(z.namelist())
        rows = [json.loads(line) for line in z.read("train.jsonl").decode().splitlines() if line]
    assert "images/3.png" not in names and len(names) == 10  # train.jsonl + 9 images
    report = vlm_schema.validate_rows(rows, image_exists=lambda p: p in names)
    assert report["invalid"] == 3  # rows 4, 14 and 24 (index % 10 == 3): 12%, far above the 2% allowance
    assert "images/3.png" in report["problems"][0]["why"]
    assert vlm_schema.dataset_problem(report)


def test_fixture_generation_is_reproducible(tmp_path):
    a = fx.write_fixture(tmp_path / "a.zip")
    b = fx.write_fixture(tmp_path / "b.zip")
    assert a.read_bytes() == b.read_bytes()
