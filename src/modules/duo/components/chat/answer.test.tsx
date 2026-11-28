import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Answer, chartSvg } from "@/modules/duo/components/chat/answer";

describe("Answer", () => {
  it("renders Markdown, tables and maths, and escapes the model's HTML", () => {
    const { container } = render(<Answer text={"**Bold** $x^2$ <img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("math")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("turns cited numbers into source buttons only for known sources", () => {
    const { container } = render(<Answer text="As stated [1] and [3]." cites={[1]} />);
    expect(container.querySelectorAll("button.cite")).toHaveLength(1);
    expect(container.textContent).toContain("[3]");
  });

  it("draws a bar chart from a chart block", () => {
    const { container } = render(<Answer text={'```chart\n{"type":"bar","title":"Sales","data":[{"month":"Jan","sales":3},{"month":"Feb","sales":5}]}\n```'} />);
    expect(container.querySelector("figure.nvchart svg.duo-chart rect")).not.toBeNull();
  });

  it("shows a caret while streaming", () => {
    const { container } = render(<Answer text="Partial" streaming />);
    expect(container.querySelector(".caret")).not.toBeNull();
  });
});

describe("chartSvg", () => {
  it("draws pie and line charts, and declines unsupported kinds", () => {
    expect(chartSvg({ type: "pie", data: [{ label: "A", value: 1 }, { label: "B", value: 3 }] })).toContain("<path");
    expect(chartSvg({ type: "line", series: [{ id: "s", data: [{ x: "a", y: 1 }, { x: "b", y: 2 }] }] })).toContain("<polyline");
    expect(chartSvg({ type: "sankey" })).toBeNull();
    expect(chartSvg({ type: "pie", data: [] })).toBeNull();
  });
});
