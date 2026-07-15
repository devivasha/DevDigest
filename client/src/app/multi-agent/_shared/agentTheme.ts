/* Per-agent visual theme (accent colour + icon name), assigned by position.
   The Agent contract carries no colour or icon, so this is presentational only
   and cycles for any agent count. Shared across the Configure-run picker and
   the results Columns/Tabs so a given agent reads as the same "lane"
   everywhere (Security = red/shield, Performance = amber/zap, …). */

export const AGENT_THEMES = [
  { accent: "#ef4444", icon: "Shield" },
  { accent: "#f59e0b", icon: "Zap" },
  { accent: "#3b82f6", icon: "Lightbulb" },
  { accent: "#8b5cf6", icon: "Users" },
  { accent: "#10b981", icon: "Boxes" },
] as const;

export type AgentTheme = (typeof AGENT_THEMES)[number];

/** Theme for the agent at ordinal position `i` (cycles past the palette). */
export function themeForIndex(i: number): AgentTheme {
  return AGENT_THEMES[((i % AGENT_THEMES.length) + AGENT_THEMES.length) % AGENT_THEMES.length]!;
}
