import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutate = vi.fn();

vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo-1", full_name: "acme/widgets" },
    repoId: "repo-1",
    repos: [{ id: "repo-1", full_name: "acme/widgets" }],
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useProjectContext: () => ({
    data: {
      documents: [
        { path: "specs/checkout.md", bucket: "specs", estimated_tokens: 120 },
        { path: "docs/setup.md", bucket: "docs", estimated_tokens: 80 },
      ],
      summary: {
        document_count: 2,
        total_estimated_tokens: 200,
        refreshed_at: new Date().toISOString(),
        clone_available: true,
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetSkillDocs: () => ({ mutate, isPending: false }),
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "Checks PR quality",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 1,
  evidence_files: [],
  attached_doc_paths: ["specs/checkout.md"],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("T14 Skill ContextTab", () => {
  it("renders attached docs, count, search, inheritance note, and the serializes-as preview; toggling persists paths", () => {
    renderWithIntl(<ContextTab skill={SKILL} />);

    // Follows the sidebar's active repo (no per-tab selector)
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();

    // Header count (AC-15)
    expect(screen.getByText("1 attached")).toBeInTheDocument();

    // Inheritance note (AC-15)
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();

    // Both discovered docs render as rows
    expect(screen.getByText("checkout.md")).toBeInTheDocument();
    expect(screen.getByText("setup.md")).toBeInTheDocument();

    // Search narrows the list without dropping attach state
    const search = screen.getByPlaceholderText("Search documents…");
    fireEvent.change(search, { target: { value: "setup" } });
    expect(screen.queryByText("checkout.md")).not.toBeInTheDocument();
    expect(screen.getByText("setup.md")).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });

    // Toggling attach on the unattached doc persists the whole ordered path set (AC-16)
    const toggles = screen.getAllByRole("switch");
    const lastToggle = toggles.at(-1);
    if (!lastToggle) throw new Error("expected at least one toggle switch");
    fireEvent.click(lastToggle);
    expect(mutate).toHaveBeenCalledWith(["specs/checkout.md", "docs/setup.md"]);

    // Serializes-as preview shows the contribution heading + attached path list (AC-17)
    expect(screen.getByText("Serializes as")).toBeInTheDocument();
    expect(screen.getByText(/## Project context/)).toBeInTheDocument();
    expect(screen.getByText(/- specs\/checkout\.md/)).toBeInTheDocument();
  });
});
