import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";

describe("EmptyState", () => {
  it("renders the title, description and action", () => {
    render(
      <EmptyState title="No experiments" description="Create your first one" action={<button>New</button>} />
    );
    expect(screen.getByText("No experiments")).toBeInTheDocument();
    expect(screen.getByText("Create your first one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("exposes a polite status region with a label", () => {
    render(<LoadingState label="Loading models…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading models…");
  });
});

describe("ErrorState", () => {
  it("renders an alert and calls onRetry when retried", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("hides the retry button when no handler is given", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
