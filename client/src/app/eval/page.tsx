import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Eval Dashboard, L06/AC-20). Thin route entry — the view, its
   agent-detail sub-view, styles and helpers are colocated under
   _components/EvalDashboardView + _components/AgentEvalDetail. */
export default function EvalPage() {
  return <EvalDashboardView />;
}
