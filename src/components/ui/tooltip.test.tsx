import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InfoTip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

describe("InfoTip", () => {
  it("renders an accessible info button and hides the tip until interaction", () => {
    render(<InfoTip label="What is this">Secondary explanation</InfoTip>);
    expect(screen.getByRole("button", { name: "What is this" })).toBeInTheDocument();
    // The explanatory copy stays out of the DOM/hidden until the tooltip opens.
    expect(screen.queryByText("Secondary explanation")).not.toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("renders its content when open", () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger render={<button type="button">trigger</button>} />
        <TooltipContent>Helpful detail</TooltipContent>
      </Tooltip>
    );
    expect(screen.getByText("Helpful detail")).toBeInTheDocument();
  });
});
