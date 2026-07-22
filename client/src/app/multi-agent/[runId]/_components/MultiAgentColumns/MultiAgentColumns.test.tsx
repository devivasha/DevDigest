import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";
import { MultiAgentColumns } from "./MultiAgentColumns";

afterEach(cleanup);

// Mock at the hook boundary — no real SSE connections in a unit test.
const mockUseRunEvents = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (...args: unknown[]) => mockUseRunEvents(...args),
}));

// RunTraceDrawer belongs to another module (T5/A5); mock it at the component
// boundary so this test only asserts MultiAgentColumns wires the correct
// run_id, without pulling in its own SSE/trace hooks.
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer", () => ({
  default: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div data-testid="run-trace-drawer" data-run-id={runId}>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

function makeColumn(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    provider: "anthropic",
    model: "claude-sonnet",
    status: "done",
    verdict: "approve",
    score: 90,
    summary: null,
    duration_ms: 1200,
    cost_usd: 0.12,
    findings: [
      {
        id: "f1",
        severity: "WARNING",
        category: "security",
        title: "Possible secret leak",
        file: "src/a.ts",
        start_line: 10,
        kind: "finding",
      },
    ],
    ...overrides,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MultiAgentColumns", () => {
  it("renders one column per agent with per-status icon+text and findings counts", () => {
    mockUseRunEvents.mockReturnValue({ events: [], running: false });
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security Reviewer", status: "done" }),
      makeColumn({
        run_id: "run-2",
        agent_id: "agent-2",
        agent_name: "Style Reviewer",
        status: "running",
        findings: [],
        cost_usd: null,
      }),
    ];

    renderWithIntl(<MultiAgentColumns columns={columns} />);

    // N columns for an N-agent run (AC-13).
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();

    // Per-status text (icon+text, not colour alone — AC-29).
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();

    // Findings counts (AC-17).
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("0 findings")).toBeInTheDocument();

    // Cost unknown until it settles.
    expect(screen.getByText(/cost unknown/i)).toBeInTheDocument();
  });

  it("opens the trace drawer for the correct run id when View trace is clicked", () => {
    mockUseRunEvents.mockReturnValue({ events: [], running: false });
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security Reviewer" }),
      makeColumn({ run_id: "run-2", agent_id: "agent-2", agent_name: "Style Reviewer" }),
    ];

    renderWithIntl(<MultiAgentColumns columns={columns} />);

    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view trace for style reviewer/i }));

    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toHaveAttribute("data-run-id", "run-2");
  });

  it("shows a failed column with its reason while sibling columns still render (AC-16)", () => {
    mockUseRunEvents.mockReturnValue({ events: [], running: false });
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security Reviewer", status: "done" }),
      makeColumn({
        run_id: "run-2",
        agent_id: "agent-2",
        agent_name: "Style Reviewer",
        status: "failed",
        error: "Provider timed out",
        findings: [],
      }),
    ];

    renderWithIntl(<MultiAgentColumns columns={columns} />);

    // The failed column does not block its sibling from rendering.
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Failed: Provider timed out")).toBeInTheDocument();
  });

  it("shows the failed reason after a reload with no live SSE event, reading the persisted column.error (AC-16)", () => {
    // No events at all — simulates a page reload where the SSE stream never
    // reconnected in time to catch the terminal error event. The reason must
    // still come from the persisted `column.error`, not `column.summary`
    // (which is always null for a failed run — it never gets a `reviews` row).
    mockUseRunEvents.mockReturnValue({ events: [], running: false });
    const columns = [
      makeColumn({
        run_id: "run-2",
        agent_id: "agent-2",
        agent_name: "Style Reviewer",
        status: "failed",
        summary: null,
        error: "Rate limit exceeded",
        findings: [],
      }),
    ];

    renderWithIntl(<MultiAgentColumns columns={columns} />);

    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Failed: Rate limit exceeded")).toBeInTheDocument();
  });
});
