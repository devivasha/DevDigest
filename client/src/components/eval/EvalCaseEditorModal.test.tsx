import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../messages/en/eval.json";
import { EvalCaseEditorModal } from "./EvalCaseEditorModal";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** The modal renders exactly 3 role="textbox" fields on the default "diff"
 *  tab: the Name TextInput, the Diff Textarea, and the Expected-output
 *  Textarea — in that DOM order (left column, then right column). The
 *  Expected-output box is always the last one and carries no placeholder. */
function getExpectedOutputBox(): HTMLTextAreaElement {
  const boxes = screen.getAllByRole("textbox");
  return boxes[boxes.length - 1] as HTMLTextAreaElement;
}

describe("EvalCaseEditorModal", () => {
  // AC-22: invalid Expected-output JSON blocks Save with a validation message.
  it("blocks Save and shows a validation message when Expected-output JSON is invalid", () => {
    const onSave = vi.fn();
    renderWithIntl(
      <EvalCaseEditorModal ownerKind="agent" ownerId="agent-1" onClose={vi.fn()} onSave={onSave} />,
    );

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "stripe-key-leak" },
    });

    // Well-formed JSON that does NOT satisfy the EvalExpectation schema
    // (missing findings[]/kind) — still invalid for Save purposes.
    fireEvent.change(getExpectedOutputBox(), { target: { value: "{}" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Not even parseable JSON.
    fireEvent.change(getExpectedOutputBox(), { target: { value: "{ this is not json" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  // AC-22: valid Expected-output JSON enables Save and persists the parsed case.
  it("enables Save and persists a valid Expected-output JSON case", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(
      <EvalCaseEditorModal ownerKind="agent" ownerId="agent-1" onClose={vi.fn()} onSave={onSave} />,
    );

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "stripe-key-leak" },
    });

    const validExpectation = {
      kind: "must_find",
      findings: [
        {
          file: "src/config.ts",
          start_line: 10,
          end_line: 11,
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded secret",
        },
      ],
    };
    fireEvent.change(getExpectedOutputBox(), { target: { value: JSON.stringify(validExpectation) } });

    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [input, opts] = onSave.mock.calls[0]!;
    expect(input).toMatchObject({
      owner_kind: "agent",
      owner_id: "agent-1",
      name: "stripe-key-leak",
      expected_output: validExpectation,
    });
    // "Run on save" defaults ON (matches the case-editor mockup).
    expect(opts).toEqual({ runOnSave: true });
  });
});
