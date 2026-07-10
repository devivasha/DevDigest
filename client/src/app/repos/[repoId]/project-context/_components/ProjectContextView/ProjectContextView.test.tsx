import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ApiError as ApiErrorType } from "@/lib/api";
import messages from "../../../../../../../messages/en/projectContext.json";

const mockUseProjectContext = vi.fn();
const mockUseDocument = vi.fn();
const mockUseSaveDocument = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1" }),
}));

vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo1", full_name: "acme/widgets" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks", () => ({
  useProjectContext: (...args: unknown[]) => mockUseProjectContext(...args),
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
  useSaveDocument: (...args: unknown[]) => mockUseSaveDocument(...args),
}));

import { ProjectContextView } from "./ProjectContextView";
import { ApiError } from "@/lib/api";

afterEach(() => {
  cleanup();
  mockUseProjectContext.mockReset();
  mockUseDocument.mockReset();
  mockUseSaveDocument.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const REFRESHED_5_MIN_AGO = new Date(Date.now() - 5 * 60_000).toISOString();

function mockDiscovery() {
  mockUseProjectContext.mockReturnValue({
    data: {
      documents: [{ path: "specs/architecture.md", bucket: "specs", estimated_tokens: 120 }],
      summary: {
        document_count: 1,
        total_estimated_tokens: 120,
        refreshed_at: REFRESHED_5_MIN_AGO,
        clone_available: true,
      },
    },
    isLoading: false,
    isError: false,
    error: null as ApiErrorType | null,
    refetch: vi.fn(),
  });
}

describe("ProjectContextView", () => {
  it("renders the discovery list with a labelled bucket badge and a chunk/index-free summary footer, then previews, edits, and saves a document", () => {
    mockDiscovery();
    mockUseDocument.mockReturnValue({
      data: { path: "specs/architecture.md", text: "# Hello\n\nWorld" },
      isLoading: false,
      isError: false,
      error: null,
    });
    const mockMutate = vi.fn();
    mockUseSaveDocument.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    });

    renderWithIntl(<ProjectContextView />);

    // Row: filename, folder, and a bucket badge that carries a TEXT label
    // (not colour alone).
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();

    // Footer: count + summed tokens + refresh time, no chunk/index wording (AC-7).
    const footerText = screen.getByText(/documents · ≈ 120 tokens total · refreshed/).textContent ?? "";
    expect(footerText).toMatch(/1 documents · ≈ 120 tokens total · refreshed 5 minutes ago/);
    expect(footerText.toLowerCase()).not.toMatch(/chunk|index/);

    // Preview affordance opens the drawer and renders markdown.
    fireEvent.click(screen.getByRole("button", { name: "Preview architecture.md" }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();

    // Switch to Edit: resync-clobber warning + a keyboard-operable textarea
    // pre-filled with the raw markdown (AC-31/AC-34).
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/git reset --hard/)).toBeInTheDocument();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("# Hello\n\nWorld");
    fireEvent.change(textarea, { target: { value: "# Hello\n\nEdited" } });

    // Save calls the mutation with the edited text.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockMutate).toHaveBeenCalledWith({ path: "specs/architecture.md", text: "# Hello\n\nEdited" });
  });

  it("surfaces a save failure in the aria-live status region", () => {
    mockDiscovery();
    mockUseDocument.mockReturnValue({
      data: { path: "specs/architecture.md", text: "# Hello" },
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseSaveDocument.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new ApiError("Disk is read-only", 500),
    });

    renderWithIntl(<ProjectContextView />);
    fireEvent.click(screen.getByRole("button", { name: "Preview architecture.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Disk is read-only");
  });

  it("shows the not-available state (not an error) when the repo has no local clone", () => {
    mockUseProjectContext.mockReturnValue({
      data: {
        documents: [],
        summary: {
          document_count: 0,
          total_estimated_tokens: 0,
          refreshed_at: new Date().toISOString(),
          clone_available: false,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithIntl(<ProjectContextView />);

    expect(screen.getByText("No local clone available")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
