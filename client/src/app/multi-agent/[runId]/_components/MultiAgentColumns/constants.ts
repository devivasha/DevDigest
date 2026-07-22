import { Icon } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";

/** Status → icon component. Status/severity must be conveyed by icon+text,
 * never colour alone (AC-29). */
export const STATUS_ICON: Record<AgentColumn["status"], typeof Icon.CheckCircle> = {
  running: Icon.RefreshCw,
  done: Icon.CheckCircle,
  failed: Icon.XCircle,
};

/** Fixed/min width (px) of a single agent column card. */
export const COLUMN_WIDTH = 280;

/** Severity → colour for a finding mini-card's left border. Matches the
 * design system's severity tokens (`--crit`/`--warn`/`--sugg`, the latter
 * being the same blue as `--accent`). */
export const SEVERITY_BORDER_COLOR: Record<AgentColumnFinding["severity"], string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};

/** Severity → icon for a finding mini-card, mirroring `@devdigest/ui`'s own
 * `SEV` token table so a CRITICAL/WARNING/SUGGESTION finding reads the same
 * icon here as everywhere else in the app. */
export const SEVERITY_ICON: Record<AgentColumnFinding["severity"], typeof Icon.CheckCircle> = {
  CRITICAL: Icon.AlertOctagon,
  WARNING: Icon.AlertTriangle,
  SUGGESTION: Icon.Lightbulb,
};
