import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import ciMessages from "../../../../messages/en/ci.json";

// AppShell chrome (command palette, nav frame) is orthogonal to CiRunsView's
// own behaviour — strip it to its children, mirroring EvalDashboardView.test.tsx.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseCiRuns = vi.fn();
vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: (...args: unknown[]) => mockUseCiRuns(...args),
}));

import { CiRunsView } from "./CiRunsView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>{ui}</NextIntlClientProvider>);
}

function makeRun(overrides: Partial<CiRun> = {}): CiRun {
  return {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 42,
    ran_at: "2026-07-10T00:00:00.000Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.021,
    github_url: "https://github.com/acme/payments-api/actions/runs/123",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 12.4,
    repo: "acme/payments-api",
    ...overrides,
  };
}

describe("CiRunsView", () => {
  // AC-15: each row renders PR#, repository, agent, status, findings, cost,
  // duration, and a link to the GitHub Actions job.
  it("renders one row per CI run with all required fields and a GitHub Actions link", () => {
    mockUseCiRuns.mockReturnValue({ data: [makeRun()], isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl(<CiRunsView />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$0.021")).toBeInTheDocument();
    expect(screen.getByText("12.4s")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/actions/runs/123");
  });

  // AC-16: an explicit empty state renders (not a blank/broken table) when
  // the workspace has no CI runs yet.
  it("renders an explicit empty state when there are no CI runs", () => {
    mockUseCiRuns.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl(<CiRunsView />);

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // Error state — a failed query surfaces a retry affordance, not a blank
  // page or an unhandled exception.
  it("renders an error state with a retry action when the query fails", () => {
    const refetch = vi.fn();
    mockUseCiRuns.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    renderWithIntl(<CiRunsView />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // AC-17: a run with zero grounded findings renders `no_findings` as a
  // distinct PASSING outcome (icon + label), never as a failure — and it
  // must not read the same as an actual failure.
  it("renders no_findings as a distinct passing status, not a failure", () => {
    mockUseCiRuns.mockReturnValue({
      data: [
        makeRun({ id: "run-pass", pr_number: 10, status: "no_findings", findings_count: 0 }),
        makeRun({ id: "run-fail", pr_number: 11, status: "failed", findings_count: 5 }),
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithIntl(<CiRunsView />);

    // Non-color: each status renders its own distinct, visible text label
    // (WCAG — never color alone) rather than sharing one "failed"-looking
    // indicator.
    expect(screen.getByText("No findings")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
