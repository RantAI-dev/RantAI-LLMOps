import { describe, expect, it } from "vitest";

import { buildFormattingTemplate, csvToJsonl, fineTuneTag, normalizeJsonl } from "@/lib/finetune";

describe("buildFormattingTemplate", () => {
  it("uses the Alpaca shape for instruction/input/output", () => {
    const t = buildFormattingTemplate(["instruction", "input", "output"]);
    expect(t).toContain("{{instruction}}");
    expect(t).toContain("{{input}}");
    expect(t).toContain("{{output}}");
  });

  it("omits input when absent", () => {
    const t = buildFormattingTemplate(["instruction", "output"]);
    expect(t).toContain("{{instruction}}");
    expect(t).not.toContain("{{input}}");
  });

  it("handles prompt/completion datasets", () => {
    expect(buildFormattingTemplate(["prompt", "completion"])).toBe(
      "### Question:\n{{prompt}}\n\n### Answer:\n{{completion}}"
    );
  });

  it("passes a plain text column straight through", () => {
    expect(buildFormattingTemplate(["text"])).toBe("{{text}}");
  });

  it("falls back to joining unknown columns", () => {
    expect(buildFormattingTemplate(["a", "b"])).toBe("{{a}}\n{{b}}");
  });
});

describe("fineTuneTag", () => {
  it("disambiguates same-named runs by job id (no collision)", () => {
    expect(fineTuneTag("My Run", "1")).not.toBe(fineTuneTag("My Run", "2"));
  });

  it("is stable for the same name + job id (listing must match export)", () => {
    expect(fineTuneTag("My Run", "42")).toBe(fineTuneTag("My Run", "42"));
  });

  it("always carries one nqr- prefix and a slugified name", () => {
    expect(fineTuneTag("My Run", "42")).toBe("nqr-my-run-42");
    expect(fineTuneTag("nqr-already", "7")).toBe("nqr-already-7");
  });
});

describe("csvToJsonl", () => {
  it("maps header row to JSON object keys per data row", () => {
    const out = csvToJsonl("question,answer\nApa ibukota Jepang?,Tokyo\nWarna langit?,Biru");
    expect(out.split("\n")).toEqual([
      '{"question":"Apa ibukota Jepang?","answer":"Tokyo"}',
      '{"question":"Warna langit?","answer":"Biru"}',
    ]);
  });

  it("handles quoted fields with commas, escaped quotes, and CRLF", () => {
    const out = csvToJsonl('a,b\r\n"x,y","he said ""hi"""\r\n');
    expect(out).toBe('{"a":"x,y","b":"he said \\"hi\\""}');
  });

  it("pads ragged rows with empty strings", () => {
    expect(csvToJsonl("a,b,c\n1,2")).toBe('{"a":"1","b":"2","c":""}');
  });

  it("rejects a header-only file, empty/duplicate headers, and over-wide rows", () => {
    expect(() => csvToJsonl("a,b")).toThrow(); // header only
    expect(() => csvToJsonl("a,,c\n1,2,3")).toThrow(); // empty header column
    expect(() => csvToJsonl("a,a\n1,2")).toThrow(/duplikat/); // duplicate header
    expect(() => csvToJsonl("a,b\n1,2,3")).toThrow(); // row wider than header
  });
});

describe("normalizeJsonl", () => {
  it("keeps valid object lines and drops blank lines", () => {
    expect(normalizeJsonl('{"a":1}\n\n{"b":2}\n')).toBe('{"a":1}\n{"b":2}');
  });

  it("rejects a non-JSON line with its REAL file line number (blank lines counted)", () => {
    expect(() => normalizeJsonl('{"a":1}\nnope')).toThrow(/Baris 2/);
    // Blank line 2 is skipped but still counted, so the bad line is 3 — not 2.
    expect(() => normalizeJsonl('{"a":1}\n\nnope')).toThrow(/Baris 3/);
  });

  it("rejects lines that aren't JSON objects", () => {
    expect(() => normalizeJsonl("[1,2,3]")).toThrow();
    expect(() => normalizeJsonl("42")).toThrow();
  });

  it("rejects an empty file", () => {
    expect(() => normalizeJsonl("   \n  ")).toThrow();
  });
});
