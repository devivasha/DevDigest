export const TABS = ["config", "preview", "stats", "versions", "context"] as const;
export type SkillEditorTab = (typeof TABS)[number];
