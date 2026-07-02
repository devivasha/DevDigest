/**
 * Shared response-shaping helpers.
 *
 * Centralises:
 *  - toolOk / toolError — MCP tool result envelope construction
 *  - compact* shapers — concise projections that drop UUIDs, full text fields,
 *    and verbose diagnostics to keep responses token-efficient
 *
 * All functions are pure (no I/O, no side effects).
 *
 * NOTE: Finding uses start_line / end_line (not "line"). compactFinding surfaces
 * start_line as "line" so callers get a clean file:line signal.
 */

import type { Finding, Agent, ConventionCandidate } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// MCP tool result envelope
// ---------------------------------------------------------------------------

export type ToolContent = { type: 'text'; text: string };
export type ToolResult = { content: ToolContent[]; isError?: true };

/** Wrap a successful data payload as an MCP tool result. */
export function toolOk(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/** Wrap an error message as an MCP tool result with isError: true. */
export function toolError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Compact shapers — concise projections for tool responses
// ---------------------------------------------------------------------------

/**
 * Compact finding — drops UUIDs, confidence, suggestion, kind, trifecta fields.
 * Surfaces start_line as `line` for human-readable file:line signals.
 */
export type CompactFinding = {
  severity: Finding['severity'];
  title: string;
  file: string;
  line: number;
  rationale: string;
};

export function compactFinding(f: Finding): CompactFinding {
  return {
    severity: f.severity,
    title: f.title,
    file: f.file,
    line: f.start_line,
    rationale: f.rationale,
  };
}

/**
 * Compact agent — returns only the fields relevant to tool callers:
 * id, name, enabled, model. Drops system_prompt, description, version, etc.
 */
export type CompactAgent = {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
};

export function compactAgent(a: Agent): CompactAgent {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    model: a.model,
  };
}

/**
 * Compact convention — returns rule, evidence_path as file, confidence, accepted.
 * Drops evidence_snippet to keep responses token-efficient.
 */
export type CompactConvention = {
  rule: string;
  file: string;
  confidence: number;
  accepted: boolean;
};

export function compactConvention(c: ConventionCandidate): CompactConvention {
  return {
    rule: c.rule,
    file: c.evidence_path,
    confidence: c.confidence,
    accepted: c.accepted,
  };
}
