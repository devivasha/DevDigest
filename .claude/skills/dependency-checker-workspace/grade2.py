#!/usr/bin/env python3
"""Grader for iteration-2 (subtle-defect fixtures). Same output schema as grade.py.

All three evals share one assertion set (they are generic full-audit prompts over
mini-repo-2), so this doubles as a 3-sample variance check per configuration.
"""
import json
import re
from pathlib import Path

ITER = Path(__file__).parent / "iteration-2"
RUNS = ["with_skill", "without_skill"]
EVAL_DIRS = {
    0: "eval-0-full-audit-generic",
    1: "eval-1-health-check",
    2: "eval-2-ship-sanity",
}


def load_report(eval_dir, run):
    p = ITER / eval_dir / run / "outputs" / "report.md"
    return p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""


def near(text, a, b, window=90):
    for m in re.finditer(re.escape(a), text):
        seg = text[max(0, m.start() - window): m.end() + window]
        if b in seg:
            return True
    return False


def check(text):
    t = text.lower()

    def any_(*subs):
        return any(s in t for s in subs)

    # S1 — 3-hop cross-package cycle; must recognise a loop AND that shared + reviewer-core are on it
    circular = any_("circular", "cycle", "cyclic") and "reviewer-core" in t and "shared" in t

    # S2 — vitest version drift (client ^1.6 vs ^2 elsewhere)
    vitest_has_v1 = bool(re.search(r"vitest", t)) and any_("1.6", "^1", "v1", "1.x")
    vitest_drift = vitest_has_v1 and any_(
        "drift", "mismatch", "different", "inconsistent", "2.0", "^2", "major", "diverg", "align")

    # S3 — tailwindcss must NOT be called unused (it is used via config).
    # Guard against proximity false-positives like "No UNUSED deps (... tailwindcss are USED ...)":
    # only count it as flagged-unused if a negative word is near AND no positive word ("used",
    # "config", "keep", "needed") is near to exonerate it.
    tw_neg = (near(t, "tailwind", "unused") or near(t, "tailwind", "never")
              or near(t, "tailwind", "not imported") or near(t, "tailwind", "no import")
              or near(t, "tailwind", "remove") or near(t, "tailwind", "dead"))
    tw_pos = (near(t, "tailwind", "used") or near(t, "tailwind", "config")
              or near(t, "tailwind", "keep") or near(t, "tailwind", "needed")
              or near(t, "tailwind", "required") or near(t, "tailwind", "postcss")
              or near(t, "tailwind", "framework"))
    tw_flagged_unused = tw_neg and not tw_pos
    tailwind_ok = not tw_flagged_unused

    # S4 — duplicate date libs across packages (date-fns + dayjs)
    dup_dates = "date-fns" in t and "dayjs" in t and any_(
        "duplicate", "overlap", "redundant", "two date", "both", "same job", "same purpose",
        "standardi", "consolidat", "two different", "two libraries")

    # S5 — uuid unused in server
    uuid_unused = "uuid" in t and (
        near(t, "uuid", "unused") or near(t, "uuid", "remove") or near(t, "uuid", "never")
        or near(t, "uuid", "not used") or near(t, "uuid", "not imported") or near(t, "uuid", "no import"))

    mermaid = "```mermaid" in t and ("flowchart" in t or re.search(r"\bgraph (lr|td|rl|bt)\b", t) is not None)
    tier_tokens = set(re.findall(r"\bp[012]\b", t))
    severity = len(tier_tokens) >= 2 or (
        "high" in t and "medium" in t and ("low" in t or "info" in t)) or (
        len(tier_tokens) >= 1 and any_("critical", "severity"))

    return dict(circular=circular, vitest_drift=vitest_drift, tailwind_ok=tailwind_ok,
                dup_dates=dup_dates, uuid_unused=uuid_unused, mermaid=mermaid, severity=severity,
                tw_flagged_unused=tw_flagged_unused)


def expectations_for(c):
    specs = [
        ("Detects the cross-package circular dependency (server -> shared -> reviewer-core -> server)",
         c["circular"], "'circular/cycle' + 'shared' + 'reviewer-core'"),
        ("Detects the vitest version drift (client ^1.6 vs ^2.x)", c["vitest_drift"], "vitest + v1 marker + drift/^2"),
        ("Does NOT falsely flag tailwindcss as unused", c["tailwind_ok"],
         "tailwind wrongly called unused" if c["tw_flagged_unused"] else "tailwind not flagged unused"),
        ("Detects duplicate date libraries across packages (date-fns + dayjs)", c["dup_dates"],
         "date-fns + dayjs + duplicate/overlap"),
        ("Detects uuid as unused in server", c["uuid_unused"], "uuid near unused/remove"),
        ("Output contains a Mermaid dependency graph", c["mermaid"], "```mermaid + flowchart/graph"),
        ("Findings carry explicit severity tiers", c["severity"], "P0/P1/P2 or High/Med/Low"),
    ]
    return [{"text": s[0], "passed": bool(s[1]), "evidence": s[2]} for s in specs]


def main():
    summary = []
    for eval_id, edir in EVAL_DIRS.items():
        for run in RUNS:
            text = load_report(edir, run)
            c = check(text)
            exps = expectations_for(c)
            passed = sum(1 for e in exps if e["passed"])
            total = len(exps)
            out = {
                "eval_id": eval_id, "run": run, "report_found": bool(text),
                "summary": {"pass_rate": round(passed / total, 4) if total else 0.0,
                            "passed": passed, "failed": total - passed, "total": total},
                "score": f"{passed}/{total}", "expectations": exps,
            }
            payload = json.dumps(out, indent=2)
            (ITER / edir / run / "grading.json").write_text(payload)
            run1 = ITER / edir / run / "run-1"
            run1.mkdir(exist_ok=True)
            (run1 / "grading.json").write_text(payload)
            summary.append((edir, run, passed, total, bool(text)))
    print("EVAL                                RUN            SCORE  report?")
    for edir, run, p, tot, found in summary:
        print(f"{edir:35} {run:14} {p}/{tot}    {'yes' if found else 'MISSING'}")


if __name__ == "__main__":
    main()
