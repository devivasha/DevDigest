/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer.
   Optional `finding` prop adds a severity indicator (colored left border +
   clickable chip) for Smart Diff view — no change when omitted. */
"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

const FINDING_BORDER: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};
const FINDING_LABEL: Record<string, string> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  finding,
  onFindingClick,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  finding?: FindingRecord;
  onFindingClick?: (findingId: string) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  const findingColor = finding ? (FINDING_BORDER[finding.severity] ?? undefined) : undefined;
  const findingLabel = finding ? (FINDING_LABEL[finding.severity] ?? finding.severity.toLowerCase()) : undefined;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          ...lineRowFor(ln.kind),
          ...(findingColor ? { borderLeft: `3px solid ${findingColor}`, paddingLeft: 2 } : {}),
        }}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {finding && findingLabel && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFindingClick?.(finding.id);
            }}
            style={{
              background: "none",
              border: `1px solid ${findingColor}`,
              borderRadius: 3,
              color: findingColor,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.03em",
              padding: "1px 5px",
              flexShrink: 0,
              alignSelf: "center",
              marginRight: 8,
            }}
          >
            {findingLabel}
          </button>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
