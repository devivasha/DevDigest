import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalSetRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import shellMessages from "../../../../messages/en/shell.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The AppShell chrome (command palette, shortcuts, nav frame) is orthogonal
// to the eval dashboard's own behaviour — strip it to its children, mirroring
// ProjectContextView.test.tsx's established pattern for this codebase.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseAgents = vi.fn();
const mockUseAgent = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => mockUseAgents(...args),
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
}));

const mockUseEvalDashboardAll = vi.fn();
const mockUseRunAllAgents = vi.fn();
const mockUseEvalDashboard = vi.fn();
const mockUseRunHistory = vi.fn();
const mockUseCompareRuns = vi.fn();
const mockUseRunEvalSet = vi.fn();

// Both EvalDashboardView (AC-20) and the AgentEvalDetail it swaps in on
// selection (AC-21) talk to the server only through `@/lib/hooks/eval` —
// mock at that boundary, never the network.
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboardAll: (...args: unknown[]) => mockUseEvalDashboardAll(...args),
  useRunAllAgents: (...args: unknown[]) => mockUseRunAllAgents(...args),
  useEvalDashboard: (...args: unknown[]) => mockUseEvalDashboard(...args),
  useRunHistory: (...args: unknown[]) => mockUseRunHistory(...args),
  useCompareRuns: (...args: unknown[]) => mockUseCompareRuns(...args),
  useRunEvalSet: (...args: unknown[]) => mockUseRunEvalSet(...args),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
  attached_doc_paths: [],
};

function makeSetRun(overrides: Partial<EvalSetRunRecord> = {}): EvalSetRunRecord {
  return {
    id: "run-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    ran_at: "2026-07-01T00:00:00.000Z",
    version: 3,
    system_prompt: "You are a security reviewer.",
    model: "gpt-4.1",
    recall: 0.9,
    precision: 0.85,
    citation_accuracy: 0.95,
    traces_passed: 7,
    traces_total: 8,
    duration_ms: 12000,
    cost_usd: 0.12,
    under_min: false,
    ...overrides,
  };
}

function makeAllAgentsDashboard(
  recentRuns: EvalSetRunRecord[],
  ownerCaseCounts: Record<string, number> = { "agent-1": 8 },
): EvalDashboard {
  return {
    owner_kind: null,
    owner_id: null,
    cases_total: 8,
    current: { recall: 0.9, precision: 0.85, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.12 },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: recentRuns,
    alert: null,
    owner_case_counts: ownerCaseCounts,
  };
}

function makeAgentDashboard(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 8,
    current: { recall: 0.9, precision: 0.85, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.12 },
    delta: { recall: 0.02, precision: -0.01, citation_accuracy: 0 },
    trend: [
      {
        ran_at: "2026-06-25T00:00:00.000Z",
        recall: 0.88,
        precision: 0.86,
        citation_accuracy: 0.94,
        pass_rate: 0.85,
        cost_usd: 0.1,
      },
      {
        ran_at: "2026-07-01T00:00:00.000Z",
        recall: 0.9,
        precision: 0.85,
        citation_accuracy: 0.95,
        pass_rate: 0.9,
        cost_usd: 0.12,
      },
    ],
    recent_runs: [],
    alert: null,
    owner_case_counts: { "agent-1": 8 },
    ...overrides,
  };
}

function mockAllAgentsLoaded(
  recentRuns: EvalSetRunRecord[],
  opts: { agents?: Agent[]; ownerCaseCounts?: Record<string, number> } = {},
) {
  const agentsList = opts.agents ?? [AGENT];
  mockUseAgents.mockReturnValue({ data: agentsList, isLoading: false, isError: false, refetch: vi.fn() });
  mockUseEvalDashboardAll.mockReturnValue({
    data: makeAllAgentsDashboard(recentRuns, opts.ownerCaseCounts),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseRunAllAgents.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function mockAgentDetailLoaded(opts: { dashboard: EvalDashboard; history: EvalSetRunRecord[] }) {
  mockUseAgent.mockReturnValue({ data: AGENT, isLoading: false });
  mockUseEvalDashboard.mockReturnValue({
    data: opts.dashboard,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseRunHistory.mockReturnValue({ data: opts.history, isLoading: false });
  mockUseCompareRuns.mockReturnValue({ data: undefined, isLoading: false });
  mockUseRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function openAgentDetail() {
  // "Security Reviewer" also appears as a data cell in the recent-runs
  // table — the summary CARD (a <button>) renders first in DOM order.
  const nameNode = screen.getAllByText("Security Reviewer").find((el) => el.closest("button"));
  const card = nameNode?.closest("button");
  if (!card) throw new Error("agent summary card button not found");
  fireEvent.click(card);
}

describe("EvalDashboardView", () => {
  // AC-20: per-agent cards + a "Recent eval runs" table render on the
  // all-agents dashboard.
  it("renders per-agent cards and the recent eval runs table (AC-20)", () => {
    mockAllAgentsLoaded([makeSetRun()]);

    renderWithIntl(<EvalDashboardView />);

    // Per-agent card: name, model badge, version + pass count. "Security
    // Reviewer" also appears as a data cell in the recent-runs table below,
    // so assert at least one instance (the card) rather than requiring
    // exactly one.
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getAllByText(/v3/).length).toBeGreaterThan(0);

    // Recent eval runs table — one row per SET run (GAP-2), not per-case.
    const table = screen.getByRole("table");
    const row = within(table).getByText("Security Reviewer").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("90%")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("85%")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("95%")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("7/8")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Run eval (1)" })).toBeInTheDocument();
  });

  // AC-21: the single-agent detail renders 3 metric cards with deltas, a
  // trend chart, and a selectable Recent-runs table with a Compare control.
  it("opens the single-agent detail with 3 metric cards, a trend chart, and a selectable runs table with Compare (AC-21)", () => {
    mockAllAgentsLoaded([makeSetRun({ id: "run-1" }), makeSetRun({ id: "run-2", version: 4 })]);
    mockAgentDetailLoaded({
      dashboard: makeAgentDashboard(),
      history: [makeSetRun({ id: "run-2", ran_at: "2026-07-05T00:00:00.000Z", version: 4 }), makeSetRun({ id: "run-1" })],
    });

    renderWithIntl(<EvalDashboardView />);
    openAgentDetail();

    // 3 metric cards with deltas.
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    // Arrow + text direction on the metric-card deltas (AC-23 reused).
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);

    // Trend chart renders (its accessible text alternative carries the data).
    expect(screen.getByText(/Metric trend:/)).toBeInTheDocument();

    // Selectable Recent-runs table + Compare control, disabled until exactly
    // two runs are selected.
    const compareBtn = screen.getByRole("button", { name: "Compare runs" });
    expect(compareBtn).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    expect(compareBtn).toBeEnabled();
  });

  // Sub-header (runs = full history length, unaffected by the date-range
  // filter) + the date-range dropdown narrowing the runs table client-side.
  it("renders the regression-harness subheader and filters the runs table via the date-range dropdown", () => {
    const recentRun = makeSetRun({
      id: "run-recent",
      ran_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const oldRun = makeSetRun({
      id: "run-old",
      version: 2,
      ran_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    });

    mockAllAgentsLoaded([recentRun, oldRun]);
    mockAgentDetailLoaded({
      dashboard: makeAgentDashboard(),
      history: [recentRun, oldRun],
    });

    renderWithIntl(<EvalDashboardView />);
    openAgentDetail();

    // Sub-header always reflects the full history length (2), regardless of
    // the currently selected date range.
    expect(screen.getByText("Regression harness · 2 runs on the 8-case gold set")).toBeInTheDocument();

    // Default range is 30 days — the 200-day-old run starts out of view.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    // Switch to "All time" via the date-range dropdown — both runs appear.
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  // A single-run agent has nothing to diff against — compare/regression must
  // be omitted (not crash).
  it("omits compare and regression for a single-run agent without crashing", () => {
    mockAllAgentsLoaded([makeSetRun()]);
    mockAgentDetailLoaded({
      dashboard: makeAgentDashboard({ alert: null }),
      history: [makeSetRun()],
    });

    renderWithIntl(<EvalDashboardView />);
    openAgentDetail();

    expect(screen.getByText("Select a second run to compare against")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare runs" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // The chrome fix: a sub-header + two section headers render, and agents
  // with zero eval cases (stale seeded model, never run) are hidden entirely
  // — only agents with an eval set get a card, and "Run all agents" counts
  // just those.
  it("renders the sub-header and section headers, and hides agents with no eval set", () => {
    const neverRunAgent: Agent = { ...AGENT, id: "agent-2", name: "Never Run Agent", model: "gpt-3.5-turbo" };
    mockAllAgentsLoaded([makeSetRun()], {
      agents: [AGENT, neverRunAgent],
      ownerCaseCounts: { "agent-1": 8 },
    });

    renderWithIntl(<EvalDashboardView />);

    expect(
      screen.getByText("Regression harness across all reviewer agents · pick an agent to see its runs"),
    ).toBeInTheDocument();
    // "Agents" also appears as the recent-runs table's owner column header
    // (borrowed from shell.json) — the section heading is a second instance.
    expect(screen.getAllByText("Agents").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Recent eval runs · all agents")).toBeInTheDocument();

    // With-cases agent renders as a card.
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    // Zero-case agent never appears — no stale-model card for it.
    expect(screen.queryByText("Never Run Agent")).not.toBeInTheDocument();

    // "Run all agents" only counts the evaluable agent.
    expect(screen.getByRole("button", { name: "Run eval (1)" })).toBeInTheDocument();
  });
});
