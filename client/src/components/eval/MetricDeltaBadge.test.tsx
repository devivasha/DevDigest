import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../messages/en/eval.json";
import { MetricDeltaBadge } from "./MetricDeltaBadge";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// AC-23: metric direction and magnitude must be conveyed by an arrow glyph +
// text, never by colour alone — so even with colour ignored (as this test
// does, colour is never asserted on), an up/down/flat delta must remain
// distinguishable via an accessible name + a visible arrow glyph.
describe("MetricDeltaBadge", () => {
  it("conveys an upward delta via an arrow glyph + signed text, not colour alone", () => {
    renderWithIntl(<MetricDeltaBadge delta={0.04} metricLabel="Recall" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName("Recall: Increased, 4pts");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("+4pts")).toBeInTheDocument();
  });

  it("conveys a downward delta via an arrow glyph + signed text, not colour alone", () => {
    renderWithIntl(<MetricDeltaBadge delta={-0.03} metricLabel="Precision" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName("Precision: Decreased, 3pts");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("−3pts")).toBeInTheDocument();
  });

  it("conveys a flat (zero) delta via a distinct glyph + text, not colour alone", () => {
    renderWithIntl(<MetricDeltaBadge delta={0} metricLabel="Citation" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName("Citation: No change, 0pts");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("0pts")).toBeInTheDocument();
  });

  it("renders nothing when there is no previous run to compare against", () => {
    renderWithIntl(<MetricDeltaBadge delta={null} metricLabel="Recall" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
