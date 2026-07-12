/**
 * LLM Message Pattern judge, on the subscription. Binary PASS/FAIL per practice, PASS only with
 * a verbatim evidence quote. The judge defaults to a stronger family than the task to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the
 * rest, since on a shared subscription the families overlap.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each " +
  "practice independently.\n" +
  "Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct " +
  "verbatim quote from the OUTPUT is evidence the practice was met — a keyword is not " +
  "evidence. (3) Reply with ONLY minified JSON:\n" +
  '{"results":[{"practice":"<text>","passed":true,"evidence":"<verbatim quote>"}]}';

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

/**
 * Best-effort extraction of the verdict array from a judge reply. Cheap non-Anthropic models
 * (DeepSeek, Gemini Flash) wrap the JSON in ```json fences or trail prose after it, and sometimes
 * emit outright invalid JSON. Strip fences, take the outermost braces, and return null on any
 * failure so the caller can retry rather than crash the whole test on a single flaky reply.
 */
function parseVerdict(text: string): Verdict["results"] | null {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(unfenced.slice(start, end + 1));
    return Array.isArray(obj.results) ? obj.results : null;
  } catch {
    return null;
  }
}

/**
 * Judge an output against a list of practices. Model defaults to the stronger judge family.
 *
 * The judge runs on whatever model EVAL_JUDGE_MODEL selects — including cheap ones that
 * occasionally break their own JSON. On an unparseable reply we retry ONCE with an explicit
 * "valid JSON only" correction (a different prompt yields a different completion even at
 * temperature 0); only if that also fails do we surface the error.
 */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nReturn the JSON now.`;

  let res = await runContent(prompt, { allowedTools: [], maxTurns: 1, model });
  let results = parseVerdict(res.text);
  if (!results) {
    const correction =
      `${prompt}\n\nYour previous reply was NOT valid JSON. Reply with ONLY the minified JSON ` +
      "object matching the schema — no markdown fences, no prose before or after.";
    res = await runContent(correction, { allowedTools: [], maxTurns: 1, model });
    results = parseVerdict(res.text);
  }
  if (!results) throw new Error(`judge returned no parseable JSON after retry: ${res.text.slice(0, 200)}`);

  const total = results.length || 1;
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total, score: passed / total };
}
