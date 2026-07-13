import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const mockActionMutate = vi.fn();
const mockCreateCaseMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: mockActionMutate, isPending: false }),
}));

// FindingsPanel calls `useCreateCaseFromFinding()` (a TanStack Query hook)
// unconditionally — mock the hook at the boundary so the test never needs a
// real QueryClientProvider/network and the mutation call is observable
// directly (regression fix: this previously crashed with "No QueryClient
// set, use QueryClientProvider to set one" — see client/insights/INSIGHTS.md
// 2026-07-12 T11 entry).
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateCaseFromFinding: () => ({ mutate: mockCreateCaseMutate, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  mockActionMutate.mockClear();
  mockCreateCaseMutate.mockClear();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("filters by severity when a pill is clicked", () => {
    const findings: FindingRecord[] = [
      { ...FINDINGS[0]! },
      {
        ...FINDINGS[0]!,
        id: "f2",
        severity: "WARNING",
        title: "Warn finding",
      },
    ];
    renderWithIntl(<FindingsPanel findings={findings} prId="pr1" />);
    // Both visible initially
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
    // Click CRITICAL pill
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Warn finding")).not.toBeInTheDocument();
    // Click again → reset
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
  });

  // AC-1: from an accepted finding, "Turn into eval case" creates a case in
  // one click (no confirmation step) — the mutation fires immediately on click.
  it("creates an eval case in one click from an accepted finding, with no confirmation step", () => {
    const accepted: FindingRecord = { ...FINDINGS[0]!, accepted_at: "2026-07-01T00:00:00.000Z" };
    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" agentId="agent-1" />);

    const btn = screen.getByRole("button", {
      name: "Turn this finding into an eval case",
    });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);

    // One click → the mutation fires immediately with the finding + owning
    // agent id; no confirmation dialog is rendered anywhere in the DOM.
    expect(mockCreateCaseMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateCaseMutate).toHaveBeenCalledWith({ agentId: "agent-1", findingId: "f1" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-4: an untriaged finding (neither accepted nor dismissed) cannot have a
  // case-type derived — the action must render disabled with an accessible
  // name, and clicking it (even if forced) must not create anything.
  it("disables 'Turn into eval case' for an untriaged finding and creates nothing", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" agentId="agent-1" />);

    const btn = screen.getByRole("button", {
      name: "Accept or dismiss this finding before turning it into an eval case",
    });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(mockCreateCaseMutate).not.toHaveBeenCalled();
  });
});
