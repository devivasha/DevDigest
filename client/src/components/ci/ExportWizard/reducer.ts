import type { CiTarget } from "@/vendor/shared/contracts/eval-ci";
import { DEFAULT_TRIGGERS, SUPPORTED_TRIGGERS, type SupportedTrigger } from "./constants";
import type { WizardFormState, WizardPostAs, WizardStepIndex } from "./types";

const LAST_STEP: WizardStepIndex = 3;

/** Initial state — `CiExportInput` defaults (AC-1): target=gha, post_as=github_review,
 *  triggers=[opened,synchronize,reopened], base=main. `repo` has no schema default
 *  (required, `min(1)`) so it starts empty; `action` isn't tracked in form state — the
 *  Install step picks it per button click (see `types.ts#toExportInputBody`). */
export function initialWizardState(): WizardFormState {
  return {
    step: 0,
    repo: "",
    target: "gha",
    post_as: "github_review",
    triggers: [...DEFAULT_TRIGGERS],
    base: "main",
    workflowOverride: null,
  };
}

export type WizardReducerAction =
  | { type: "SET_REPO"; repo: string }
  | { type: "SET_TARGET"; target: CiTarget }
  | { type: "TOGGLE_TRIGGER"; trigger: SupportedTrigger }
  | { type: "SET_POST_AS"; postAs: WizardPostAs }
  | { type: "SET_WORKFLOW_OVERRIDE"; contents: string }
  | { type: "NEXT" }
  | { type: "BACK" };

export function wizardReducer(state: WizardFormState, action: WizardReducerAction): WizardFormState {
  switch (action.type) {
    case "SET_REPO":
      return { ...state, repo: action.repo };
    case "SET_TARGET":
      // AC-3: switching target changes whether the workflow preview is editable —
      // drop any manual edit so the next render re-derives from the new target.
      return { ...state, target: action.target, workflowOverride: null };
    case "TOGGLE_TRIGGER": {
      const has = state.triggers.includes(action.trigger);
      const next = has ? state.triggers.filter((t) => t !== action.trigger) : [...state.triggers, action.trigger];
      // Keep canonical SUPPORTED_TRIGGERS order regardless of toggle order (AC-8).
      const ordered = SUPPORTED_TRIGGERS.filter((t) => next.includes(t));
      return { ...state, triggers: ordered, workflowOverride: null };
    }
    case "SET_POST_AS":
      return { ...state, post_as: action.postAs, workflowOverride: null };
    case "SET_WORKFLOW_OVERRIDE":
      return { ...state, workflowOverride: action.contents };
    case "NEXT":
      return { ...state, step: Math.min(LAST_STEP, state.step + 1) as WizardStepIndex };
    case "BACK":
      return { ...state, step: Math.max(0, state.step - 1) as WizardStepIndex };
    default:
      return state;
  }
}
