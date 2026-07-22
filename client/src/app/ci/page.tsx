import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci (CI Runs page, AC-15/16/17). Thin route entry, mirroring
   client/src/app/eval/page.tsx — the data-fetching view is a client
   component colocated under _components/CiRunsView. */
export default function CiPage() {
  return <CiRunsView />;
}
