import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/multiAgent.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const mockUseAgents = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => mockUseAgents(...args),
}));

const mutateAsync = vi.fn();
const mockUseLaunchMultiAgentRun = vi.fn();
vi.mock("@/lib/hooks/multiAgent", () => ({
  useLaunchMultiAgentRun: (...args: unknown[]) => mockUseLaunchMultiAgentRun(...args),
}));

import { AgentPicker } from "./AgentPicker";
import { PrDetailHeader } from "../PrDetailHeader/PrDetailHeader";
import type { PrDetail } from "@/lib/types";

/** Fully-typed `PrDetail` factory — every required field gets a sensible
    default so fixtures compile-check against the real contract instead of
    being force-cast with `as PrDetail` (which would hide missing/renamed
    fields from the type checker). */
function buildPrDetail(overrides: Partial<PrDetail> = {}): PrDetail {
  return {
    number: 42,
    title: "Add feature",
    author: "octocat",
    branch: "feature-x",
    base: "main",
    head_sha: "abc123",
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: "open",
    files: [],
    commits: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  push.mockReset();
  mockUseAgents.mockReset();
  mutateAsync.mockReset();
  mockUseLaunchMultiAgentRun.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENTS = [
  { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Style", model: "gpt-4.1", enabled: true },
];

function setup() {
  mockUseAgents.mockReturnValue({ data: AGENTS });
  mockUseLaunchMultiAgentRun.mockReturnValue({ mutateAsync, isPending: false });
}

describe("AgentPicker", () => {
  it("pre-selects all agents, launches the run, and navigates to its results", async () => {
    setup();
    mutateAsync.mockResolvedValueOnce({ id: "run-1", pr_id: "pr1", runs: [] });
    renderWithIntl(<AgentPicker prId="pr1" />);

    // The trigger reads "Run Review"; the run button lives inside the panel it
    // opens (design parity) — open it first.
    fireEvent.click(screen.getByRole("button", { name: /run review/i }));

    // Agents are pre-selected on load, so the button is immediately actionable.
    const launchButton = screen.getByRole("button", {
      name: /run multi-agent review with 2 selected/i,
    });
    expect(launchButton).toBeEnabled();

    // AC-3: launching calls the launch hook then navigates to the run URL.
    fireEvent.click(launchButton);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/multi-agent/run-1"));
  });

  it("toggles a selection off, disables at N=0 on Clear, and Configure navigates", () => {
    setup();
    renderWithIntl(<AgentPicker prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: /run review/i }));
    const agentGroup = screen.getByRole("group");

    // Deselect one agent — N updates.
    fireEvent.click(within(agentGroup).getByRole("checkbox", { name: /select security/i }));
    expect(
      screen.getByRole("button", { name: /run multi-agent review with 1 selected/i }),
    ).toBeEnabled();

    // AC-2/AC-4: Clear resets N to 0 and disables the run button (not hidden).
    fireEvent.click(screen.getByRole("button", { name: /clear selected agents/i }));
    expect(
      screen.getByRole("button", { name: /run multi-agent review with 0 selected/i }),
    ).toBeDisabled();

    // AC-4: Configure agents… navigates to the agent management route.
    fireEvent.click(screen.getByRole("button", { name: "Configure agents…" }));
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("renders a 'Run Review' trigger in the PR header that opens the agent picker", () => {
    setup();
    const pr = buildPrDetail();

    renderWithIntl(
      <PrDetailHeader
        pr={pr}
        prId="pr1"
        tab="overview"
        findingsCount={0}
        onSetTab={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
      />,
    );

    // AC-1: a "Run Review" trigger is rendered, and clicking it opens the
    // multi-agent "Pick agents to run" panel (not the old single/all dropdown).
    const trigger = screen.getByRole("button", { name: /run review/i });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByText("Pick agents to run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run multi-agent review with/i })).toBeInTheDocument();
  });

  it("does NOT render the Run Review picker on the Agent runs tab (only Overview)", () => {
    setup();
    const pr = buildPrDetail();

    renderWithIntl(
      <PrDetailHeader
        pr={pr}
        prId="pr1"
        tab="findings"
        findingsCount={3}
        onSetTab={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
      />,
    );

    // The "Run Review" trigger is absent on the Agent runs tab; it already
    // lives on Overview.
    expect(screen.queryByRole("button", { name: /run review/i })).not.toBeInTheDocument();
  });
});
