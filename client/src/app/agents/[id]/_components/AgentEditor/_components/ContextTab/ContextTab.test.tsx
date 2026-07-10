import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const mockUseProjectContext = vi.fn();
const mockUseDocument = vi.fn();
const mockUseSetAgentDocs = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useProjectContext: (...args: unknown[]) => mockUseProjectContext(...args),
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
  useSetAgentDocs: (...args: unknown[]) => mockUseSetAgentDocs(...args),
}));

// The tab follows the sidebar's active repo (useActiveRepo) instead of a
// per-tab selector; provide a fixed active repo for these tests.
vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    repoId: "repo1",
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mockUseProjectContext.mockReset();
  mockUseDocument.mockReset();
  mockUseSetAgentDocs.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function baseAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag1",
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
    version: 1,
    attached_doc_paths: [],
    ...overrides,
  };
}

const DOCS = [
  { path: "specs/architecture.md", bucket: "specs" as const, estimated_tokens: 120 },
  { path: "docs/setup.md", bucket: "docs" as const, estimated_tokens: 50 },
  { path: "insights/notes.md", bucket: "insights" as const, estimated_tokens: 30, used_by_agents: 2 },
];

function mockHooks(mutate = vi.fn()) {
  mockUseProjectContext.mockReturnValue({
    data: {
      documents: DOCS,
      summary: {
        document_count: DOCS.length,
        total_estimated_tokens: 200,
        refreshed_at: new Date().toISOString(),
        clone_available: true,
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseDocument.mockReturnValue({ data: { path: "specs/architecture.md", text: "# Architecture" }, isLoading: false });
  mockUseSetAgentDocs.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

describe("ContextTab", () => {
  it("shows one row per doc with the attached count, toggles attach state, keeps toggles across a search, and persists ordered paths", () => {
    const mutate = mockHooks();
    const agent = baseAgent({ attached_doc_paths: ["specs/architecture.md"] });
    renderWithIntl(<ContextTab agent={agent} />);

    // One row per discovered doc, all three filenames present.
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("setup.md")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();

    // Header count (AC-8) + running token estimate + untrusted-block note (AC-9/AC-10/AC-11).
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("~120 tokens across attached docs")).toBeInTheDocument();
    expect(screen.getByText(/injected as an untrusted block \(## Project context\)/)).toBeInTheDocument();

    // Toggling attach on an unattached doc persists the ordered path set.
    fireEvent.click(screen.getByRole("button", { name: "Attach setup.md" }));
    expect(mutate).toHaveBeenCalledWith(["specs/architecture.md", "docs/setup.md"]);

    // Search narrows the visible rows without dropping the attach state (AC-12).
    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents" }), {
      target: { value: "arch" },
    });
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.queryByText("setup.md")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detach architecture.md" })).toBeInTheDocument();
  });

  it("reorders attached docs with the keyboard move-down control (WCAG alternative to drag)", () => {
    const mutate = mockHooks();
    const agent = baseAgent({ attached_doc_paths: ["specs/architecture.md", "docs/setup.md"] });
    renderWithIntl(<ContextTab agent={agent} />);

    fireEvent.click(screen.getByRole("button", { name: "Move architecture.md down" }));
    expect(mutate).toHaveBeenCalledWith(["docs/setup.md", "specs/architecture.md"]);
  });

  it("preview drawer shows exactly the four metadata items and an attach toggle (AC-13)", () => {
    mockHooks();
    const agent = baseAgent({ attached_doc_paths: ["insights/notes.md"] });
    renderWithIntl(<ContextTab agent={agent} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.md" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Scoped to the drawer — "Insights" also matches the background row's
    // bucket badge for the same doc, so an unscoped query would be ambiguous.
    expect(within(dialog).getByText("Insights")).toBeInTheDocument(); // bucket badge
    expect(within(dialog).getByText("30 tokens")).toBeInTheDocument(); // token count
    expect(within(dialog).getByText("Used by 2 agents")).toBeInTheDocument(); // used-by count
    expect(within(dialog).getByRole("button", { name: "Detach notes.md" })).toBeInTheDocument(); // attach toggle
  });
});
