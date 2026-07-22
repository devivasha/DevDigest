import { Suspense } from "react";
// Import Skeleton from its module directly (not the "@devdigest/ui" barrel):
// this is a Server Component, and the barrel re-exports client-only chart
// components (recharts) that crash when evaluated in the RSC graph.
import { Skeleton } from "@devdigest/ui/primitives/Skeleton";
import { ResultsView } from "./_components/ResultsView";

type Props = { params: Promise<{ runId: string }> };

/* Route: /multi-agent/[runId] (Results page, T14). Thin RSC shell — the run
   id is resolved here (Next 15 async params) and handed to the client
   component, which owns the `?view=` toggle and all interactivity.
   `ResultsView` reads `useSearchParams`, so it must sit inside a Suspense
   boundary or the whole route bails out to full client-side rendering
   (Next 15 CSR bailout — next-best-practices: suspense-boundaries). */
export default async function MultiAgentResultsPage({ params }: Props) {
  const { runId } = await params;

  return (
    <Suspense
      fallback={
        <div style={{ padding: "28px 32px", maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      }
    >
      <ResultsView runId={runId} />
    </Suspense>
  );
}
