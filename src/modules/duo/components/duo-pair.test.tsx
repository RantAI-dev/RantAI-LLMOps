import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuoRoleStatus } from "@/lib/duo-deploy";
import { DuoPair } from "@/modules/duo/components/duo-pair";

const role = (over: Partial<DuoRoleStatus>): DuoRoleStatus => ({
  exists: true,
  running: true,
  image: "vllm/vllm-openai:cu130-nightly",
  baseModel: "Qwen/Qwen3-1.7B",
  adapterPath: null,
  maxModelLen: 8192,
  label: "System 1",
  served: "system1",
  answering: true,
  hasPrevious: false,
  job: null,
  ...over,
});
const ADAPTER = "/root/.transformerlab/orgs/o/workspace/experiments/rantai-ft/jobs/abcd1234-0000/models/m";
const status = (docker: boolean) => ({
  docker,
  roles: {
    s1: role({}),
    s2: role({ label: "System 2", served: "system2", baseModel: "Qwen/Qwen3-4B-Thinking-2507", hasPrevious: true }),
  },
  adapters: [
    { jobId: "abcd1234-0000", path: ADAPTER, base: "Qwen/Qwen3-1.7B" },
    { jobId: "ffff0000-0000", path: "/root/.transformerlab/x/jobs/ffff0000-0000/models/m", base: "aisingapore/Qwen-SEA-LION-v4-8B-VL" },
  ],
});

const fetchMock = vi.fn();
const json = (body: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(body), { status: s }));
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DuoPair", () => {
  it("shows both roles read-only when no Duo deployer is configured", async () => {
    fetchMock.mockImplementation(() => json(status(false)));
    render(<DuoPair />);
    expect(await screen.findByText(/Read only: changing models needs the Duo deployer/)).toBeInTheDocument();
    expect(screen.getByText("Qwen/Qwen3-4B-Thinking-2507")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deploy/i })).not.toBeInTheDocument();
  });

  it("deploys System 1 with an adapter trained on its base, and offers only fitting adapters", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "POST" ? json({ phase: "replacing" }, 202) : json(status(true))));
    render(<DuoPair />);
    const user = userEvent.setup();
    const [s1Adapter] = await screen.findAllByRole("combobox");
    expect(screen.getAllByRole("option", { name: /job abcd1234/ }).length).toBe(1);
    expect(screen.queryByRole("option", { name: /job ffff0000/ })).not.toBeInTheDocument();
    await user.selectOptions(s1Adapter, ADAPTER);
    await user.click(screen.getAllByRole("button", { name: /deploy/i })[0]);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(init.body)).toEqual({ role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER });
    expect(screen.getByRole("button", { name: /roll back/i })).toBeInTheDocument(); // System 2 has a previous container
  });
});
