"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/diff-viewer/SmartDiffViewer/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/pulls";
import { notify } from "@/lib/contexts/toast";
import type { PrFile, ReviewRecord } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Latest review data — used for finding badges in Smart order view. */
  reviews?: ReviewRecord[];
  /** Called when user clicks a finding badge; parent switches to Agent runs tab. */
  onFindingClick?: (findingId: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  reviews,
  onFindingClick,
}: DiffTabProps) {
  const t = useTranslations("shell");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smartDiff, isLoading: smartLoading } = useSmartDiff(prId);
  const [smartOrder, setSmartOrder] = React.useState(true);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const allFindings = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings),
    [reviews],
  );

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const orderToggle = (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <Button
        kind={smartOrder ? "secondary" : "ghost"}
        size="sm"
        disabled={smartLoading}
        onClick={() => setSmartOrder(true)}
      >
        {t("smartDiff.smartOrder")}
      </Button>
      <Button
        kind={!smartOrder ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setSmartOrder(false)}
      >
        {t("smartDiff.originalOrder")}
      </Button>
    </div>
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {orderToggle}
            {commentCount > 0 ? (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            ) : undefined}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {smartOrder && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          findings={allFindings}
          commenting={commenting}
          onFindingClick={onFindingClick}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
