# Workflow Retro — Trend Ledger

One row per retro so multi-agent runs can be compared over time. Appended by `/workflow-retro`.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-07-11 | why-risk-brief (SDD pipeline) | 24 (23 top + 1 nested) | 83.9M in-side → 297k out | 90% | 80m | 1.33x | ~$133 (list) | Run read-only Explore/ground-truth agents on Sonnet, not Opus (~$40–50/run) |
