import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingTour } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

// Tests are derived from specs/2026-07-11-onboarding-generator.md AC-1..AC-19 (T14 in
// docs/plans/onboarding-generator.md), not from reading the finished component — each
// assertion below cites the AC it drives.

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1" }),
}));

vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/widgets", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

// AppShell pulls in shell chrome (global shortcuts, command palette) unrelated to this
// view's own I/O — replaced with a passthrough so only OnboardingTourView's own fetches
// are observed on the global fetch mock.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// `mermaid` is an external, heavy, canvas-touching library — the seam to stub per the
// plan's known gotcha ("MermaidDiagram may need mermaid.render mocked/stubbed in
// jsdom — assert the diagram container renders rather than the SVG"). The fake render
// output carries role="img" so the test can assert the container rendered via an
// accessible query instead of inspecting raw SVG markup (never snapshotting LLM/SVG text).
const { mermaidParseMock, mermaidRenderMock } = vi.hoisted(() => ({
  mermaidParseMock: vi.fn(async () => true),
  mermaidRenderMock: vi.fn(async () => ({
    svg: '<svg role="img" aria-label="architecture diagram"></svg>',
  })),
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: mermaidParseMock,
    render: mermaidRenderMock,
  },
}));

import { OnboardingTourView } from "./OnboardingTourView";

// jsdom (via `src/test/setup.ts`) stubs ResizeObserver but not IntersectionObserver;
// OnboardingTourView's "on this page" active-section tracking uses IntersectionObserver
// directly (a legitimate external-browser-API effect, not something to mock away by
// avoiding the render). Stub it the same way setup.ts stubs ResizeObserver.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
}

// Fixed reference instants for the "last refreshed <ago>" header assertion (AC-2).
// Computed once at module scope — mirrors the existing `REFRESHED_5_MIN_AGO` pattern in
// `ProjectContextView.test.tsx` — rather than calling `Date.now()`/`new Date()` inside an
// `it()` body, and avoids the fake-timers-vs-RTL-waitFor interaction pitfall entirely.
const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60_000).toISOString();
const JUST_NOW = new Date().toISOString();

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom does not implement the Clipboard API by default.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function renderTour() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTourView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeFullTour(overrides: Partial<OnboardingTour> = {}): OnboardingTour {
  return {
    repoId: "repo1",
    repoName: "acme/widgets",
    generatedAt: FIVE_MIN_AGO,
    indexFileCount: 128,
    lastRefreshedAt: FIVE_MIN_AGO,
    degraded: false,
    sections: {
      architecture: {
        narrative: "This service boots from `src/server.ts` and persists state via `src/db.ts`.",
        codeRefs: [{ path: "src/server.ts" }, { path: "src/db.ts" }],
        diagram: "flowchart TD\n  Client --> API\n  API --> DB",
      },
      criticalPaths: [
        { path: "src/server.ts", why: "Boots the HTTP server and wires all routes.", callerCount: 12 },
        { path: "src/db.ts", why: "Owns the database connection pool.", callerCount: 8 },
      ],
      howToRun: [
        { order: 1, command: "pnpm install", note: "Installs all workspace dependencies." },
        { order: 2, command: "pnpm dev" },
      ],
      readingPath: [
        { order: 1, path: "src/server.ts", rationale: "Start here to see the request flow." },
        { order: 2, path: "src/db.ts", rationale: "Then read the data layer." },
      ],
      firstTasks: [{ title: "Add a health-check test", detail: "Extend the suite with one more case." }],
    },
    ...overrides,
  };
}

function makeDegradedTour(overrides: Partial<OnboardingTour> = {}): OnboardingTour {
  return {
    repoId: "repo1",
    repoName: "acme/widgets",
    generatedAt: FIVE_MIN_AGO,
    indexFileCount: 0,
    lastRefreshedAt: FIVE_MIN_AGO,
    degraded: true,
    degradedReason: "no_data",
    sections: {
      architecture: { narrative: "", codeRefs: [], diagram: null },
      criticalPaths: [],
      howToRun: [],
      readingPath: [],
      firstTasks: [],
    },
    ...overrides,
  };
}

describe("OnboardingTourView", () => {
  it("renders all 5 sections from a full tour with the header file count, a working copy control, Open links, and the mermaid diagram (AC-2/6/7/8/10)", async () => {
    const tour = makeFullTour();
    fetchMock.mockResolvedValueOnce(jsonResponse(tour));

    renderTour();

    // Header facts are deterministic: repo name + "Generated from index of N files · last
    // refreshed <ago>" (AC-2).
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Onboarding for");
    expect(heading).toHaveTextContent("acme/widgets");
    expect(
      screen.getByText("Generated from index of 128 files · last refreshed 5 minutes ago"),
    ).toBeInTheDocument();

    // Exactly the 5 spec'd sections render, each as a named region.
    for (const title of [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }

    // Architecture: a grounded inline code ref is a clickable Open affordance (AC-6/AC-13).
    const architecture = screen.getByRole("region", { name: "Architecture overview" });
    expect(within(architecture).getByRole("link", { name: "Open src/server.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/main/src/server.ts",
    );

    // Architecture diagram renders from the mermaid string via the stubbed mermaid.render —
    // assert the container renders (accessible role from the mock's SVG), not raw SVG markup.
    await waitFor(() => {
      expect(within(architecture).getByRole("img", { name: "architecture diagram" })).toBeInTheDocument();
    });
    expect(mermaidRenderMock).toHaveBeenCalledWith(expect.any(String), tour.sections.architecture.diagram);

    // Critical paths: ranked rows carrying path + why + Open (AC-7).
    const criticalPaths = screen.getByRole("region", { name: "Critical paths" });
    expect(within(criticalPaths).getByText("Boots the HTTP server and wires all routes.")).toBeInTheDocument();
    expect(within(criticalPaths).getByRole("link", { name: "Open src/server.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/main/src/server.ts",
    );

    // How-to-run: an ordered command has a WORKING copy control that only ever calls
    // navigator.clipboard.writeText — it never executes anything (AC-8).
    const howToRun = screen.getByRole("region", { name: "How to run locally" });
    fireEvent.click(within(howToRun).getByRole("button", { name: "Copy command: pnpm install" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pnpm install"));
    // Copying triggers no additional network call (display-only, never "run").
    expect(fetchMock.mock.calls.length).toBe(1);

    // Guided reading path + First tasks also render (AC-9 ordering is server-decided;
    // AC-10 just requires the bounded starter-task list to render).
    expect(screen.getByText("Start here to see the request flow.")).toBeInTheDocument();
    expect(screen.getByText("Add a health-check test")).toBeInTheDocument();
  });

  it("renders a degraded (no_data) tour as an honest skeleton with a text+icon badge, an index CTA, and no fabricated narrative — Regenerate never invents content (AC-11/AC-12)", async () => {
    const degradedTour = makeDegradedTour();
    fetchMock.mockResolvedValueOnce(jsonResponse(degradedTour));

    renderTour();

    // Degraded badge conveys the reason via TEXT, not colour alone (AC-11, WCAG 2.1 AA).
    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    // The reason renders as "— <reason text>" inside the same span, so match by substring.
    expect(screen.getByText(/This repo hasn't been cloned or indexed yet\./)).toBeInTheDocument();

    // no_data shows a CTA to the existing add/index flow — this feature never triggers
    // cloning/indexing itself (AC-12).
    expect(screen.getByRole("link", { name: "Add or index this repo" })).toHaveAttribute("href", "/onboarding");

    // Every section shows its honest empty-state placeholder, not invented prose (AC-11).
    expect(screen.getByText("No architecture summary available yet.")).toBeInTheDocument();
    expect(screen.getByText("No critical paths identified yet.")).toBeInTheDocument();
    expect(screen.getByText("No setup commands available yet.")).toBeInTheDocument();
    expect(screen.getByText("No guided reading path available yet.")).toBeInTheDocument();
    expect(screen.getByText("No starter tasks available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "architecture diagram" })).not.toBeInTheDocument();

    // Regenerating a degraded tour re-serves the same honest skeleton (the server makes no
    // LLM call per AC-11) — the client must not invent content on top of what it receives.
    fetchMock.mockResolvedValueOnce(jsonResponse(degradedTour));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/repos/repo1/onboarding/generate");
    expect(screen.getByText("No architecture summary available yet.")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("shows the large-repo note (and no index CTA) when the degraded reason is repo_too_large (AC-19)", async () => {
    const tour = makeDegradedTour({ degradedReason: "repo_too_large", indexFileCount: 200 });
    fetchMock.mockResolvedValueOnce(jsonResponse(tour));

    renderTour();

    expect(await screen.findByText("Large repo — showing top results")).toBeInTheDocument();
    // The reason renders as "— <reason text>" inside the same span, so match by substring.
    expect(screen.getByText(/This repo is too large to index in full\./)).toBeInTheDocument();
    // The no_data-only CTA must not appear for a different degraded reason.
    expect(screen.queryByRole("link", { name: "Add or index this repo" })).not.toBeInTheDocument();
  });

  it("shows the stale hint when facts changed since generation, and Regenerate replaces the tour via POST (AC-15/AC-16)", async () => {
    const staleTour = makeFullTour({ stale: true });
    fetchMock.mockResolvedValueOnce(jsonResponse(staleTour));

    renderTour();

    expect(
      await screen.findByText("Facts changed since this tour was generated — regenerate for the latest version."),
    ).toBeInTheDocument();

    // Control exactly when the Regenerate mutation resolves so the in-flight state is
    // observable, not just the eventual result.
    let resolvePost!: (value: Response) => void;
    const postPromise = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementationOnce(() => postPromise);

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(await screen.findByRole("button", { name: "Regenerating…" })).toBeInTheDocument();

    const freshTour = makeFullTour({
      stale: false,
      indexFileCount: 130,
      generatedAt: JUST_NOW,
      lastRefreshedAt: JUST_NOW,
    });
    resolvePost(jsonResponse(freshTour));

    // The mutation replaced the stored tour: header reflects fresh data, stale hint clears.
    expect(
      await screen.findByText("Generated from index of 130 files · last refreshed just now"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Facts changed since this tour was generated — regenerate for the latest version."),
    ).not.toBeInTheDocument();

    const postCall = fetchMock.mock.calls[1];
    expect(String(postCall?.[0])).toContain("/repos/repo1/onboarding/generate");
    expect(postCall?.[1]).toMatchObject({ method: "POST" });
    // Regenerate never re-clones or re-indexes — it only calls the tour-generate endpoint,
    // never any index/refresh/clone route.
    expect(String(postCall?.[0])).not.toMatch(/index|clone|refresh/);
  });

  it("Share copies the in-app route only — mints no public URL and makes no server call (AC-17)", async () => {
    const tour = makeFullTour();
    fetchMock.mockResolvedValueOnce(jsonResponse(tour));

    renderTour();
    await screen.findByRole("heading", { level: 1 });
    const callsBeforeShare = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));

    const expectedLink = `${window.location.origin}/repos/repo1/onboarding`;
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink));

    const copiedUrl = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    // In-app deep link only (resolvable within the authenticated app) — no public/token URL.
    expect(copiedUrl).toBe(expectedLink);
    expect(String(copiedUrl)).not.toMatch(/token|public/i);
    // Sharing never talks to the server.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeShare);

    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });
});
