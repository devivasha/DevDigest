#!/usr/bin/env python3
"""Programmatic grader for dependency-checker skill evals.

Reads each run's report.md and checks the planted-finding assertions using
substring / proximity heuristics. Writes grading.json into each run dir with
the schema the eval-viewer expects: {"expectations": [{text, passed, evidence}]}.
"""
import json
import re
import sys
from pathlib import Path

ITER = Path(__file__).parent / "iteration-1"

RUNS = ["with_skill", "without_skill"]
EVAL_DIRS = {
    0: "eval-0-full-audit",
    1: "eval-1-unused-and-duplicate",
    2: "eval-2-coupling-and-drift",
}


def load_report(eval_dir: str, run: str) -> str:
    p = ITER / eval_dir / run / "outputs" / "report.md"
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8", errors="ignore")


def near(text: str, a: str, b: str, window: int = 60) -> bool:
    """True if token b appears within `window` chars of token a (either order)."""
    for m in re.finditer(re.escape(a), text):
        seg = text[max(0, m.start() - window): m.end() + window]
        if b in seg:
            return True
    return False


def check(text: str) -> dict:
    t = text.lower()

    def has(*subs):
        return all(s in t for s in subs)

    def any_(*subs):
        return any(s in t for s in subs)

    # --- individual planted-finding checks (reused across evals) ---
    mermaid = "```mermaid" in t and ("flowchart" in t or re.search(r"\bgraph (lr|td|rl|bt)\b", t) is not None)

    tier_tokens = set(re.findall(r"\bp[012]\b", t))
    ranked_words = any_("critical", "high priority", "severity", "medium", "info tier", "informational")
    severity = len(tier_tokens) >= 2 or (len(tier_tokens) >= 1 and ranked_words) or (
        "high" in t and "medium" in t and ("low" in t or "info" in t))

    circular = "circular" in t and "reviewer-core" in t

    reach = ("server/src/db/schema" in t) or (
        "server/src" in t and "client" in t and any_("internal", "reach", "relative import", "relative path", "bypass"))

    # zod drift: zod mentioned with both a v3 and v4 marker, or explicit "drift"
    zod_drift = "zod" in t and (
        near(t, "zod", "drift", 120)
        or (re.search(r"\^?3\.\d", t) is not None and re.search(r"\^?4\.\d", t) is not None and near(t, "zod", "4", 200))
        or ("version" in t and near(t, "zod", "different", 160))
    )

    unused_lodash = "lodash" in t and (near(t, "lodash", "unused", 80) or near(t, "lodash", "not imported", 80)
                                       or near(t, "lodash", "never", 80) or near(t, "lodash", "remove", 80))
    unused_axios = "axios" in t and (near(t, "axios", "unused", 80) or near(t, "axios", "not imported", 80)
                                     or near(t, "axios", "never", 80) or near(t, "axios", "remove", 80))

    dup_dates = "date-fns" in t and "moment" in t and any_(
        "duplicate", "overlap", "redundant", "same job", "two date", "both date", "two libraries", "same purpose")

    eslint_dep = "eslint" in t and (near(t, "eslint", "devdependenc", 120) or near(t, "eslint", "tooling", 120)
                                    or near(t, "eslint", "should", 100) or near(t, "eslint", "move", 100))

    rc_zero = "reviewer-core" in t and any_("zero runtime", "no runtime", "no dependenc", "zero dependenc",
                                            "empty dependenc", "zero external", "no external dep")

    # no-false-positive: a genuinely-used dep should NOT be labelled unused
    used_deps = ["zod", "fastify", "next", "react", "drizzle-orm", "date-fns", "moment", "playwright"]
    false_pos = None
    for d in used_deps:
        # "moment"/"date-fns" may legitimately be recommended for removal as a duplicate;
        # only count it as a false positive if explicitly called UNUSED / never imported.
        if near(t, d, "unused", 50) or near(t, d, "never imported", 50) or near(t, d, "not imported", 50):
            false_pos = d
            break
    no_false_pos = false_pos is None

    # files named for coupling specificity
    file_tokens = [f for f in ["service.ts", "pipeline.ts", "db.ts", "config.ts", "schema.ts"] if f in t]
    named_files = len(file_tokens) >= 2 or ("db.ts" in t and ("pipeline.ts" in t or "service.ts" in t))

    concrete_removal = "remove" in t and any_("lodash", "axios", "moment", "package.json")

    return dict(mermaid=mermaid, severity=severity, circular=circular, reach=reach, zod_drift=zod_drift,
                unused_lodash=unused_lodash, unused_axios=unused_axios, dup_dates=dup_dates,
                eslint_dep=eslint_dep, rc_zero=rc_zero, no_false_pos=no_false_pos, false_pos=false_pos,
                named_files=named_files, file_tokens=file_tokens, concrete_removal=concrete_removal)


def expectations_for(eval_id: int, c: dict) -> list:
    def ev(flag, note):
        return {"passed": bool(flag), "evidence": note}

    if eval_id == 0:
        specs = [
            ("Output contains a Mermaid dependency graph", c["mermaid"], "```mermaid + flowchart/graph found"),
            ("Findings carry explicit severity tiers", c["severity"], "P0/P1/P2 or High/Med/Low ranking present"),
            ("Detects circular dependency server <-> reviewer-core", c["circular"], "'circular' + 'reviewer-core'"),
            ("Detects client reaching into server internals", c["reach"], "server/src/db/schema reach-in referenced"),
            ("Detects zod version drift (v3 vs v4)", c["zod_drift"], "zod + drift / v3&v4 markers"),
            ("Detects unused lodash in server", c["unused_lodash"], "lodash near unused/remove"),
            ("Detects unused axios in client", c["unused_axios"], "axios near unused/remove"),
            ("Detects duplicate date libraries (date-fns + moment)", c["dup_dates"], "date-fns+moment+duplicate/overlap"),
            ("Detects eslint under dependencies (should be dev)", c["eslint_dep"], "eslint near devDependencies/tooling"),
            ("Notes reviewer-core has zero runtime deps (Info)", c["rc_zero"], "reviewer-core + zero/no runtime deps"),
        ]
    elif eval_id == 1:
        specs = [
            ("Identifies lodash as unused in server", c["unused_lodash"], "lodash near unused/remove"),
            ("Identifies axios as unused in client", c["unused_axios"], "axios near unused/remove"),
            ("Identifies date-fns + moment as duplicate date libs", c["dup_dates"], "date-fns+moment+duplicate/overlap"),
            ("Gives a concrete removal recommendation", c["concrete_removal"], "'remove' + specific pkg/package.json"),
            ("Does NOT falsely flag a used dependency as unused",
             c["no_false_pos"], f"false positive: {c['false_pos']}" if c["false_pos"] else "no used dep called unused"),
        ]
    else:  # eval_id == 2
        specs = [
            ("Detects circular dependency server <-> reviewer-core", c["circular"], "'circular' + 'reviewer-core'"),
            ("Detects client reaching into server internals", c["reach"], "server/src/db/schema reach-in referenced"),
            ("Detects zod version drift (v3 vs v4)", c["zod_drift"], "zod + drift / v3&v4 markers"),
            ("Names the specific files involved", c["named_files"], "files: " + ", ".join(c["file_tokens"])),
        ]
    return [{"text": s[0], "passed": bool(s[1]), "evidence": s[2]} for s in specs]


def main():
    summary = []
    for eval_id, edir in EVAL_DIRS.items():
        for run in RUNS:
            text = load_report(edir, run)
            c = check(text)
            exps = expectations_for(eval_id, c)
            passed = sum(1 for e in exps if e["passed"])
            total = len(exps)
            failed = total - passed
            out = {
                "eval_id": eval_id,
                "run": run,
                "report_found": bool(text),
                "summary": {
                    "pass_rate": round(passed / total, 4) if total else 0.0,
                    "passed": passed,
                    "failed": failed,
                    "total": total,
                },
                "score": f"{passed}/{total}",
                "expectations": exps,
            }
            payload = json.dumps(out, indent=2)
            # config-level grading.json -> consumed by the eval viewer
            (ITER / edir / run / "grading.json").write_text(payload)
            # run-1/grading.json -> consumed by aggregate_benchmark.py
            run1 = ITER / edir / run / "run-1"
            run1.mkdir(exist_ok=True)
            (run1 / "grading.json").write_text(payload)
            summary.append((edir, run, passed, total, bool(text)))
    print("EVAL                              RUN            SCORE  report?")
    for edir, run, p, tot, found in summary:
        print(f"{edir:33} {run:14} {p}/{tot}    {'yes' if found else 'MISSING'}")


if __name__ == "__main__":
    main()
