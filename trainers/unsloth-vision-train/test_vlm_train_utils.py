"""CPU-only tests for vlm_train_utils.py: marker derivation (chat templates stored as fixture strings), the
first-batch mask check on fake batches, the length audit, params and the processor knob.

The Jinja templates below are PLAUSIBLE MINIMAL reimplementations of the Gemma-3 and Qwen3-VL chat templates
(same turn structure and special tokens, none of the tool / thinking branches). They are not byte-exact copies
of the files shipped with the models. The first real run on the box prints the markers derived from the real
templates (look for "Turn markers:" in the job log), which is the check that matters.

Run: python -m pytest trainers/unsloth-vision-train
"""

import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import vlm_train_utils as vt  # noqa: E402

# ───────────────────────────── chat template fixtures ─────────────────────────────

GEMMA3_TEMPLATE = """{{ bos_token }}
{%- if messages[0]['role'] == 'system' -%}
    {%- if messages[0]['content'] is string -%}
        {%- set first_user_prefix = messages[0]['content'] + '\n\n' -%}
    {%- else -%}
        {%- set first_user_prefix = messages[0]['content'][0]['text'] + '\n\n' -%}
    {%- endif -%}
    {%- set loop_messages = messages[1:] -%}
{%- else -%}
    {%- set first_user_prefix = "" -%}
    {%- set loop_messages = messages -%}
{%- endif -%}
{%- for message in loop_messages -%}
    {%- if message['role'] == 'assistant' -%}
        {%- set role = "model" -%}
    {%- else -%}
        {%- set role = message['role'] -%}
    {%- endif -%}
    {{ '<start_of_turn>' + role + '\n' + (first_user_prefix if loop.first else "") }}
    {%- if message['content'] is string -%}
        {{ message['content'] | trim }}
    {%- elif message['content'] is iterable -%}
        {%- for item in message['content'] -%}
            {%- if item['type'] == 'image' -%}
                {{ '<start_of_image>' }}
            {%- elif item['type'] == 'text' -%}
                {{ item['text'] | trim }}
            {%- endif -%}
        {%- endfor -%}
    {%- endif -%}
    {{ '<end_of_turn>\n' }}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{ '<start_of_turn>model\n' }}
{%- endif -%}
"""

QWEN3VL_TEMPLATE = """{%- for message in messages -%}
    {{ '<|im_start|>' + message.role + '\n' }}
    {%- if message.content is string -%}
        {{ message.content }}
    {%- else -%}
        {%- for item in message.content -%}
            {%- if item.type == 'image' -%}
                {{ '<|vision_start|><|image_pad|><|vision_end|>' }}
            {%- elif item.type == 'text' -%}
                {{ item.text }}
            {%- endif -%}
        {%- endfor -%}
    {%- endif -%}
    {{ '<|im_end|>\n' }}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{ '<|im_start|>assistant\n' }}
{%- endif -%}
"""

# a template that insists on content PARTS (indexes content[0]["type"]): the string render raises
PARTS_ONLY_TEMPLATE = """{%- for message in messages -%}
{{ '<|im_start|>' + message.role + '\n' + message.content[0].text + '<|im_end|>\n' }}
{%- endfor -%}"""

LLAMA3_TEMPLATE = """{{ bos_token }}
{%- for message in messages -%}
{{ '<|start_header_id|>' + message['role'] + '<|end_header_id|>\n\n' + message['content'] | trim + '<|eot_id|>' }}
{%- endfor -%}"""

ALPACA_TEMPLATE = """{%- for message in messages -%}
{%- if message['role'] == 'user' -%}{{ '### Instruction:\n' + message['content'] + '\n\n' }}{%- else -%}{{ '### Response:\n' + message['content'] + '\n\n' }}{%- endif -%}
{%- endfor -%}"""


def jinja_render(template_src, **extra):
    jinja2 = pytest.importorskip("jinja2")
    env = jinja2.Environment(undefined=jinja2.StrictUndefined)
    tpl = env.from_string(template_src)
    return lambda messages: tpl.render(messages=messages, bos_token="<bos>", add_generation_prompt=False, **extra)


# pure-python twins, so the core logic is tested even where jinja2 is not installed
def py_gemma(messages):
    out, prefix = "<bos>", ""
    if messages[0]["role"] == "system":
        c = messages[0]["content"]
        prefix = (c if isinstance(c, str) else c[0]["text"]) + "\n\n"
        messages = messages[1:]
    for i, m in enumerate(messages):
        role = "model" if m["role"] == "assistant" else m["role"]
        c = m["content"]
        body = c.strip() if isinstance(c, str) else "".join("<start_of_image>" if p["type"] == "image" else p["text"].strip() for p in c)
        out += f"<start_of_turn>{role}\n{prefix if i == 0 else ''}{body}<end_of_turn>\n"
    return out


def py_chatml(messages):
    return "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)


# ───────────────────────────── derive_turn_markers ─────────────────────────────


def test_gemma3_markers_python_twin():
    m = vt.derive_turn_markers(py_gemma)
    assert m.instruction_part == "<start_of_turn>user\n"
    assert m.response_part == "<start_of_turn>model\n"
    assert m.terminator == "<end_of_turn>\n"


def test_chatml_markers_python_twin():
    m = vt.derive_turn_markers(py_chatml)
    assert (m.instruction_part, m.response_part, m.terminator) == ("<|im_start|>user\n", "<|im_start|>assistant\n", "<|im_end|>\n")


def test_gemma3_markers_from_jinja_template():
    m = vt.derive_turn_markers(jinja_render(GEMMA3_TEMPLATE))
    assert (m.instruction_part, m.response_part, m.terminator) == ("<start_of_turn>user\n", "<start_of_turn>model\n", "<end_of_turn>\n")


def test_qwen3vl_markers_from_jinja_template():
    m = vt.derive_turn_markers(jinja_render(QWEN3VL_TEMPLATE))
    assert (m.instruction_part, m.response_part, m.terminator) == ("<|im_start|>user\n", "<|im_start|>assistant\n", "<|im_end|>\n")


def test_llama3_markers_from_jinja_template():
    m = vt.derive_turn_markers(jinja_render(LLAMA3_TEMPLATE))
    assert m.instruction_part == "<|start_header_id|>user<|end_header_id|>\n\n"
    assert m.response_part == "<|start_header_id|>assistant<|end_header_id|>\n\n"
    assert m.terminator == "<|eot_id|>"


def test_template_that_needs_content_parts_is_retried_with_parts():
    m = vt.derive_turn_markers(jinja_render(PARTS_ONLY_TEMPLATE))
    assert m.instruction_part == "<|im_start|>user\n" and m.response_part == "<|im_start|>assistant\n"


def test_template_without_end_of_turn_text_gets_a_note():
    m = vt.derive_turn_markers(jinja_render(ALPACA_TEMPLATE))
    assert m.instruction_part == "### Instruction:\n" and m.response_part == "### Response:\n"
    assert m.terminator == "\n\n"


def test_markers_are_checked_against_a_real_sample():
    sample = py_gemma([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}])
    assert vt.derive_turn_markers(py_gemma, sample_text=sample).response_part in sample
    with pytest.raises(vt.MarkerError, match="does not occur"):
        vt.derive_turn_markers(py_gemma, sample_text="<|im_start|>user\nhi<|im_end|>\n")


def test_template_that_drops_a_turn_fails_loudly():
    def broken(messages):  # only renders the first user turn
        return f"<u>{messages[0]['content']}</u>"

    with pytest.raises(vt.MarkerError, match="occurs 0x"):
        vt.derive_turn_markers(broken)


def test_template_that_cannot_render_fails_with_a_marker_error():
    def boom(messages):
        raise ValueError("raise_exception")

    with pytest.raises(vt.MarkerError, match="cannot render"):
        vt.derive_turn_markers(boom)


def test_gemma_marker_is_not_a_bare_newline_even_with_a_system_turn_in_play():
    # the original unsloth-llm-train derivation produced instruction "\n" for Gemma: guard the regression
    m = vt.derive_turn_markers(jinja_render(GEMMA3_TEMPLATE))
    assert len(m.instruction_part) > 5 and m.instruction_part.strip() != ""


def test_count_assistant_turns():
    assert vt.count_assistant_turns([{"role": "user"}, {"role": "assistant"}, {"role": "user"}, {"role": "assistant"}]) == 2


# ───────────────────────────── mask check ─────────────────────────────

IMG, EOT, PAD = 262144, 106, 0


def gemma_batch(n_img=4, answer=(50, 51, 52), trained=True, mask_eot=False, train_image=False, truncated_len=None):
    """One Gemma-3-shaped sample as (input_ids, labels, attention_mask): bos, user turn with image tokens and
    a prompt, model turn with an answer and its end-of-turn token."""
    head = [2, 105, 2364, 107]
    imgs = [IMG] * n_img
    prompt = [9, 8, 7]
    mid = [EOT, 107, 105, 4368, 107]
    ans = list(answer)
    tail = [EOT, 107]
    ids = head + imgs + prompt + mid + ans + tail
    labels = [-100] * len(ids)
    if trained:
        start = len(head + imgs + prompt + mid)
        for i in range(start, len(ids)):
            labels[i] = ids[i]
        if mask_eot:
            labels[-2] = -100
    if train_image:
        labels[len(head)] = IMG
    attn = [1] * len(ids)
    return ids, labels, attn


def test_mask_ok():
    ids, labs, attn = gemma_batch()
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], eot_token_ids=[EOT], expected_eot_per_row=[1], attention_mask=[attn], expect_images=True)
    assert rep.ok, rep.problems
    assert rep.image_tokens == 4 and rep.image_tokens_trainable == 0
    assert (rep.eot_trainable, rep.eot_expected) == (1, 1)
    assert 0 < rep.fraction < 1
    assert "trainable" in rep.summary()


def test_mask_zero_percent_fails():
    ids, labs, attn = gemma_batch(trained=False)
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], attention_mask=[attn])
    assert not rep.ok and "0%" in rep.problems[0]


def test_mask_hundred_percent_fails():
    ids, _, attn = gemma_batch()
    rep = vt.check_mask([ids], [list(ids)], image_token_ids=[IMG], attention_mask=[attn])
    assert not rep.ok and any("100%" in p for p in rep.problems)
    assert any("image token" in p for p in rep.problems)  # everything trainable includes the image tokens


def test_mask_trainable_image_token_fails():
    ids, labs, attn = gemma_batch(train_image=True)
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], attention_mask=[attn])
    assert not rep.ok and any("image token" in p for p in rep.problems)


def test_mask_end_of_turn_masked_fails():
    ids, labs, attn = gemma_batch(mask_eot=True)
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], eot_token_ids=[EOT], expected_eot_per_row=[1], attention_mask=[attn])
    assert not rep.ok and any("never learn to stop" in p for p in rep.problems)


def test_mask_missing_images_fails_only_when_expected():
    ids, labs, attn = gemma_batch(n_img=0)
    assert not vt.check_mask([ids], [labs], image_token_ids=[IMG], expect_images=True).ok
    assert vt.check_mask([ids], [labs], image_token_ids=[IMG], expect_images=False).ok


def test_mask_padding_is_not_counted():
    ids, labs, attn = gemma_batch()
    pad = 6
    rep_pad = vt.check_mask([ids + [PAD] * pad], [labs + [-100] * pad], image_token_ids=[IMG], attention_mask=[attn + [0] * pad])
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], attention_mask=[attn])
    assert rep_pad.tokens == rep.tokens and rep_pad.trainable == rep.trainable


def test_mask_truncated_rows_skip_the_end_of_turn_check():
    ids, labs, attn = gemma_batch(mask_eot=True)
    rep = vt.check_mask([ids], [labs], image_token_ids=[IMG], eot_token_ids=[EOT], expected_eot_per_row=[1], attention_mask=[attn], max_length=len(ids))
    assert rep.ok and not rep.eot_checked


def test_mask_batch_of_two_rows_and_numpy_input():
    np = pytest.importorskip("numpy")
    a = gemma_batch()
    b = gemma_batch(answer=(60, 61))
    width = max(len(a[0]), len(b[0]))

    def padded(x, fill):
        return x + [fill] * (width - len(x))

    ids = np.array([padded(a[0], 0), padded(b[0], 0)])
    labs = np.array([padded(a[1], -100), padded(b[1], -100)])
    attn = np.array([padded(a[2], 0), padded(b[2], 0)])
    rep = vt.check_mask(ids, labs, image_token_ids=[IMG], eot_token_ids=[EOT], expected_eot_per_row=[1, 1], attention_mask=attn, expect_images=True)
    assert rep.ok, rep.problems
    assert rep.rows == 2 and rep.eot_expected == 2 and rep.eot_trainable == 2


def test_mask_shape_mismatch_raises():
    with pytest.raises(ValueError):
        vt.check_mask([[1, 2]], [[1]])


def test_mask_with_torch_tensors():
    torch = pytest.importorskip("torch")
    ids, labs, attn = gemma_batch()
    rep = vt.check_mask(torch.tensor([ids]), torch.tensor([labs]), image_token_ids=[IMG], eot_token_ids=[EOT], expected_eot_per_row=[1], attention_mask=torch.tensor([attn]))
    assert rep.ok


def test_mask_image_labels_numpy_forces_ignore():
    np = pytest.importorskip("numpy")
    ids, labs, _ = gemma_batch(train_image=True)
    labs = [i if i != -100 else l for i, l in zip(ids, labs)]  # make the whole thing trainable
    out = vt.mask_image_labels({"input_ids": np.array([ids]), "labels": np.array([labs])}, [IMG])
    assert all(l == -100 for t, l in zip(ids, out["labels"][0].tolist()) if t == IMG)
    assert out["labels"][0][-1] == ids[-1]  # text stays trainable


def test_mask_image_labels_torch():
    torch = pytest.importorskip("torch")
    ids, _, _ = gemma_batch()
    batch = {"input_ids": torch.tensor([ids]), "labels": torch.tensor([ids])}
    out = vt.mask_image_labels(batch, [IMG])
    assert int((out["labels"] == IMG).sum()) == 0 and int((out["labels"] != -100).sum()) > 0


def test_mask_image_labels_noop_without_ids():
    batch = {"input_ids": [[1]], "labels": [[1]]}
    assert vt.mask_image_labels(batch, []) is batch


# ───────────────────────────── image token ids ─────────────────────────────


class FakeTok:
    unk_token_id = 3
    vocab = {"<image_soft_token>": 262144, "<start_of_image>": 255999, "<end_of_image>": 256000}

    def convert_tokens_to_ids(self, t):
        return self.vocab.get(t, 3)


def test_image_token_ids_gemma_style():
    cfg = SimpleNamespace(image_token_index=262144, boi_token_index=255999)
    proc = SimpleNamespace(tokenizer=FakeTok(), image_token="<image_soft_token>", boi_token="<start_of_image>", eoi_token="<end_of_image>")
    assert vt.image_token_ids(cfg, proc) == [255999, 256000, 262144]


def test_image_token_ids_qwen_style_from_config_only():
    cfg = SimpleNamespace(image_token_id=151655, vision_start_token_id=151652, vision_end_token_id=151653)
    assert vt.image_token_ids(cfg) == [151652, 151653, 151655]


def test_image_token_ids_unknown_tokens_ignored():
    proc = SimpleNamespace(tokenizer=FakeTok(), image_token="<nope>")
    assert vt.image_token_ids(SimpleNamespace(), proc) == []


# ───────────────────────────── length audit ─────────────────────────────


def test_audit_lengths_ok_and_warn():
    a = vt.audit_lengths([300, 400, 5000], 4096, max_fraction=0.5)
    assert not a.failed and a.over == 1 and "1/3" in a.message and "truncated" in a.message
    b = vt.audit_lengths([300, 400], 4096)
    assert not b.failed and b.over == 0 and "0/2" in b.message


def test_audit_lengths_fails_above_twenty_percent():
    a = vt.audit_lengths([5000] * 3 + [300] * 7, 4096)  # 30 %
    assert a.failed and "3/10" in a.message
    ok = vt.audit_lengths([5000] * 2 + [300] * 8, 4096)  # exactly 20 % is allowed
    assert not ok.failed


def test_audit_lengths_empty():
    a = vt.audit_lengths([], 4096)
    assert not a.failed and a.n == 0


def test_sample_indices():
    assert vt.sample_indices(10, 200) == list(range(10))
    s = vt.sample_indices(1000, 200)
    assert len(s) == 200 and len(set(s)) == 200 and s == sorted(s) and s == vt.sample_indices(1000, 200)


# ───────────────────────────── processor knob ─────────────────────────────


def test_apply_max_pixels_qwen_style():
    ip = SimpleNamespace(max_pixels=16777216, size={"shortest_edge": 65536, "longest_edge": 16777216})
    msg = vt.apply_max_pixels(SimpleNamespace(image_processor=ip), 1003520)
    assert ip.max_pixels == 1003520 and ip.size["longest_edge"] == 1003520
    assert "max_pixels" in msg and "fixed" not in msg


def test_apply_max_pixels_gemma_style_is_ignored_with_a_message():
    ip = SimpleNamespace(size={"height": 896, "width": 896})
    msg = vt.apply_max_pixels(SimpleNamespace(image_processor=ip), 1003520)
    assert "fixed image size" in msg and ip.size == {"height": 896, "width": 896}


def test_apply_max_pixels_no_image_processor():
    assert "no image_processor" in vt.apply_max_pixels(SimpleNamespace(), 100)


def test_apply_max_pixels_never_raises():
    class Locked:
        size = None

        @property
        def max_pixels(self):
            return 1

        @max_pixels.setter
        def max_pixels(self, v):
            raise AttributeError("read-only")

    assert "could not set" in vt.apply_max_pixels(SimpleNamespace(image_processor=Locked()), 5)


# ───────────────────────────── params ─────────────────────────────


def test_read_params_defaults():
    p = vt.read_params({"dataset": "ds"})
    assert (p.batch_size, p.gradient_accumulation_steps, p.max_seq_length, p.lora_r, p.lora_alpha) == (1, 8, 4096, 16, 16)
    assert (p.finetune_vision_layers, p.finetune_language_layers, p.max_pixels, p.max_images_per_sample) == (False, True, 1003520, 4)
    assert p.lr == 2e-4 and p.num_train_epochs == 1 and p.model_name == "aisingapore/Gemma-SEA-LION-v4-4B-VL"


def test_read_params_coerces_strings_and_ignores_unknown_keys():
    p = vt.read_params({"dataset": "ds", "lr": "1e-4", "batch_size": "2", "finetune_vision_layers": "true", "max_steps": 30.0, "surprise": 1, "image_column": " image "})
    assert p.lr == 1e-4 and p.batch_size == 2 and p.finetune_vision_layers is True and p.max_steps == 30 and p.image_column == "image"


def test_read_params_none_means_default():
    assert vt.read_params({"dataset": "d", "lr": None}).lr == 2e-4


@pytest.mark.parametrize(
    "cfg,needle",
    [
        ({}, "dataset is empty"),
        ({"dataset": "d", "batch_size": 0}, "batch_size"),
        ({"dataset": "d", "batch_size": "two"}, "batch_size"),
        ({"dataset": "d", "batch_size": 1.5}, "whole number"),
        ({"dataset": "d", "max_steps": 0}, "max_steps"),
        ({"dataset": "d", "lora_dropout": 1.0}, "lora_dropout"),
        ({"dataset": "d", "lr": 0}, "lr"),
        ({"dataset": "d", "finetune_vision_layers": False, "finetune_language_layers": False}, "at least one"),
        ({"dataset": "d", "finetune_vision_layers": "maybe"}, "boolean"),
    ],
)
def test_read_params_rejects(cfg, needle):
    with pytest.raises(vt.ParamError, match=needle):
        vt.read_params(cfg)


def test_params_to_dict_roundtrip_keys():
    d = vt.read_params({"dataset": "d"}).to_dict()
    for k in ("finetune_vision_layers", "finetune_language_layers", "max_pixels", "model_name"):
        assert k in d


# ───────────────────────────── adapter keys / memory ─────────────────────────────


def test_adapter_key_report_language_only():
    keys = [f"base_model.model.model.language_model.layers.{i}.self_attn.q_proj.lora_A.weight" for i in range(4)]
    keys += ["base_model.model.model.language_model.layers.0.mlp.up_proj.lora_B.weight"]
    assert vt.adapter_key_report(keys) == {"total": 5, "lora": 5, "vision": 0}


def test_adapter_key_report_counts_vision_tower_and_qwen_visual():
    keys = [
        "base_model.model.model.vision_tower.vision_model.encoder.layers.0.self_attn.q_proj.lora_A.weight",
        "base_model.model.model.visual.blocks.0.attn.qkv.lora_B.weight",
        "base_model.model.model.language_model.layers.0.self_attn.q_proj.lora_A.weight",
        "base_model.model.model.visual.blocks.0.attn.qkv.weight",  # not a LoRA key
    ]
    assert vt.adapter_key_report(keys) == {"total": 4, "lora": 3, "vision": 2}


def test_read_mem_available(tmp_path):
    p = tmp_path / "meminfo"
    p.write_text("MemTotal: 134217728 kB\nMemAvailable: 16777216 kB\n")
    assert vt.read_mem_available_gib(str(p)) == 16.0
    assert vt.read_mem_available_gib(str(tmp_path / "missing")) is None


def test_skip_trackio_model_card_replaces_the_lookup(monkeypatch):
    import sys
    import types

    def broken():
        raise ImportError("cannot import name 'CommitOperationAdd'")

    pkg = types.ModuleType("trl")
    pkg.__path__ = []
    trainer_pkg = types.ModuleType("trl.trainer")
    trainer_pkg.__path__ = []
    base = types.ModuleType("trl.trainer.base_trainer")
    base.get_trackio_space_url = broken
    utils = types.ModuleType("trl.trainer.utils")
    utils.get_trackio_space_url = broken
    for name, mod in {"trl": pkg, "trl.trainer": trainer_pkg, "trl.trainer.base_trainer": base, "trl.trainer.utils": utils}.items():
        monkeypatch.setitem(sys.modules, name, mod)
    monkeypatch.delitem(sys.modules, "trl.trainer.sft_trainer", raising=False)

    line = vt.skip_trackio_model_card()
    assert base.get_trackio_space_url() is None and utils.get_trackio_space_url() is None
    assert "base_trainer" in line and "utils" in line


def test_skip_trackio_model_card_never_raises_without_trl(monkeypatch):
    import sys

    for name in ("trl", "trl.trainer", "trl.trainer.base_trainer", "trl.trainer.utils", "trl.trainer.sft_trainer"):
        monkeypatch.setitem(sys.modules, name, None)  # import raises ImportError
    assert "no trackio lookup" in vt.skip_trackio_model_card()


def test_row_cap_params_default_and_validate():
    p = vt.read_params({"model_name": "m", "dataset": "d"})
    assert (p.max_train_rows, p.max_eval_rows) == (0, 500)
    p = vt.read_params({"model_name": "m", "dataset": "d", "max_train_rows": "3200", "max_eval_rows": 100})
    assert (p.max_train_rows, p.max_eval_rows) == (3200, 100)
    with pytest.raises(vt.ParamError, match="max_train_rows must be >= 0"):
        vt.read_params({"model_name": "m", "dataset": "d", "max_train_rows": -1})


def test_prune_checkpoints_keeps_the_newest_and_touches_nothing_else(tmp_path):
    for n in (50, 100, 150, 1000, 200):
        (tmp_path / f"checkpoint-{n}").mkdir()
    (tmp_path / "checkpoint-final").mkdir()  # not a step number: left alone
    (tmp_path / "checkpoint-7.txt").write_text("x")  # a file, not a folder: left alone
    removed = vt.prune_checkpoints(str(tmp_path), keep=2)
    assert removed == ["checkpoint-50", "checkpoint-100", "checkpoint-150"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["checkpoint-1000", "checkpoint-200", "checkpoint-7.txt", "checkpoint-final"]


def test_prune_checkpoints_is_safe_on_missing_or_small_folders(tmp_path):
    assert vt.prune_checkpoints(str(tmp_path / "missing")) == []
    (tmp_path / "checkpoint-5").mkdir()
    assert vt.prune_checkpoints(str(tmp_path), keep=2) == []
    assert vt.prune_checkpoints("", keep=2) == []
