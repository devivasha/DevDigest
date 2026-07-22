import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiExport, CiExportInputBody, CiFile } from "@devdigest/shared";
import ciMessages from "../../../../messages/en/ci.json";

const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
const MANIFEST_PATH = ".devdigest/agents/security-reviewer.yaml";
const MEMORY_PATH = ".devdigest/memory.jsonl";

// `usePreviewCi` is mocked to derive its returned bundle FROM the input the
// component actually passed it (target/triggers/post_as), so the same
// hermetic mock can exercise AC-3 (non-gha -> read-only workflow) and AC-8
// (toggling `reopened` -> the previewed workflow's trigger list changes)
// without a real server. `useExportCi` stays a plain vi.fn() per test.
function buildFiles(input: CiExportInputBody): CiFile[] {
  const triggers = input.triggers ?? [];
  return [
    { path: MANIFEST_PATH, contents: "name: Security Reviewer\n", editable: false },
    {
      path: WORKFLOW_PATH,
      contents: `on:\n  pull_request:\n    types: [${triggers.join(", ")}]\n# post_as: ${input.post_as}\n`,
      editable: input.target === "gha",
    },
    { path: MEMORY_PATH, contents: "", editable: false },
  ];
}

const mockUsePreviewCi = vi.fn();
const mockUseExportCi = vi.fn();
vi.mock("@/lib/hooks/ci", () => ({
  usePreviewCi: (...args: unknown[]) => mockUsePreviewCi(...args),
  useExportCi: (...args: unknown[]) => mockUseExportCi(...args),
}));

vi.mock("@/lib/contexts/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

// The Target step's repo picker is populated from GET /repos via useRepos;
// provide a fixed connected repo so the searchable dropdown has one option.
vi.mock("@/lib/hooks/repos", () => ({
  useRepos: () => ({ data: [{ full_name: "acme/payments-api" }], isLoading: false, isError: false }),
}));

// The Configure step's SECRETS block reads provider-key status via useSecretsStatus;
// openrouter=true so OPENROUTER_API_KEY renders as "Set".
vi.mock("@/lib/hooks/settings", () => ({
  useSecretsStatus: () => ({
    data: { openai: false, anthropic: false, openrouter: true, github: false },
    isLoading: false,
    isError: false,
  }),
}));

import { ExportWizard } from "./ExportWizard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>{ui}</NextIntlClientProvider>);
}

function renderWizard(agentName = "Security Reviewer") {
  const onClose = vi.fn();
  renderWithIntl(<ExportWizard agentId="agent-1" agentName={agentName} onClose={onClose} />);
  return { onClose };
}

function setupPreviewMock() {
  mockUsePreviewCi.mockImplementation((_agentId: string, input: CiExportInputBody, enabled: boolean) => ({
    data: enabled ? buildFiles(input) : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }));
}

function selectRepo() {
  // Open the searchable repo dropdown (its trigger shows the placeholder until
  // a repo is picked), then choose the one connected repo.
  fireEvent.click(screen.getByText("Select a repository…"));
  fireEvent.click(screen.getByRole("button", { name: "acme/payments-api" }));
}

function fillRepoAndAdvanceToPreview() {
  selectRepo();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("ExportWizard", () => {
  // AC-1: the wizard opens with the `CiExportInput` defaults (target=gha,
  // triggers=[opened,synchronize,reopened], post_as=github_review, base=main)
  // pre-set across its four steps.
  it("opens with CiExportInput defaults across all four steps (AC-1, AC-9)", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({ data: undefined, mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false });

    renderWizard();

    // Target step: gha selected by default; no repo picked yet (the dropdown
    // shows its placeholder) so Continue is disabled until one is selected.
    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Select a repository…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fillRepoAndAdvanceToPreview();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    // Preview step: the bundle renders as semantic sections (manifest, linked
    // skills with a count + empty-state, memory log, editable workflow) — not
    // one raw card per path.
    expect(screen.getByText("Agent manifest")).toBeInTheDocument();
    expect(screen.getByText("Linked skills (0)")).toBeInTheDocument();
    expect(screen.getByText("No skills linked to this agent yet.")).toBeInTheDocument();
    expect(screen.getByText("Memory log")).toBeInTheDocument();
    expect(screen.getByText("Workflow file")).toBeInTheDocument();

    // Configure step: default triggers (toggles) all on + default post_as
    // (AC-9: three radios render, github_review selected + the merge-blocking
    // hint), plus the SECRETS block.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("switch", { name: "Opened" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Synchronize (new commits pushed)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Reopened" })).toHaveAttribute("aria-checked", "true");

    const postAsRadios = screen.getAllByRole("radio").map((r) => r.textContent);
    expect(postAsRadios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /GitHub review/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /PR comment/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /None \(exit code only\)/ })).toBeInTheDocument();
    expect(
      screen.getByText(/GitHub review can block merges when findings fail the gate/),
    ).toBeInTheDocument();

    // SECRETS: provider key reflects useSecretsStatus (Set), GITHUB_TOKEN is
    // auto-provided for the gha target.
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("Set")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText("Auto-provided")).toBeInTheDocument();

    // Install step defaults: target=gha so "Open a PR" is offered.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  // AC-2: exactly four targets render, and only `gha` is marked recommended.
  it("presents exactly four targets with gha marked recommended", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({ data: undefined, mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false });

    renderWizard();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /CircleCI/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Jenkins/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Generic CLI/ })).toBeInTheDocument();

    // Only the gha radio's own accessible name/content includes "recommended".
    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toHaveTextContent("recommended");
    expect(screen.getByRole("radio", { name: /CircleCI/ })).not.toHaveTextContent("recommended");
    expect(screen.getByRole("radio", { name: /Jenkins/ })).not.toHaveTextContent("recommended");
    expect(screen.getByRole("radio", { name: /Generic CLI/ })).not.toHaveTextContent("recommended");
  });

  // AC-3: selecting a non-gha target renders the workflow file read-only in
  // Preview and removes the "Open a PR" action from Install (zip-only).
  it("restricts a non-gha target to a read-only workflow preview and zip-only install", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({ data: undefined, mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false });

    renderWizard();

    fireEvent.click(screen.getByRole("radio", { name: /Jenkins/ }));
    fillRepoAndAdvanceToPreview();

    // Preview step: every file card (including the workflow) shows the
    // "read-only" badge, not "editable", and renders as static text (no
    // textarea) — a non-gha target has no editable files at all.
    expect(screen.getAllByText("read-only").length).toBeGreaterThan(0);
    expect(screen.queryByText("editable")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Configure -> Install: no "Open a PR"/"Install" action for a non-gha
    // target; a zip-only explanation renders instead.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/This target isn't wired to open a PR automatically/),
    ).toBeInTheDocument();
    // Zip path is still offered (AC-12).
    expect(screen.getByRole("button", { name: "Copy files as a zip" })).toBeEnabled();
  });

  // AC-8: toggling the `reopened` trigger off changes the previewed
  // workflow's `pull_request:` types list.
  it("reflects a reopened trigger toggle in the previewed workflow's pull_request types", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({ data: undefined, mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false });

    renderWizard();
    fillRepoAndAdvanceToPreview(); // -> Preview
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // -> Configure

    fireEvent.click(screen.getByRole("switch", { name: "Reopened" }));
    expect(screen.getByRole("switch", { name: "Reopened" })).toHaveAttribute("aria-checked", "false");

    // Go back to Preview — the fetched bundle re-derives from current state
    // (mock keys its output off the input actually passed by ExportWizard).
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const workflowTextarea = screen.getByDisplayValue(/types: \[opened, synchronize\]/);
    expect(workflowTextarea).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/reopened/)).not.toBeInTheDocument();
  });

  // AC-9: three "Post results as" options render and selecting a different
  // one flows into wizard state (verified via the select's own value).
  it("lets the user change the Post results as selection among all three options", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({ data: undefined, mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false });

    renderWizard();
    fillRepoAndAdvanceToPreview();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // -> Configure

    expect(screen.getByRole("radio", { name: /GitHub review/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /PR comment/ }));
    expect(screen.getByRole("radio", { name: /PR comment/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /GitHub review/ })).toHaveAttribute("aria-checked", "false");
  });

  // AC-12: "Copy files as a zip" is present and enabled at the Install step
  // even when a prior export attempt degraded to `pr_url: null`.
  it("always offers the zip download, even when the export result has a null pr_url", () => {
    setupPreviewMock();
    mockUseExportCi.mockReturnValue({
      data: {
        installation: {
          id: "inst-1",
          agent_id: "agent-1",
          repo: "acme/payments-api",
          target_type: "gha",
          installed_at: "2026-07-10T00:00:00.000Z",
          version: 3,
          status: null,
        },
        files: buildFiles({
          repo: "acme/payments-api",
          target: "gha",
          action: "open_pr",
          post_as: "github_review",
          triggers: ["opened", "synchronize", "reopened"],
          base: "main",
        }),
        pr_url: null,
        ingest_secret: null,
        pr_open_reason: "github_token_missing",
      } satisfies CiExport,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
    });

    renderWizard();
    fillRepoAndAdvanceToPreview();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Degraded-PR messaging shown alongside the still-available zip button.
    expect(
      screen.getByText(/DevDigest couldn't open a PR automatically/),
    ).toBeInTheDocument();
    const zipButton = screen.getByRole("button", { name: "Copy files as a zip" });
    expect(zipButton).toBeInTheDocument();
    expect(zipButton).toBeEnabled();
  });
});
