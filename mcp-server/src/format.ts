/**
 * format.ts — pure (no-I/O) response shapers + the `toolOk`/`toolError`
 * conventions. Centralises two things every tool must do the same way:
 *
 *  1. Wrap payloads in the MCP tool-result envelope (`content: [{type:"text"}]`).
 *  2. Keep responses TOKEN-EFFICIENT: strip UUID-heavy / verbose fields in the
 *     default "concise" shape, surfacing `file:line` + title + severity as the
 *     primary signal. Full fields are opt-in via the caller's "detailed" mode.
 */

import type { Agent, ConventionCandidate, FindingRecord } from "@devdigest/shared";

/** MCP tool-result envelope (structurally compatible with the SDK's CallToolResult). */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

/** Success result — JSON-encodes `data` into a single text content block. */
export function toolOk(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * Business-level error result (NOT a thrown protocol error). Messages must lead
 * forward — tell the agent what to do next (see error-handling contract). An
 * empty result is never routed through here.
 */
export function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Concise agent row — drops system_prompt/description/version/etc. */
export function compactAgent(a: Agent): { id: string; name: string; enabled: boolean; model: string } {
  return { id: a.id, name: a.name, enabled: a.enabled, model: a.model };
}

/** Concise convention row — drops evidence_snippet and the internal id. */
export function compactConvention(c: ConventionCandidate): {
  rule: string;
  file: string;
  confidence: number;
  accepted: boolean;
} {
  return { rule: c.rule, file: c.evidence_path, confidence: c.confidence, accepted: c.accepted };
}

/**
 * Concise finding — `start_line` surfaces as `line`, drops UUIDs / confidence /
 * suggestion / trifecta fields. `file:line` is the primary locator signal.
 */
export function compactFinding(f: FindingRecord): {
  severity: string;
  title: string;
  file: string;
  line: number;
  rationale: string;
} {
  return {
    severity: f.severity,
    title: f.title,
    file: f.file,
    line: f.start_line,
    rationale: f.rationale,
  };
}

/** Detailed finding — full fields for when the agent explicitly asks. */
export function detailedFinding(f: FindingRecord): {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion: string | null | undefined;
  confidence: number;
} {
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: f.rationale,
    suggestion: f.suggestion,
    confidence: f.confidence,
  };
}
