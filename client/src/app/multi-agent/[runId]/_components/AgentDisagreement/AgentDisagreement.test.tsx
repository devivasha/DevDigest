import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";

// NOTE: `@testing-library/user-event` is not installed in client/ — use
// `fireEvent`, matching the sibling AgentPicker.test.tsx pattern.
// ref: client/insights/INSIGHTS.md "@testing-library/user-event is NOT installed"

import { AgentDisagreement } from "./AgentDisagreement";

afterEach(() => {
  cleanup();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A genuine disagreement: one agent flags CRITICAL, another did not flag it. */
const disagreementGroup: Conflict = {
  file: "src/auth/session.ts",
  line: 42,
  title: "Session token stored without expiry",
  takes: [
    {
      agent_id: "agent-1",
      persona: "Security Reviewer",
      verdict: "CRITICAL",
      note: "No TTL on the session cookie.",
    },
    {
      agent_id: "agent-2",
      persona: "Style Reviewer",
      verdict: "ignored",
      note: "",
    },
  ],
};

/**
 * An all-agree group: every agent gave the same verdict (no real conflict).
 * Personas are intentionally distinct from `disagreementGroup`'s so each
 * agent's name/verdict text is unique across the whole render — this lets
 * assertions target visible text/accessible name directly instead of
 * scoping by DOM structure (`closest("div")` chains), since neither the
 * group container nor its rows expose any role/label to query by.
 */
const agreementGroup: Conflict = {
  file: "src/utils/format.ts",
  line: 10,
  title: "Minor formatting nit",
  takes: [
    {
      agent_id: "agent-1",
      persona: "Docs Reviewer",
      verdict: "SUGGESTION",
      note: "Consider extracting this to a helper.",
    },
    {
      agent_id: "agent-2",
      persona: "Perf Reviewer",
      verdict: "SUGGESTION",
      note: "Same nit.",
    },
  ],
};

describe("AgentDisagreement", () => {
  it("renders each agent's verdict per group — including 'did not flag' — and 'Show only conflicts' hides all-agree groups while keeping disagreement groups", () => {
    renderWithIntl(
      <AgentDisagreement conflicts={[disagreementGroup, agreementGroup]} />,
    );

    // Both groups render initially (AC-19)
    expect(screen.getByText("Session token stored without expiry")).toBeInTheDocument();
    expect(screen.getByText("Minor formatting nit")).toBeInTheDocument();

    // Disagreement group: one agent's severity verdict, the other's "did not flag" —
    // both shown as icon + text so they survive colour removal (AC-29).
    // Each group uses distinct persona names (see `disagreementGroup`/
    // `agreementGroup` fixtures above), so every persona/verdict text below
    // is unique across the whole render — no need to scope by DOM structure
    // to prove it belongs to the disagreement group specifically.
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();
    // The icon next to "did not flag" is decorative — the visible text is
    // the accessible, user-facing signal that conveys the verdict, so assert
    // on that rather than reaching into the DOM for the underlying <svg>.
    expect(screen.getByText("did not flag")).toBeInTheDocument();

    // Toggle is keyboard-operable: a real <button role="switch"> with an
    // accessible name, starting unchecked (AC-29).
    const toggle = screen.getByRole("switch", { name: "Show only conflicts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    // Toggling ON hides the all-agree group but keeps the disagreement group (AC-21)
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Session token stored without expiry")).toBeInTheDocument();
    expect(screen.queryByText("Minor formatting nit")).not.toBeInTheDocument();

    // Toggling back OFF restores the agreement group
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Minor formatting nit")).toBeInTheDocument();
  });

  it("renders a calm empty state — never blank or crashing — when there are no conflict groups", () => {
    renderWithIntl(<AgentDisagreement conflicts={[]} />);

    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("All agents agreed — no conflicts to show.")).toBeInTheDocument();
    // No toggle when there is nothing to filter
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
