/* Thin re-export — the icon+label status mapping now lives in the shared
 * `@/lib/ci-status` module (deduplicated from a byte-identical copy in
 * `CiRunsView.tsx`). Kept as a re-export here (rather than deleted) so
 * `InstallationsList.tsx` doesn't need a separate edit for this fix. */
export { ciStatusMeta } from "@/lib/ci-status";
export type { CiStatusMeta as StatusMeta } from "@/lib/ci-status";
