import { describeAgent, runAgentCases } from "../../src/index.js";
// Same prompts and fixtures as the strict variant, minus the "cite the exact documented rule"
// practices that lite is designed NOT to satisfy (see architecture-reviewer-lite.cases.ts). Only
// the injected agent artifact differs, which keeps this a controlled A/B: pnpm eval:repeat both
// with labels and pnpm eval:delta them to see exactly which practice moved.
import { cases } from "./architecture-reviewer-lite.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
