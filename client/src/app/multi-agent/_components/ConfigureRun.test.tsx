import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, MultiAgentEstimate, PrMeta, Repo } from "@devdigest/shared";
import multiAgentMessages from "../../../../messages/en/multiAgent.json";
import agentsMessages from "../../../../messages/en/agents.json";

const push = vi.fn();
let searchParamsString = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/multi-agent",
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

// AppShell chrome (nav, command palette) is orthogonal to this page's own
// behaviour — strip it to its children, same pattern as EvalDashboardView.test.tsx.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseRepos = vi.fn();
vi.mock("@/lib/hooks/repos", () => ({
  useRepos: (...args: unknown[]) => mockUseRepos(...args),
}));

const mockUsePulls = vi.fn();
vi.mock("@/lib/hooks/pulls", () => ({
  usePulls: (...args: unknown[]) => mockUsePulls(...args),
}));

const mockUseAgents = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => mockUseAgents(...args),
}));

const mockUseMultiAgentEstimate = vi.fn();
const mockUseLaunchMultiAgentRun = vi.fn();
vi.mock("@/lib/hooks/multiAgent", () => ({
  useMultiAgentEstimate: (...args: unknown[]) => mockUseMultiAgentEstimate(...args),
  useLaunchMultiAgentRun: (...args: unknown[]) => mockUseLaunchMultiAgentRun(...args),
}));

import { ConfigureRun } from "./ConfigureRun";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsString = "";
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: multiAgentMessages, agents: agentsMessages }}>
      <ConfigureRun />
    </NextIntlClientProvider>,
  );
}

const REPO: Repo = {
  id: "repo-1",
  workspace_id: "ws-1",
  owner: "acme",
  name: "widgets",
  full_name: "acme/widgets",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const PR: PrMeta = {
  id: "pr-1",
  number: 42,
  title: "Add rate limiter",
  author: "octocat",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc123",
  additions: 10,
  deletions: 2,
  files_count: 3,
  status: "needs_review",
  opened_at: null,
  updated_at: null,
  score: null,
  findings_critical: null,
  findings_warning: null,
  findings_suggestion: null,
  last_run_cost_usd: null,
};

const AGENT_1: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags security issues",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review for security issues.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  attached_doc_paths: [],
};

const AGENT_2: Agent = { ...AGENT_1, id: "agent-2", name: "Style Reviewer" };

function mockLaunch(mutateAsync = vi.fn().mockResolvedValue({ id: "run-1", pr_id: "pr-1", runs: [] })) {
  mockUseLaunchMultiAgentRun.mockReturnValue({ mutateAsync, isPending: false });
  return mutateAsync;
}

describe("ConfigureRun", () => {
  it("shows the empty agents state and a disabled run button until a PR is chosen", () => {
    mockUseRepos.mockReturnValue({ data: [REPO] });
    mockUsePulls.mockReturnValue({ data: undefined });
    mockUseAgents.mockReturnValue({ data: [AGENT_1, AGENT_2] });
    mockUseMultiAgentEstimate.mockReturnValue({ data: undefined, isLoading: false });
    mockLaunch();

    renderWithIntl();

    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review/i })).toBeDisabled();
  });

  it("selecting a repo and a PR updates the URL via search params", () => {
    mockUseRepos.mockReturnValue({ data: [REPO] });
    mockUsePulls.mockReturnValue({ data: undefined });
    mockUseAgents.mockReturnValue({ data: [] });
    mockUseMultiAgentEstimate.mockReturnValue({ data: undefined, isLoading: false });
    mockLaunch();

    renderWithIntl();

    const comboboxes = screen.getAllByRole("combobox");
    const repoSelect = comboboxes[0];
    if (!repoSelect) throw new Error("expected a repo <select> to render");
    fireEvent.change(repoSelect, { target: { value: "repo-1" } });

    expect(push).toHaveBeenCalledWith("/multi-agent?repo=repo-1");
  });

  it("shows per-agent estimates (with a no-estimate placeholder) and a summary once a PR and agents are selected, and launch is never blocked by a missing estimate", async () => {
    searchParamsString = "repo=repo-1&pr=pr-1";
    mockUseRepos.mockReturnValue({ data: [REPO] });
    mockUsePulls.mockReturnValue({ data: [PR] });
    mockUseAgents.mockReturnValue({ data: [AGENT_1, AGENT_2] });
    const estimateResult: MultiAgentEstimate = {
      agents: [{ agent_id: "agent-1", est_duration_ms: 8200, est_cost_usd: 0.2 }],
      summary: { est_duration_ms: 8200, est_cost_usd: 0.2, agent_count: 1 },
    };
    mockUseMultiAgentEstimate.mockReturnValue({ data: estimateResult, isLoading: false });
    const mutateAsync = mockLaunch();

    renderWithIntl();

    // No PR-first empty state anymore — the agent list is visible.
    expect(screen.queryByText("Pick a pull request first")).not.toBeInTheDocument();
    expect(screen.getByText("Select at least one agent to see an estimate.")).toBeInTheDocument();

    const runButton = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(runButton).toBeDisabled();

    // AC-6/AC-7: BEFORE any checkbox is touched, every listed agent row
    // already shows its own per-agent estimate (agent-1, which has a
    // resolved estimate) or the "no estimate yet" placeholder (agent-2,
    // absent from the estimate response / cold-start) — the estimate must
    // not be gated behind the agent being selected.
    expect(screen.getByText(/≈8\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/≈\$0\.20/)).toBeInTheDocument();
    expect(screen.getByText("no estimate yet")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Security Reviewer" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Style Reviewer" })).not.toBeChecked();

    // Select both agents — agent-1 has a resolved estimate, agent-2 (selected
    // but absent from the estimate response) must fall back to "no estimate
    // yet" rather than blocking anything (AC-9).
    fireEvent.click(screen.getByRole("checkbox", { name: "Security Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Style Reviewer" }));

    expect(screen.getByText(/≈8\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/≈\$0\.20/)).toBeInTheDocument();
    expect(screen.getAllByText("no estimate yet").length).toBeGreaterThan(0);

    expect(
      screen.getByText("≈2 agents · parallel fan-out · est. 8.2s · est. $0.20"),
    ).toBeInTheDocument();
    expect(screen.getByText("Estimates are approximate and won't block launch.")).toBeInTheDocument();

    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr-1", agentIds: ["agent-1", "agent-2"] });
  });

  it("Select all checks every agent card, then toggles to Clear", () => {
    searchParamsString = "repo=repo-1&pr=pr-1";
    mockUseRepos.mockReturnValue({ data: [REPO] });
    mockUsePulls.mockReturnValue({ data: [PR] });
    mockUseAgents.mockReturnValue({ data: [AGENT_1, AGENT_2] });
    mockUseMultiAgentEstimate.mockReturnValue({ data: undefined, isLoading: false });
    mockLaunch();

    renderWithIntl();

    const security = screen.getByRole("checkbox", { name: "Security Reviewer" });
    const style = screen.getByRole("checkbox", { name: "Style Reviewer" });
    expect(security).not.toBeChecked();
    expect(style).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("checkbox", { name: "Security Reviewer" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Style Reviewer" })).toBeChecked();

    // Once everything is selected the affordance flips to Clear.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("checkbox", { name: "Security Reviewer" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Style Reviewer" })).not.toBeChecked();
  });
});
