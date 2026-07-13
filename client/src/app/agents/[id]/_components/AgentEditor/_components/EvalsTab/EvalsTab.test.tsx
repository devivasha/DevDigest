import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalCaseStatus, EvalDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const mockUseEvalCases = vi.fn();
const mockUseEvalDashboard = vi.fn();
const mockUseCaseStatuses = vi.fn();
const mockUseRunEvalSet = vi.fn();
const mockUseRunEvalCase = vi.fn();
const mockUseCreateEvalCase = vi.fn();
const mockUseUpdateEvalCase = vi.fn();
const mockUseDeleteEvalCase = vi.fn();

// EvalsTab talks to the server only through `@/lib/hooks/eval` — mock at
// that boundary (never the network) per the test-writer brief.
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: (...args: unknown[]) => mockUseEvalCases(...args),
  useEvalDashboard: (...args: unknown[]) => mockUseEvalDashboard(...args),
  useCaseStatuses: (...args: unknown[]) => mockUseCaseStatuses(...args),
  useRunEvalSet: (...args: unknown[]) => mockUseRunEvalSet(...args),
  useRunEvalCase: (...args: unknown[]) => mockUseRunEvalCase(...args),
  useCreateEvalCase: (...args: unknown[]) => mockUseCreateEvalCase(...args),
  useUpdateEvalCase: (...args: unknown[]) => mockUseUpdateEvalCase(...args),
  useDeleteEvalCase: (...args: unknown[]) => mockUseDeleteEvalCase(...args),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: overrides.id ?? "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: overrides.name ?? "stripe-key-leak",
    input_diff: "--- a/x\n+++ b/x\n",
    input_files: null,
    input_meta: null,
    expected_output: {
      kind: "must_find",
      findings: [
        {
          file: "src/config.ts",
          start_line: 10,
          end_line: 11,
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded secret",
        },
      ],
    },
    notes: null,
    ...overrides,
  };
}

function makeDashboard(overrides: Partial<EvalDashboard["current"]> = {}, casesTotal = 8): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: casesTotal,
    current: {
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.95,
      traces_passed: 6,
      traces_total: casesTotal,
      cost_usd: 0.2,
      ...overrides,
    },
    delta: { recall: 0.03, precision: -0.01, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
    owner_case_counts: { "agent-1": casesTotal },
  };
}

function mockCasesQuery(cases: EvalCase[]) {
  mockUseEvalCases.mockReturnValue({
    data: cases,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function mockDashboardQuery(dashboard: EvalDashboard) {
  mockUseEvalDashboard.mockReturnValue({
    data: dashboard,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function mockStatusesQuery(statuses: EvalCaseStatus[] = []) {
  mockUseCaseStatuses.mockReturnValue({
    data: statuses,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function makeCaseStatus(overrides: Partial<EvalCaseStatus> = {}): EvalCaseStatus {
  return {
    case_id: overrides.case_id ?? "case-1",
    name: overrides.name ?? "stripe-key-leak",
    pass: overrides.pass ?? true,
    produced_count: overrides.produced_count ?? 1,
    degraded: overrides.degraded ?? false,
    duration_ms: overrides.duration_ms ?? 1800,
    cost_usd: overrides.cost_usd ?? 0.02,
    ran_at: overrides.ran_at ?? "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function mockMutationHooks() {
  mockUseRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseCreateEvalCase.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  mockUseUpdateEvalCase.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  mockUseDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe("EvalsTab", () => {
  // AC-19: the EVAL METRICS row (recall/precision/citation with deltas +
  // traces X/Y) plus one row per case (name, "expected N, got M", a
  // severity·category badge, run/edit/delete controls) all render.
  it("renders the EVAL METRICS row and one row per eval case (AC-19)", () => {
    const cases = [
      makeCase({ id: "case-1", name: "stripe-key-leak" }),
      makeCase({
        id: "case-2",
        name: "no-false-positive-on-refactor",
        expected_output: { kind: "must_not_flag", findings: [] },
      }),
    ];
    mockCasesQuery(cases);
    mockDashboardQuery(makeDashboard());
    mockStatusesQuery();
    mockMutationHooks();

    renderWithIntl(<EvalsTab agentId="agent-1" />);

    // Metrics row.
    expect(screen.getByText("Eval metrics")).toBeInTheDocument();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();

    // One row per case: name + "expected N finding(s), got —" (never run
    // this session) + a severity·category badge or "empty []".
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got —")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL · security")).toBeInTheDocument();

    expect(screen.getByText("no-false-positive-on-refactor")).toBeInTheDocument();
    expect(screen.getByText("expected 0 findings, got —")).toBeInTheDocument();
    expect(screen.getByText("empty []")).toBeInTheDocument();

    // Passing-count badge is server-persisted (dashboard.current), not
    // session state, so it stays accurate across reloads.
    expect(screen.getByText("6/2 passing")).toBeInTheDocument();

    // Run/edit/delete controls exist per row with accessible names.
    expect(screen.getAllByRole("button", { name: "Run" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);

    // Toolbar actions.
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View full dashboard →" })).toBeInTheDocument();
  });

  // AC-15: a set with fewer than 8 cases warns that it's under the
  // recommended minimum — the run itself is still permitted (Run all evals
  // stays enabled).
  it("shows an under-minimum warning for a set with fewer than 8 cases (AC-15)", () => {
    const cases = [makeCase({ id: "case-1" }), makeCase({ id: "case-2", name: "second-case" })];
    mockCasesQuery(cases);
    mockDashboardQuery(makeDashboard({}, 2));
    mockStatusesQuery();
    mockMutationHooks();

    renderWithIntl(<EvalsTab agentId="agent-1" />);

    expect(
      screen.getByText(
        "This run set has fewer than 8 cases — results may be noisy and are less reliable as a signal.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeEnabled();
  });

  it("shows no under-minimum warning for a set with 8 or more cases", () => {
    const cases = Array.from({ length: 8 }, (_, i) => makeCase({ id: `case-${i}`, name: `case-${i}` }));
    mockCasesQuery(cases);
    mockDashboardQuery(makeDashboard({}, 8));
    mockStatusesQuery();
    mockMutationHooks();

    renderWithIntl(<EvalsTab agentId="agent-1" />);

    expect(
      screen.queryByText(
        "This run set has fewer than 8 cases — results may be noisy and are less reliable as a signal.",
      ),
    ).not.toBeInTheDocument();
  });

  // A loaded `useCaseStatuses` renders each row's pass/fail icon on mount,
  // with NO run happening this session — proves the row status is sourced
  // from the persisted status endpoint, not only from an in-session trace.
  it("renders persisted pass/fail status from useCaseStatuses on mount, without any run this session", () => {
    const cases = [
      makeCase({ id: "case-1", name: "stripe-key-leak" }),
      makeCase({ id: "case-2", name: "second-case" }),
    ];
    mockCasesQuery(cases);
    mockDashboardQuery(makeDashboard());
    mockStatusesQuery([
      makeCaseStatus({ case_id: "case-1", name: "stripe-key-leak", pass: true, produced_count: 1 }),
      makeCaseStatus({ case_id: "case-2", name: "second-case", pass: false, produced_count: 0 }),
    ]);
    mockMutationHooks();

    renderWithIntl(<EvalsTab agentId="agent-1" />);

    // Row 1: persisted PASS status + produced count 1 (no session run happened).
    expect(screen.getByText("expected 1 finding, got 1")).toBeInTheDocument();
    // Row 2: persisted FAIL status + produced count 0.
    expect(screen.getByText("expected 1 finding, got 0")).toBeInTheDocument();
    expect(screen.getByLabelText("passed")).toBeInTheDocument();
    expect(screen.getByLabelText("failed")).toBeInTheDocument();
  });

  // Per-row play must run ONLY that case via useRunEvalCase — never the
  // whole set (useRunEvalSet's mutate must not be called).
  it("the per-case play button calls useRunEvalCase with that case's id, not the whole set", () => {
    const cases = [
      makeCase({ id: "case-1", name: "stripe-key-leak" }),
      makeCase({ id: "case-2", name: "second-case" }),
    ];
    mockCasesQuery(cases);
    mockDashboardQuery(makeDashboard());
    mockStatusesQuery();
    const runSetMutate = vi.fn();
    const runCaseMutate = vi.fn();
    mockUseRunEvalSet.mockReturnValue({ mutate: runSetMutate, isPending: false });
    mockUseRunEvalCase.mockReturnValue({ mutate: runCaseMutate, isPending: false });
    mockUseCreateEvalCase.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
    mockUseUpdateEvalCase.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
    mockUseDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl(<EvalsTab agentId="agent-1" />);

    const runButtons = screen.getAllByRole("button", { name: "Run" });
    expect(runButtons).toHaveLength(2);
    fireEvent.click(runButtons[1]!);

    expect(runCaseMutate).toHaveBeenCalledTimes(1);
    expect(runCaseMutate).toHaveBeenCalledWith({ caseId: "case-2" }, expect.anything());
    expect(runSetMutate).not.toHaveBeenCalled();
  });
});
