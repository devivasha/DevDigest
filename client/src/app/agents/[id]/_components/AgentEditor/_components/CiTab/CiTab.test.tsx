import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation, CiRun } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../../../messages/en/ci.json";

const mockUseAgent = vi.fn();
const mockUseUpdateAgent = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
  useUpdateAgent: (...args: unknown[]) => mockUseUpdateAgent(...args),
}));

// `@/lib/hooks/ci` is the real mock boundary — this covers CiTab's own data
// AND (transitively) the real `ExportWizard` it renders when "Add to CI" is
// activated (AC-1). We deliberately do NOT mock `@/components/ci/ExportWizard`
// itself; it has its own full suite (ExportWizard.test.tsx), but stubbing out
// the app's own component here would hide integration bugs at the CiTab/
// ExportWizard boundary.
const mockUseAgentInstallations = vi.fn();
const mockUseAgentCiRuns = vi.fn();
const mockUsePreviewCi = vi.fn();
const mockUseExportCi = vi.fn();
vi.mock("@/lib/hooks/ci", () => ({
  useAgentInstallations: (...args: unknown[]) => mockUseAgentInstallations(...args),
  useAgentCiRuns: (...args: unknown[]) => mockUseAgentCiRuns(...args),
  usePreviewCi: (...args: unknown[]) => mockUsePreviewCi(...args),
  useExportCi: (...args: unknown[]) => mockUseExportCi(...args),
}));

// The wizard's Target step lists connected repos via useRepos — mock it so the
// transitively-rendered ExportWizard doesn't need a QueryClientProvider here.
vi.mock("@/lib/hooks/repos", () => ({
  useRepos: () => ({ data: [{ full_name: "acme/payments-api" }], isLoading: false, isError: false }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, ci: ciMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function baseAgent(overrides: Partial<Agent> = {}): Agent {
  return {
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
    ...overrides,
  };
}

function makeInstallation(overrides: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "inst-1",
    agent_id: "agent-1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-07-01T00:00:00.000Z",
    version: 3,
    status: "succeeded",
    ...overrides,
  };
}

function makeRun(overrides: Partial<CiRun> = {}): CiRun {
  return {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 42,
    ran_at: "2026-07-10T00:00:00.000Z",
    status: "succeeded",
    findings_count: 2,
    cost_usd: 0.01,
    github_url: "https://github.com/acme/payments-api/actions/runs/9",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 8.2,
    repo: "acme/payments-api",
    ...overrides,
  };
}

function mockLoaded(opts: {
  agent?: Agent;
  installations?: CiInstallation[];
  runs?: CiRun[];
} = {}) {
  mockUseAgent.mockReturnValue({ data: opts.agent ?? baseAgent(), isLoading: false });
  mockUseAgentInstallations.mockReturnValue({
    data: opts.installations ?? [makeInstallation()],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseAgentCiRuns.mockReturnValue({
    data: opts.runs ?? [makeRun()],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseUpdateAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  // Defaults for the real `ExportWizard` mounted once "Add to CI" is
  // activated (AC-1) — only exercised by the last test below, but the
  // module mock is shared across the whole file.
  mockUsePreviewCi.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  mockUseExportCi.mockReturnValue({
    data: undefined,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  });
}

describe("CiTab", () => {
  // AC-18/AC-19: one row per installation (repo + status + workflow-version
  // snapshot) and the agent's CI run history render.
  it("renders one row per installation and the agent's CI run history", () => {
    mockLoaded();

    renderWithIntl(<CiTab agentId="agent-1" agentName="Security Reviewer" />);

    // Installations (AC-18): repo, status label, and the D5 version
    // snapshot. Both tables share a "Succeeded" status badge, so scope to
    // the installations table specifically.
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);

    // CI run history (AC-19): PR number, findings, cost, duration, link.
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("$0.010")).toBeInTheDocument();
    expect(screen.getByText("8.2s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/9",
    );
  });

  // AC-20: the "Fail CI on" selector reflects the agent's current
  // `ci_fail_on` and updates it via the existing agent-update mutation.
  it("reflects and updates the agent's ci_fail_on via the Fail CI on selector", () => {
    const mutate = vi.fn();
    mockLoaded({ agent: baseAgent({ ci_fail_on: "critical" }) });
    mockUseUpdateAgent.mockReturnValue({ mutate, isPending: false });

    renderWithIntl(<CiTab agentId="agent-1" agentName="Security Reviewer" />);

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("critical");

    fireEvent.change(select, { target: { value: "any" } });

    expect(mutate).toHaveBeenCalledWith({ id: "agent-1", patch: { ci_fail_on: "any" } });
  });

  // AC-1: activating "Add to CI" opens the real Export Wizard, defaulted to
  // its first ("Target") step.
  it('opens the Export Wizard when "Add to CI" is activated', () => {
    mockLoaded();

    renderWithIntl(<CiTab agentId="agent-1" agentName="Security Reviewer" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to CI" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toBeInTheDocument();
  });
});
