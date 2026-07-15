import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";

// NOTE: `@testing-library/user-event` is not installed in client/ — use
// `fireEvent`, same pattern as the sibling AgentDisagreement/MultiAgentTabs tests.

const replace = vi.fn();
let searchParamsString = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

// AppShell chrome (nav, command palette) is orthogonal to this page's own
// behaviour — strip it to its children, same pattern as ConfigureRun.test.tsx.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseMultiAgentRun = vi.fn();
vi.mock("@/lib/hooks/multiAgent", () => ({
  useMultiAgentRun: (...args: unknown[]) => mockUseMultiAgentRun(...args),
}));

// `useRunEvents` is used directly by ResultsView AND by MultiAgentColumns
// (imported via the `@/` alias); `usePrReviews`/`useFindingAction` are used
// by MultiAgentTabs (imported via a relative path) — all three resolve to
// this SAME file, so mocking it once here covers every importer.
const mockUseRunEvents = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (...args: unknown[]) => mockUseRunEvents(...args),
  usePrReviews: () => ({ data: [], isLoading: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// RunTraceDrawer belongs to another module; mock it at the component boundary
// so this test never mounts it (same pattern as MultiAgentColumns.test.tsx).
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer", () => ({
  default: () => null,
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

import { ResultsView } from "./ResultsView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsString = "";
});

function renderWithIntl(runId = "run-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ResultsView runId={runId} />
    </NextIntlClientProvider>,
  );
}

const RUN: MultiAgentRun = {
  id: "run-1",
  pr_id: "pr-1",
  pr_number: 42,
  ran_at: new Date().toISOString(),
  agent_count: 2,
  total_duration_ms: 5000,
  total_cost_usd: 0.02,
  columns: [
    {
      run_id: "run-a",
      agent_id: "agent-a",
      agent_name: "Security Reviewer",
      provider: "anthropic",
      model: "claude",
      status: "done",
      verdict: "request_changes",
      score: 42,
      summary: "Found issues.",
      duration_ms: 2000,
      cost_usd: 0.01,
      findings: [
        {
          id: "f1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded Stripe secret key",
          file: "src/config.ts",
          start_line: 11,
          kind: "finding",
        },
      ],
    },
    {
      run_id: "run-b",
      agent_id: "agent-b",
      agent_name: "Style Reviewer",
      provider: "openai",
      model: "gpt",
      status: "done",
      verdict: "approve",
      score: 95,
      summary: "Looks clean.",
      duration_ms: 1500,
      cost_usd: 0.01,
      findings: [],
    },
  ],
  conflicts: [
    {
      file: "src/config.ts",
      line: 11,
      title: "Disagreement on the hardcoded key",
      takes: [
        { agent_id: "agent-a", persona: "Security Reviewer", verdict: "CRITICAL", note: "Leaked key." },
        { agent_id: "agent-b", persona: "Style Reviewer", verdict: "ignored", note: "" },
      ],
    },
  ],
};

describe("ResultsView", () => {
  it("renders Columns mode by default and switching to Tabs only rewrites the URL over the same run — never a new run (AC-23)", () => {
    mockUseMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseRunEvents.mockReturnValue({ events: [], running: false });

    renderWithIntl();

    // Columns mode: a "View trace" control exists (unique to MultiAgentColumns).
    expect(screen.getByRole("button", { name: /view trace for security reviewer/i })).toBeInTheDocument();
    // No per-agent tab button (unique to MultiAgentTabs) yet.
    expect(screen.queryByRole("button", { name: /Security Reviewer · 42/ })).not.toBeInTheDocument();
    // The disagreement block is present regardless of mode.
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("Disagreement on the hardcoded key")).toBeInTheDocument();

    // Toggle to Tabs — must only push a `?view=` URL, never call a launch hook
    // (none is even imported here) or fetch a different run id.
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(replace).toHaveBeenCalledWith("/multi-agent/run-1?view=tabs");
    expect(mockUseMultiAgentRun).toHaveBeenCalledWith("run-1");
    expect(mockUseMultiAgentRun.mock.calls.every(([id]) => id === "run-1")).toBe(true);
  });

  it("reloading the URL directly on ?view=tabs re-renders Tabs mode from the persisted run, with the disagreement block unchanged (AC-11, AC-27)", () => {
    searchParamsString = "view=tabs";
    mockUseMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseRunEvents.mockReturnValue({ events: [], running: false });

    renderWithIntl();

    // Tabs mode: per-agent tab buttons render; Columns-only control is gone.
    expect(screen.getByRole("button", { name: /Security Reviewer · 42/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view trace for/i })).not.toBeInTheDocument();

    // Same disagreement content, rendered the same way as in Columns mode.
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("Disagreement on the hardcoded key")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show only conflicts" })).toBeInTheDocument();
  });
});
