"use client";

/* ExportWizard — the "Add to CI" 4-step modal (Target → Preview → Configure →
   Install), composing the shared `Modal` the same way `CompareRunsModal` does
   (see `client/src/components/eval/CompareRunsModal.tsx`). AC-1: opens with
   `CiExportInput` defaults (target=gha, post_as=github_review,
   triggers=[opened,synchronize,reopened], base=main). Each step is a real
   PascalCase component, never a `renderStep()` factory — see `reducer.ts`
   for the `useReducer` form state and `TargetStep`/`PreviewStep`/
   `ConfigureStep`/`InstallStep` for the steps themselves. */

import React, { useEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import { usePreviewCi } from "@/lib/hooks/ci";
import { ConfigureStep } from "./ConfigureStep";
import { InstallStep } from "./InstallStep";
import { PreviewStep } from "./PreviewStep";
import { TargetStep } from "./TargetStep";
import { slugify } from "./preview";
import { initialWizardState, wizardReducer } from "./reducer";
import { toExportInputBody } from "./types";
import { isValidRepo } from "./validation";

export interface ExportWizardProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export function ExportWizard({ agentId, agentName, onClose }: ExportWizardProps) {
  const t = useTranslations("ci");
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState());

  const agentSlug = slugify(agentName);

  // Fetch the REAL server-generated bundle (AC-4/AC-7) once the user is on/past
  // the Preview step AND the repo is well-formed — not on every keystroke while
  // still typing the repo on the Target step. `usePreviewCi`'s query key is
  // keyed on the fields that affect the bundle (target/triggers/post_as/repo/
  // base via `toExportInputBody`), so it naturally refetches when Configure
  // step changes are made and stays cached otherwise. Shared here (rather than
  // inside PreviewStep) so the Install step's file count uses the same fetch.
  const canPreview = state.step >= 1 && isValidRepo(state.repo);
  const previewQuery = usePreviewCi(agentId, toExportInputBody(state, "files"), canPreview);

  const fileCount = previewQuery.data?.length ?? 0;

  // Accessibility: move focus to the step container on every transition
  // (including the initial mount) and provide a keyboard escape path.
  const stepContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepContainerRef.current?.focus();
  }, [state.step]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];

  const canContinueFromTarget = state.step !== 0 || isValidRepo(state.repo);

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <Button kind="secondary" onClick={() => dispatch({ type: "BACK" })} disabled={state.step === 0}>
        {t("exportWizard.back")}
      </Button>
      {state.step < 3 ? (
        <Button kind="primary" onClick={() => dispatch({ type: "NEXT" })} disabled={!canContinueFromTarget}>
          {t("exportWizard.continue")}
        </Button>
      ) : (
        <Button kind="secondary" onClick={onClose}>
          {t("exportWizard.done")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      width={840}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ padding: "16px 24px 0" }}>
        <ExportWizardSteps step={state.step} labels={stepLabels} />
      </div>
      <div ref={stepContainerRef} tabIndex={-1}>
        {state.step === 0 && (
          <TargetStep
            target={state.target}
            repo={state.repo}
            onSelectTarget={(target) => dispatch({ type: "SET_TARGET", target })}
            onRepoChange={(repo) => dispatch({ type: "SET_REPO", repo })}
          />
        )}
        {state.step === 1 && (
          <PreviewStep
            files={previewQuery.data}
            isLoading={previewQuery.isLoading}
            isError={previewQuery.isError}
            onRetry={() => previewQuery.refetch()}
            workflowOverride={state.workflowOverride}
            onWorkflowChange={(contents) => dispatch({ type: "SET_WORKFLOW_OVERRIDE", contents })}
          />
        )}
        {state.step === 2 && (
          <ConfigureStep
            target={state.target}
            triggers={state.triggers}
            postAs={state.post_as}
            onToggleTrigger={(trigger) => dispatch({ type: "TOGGLE_TRIGGER", trigger })}
            onChangePostAs={(postAs) => dispatch({ type: "SET_POST_AS", postAs })}
          />
        )}
        {state.step === 3 && (
          <InstallStep agentId={agentId} agentSlug={agentSlug} form={state} fileCount={fileCount} />
        )}
      </div>
    </Modal>
  );
}
