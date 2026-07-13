import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../messages/en/eval.json";
import { RegressionBanner } from "./RegressionBanner";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// AC-14 + AC-23: the regression warning names the dipped metric + magnitude,
// and — like MetricDeltaBadge — must remain distinguishable via an arrow
// glyph + text even with colour ignored (colour is never asserted here).
describe("RegressionBanner", () => {
  it("names the dipped metric and magnitude via an arrow glyph + text (structured dips)", () => {
    renderWithIntl(<RegressionBanner dips={[{ metric: "precision", magnitude: 0.02 }]} />);

    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText("Regression detected since the previous run")).toBeInTheDocument();
    expect(screen.getByText("PRECISION dipped by 2pts")).toBeInTheDocument();
    // The down-arrow glyph accompanies the text — not colour alone.
    expect(banner.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a pre-composed alert string when no structured dips are given", () => {
    renderWithIntl(<RegressionBanner alert="Citation accuracy fell sharply" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Citation accuracy fell sharply")).toBeInTheDocument();
  });

  it("renders nothing when there is no regression to report", () => {
    renderWithIntl(<RegressionBanner dips={[]} alert={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
