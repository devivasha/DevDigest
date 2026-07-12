import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// NOTE: `@testing-library/user-event` is not installed in client/ (confirmed via
// package.json — only @testing-library/react + jest-dom are present). Using
// `fireEvent` instead, matching the sibling BlastRadiusCard.test.tsx pattern.
// ref: client/insights/INSIGHTS.md "@testing-library/user-event is NOT installed"

const mockUseBrief = vi.fn();
const mockUseRegenerateBrief = vi.fn();
vi.mock("@/lib/hooks/brief", () => ({
  useBrief: (...args: unknown[]) => mockUseBrief(...args),
  useRegenerateBrief: (...args: unknown[]) => mockUseRegenerateBrief(...args),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  mockUseBrief.mockReset();
  mockUseRegenerateBrief.mockReset();
});

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(wrap(ui));
}

function withData(overrides: Partial<BriefRecord> = {}): BriefRecord {
  return {
    pr_id: "pr1",
    what: "Adds a Redis-backed rate limiter to the auth endpoints.",
    why: "Prevents credential-stuffing abuse flagged in a recent incident.",
    risk_level: "high",
    risks: [
      {
        kind: "security",
        title: "New dependency on Redis availability",
        explanation: "Auth now fails closed if Redis is unreachable.",
        severity: "medium",
        file_refs: ["src/auth/rateLimiter.ts"],
      },
    ],
    review_focus: [
      { path: "src/auth/rateLimiter.ts", reason: "New fail-closed behaviour on Redis outage." },
    ],
    ...overrides,
  };
}

describe("PrBriefCard", () => {
  it("renders what/why, a distinguishable risk badge (icon + label), risks[], and review_focus[] as navigable links when repoFullName/headSha are provided", () => {
    mockUseBrief.mockReturnValue({ data: withData(), isLoading: false, isError: false });
    mockUseRegenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl(
      <PrBriefCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    // what / why (AC-12)
    expect(
      screen.getByText("Adds a Redis-backed rate limiter to the auth endpoints."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Prevents credential-stuffing abuse flagged in a recent incident."),
    ).toBeInTheDocument();

    // Overall risk_level badge: icon + text label both present (AC-13). The
    // label text ("High risk") is what makes the level distinguishable once
    // colour is removed — the icon (an <svg>, no accessible role available
    // for a decorative glyph) is a secondary, scoped DOM check.
    const overallBadge = screen.getByText("High risk");
    expect(overallBadge.querySelector("svg")).toBeTruthy();

    // Per-risk severity badge uses a DIFFERENT label ("Medium risk") than the
    // overall risk_level badge — confirms severities are distinguishable by
    // text, not merely by colour.
    const riskBadge = screen.getByText("Medium risk");
    expect(riskBadge.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("New dependency on Redis availability")).toBeInTheDocument();
    expect(
      screen.getByText("Auth now fails closed if Redis is unreachable."),
    ).toBeInTheDocument();

    // review_focus[] renders reason text + its own navigable link (AC-12, AC-14)
    expect(
      screen.getByText("New fail-closed behaviour on Redis outage."),
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "src/auth/rateLimiter.ts" });
    // one link from the risk's file_refs, one from review_focus — both point at the same path
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/acme/widgets/blob/abc123/src/auth/rateLimiter.ts",
      );
    }
  });

  it("renders review_focus and risk file paths as non-navigating controls (no href) when repoFullName/headSha are absent", () => {
    mockUseBrief.mockReturnValue({ data: withData(), isLoading: false, isError: false });
    mockUseRegenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false });

    // repoFullName/headSha intentionally omitted (undefined)
    renderWithIntl(<PrBriefCard prId="pr1" />);

    // MonoLink renders a <button> (not an <a>) when href cannot be built (AC-14)
    expect(
      screen.queryByRole("link", { name: "src/auth/rateLimiter.ts" }),
    ).not.toBeInTheDocument();
    const controls = screen.getAllByRole("button", { name: "src/auth/rateLimiter.ts" });
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control).not.toHaveAttribute("href");
      expect(control.tagName).toBe("BUTTON");
    }
  });

  it("Regenerate has an accessible name, triggers the mutation on click, shows a loading (disabled) state, and reflects the new Brief on success", () => {
    const mutate = vi.fn();
    mockUseBrief.mockReturnValue({ data: withData(), isLoading: false, isError: false });
    mockUseRegenerateBrief.mockReturnValue({ mutate, isPending: false });

    const { rerender } = renderWithIntl(
      <PrBriefCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    const regenButton = screen.getByRole("button", {
      name: "Regenerate the Why + Risk Brief",
    });
    expect(regenButton).toBeEnabled();

    fireEvent.click(regenButton);
    expect(mutate).toHaveBeenCalledTimes(1);

    // Reflect the in-flight state the (mocked) mutation hook reports while pending
    mockUseRegenerateBrief.mockReturnValue({ mutate, isPending: true });
    rerender(
      wrap(<PrBriefCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />),
    );
    expect(
      screen.getByRole("button", { name: "Regenerate the Why + Risk Brief" }),
    ).toBeDisabled();

    // Reflect success: mutation settles and the query cache now holds a new Brief
    mockUseRegenerateBrief.mockReturnValue({ mutate, isPending: false });
    mockUseBrief.mockReturnValue({
      data: withData({
        what: "Regenerated: narrows the limiter to auth-write endpoints only.",
      }),
      isLoading: false,
      isError: false,
    });
    rerender(
      wrap(<PrBriefCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />),
    );
    expect(
      screen.getByRole("button", { name: "Regenerate the Why + Risk Brief" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Regenerated: narrows the limiter to auth-write endpoints only."),
    ).toBeInTheDocument();
  });

  it("shows a skeleton while loading and a muted error state on failure — never a fabricated Brief", () => {
    mockUseRegenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false });

    // Loading (AC-16): no data yet, so no what/why/error text should render.
    mockUseBrief.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { rerender, container } = renderWithIntl(<PrBriefCard prId="pr1" />);

    // `Skeleton` (client/src/vendor/ui/primitives/Skeleton.tsx) is a plain
    // decorative <div className="skeleton"> with no accessible role/name —
    // there is no role/text query available, so this is a scoped, deliberate
    // exception rather than an implementation-detail probe.
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("What")).not.toBeInTheDocument();
    expect(screen.queryByText("Brief could not be generated.")).not.toBeInTheDocument();

    // Error (AC-16): a muted error message, not a fabricated Brief
    mockUseBrief.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    rerender(wrap(<PrBriefCard prId="pr1" />));

    expect(screen.getByText("Brief could not be generated.")).toBeInTheDocument();
    expect(screen.queryByText("What")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton")).toHaveLength(0);
  });

  it("renders the empty-risks state via the emptyRisks i18n key when risks[] is empty, not an error", () => {
    mockUseBrief.mockReturnValue({
      data: withData({ risks: [] }),
      isLoading: false,
      isError: false,
    });
    mockUseRegenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl(<PrBriefCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />);

    // "emptyRisks" i18n key (brief.json) reused from the existing "noRisks" wording
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(screen.queryByText("Brief could not be generated.")).not.toBeInTheDocument();

    // review_focus is unaffected by an empty risks[]
    const focusItem = within(screen.getByText("New fail-closed behaviour on Redis outage.").closest("li")!);
    expect(focusItem.getByRole("link", { name: "src/auth/rateLimiter.ts" })).toBeInTheDocument();
  });
});
