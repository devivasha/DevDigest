/* MultiAgentColumns — T10: one column per AgentColumn in a multi-agent run.
   Each column shows: agent name, live status (running/done/failed, reconciled
   from useRunEvents + the persisted column status), cost once known, its
   attributed findings + count, and a "View trace" control that opens
   RunTraceDrawer for that column's run_id. A failed column shows its reason
   without blocking its siblings from rendering (AC-16). */
"use client";

import React from "react";
import type { AgentColumn } from "@devdigest/shared";
import { useRunEvents } from "@/lib/hooks/reviews";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { AgentColumnCard } from "./AgentColumnCard";
import { s } from "./styles";

export interface MultiAgentColumnsProps {
  columns: AgentColumn[];
  /** PR number, for the trace drawer's subtitle context. */
  prNumber?: number | null;
}

export function MultiAgentColumns({ columns, prNumber }: MultiAgentColumnsProps) {
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);

  // Only subscribe the SSE stream for columns still running — done/failed
  // columns already have their terminal state persisted (T10 gotcha:
  // useRunEvents takes an array of run ids and fans out in parallel).
  const subscribeRunIds = React.useMemo(
    () => columns.filter((column) => column.status === "running").map((column) => column.run_id),
    [columns],
  );
  const { events } = useRunEvents(subscribeRunIds);

  const traceColumn = columns.find((column) => column.run_id === traceRunId) ?? null;

  return (
    <>
      <div style={s.scrollWrap}>
        <div style={s.row}>
          {columns.map((column, index) => (
            <AgentColumnCard
              key={column.run_id}
              column={column}
              index={index}
              events={events}
              onViewTrace={setTraceRunId}
            />
          ))}
        </div>
      </div>

      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          agentName={traceColumn.agent_name}
          prNumber={prNumber}
          findings={[]}
          running={traceColumn.status === "running"}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </>
  );
}

export default MultiAgentColumns;
