import { Suspense } from "react";
// Import Skeleton from its module directly (not the "@devdigest/ui" barrel):
// this is a Server Component, and the barrel re-exports client-only chart
// components (recharts) that crash when evaluated in the RSC graph.
import { Skeleton } from "@devdigest/ui/primitives/Skeleton";
import { ConfigureRun } from "./_components/ConfigureRun";

/* Route: /multi-agent (Configure-run page, T13). Thin RSC shell — all
   interactivity (PR/agent selection, estimate, launch) lives in the client
   component below. `ConfigureRun` reads `useSearchParams`, so it must sit
   inside a Suspense boundary or the whole route bails out to full
   client-side rendering (Next 15 CSR bailout — next-best-practices:
   suspense-boundaries), mirroring `[runId]/page.tsx`. */
export default function MultiAgentPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "28px 32px", maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      }
    >
      <ConfigureRun />
    </Suspense>
  );
}
