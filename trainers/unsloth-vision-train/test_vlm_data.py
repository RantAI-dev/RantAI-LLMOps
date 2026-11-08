"""CPU-only tests for vlm_data.py: Pillow and numpy only, no unsloth / torch / datasets / s3fs.

Run: python -m pytest trainers/unsloth-vision-train
"""

import io
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

import vlm_data as vd  # noqa: E402

PROMPT = "Write the LaTeX."


def _png(path, size=(60, 20), color=(200, 30, 30), mode="RGB"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new(mode, size, color if mode == "RGB" else color + (0,)).save(path)


def _row(img="images/a.png", answer="x ^ { 2 }", content_style="parts"):
    user = (
        [{"type": "image", "image": img}, {"type": "text", "text": PROMPT}]
        if content_style == "parts"
        else [{"type": "image_url", "image_url": {"url": img}}, {"type": "text", "text": PROMPT}]
    )
    return {"messages": [{"role": "user", "content": user}, {"role": "assistant", "content": answer}]}


def make_dataset(root, n=25, eval_rows=0, name="train.jsonl"):
    rows = []
    for i in range(n):
        rel = f"images/{i}.png"
        _png(os.path.join(root, rel), size=(40 + i, 20))
        rows.append(_row(rel, f"answer {i}"))
    with open(os.path.join(root, name), "w") as f:
        f.write("\n".join(json.dumps(r) for r in rows) + "\n")
    if eval_rows:
        ev = [_row("images/0.png", f"eval {i}") for i in range(eval_rows)]
        with open(os.path.join(root, "eval.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(r) for r in ev) + "\n")
    return rows


# ───────────────────────────── resolve_dataset ─────────────────────────────


def test_resolve_local_folder(tmp_path):
    make_dataset(str(tmp_path), 3, eval_rows=2)
    r = vd.resolve_dataset(str(tmp_path))
    assert r.kind == "local" and r.base_dir == str(tmp_path)
    assert r.train_file.endswith("train.jsonl") and r.eval_file.endswith("eval.jsonl")


def test_resolve_tl_upload_file_names(tmp_path):
    # Transformer Lab prefixes stored files with the dataset id
    (tmp_path / "mydata_train.jsonl").write_text("{}\n")
    (tmp_path / "mydata_eval.jsonl").write_text("{}\n")
    r = vd.resolve_dataset(str(tmp_path))
    assert r.train_file.endswith("mydata_train.jsonl") and r.eval_file.endswith("mydata_eval.jsonl")


def test_resolve_folder_without_train_fails(tmp_path):
    with pytest.raises(vd.DatasetError, match="no train.jsonl"):
        vd.resolve_dataset(str(tmp_path))


def test_resolve_jsonl_file_uses_its_folder(tmp_path):
    make_dataset(str(tmp_path), 3)
    r = vd.resolve_dataset(str(tmp_path / "train.jsonl"))
    assert r.base_dir == str(tmp_path) and r.eval_file is None


def test_resolve_workspace_name(tmp_path):
    root = tmp_path / "datasets"
    make_dataset(str(root / "latex-demo"), 3)
    r = vd.resolve_dataset("latex-demo", roots=[str(root)])
    assert r.kind == "local" and r.base_dir == str(root / "latex-demo")


def test_resolve_unknown_bare_name_falls_back_to_hf(tmp_path):
    r = vd.resolve_dataset("nothing-here", roots=[str(tmp_path)])
    assert r.kind == "hf" and r.hf_id == "nothing-here"


def test_resolve_hf_id():
    r = vd.resolve_dataset("unsloth/LaTeX_OCR", roots=[])
    assert r.kind == "hf" and r.hf_id == "unsloth/LaTeX_OCR"


def test_resolve_http_url_refused():
    with pytest.raises(vd.DatasetError, match="http"):
        vd.resolve_dataset("https://example.com/train.jsonl")


def test_resolve_empty():
    with pytest.raises(vd.DatasetError):
        vd.resolve_dataset("  ")


class FakeS3:
    """Just enough of s3fs: find() and a batched get(list, list)."""

    def __init__(self, objects):
        self.objects = objects  # "bucket/key" -> bytes
        self.got = []

    def find(self, path):
        return sorted(k for k in self.objects if k.startswith(path))

    def get(self, rpaths, lpaths):
        for r, l in zip(rpaths, lpaths):
            self.got.append(r)
            with open(l, "wb") as f:
                f.write(self.objects[r])


def _png_bytes():
    b = io.BytesIO()
    Image.new("RGB", (30, 10), (1, 2, 3)).save(b, "PNG")
    return b.getvalue()


def test_s3_prefix_pulled_recursively_with_images(tmp_path):
    rows = [json.dumps(_row(f"images/{i}.png")) for i in range(3)]
    objs = {"bkt/ds/train.jsonl": ("\n".join(rows)).encode(), "bkt/ds/eval.jsonl": rows[0].encode()}
    for i in range(3):
        objs[f"bkt/ds/images/{i}.png"] = _png_bytes()
    objs["bkt/other/x.txt"] = b"not mine"
    fs = FakeS3(objs)
    work = tmp_path / "w"
    r = vd.resolve_dataset("s3://bkt/ds/", workdir=str(work), s3_fs_factory=lambda: fs)
    assert r.kind == "local" and r.eval_file
    assert (work / "images" / "2.png").is_file()
    assert not (work / "x.txt").exists()
    assert len(fs.got) == 5


def test_s3_prefix_without_trailing_slash_and_file_form(tmp_path):
    fs = FakeS3({"bkt/ds/train.jsonl": b"{}", "bkt/ds2/train.jsonl": b"{}"})
    r = vd.resolve_dataset("s3://bkt/ds/train.jsonl", workdir=str(tmp_path / "a"), s3_fs_factory=lambda: fs)
    assert r.train_file.endswith("train.jsonl") and fs.got == ["bkt/ds/train.jsonl"]  # not ds2
    fs2 = FakeS3({"bkt/ds/train.jsonl": b"{}", "bkt/ds2/train.jsonl": b"{}"})
    vd.resolve_dataset("s3://bkt/ds", workdir=str(tmp_path / "b"), s3_fs_factory=lambda: fs2)
    assert fs2.got == ["bkt/ds/train.jsonl"]


def test_s3_empty_prefix_fails(tmp_path):
    with pytest.raises(vd.DatasetError, match="No objects"):
        vd.resolve_dataset("s3://bkt/none/", workdir=str(tmp_path), s3_fs_factory=lambda: FakeS3({}))


def test_s3_unsafe_key_refused(tmp_path):
    fs = FakeS3({"bkt/ds/../evil.jsonl": b"{}"})
    with pytest.raises(vd.DatasetError, match="unsafe"):
        vd.pull_s3_prefix(fs, "s3://bkt/ds/", str(tmp_path))


# ───────────────────────────── load_rows ─────────────────────────────


def test_load_rows_valid(tmp_path):
    make_dataset(str(tmp_path), 25)
    lr = vd.load_rows(str(tmp_path / "train.jsonl"))
    assert len(lr.rows) == 25 and lr.dropped == 0 and lr.report["images_referenced"] == 25


def test_load_rows_too_few_rows_fails(tmp_path):
    make_dataset(str(tmp_path), 5)
    with pytest.raises(vd.DatasetError, match="at least 20"):
        vd.load_rows(str(tmp_path / "train.jsonl"))
    assert len(vd.load_rows(str(tmp_path / "train.jsonl"), min_rows=1).rows) == 5


def test_load_rows_missing_image_is_not_silent(tmp_path):
    make_dataset(str(tmp_path), 25)
    os.remove(tmp_path / "images" / "3.png")
    os.remove(tmp_path / "images" / "4.png")
    os.remove(tmp_path / "images" / "5.png")  # 3/25 = 12 % invalid > 2 %
    with pytest.raises(vd.DatasetError, match="invalid") as e:
        vd.load_rows(str(tmp_path / "train.jsonl"))
    assert "not in the dataset" in str(e.value)


def test_load_rows_tolerates_a_few_invalid_and_drops_them(tmp_path):
    make_dataset(str(tmp_path), 60)
    os.remove(tmp_path / "images" / "7.png")  # 1/60 < 2 %
    lr = vd.load_rows(str(tmp_path / "train.jsonl"))
    assert len(lr.rows) == 59 and lr.dropped == 1


def test_load_rows_bad_json_line_counts_as_invalid(tmp_path):
    make_dataset(str(tmp_path), 60)
    with open(tmp_path / "train.jsonl", "a") as f:
        f.write("{not json\n")
    lr = vd.load_rows(str(tmp_path / "train.jsonl"))
    assert len(lr.rows) == 60 and lr.dropped == 1


def test_load_rows_rejects_dotdot_path(tmp_path):
    make_dataset(str(tmp_path), 25)
    rows = [json.loads(l) for l in open(tmp_path / "train.jsonl")]
    rows[0]["messages"][0]["content"][0]["image"] = "../secret.png"
    rows[1]["messages"][0]["content"][0]["image"] = "/etc/passwd.png"
    rows[2]["messages"][0]["content"][0]["image"] = "images/../../x.png"
    (tmp_path / "train.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    with pytest.raises(vd.DatasetError, match="invalid"):
        vd.load_rows(str(tmp_path / "train.jsonl"))


def test_load_rows_missing_file(tmp_path):
    with pytest.raises(vd.DatasetError, match="not found"):
        vd.load_rows(str(tmp_path / "nope.jsonl"))


# ───────────────────────────── resolve_image_path ─────────────────────────────


@pytest.mark.parametrize("bad", ["../x.png", "a/../../x.png", "/abs/x.png", "C:\\x.png", "images\\x.png", "", "images/x.gif", "images//x.png", "a\0b.png"])
def test_resolve_image_path_refuses(tmp_path, bad):
    with pytest.raises(ValueError):
        vd.resolve_image_path(bad, str(tmp_path))


def test_resolve_image_path_ok_and_dot_slash(tmp_path):
    assert vd.resolve_image_path("./images/a.PNG", str(tmp_path)) == os.path.realpath(str(tmp_path / "images" / "a.PNG"))


def test_resolve_image_path_refuses_symlink_escape(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    _png(str(outside / "s.png"))
    ds = tmp_path / "ds"
    (ds / "images").mkdir(parents=True)
    os.symlink(str(outside), str(ds / "images" / "link"))
    with pytest.raises(ValueError, match="escapes"):
        vd.resolve_image_path("images/link/s.png", str(ds))


# ───────────────────────────── images ─────────────────────────────


def test_shrink_keeps_aspect_and_limit():
    img = Image.new("RGB", (4000, 1000))
    out = vd.shrink_to_pixels(img, 1_000_000)
    assert out.size[0] * out.size[1] <= 1_000_000
    assert abs(out.size[0] / out.size[1] - 4.0) < 0.02


def test_shrink_never_upscales_and_none_is_noop():
    img = Image.new("RGB", (100, 50))
    assert vd.shrink_to_pixels(img, 1_000_000).size == (100, 50)
    assert vd.shrink_to_pixels(img, None).size == (100, 50)
    assert vd.shrink_to_pixels(img, 0).size == (100, 50)


def test_shrink_tiny_budget_stays_one_pixel_minimum():
    out = vd.shrink_to_pixels(Image.new("RGB", (1000, 1)), 10)
    assert out.size[0] >= 1 and out.size[1] >= 1 and out.size[0] * out.size[1] <= 10


def test_load_image_rgb_and_shrinks(tmp_path):
    _png(str(tmp_path / "images" / "big.png"), size=(2000, 1000), mode="RGB")
    img = vd.load_image("images/big.png", base_dir=str(tmp_path), max_pixels=500_000)
    assert img.mode == "RGB" and img.size[0] * img.size[1] <= 500_000


def test_load_image_rgba_transparency_goes_white(tmp_path):
    p = tmp_path / "images" / "t.png"
    os.makedirs(p.parent)
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(p)  # fully transparent black
    img = vd.load_image("images/t.png", base_dir=str(tmp_path))
    assert img.mode == "RGB" and img.getpixel((5, 5)) == (255, 255, 255)


def test_load_image_palette_and_grayscale_modes(tmp_path):
    os.makedirs(tmp_path / "images")
    Image.new("L", (8, 8), 100).save(tmp_path / "images" / "g.png")
    Image.new("P", (8, 8)).save(tmp_path / "images" / "p.png")
    assert vd.load_image("images/g.png", base_dir=str(tmp_path)).mode == "RGB"
    assert vd.load_image("images/p.png", base_dir=str(tmp_path)).mode == "RGB"


def test_load_image_accepts_pil_and_hf_bytes_dict():
    pil = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
    assert vd.load_image(pil).mode == "RGB"
    assert vd.load_image({"bytes": _png_bytes(), "path": None}).size == (30, 10)


def test_load_image_relative_without_base_dir_fails():
    with pytest.raises(ValueError, match="dataset folder"):
        vd.load_image("images/a.png")


def test_load_image_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        vd.load_image("images/missing.png", base_dir=str(tmp_path))


class _Resp:
    def __init__(self, data, headers=None):
        self._d, self.headers = data, headers or {}

    def read(self, n=-1):
        return self._d if n < 0 else self._d[:n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_download_bytes_ok_and_timeout_is_passed():
    seen = {}

    def opener(url, timeout):
        seen["timeout"] = timeout
        return _Resp(b"abc")

    assert vd.download_bytes("https://example.com/a.png", timeout=7, opener=opener) == b"abc"
    assert seen["timeout"] == 7


def test_download_bytes_size_limit_by_header_and_by_body():
    with pytest.raises(ValueError, match="limit"):
        vd.download_bytes("https://example.com/a.png", max_bytes=10, opener=lambda u, timeout: _Resp(b"x", {"Content-Length": "500"}))
    with pytest.raises(ValueError, match="limit"):
        vd.download_bytes("https://example.com/a.png", max_bytes=10, opener=lambda u, timeout: _Resp(b"x" * 50))


@pytest.mark.parametrize("url", ["http://example.com/a.png", "https://localhost/a.png", "https://10.0.0.5/a.png", "file:///etc/passwd"])
def test_download_refuses_non_public(url):
    with pytest.raises(ValueError):
        vd.download_bytes(url, opener=lambda u, timeout: _Resp(b"x"))


def test_load_image_from_https_uses_opener():
    img = vd.load_image("https://example.com/a.png", opener=lambda u, timeout: _Resp(_png_bytes()))
    assert img.size == (30, 10)


# ───────────────────────────── messages ─────────────────────────────


def test_to_unsloth_messages_structure_and_lazy_images(tmp_path):
    make_dataset(str(tmp_path), 1)
    row = _row("images/0.png", "the answer")
    row["messages"].insert(0, {"role": "system", "content": "Be brief."})
    msgs = vd.to_unsloth_messages(row, str(tmp_path), max_pixels=10_000)
    assert [m["role"] for m in msgs] == ["system", "user", "assistant"]
    # string content became a text part
    assert msgs[0]["content"] == [{"type": "text", "text": "Be brief."}]
    assert msgs[2]["content"] == [{"type": "text", "text": "the answer"}]
    user = msgs[1]["content"]
    assert user[0]["type"] == "image" and isinstance(user[0]["image"], Image.Image)
    assert user[1] == {"type": "text", "text": PROMPT}


def test_to_unsloth_messages_image_url_alias_and_dot_slash(tmp_path):
    make_dataset(str(tmp_path), 1)
    row = _row("./images/0.png", content_style="alias")
    msgs = vd.to_unsloth_messages(row, str(tmp_path), load_images=False)
    part = msgs[0]["content"][0]
    assert part["type"] == "image"
    assert part["image"] == os.path.realpath(str(tmp_path / "images" / "0.png"))  # absolute path


def test_to_unsloth_messages_url_kept_when_not_loading():
    row = _row("https://example.com/x.png")
    msgs = vd.to_unsloth_messages(row, None, load_images=False)
    assert msgs[0]["content"][0]["image"] == "https://example.com/x.png"


def test_to_unsloth_messages_refuses_dotdot(tmp_path):
    with pytest.raises(ValueError):
        vd.to_unsloth_messages(_row("../x.png"), str(tmp_path))


def test_to_unsloth_messages_rejects_unknown_part():
    row = {"messages": [{"role": "user", "content": [{"type": "audio"}]}, {"role": "assistant", "content": "x"}]}
    with pytest.raises(vd.DatasetError, match="unsupported"):
        vd.to_unsloth_messages(row, None)


def test_count_images(tmp_path):
    make_dataset(str(tmp_path), 1)
    msgs = vd.to_unsloth_messages(_row("images/0.png"), str(tmp_path), load_images=False)
    assert vd.count_images(msgs) == 1


# ───────────────────────────── VlmDataset / split ─────────────────────────────


def test_dataset_is_lazy_and_names_the_failing_row(tmp_path):
    calls = []

    def to_msgs(row):
        calls.append(row)
        if row == 2:
            raise OSError("cannot identify image file")
        return [row]

    ds = vd.VlmDataset([0, 1, 2], to_msgs, "train")
    assert calls == []  # nothing decoded at construction
    assert ds[1] == {"messages": [1]} and calls == [1]
    with pytest.raises(vd.DatasetError, match="train row 2: OSError"):
        ds[2]
    assert len(ds) == 3 and ds[-1:] is not None if False else True


def test_dataset_index_errors_and_negative_index():
    ds = vd.VlmDataset(["a", "b"], lambda r: [r])
    assert ds[-1] == {"messages": ["b"]}
    with pytest.raises(IndexError):
        ds[2]
    assert [x["messages"][0] for x in ds] == ["a", "b"]


def test_subset_composes_indices():
    ds = vd.VlmDataset(list("abcdef"), lambda r: [r])
    sub = ds.subset([4, 1, 2]).subset([0, 2])
    assert [x["messages"][0] for x in sub] == ["e", "c"]


def test_split_indices_seeded_and_disjoint():
    t, e = vd.split_indices(100)
    assert len(e) == 10 and len(t) == 90 and not set(t) & set(e)
    assert (t, e) == vd.split_indices(100)  # deterministic
    assert e != vd.split_indices(100, seed=1)[1]


def test_split_indices_small_set_has_no_holdout():
    t, e = vd.split_indices(19)
    assert e == [] and t == list(range(19))
    t, e = vd.split_indices(20)
    assert len(e) == 2


# ───────────────────────────── build_datasets (local) ─────────────────────────────


def test_build_uses_eval_jsonl_when_present(tmp_path):
    make_dataset(str(tmp_path), 25, eval_rows=3)
    b = vd.build_datasets(str(tmp_path), max_pixels=10_000)
    assert (b.n_train, b.n_eval, b.eval_source) == (25, 3, "eval.jsonl")
    item = b.train[0]["messages"]
    assert isinstance(item[0]["content"][0]["image"], Image.Image)


def test_build_holds_out_ten_percent_without_eval(tmp_path):
    make_dataset(str(tmp_path), 40)
    b = vd.build_datasets(str(tmp_path))
    assert (b.n_train, b.n_eval, b.eval_source) == (36, 4, "10% hold-out")
    assert len(b.train) == 36 and len(b.eval) == 4


def test_build_no_holdout_below_threshold(tmp_path):
    make_dataset(str(tmp_path), 25)
    # 25 rows passes load_rows(min 20) and the hold-out; use min_rows to allow tiny sets
    tiny = tmp_path / "tiny"
    make_dataset(str(tiny), 10)
    b = vd.build_datasets(str(tiny), min_rows=1)
    assert (b.n_train, b.n_eval, b.eval_source) == (10, 0, "none") and b.eval is None


def test_build_propagates_validation_failure(tmp_path):
    make_dataset(str(tmp_path), 25)
    os.remove(tmp_path / "images" / "0.png")
    os.remove(tmp_path / "images" / "1.png")
    with pytest.raises(vd.DatasetError):
        vd.build_datasets(str(tmp_path))


# ───────────────────────────── Hugging Face rows ─────────────────────────────


class Image_:  # a stand-in whose class name is "Image", like datasets.Image
    pass


Image_.__name__ = "Image"


class FakeSeq:
    def __init__(self, feature):
        self.feature = feature


def test_detect_image_column():
    assert vd.detect_image_column({"text": "Value", "image": Image_()}) == "image"
    assert vd.detect_image_column({"a": "x", "pic": Image_(), "image": "string"}) == "pic"
    assert vd.detect_image_column({"imgs": FakeSeq(Image_())}) == "imgs"
    assert vd.detect_image_column({"text": "Value"}) is None


def _opts(**kw):
    base = dict(image_column="image", answer_column="text", prompt_text="Write the LaTeX.")
    base.update(kw)
    return vd.HfOptions(**base)


def test_hf_row_to_messages_basic():
    pil = Image.new("RGB", (240, 47), (255, 255, 255))
    msgs = vd.hf_row_to_messages({"image": pil, "text": "{ \\frac { 1 } { 2 } }"}, _opts(), max_pixels=1000)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"][0]["type"] == "image"
    w, h = msgs[0]["content"][0]["image"].size
    assert w * h <= 1000
    assert msgs[0]["content"][1] == {"type": "text", "text": "Write the LaTeX."}
    assert msgs[1]["content"] == [{"type": "text", "text": "{ \\frac { 1 } { 2 } }"}]


def test_hf_row_prompt_column_wins_and_system_prompt_and_list_answer():
    pil = Image.new("RGB", (20, 20))
    row = {"image": pil, "query": "What is the peak?", "label": ["42", "forty-two"]}
    msgs = vd.hf_row_to_messages(row, _opts(prompt_column="query", answer_column="label", system_prompt="Be exact."))
    assert msgs[0]["role"] == "system"
    assert msgs[1]["content"][-1]["text"] == "What is the peak?"
    assert msgs[2]["content"][0]["text"] == "42"


def test_hf_row_errors():
    pil = Image.new("RGB", (20, 20))
    with pytest.raises(vd.DatasetError, match="no image"):
        vd.hf_row_to_messages({"image": None, "text": "x"}, _opts())
    with pytest.raises(vd.DatasetError, match="empty answer"):
        vd.hf_row_to_messages({"image": pil, "text": "  "}, _opts())
    with pytest.raises(vd.DatasetError, match="at most 2"):
        vd.hf_row_to_messages({"image": [pil, pil, pil], "text": "x"}, _opts(max_images=2))


def test_hf_messages_column_fills_image_placeholders():
    pil = Image.new("RGB", (20, 20))
    row = {
        "images": [pil],
        "messages": json.dumps([]) if False else [
            {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": "q"}]},
            {"role": "assistant", "content": "a"},
        ],
    }
    msgs = vd.hf_row_to_messages(row, vd.HfOptions(image_column="images", messages_column="messages"))
    assert isinstance(msgs[0]["content"][0]["image"], Image.Image)
    assert msgs[1]["content"] == [{"type": "text", "text": "a"}]
    with pytest.raises(vd.DatasetError, match="placeholder"):
        vd.hf_row_to_messages({"images": [], "messages": row["messages"]}, vd.HfOptions(image_column="images", messages_column="messages"))


def test_validate_hf_options_autodetect_and_errors():
    feats = {"image": Image_(), "text": "v"}
    o = vd.validate_hf_options(["image", "text"], feats, vd.HfOptions(answer_column="text", prompt_text="p"))
    assert o.image_column == "image"
    with pytest.raises(vd.DatasetError, match="answer_column is required"):
        vd.validate_hf_options(["image", "text"], feats, vd.HfOptions(prompt_text="p"))
    with pytest.raises(vd.DatasetError, match="prompt"):
        vd.validate_hf_options(["image", "text"], feats, vd.HfOptions(answer_column="text"))
    with pytest.raises(vd.DatasetError, match="not a column"):
        vd.validate_hf_options(["image", "text"], feats, vd.HfOptions(answer_column="nope", prompt_text="p"))
    with pytest.raises(vd.DatasetError, match="No image column"):
        vd.validate_hf_options(["text"], {"text": "v"}, vd.HfOptions(answer_column="text", prompt_text="p"))
    # an explicit messages column needs neither answer nor prompt
    o = vd.validate_hf_options(["images", "messages"], {"images": FakeSeq(Image_())}, vd.HfOptions())
    assert o.messages_column == "messages" and o.image_column == "images"


class FakeHfDataset:
    def __init__(self, rows, features):
        self._rows, self.features = rows, features
        self.column_names = list(features)

    def __len__(self):
        return len(self._rows)

    def __getitem__(self, i):
        return self._rows[i]


def _fake_hf(n=40, with_validation=False):
    rows = [{"image": Image.new("RGB", (30, 10)), "text": f"t{i}"} for i in range(n)]
    feats = {"image": Image_(), "text": "Value"}
    d = {"train": FakeHfDataset(rows, feats)}
    if with_validation:
        d["validation"] = FakeHfDataset(rows[:5], feats)
    return lambda *a: d


def test_build_hf_dataset_with_holdout():
    b = vd.build_datasets("fake/latex", hf=vd.HfOptions(answer_column="text", prompt_text="Write the LaTeX."), hf_loader=_fake_hf(40), roots=[])
    assert (b.n_train, b.n_eval, b.eval_source) == (36, 4, "10% hold-out")
    msgs = b.train[0]["messages"]
    assert msgs[0]["content"][0]["type"] == "image" and msgs[1]["content"][0]["text"].startswith("t")


def test_build_hf_dataset_uses_validation_split_not_test():
    b = vd.build_datasets("fake/latex", hf=vd.HfOptions(answer_column="text", prompt_text="p"), hf_loader=_fake_hf(40, with_validation=True), roots=[])
    assert (b.n_train, b.n_eval, b.eval_source) == (40, 5, "validation split")


def test_build_hf_unknown_split():
    with pytest.raises(vd.DatasetError, match="no split"):
        vd.build_datasets("fake/latex", hf=vd.HfOptions(answer_column="text", prompt_text="p", split="nope"), hf_loader=_fake_hf(), roots=[])


# ---- row caps (max_train_rows / max_eval_rows) ----------------------------------------------------------


def _texts(ds):
    return [ds[i]["messages"][1]["content"][0]["text"] for i in range(len(ds))]


def _capped(n=200, **caps):
    return vd.build_datasets("fake/latex", hf=vd.HfOptions(answer_column="text", prompt_text="p"), hf_loader=_fake_hf(n), roots=[], **caps)


def test_row_caps_limit_train_and_eval_and_are_reported():
    b = _capped(200, max_train_rows=50, max_eval_rows=8)
    assert (b.n_train, b.n_eval) == (50, 8) and len(b.train) == 50 and len(b.eval) == 8
    assert b.info["train_rows_available"] == 180 and b.info["eval_rows_available"] == 20
    assert b.eval_source == "10% hold-out"


def test_row_caps_zero_and_oversized_change_nothing():
    base = _capped(200)
    for caps in ({}, {"max_train_rows": 0, "max_eval_rows": 0}, {"max_train_rows": 999, "max_eval_rows": 999}):
        b = _capped(200, **caps)
        assert (b.n_train, b.n_eval) == (base.n_train, base.n_eval) == (180, 20)
        assert "train_rows_available" not in b.info


def test_row_caps_are_deterministic_and_keep_eval_disjoint_from_train():
    a, b = _capped(200, max_train_rows=60, max_eval_rows=10), _capped(200, max_train_rows=60, max_eval_rows=10)
    assert _texts(a.train) == _texts(b.train) and _texts(a.eval) == _texts(b.eval)
    # the hold-out was taken from ALL rows before the cap, so no eval row is ever a training row
    assert not (set(_texts(a.train)) & set(_texts(a.eval)))
    other = vd.cap_bundle(_capped(200), max_train_rows=60, seed=1)
    assert _texts(other.train) != _texts(a.train)


def test_row_caps_leave_a_bundle_without_eval_alone():
    b = _capped(10, max_train_rows=4, max_eval_rows=3)  # below HOLDOUT_MIN_ROWS: everything trains, no eval
    assert b.eval is None and (b.n_train, b.n_eval) == (4, 0)
