import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";

const mockActionMutate = vi.fn();
let mockReviewsData: unknown[] = [];

// Mock at the hook boundary (usePrReviews / useFindingAction) so this test
// never needs a real QueryClientProvider or network — same pattern as
// FindingsPanel.test.tsx.
vi.mock("../../../../../lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: mockReviewsData, isLoading: false }),
  useFindingAction: () => ({ mutate: mockActionMutate, isPending: false }),
}));

import { MultiAgentTabs } from "./MultiAgentTabs";

afterEach(() => {
  cleanup();
  mockActionMutate.mockClear();
  mockReviewsData = [];
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const FINDING_A1: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

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
  conflicts: [],
};

describe("MultiAgentTabs", () => {
  it("shows one tab per agent with score/finding count, and switches lists on selection", () => {
    mockReviewsData = [
      { id: "r1", pr_id: "pr-1", agent_id: "agent-a", run_id: "run-a", findings: [FINDING_A1] },
    ];
    renderWithIntl(<MultiAgentTabs run={RUN} prId="pr-1" />);

    expect(screen.getByRole("button", { name: /Security Reviewer · 42/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Style Reviewer · 95/ })).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Style Reviewer · 95/ }));
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    expect(screen.getByText("No findings from this agent.")).toBeInTheDocument();
  });

  it("opening a finding shows confidence + suggested fix, and Accept/Dismiss call the existing hook", () => {
    mockReviewsData = [
      { id: "r1", pr_id: "pr-1", agent_id: "agent-a", run_id: "run-a", findings: [FINDING_A1] },
    ];
    renderWithIntl(<MultiAgentTabs run={RUN} prId="pr-1" />);

    // Confidence is shown on the collapsed card's second line already.
    expect(screen.getByText("95% conf")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));

    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mockActionMutate).toHaveBeenCalledWith({
      findingId: "f1",
      action: "accept",
      prId: "pr-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockActionMutate).toHaveBeenCalledWith({
      findingId: "f1",
      action: "dismiss",
      prId: "pr-1",
    });
  });

  it("renders Learn / Turn into eval case / Reply to author as disabled stubs (no new endpoint)", () => {
    mockReviewsData = [
      { id: "r1", pr_id: "pr-1", agent_id: "agent-a", run_id: "run-a", findings: [FINDING_A1] },
    ];
    renderWithIntl(<MultiAgentTabs run={RUN} prId="pr-1" />);
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));

    const learn = screen.getByRole("button", { name: "Learn" });
    const evalCase = screen.getByRole("button", { name: "Turn into eval case" });
    const reply = screen.getByRole("button", { name: "Reply to author" });

    expect(learn).toBeDisabled();
    expect(evalCase).toBeDisabled();
    expect(reply).toBeDisabled();

    fireEvent.click(learn);
    fireEvent.click(evalCase);
    fireEvent.click(reply);
    expect(mockActionMutate).not.toHaveBeenCalled();
  });
});
