import type { IconName } from "@devdigest/ui";

export type CiStatusMeta = { icon: IconName; label: string; color: string; bg: string };

type TranslateFn = (key: string) => string;

/**
 * Icon + text label per CI run status — never color alone (WCAG). A run
 * with zero grounded findings is `no_findings`, a PASSING outcome, so it
 * gets its own check-style icon/label distinct from `failed`. Falls back
 * gracefully for `null`/unrecognized status values instead of crashing.
 *
 * Shared by the CI Runs page (`/ci`) and the agent CI tab (installations
 * list + run-history list) — reuses the existing `runs.status.*` keys
 * already shipped in `ci.json`. `t` must be a `useTranslations("ci")`
 * instance.
 */
export function ciStatusMeta(status: string | null | undefined, t: TranslateFn): CiStatusMeta {
  switch (status) {
    case "succeeded":
      return { icon: "CheckCircle", label: t("runs.status.succeeded"), color: "var(--ok)", bg: "var(--ok-bg)" };
    case "no_findings":
      return { icon: "Check", label: t("runs.status.noFindings"), color: "var(--ok)", bg: "var(--ok-bg)" };
    case "failed":
      return { icon: "XCircle", label: t("runs.status.failed"), color: "var(--crit)", bg: "var(--crit-bg)" };
    case "running":
      return { icon: "RefreshCw", label: t("runs.status.running"), color: "var(--accent)", bg: "var(--accent-bg)" };
    default:
      return { icon: "Clock", label: status ?? "—", color: "var(--text-muted)", bg: "var(--bg-hover)" };
  }
}
