import type { CiExportInputBody, CiTarget } from "@/vendor/shared/contracts/eval-ci";

/** Ordered wizard steps: Target(0) → Preview(1) → Configure(2) → Install(3). */
export type WizardStepIndex = 0 | 1 | 2 | 3;

/** Derived from the Zod contract (`CiExportInput`'s `post_as`/`action` enums) rather
 *  than re-declared, so these track the source of truth if the schema changes. */
export type WizardPostAs = NonNullable<CiExportInputBody["post_as"]>;
export type WizardExportAction = NonNullable<CiExportInputBody["action"]>;

/** Local UI/form state for the multi-step wizard (useReducer — not URL/global state). */
export interface WizardFormState {
  step: WizardStepIndex;
  repo: string;
  target: CiTarget;
  post_as: WizardPostAs;
  triggers: string[];
  base: string;
  /** User-edited workflow YAML text (gha target only, Preview step). `null` = derive
   *  the workflow text from the current triggers/post_as/target (default). */
  workflowOverride: string | null;
}

/** Builds the `POST /agents/:id/export-ci` request body for one Install-step action.
 *  The Install step decides `open_pr` vs `files` per button click — the reducer state
 *  itself carries no `action` field. */
export function toExportInputBody(state: WizardFormState, action: WizardExportAction): CiExportInputBody {
  return {
    repo: state.repo.trim(),
    target: state.target,
    action,
    post_as: state.post_as,
    triggers: state.triggers,
    base: state.base,
  };
}
