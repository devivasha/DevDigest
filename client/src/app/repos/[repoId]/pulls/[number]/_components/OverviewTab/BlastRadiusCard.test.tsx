import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const mockUseBlastRadius = vi.fn();
vi.mock("@/lib/hooks/pulls", () => ({
  useBlastRadius: (...args: unknown[]) => mockUseBlastRadius(...args),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  mockUseBlastRadius.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ blast: messages }}>{ui}</NextIntlClientProvider>);
}

function withData(overrides: Partial<BlastResponse> = {}): BlastResponse {
  return {
    changed_symbols: [{ name: "computeTotal", file: "src/billing.ts", kind: "function" }],
    downstream: [
      {
        symbol: "computeTotal",
        callers: [{ name: "checkout", file: "src/checkout.ts", line: 42 }],
        endpoints_affected: ["GET /api/checkout"],
        crons_affected: [],
      },
    ],
    impacted_endpoints: ["GET /api/checkout"],
    impacted_crons: [],
    status: "full",
    degraded: false,
    degraded_reason: null,
    history: [],
    summary: "1 symbols changed, 1 downstream callers, 1 endpoints impacted.",
    ...overrides,
  };
}

describe("BlastRadiusCard", () => {
  it("expands a symbol row and links a caller to the exact GitHub blob line", () => {
    mockUseBlastRadius.mockReturnValue({ data: withData(), isLoading: false, isError: false });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    expect(screen.getByText("computeTotal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("computeTotal"));

    const link = screen.getByText("src/checkout.ts:42");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/abc123/src/checkout.ts#L42",
    );
  });

  it("shows the no-downstream empty state when there are no callers", () => {
    mockUseBlastRadius.mockReturnValue({
      data: withData({ downstream: [] }),
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" />);

    expect(
      screen.getByText("1 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
  });

  it("lists only symbols that have callers, dropping caller-less ones", () => {
    mockUseBlastRadius.mockReturnValue({
      data: withData({
        changed_symbols: [
          { name: "computeTotal", file: "src/billing.ts", kind: "function" },
          { name: "unusedHelper", file: "src/billing.ts", kind: "function" },
        ],
        downstream: [
          {
            symbol: "computeTotal",
            callers: [{ name: "checkout", file: "src/checkout.ts", line: 42 }],
            endpoints_affected: [],
            crons_affected: [],
          },
          { symbol: "unusedHelper", callers: [], endpoints_affected: [], crons_affected: [] },
        ],
      }),
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" />);

    expect(screen.getByText("computeTotal")).toBeInTheDocument();
    expect(screen.queryByText("unusedHelper")).not.toBeInTheDocument();
  });

  it("shows the degraded badge and explanation for a partial index", () => {
    mockUseBlastRadius.mockReturnValue({
      data: withData({ status: "partial", degraded: true }),
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" />);

    expect(screen.getByText("partial index")).toBeInTheDocument();
    expect(
      screen.getByText("The repository index is partial — some downstream callers may be missing."),
    ).toBeInTheDocument();
  });
});
