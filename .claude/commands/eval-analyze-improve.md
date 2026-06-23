---
description: Re-score the golden set inside the Claude Code session (no API spend) and write improvement candidates to reports/improvement_log_YYYY-MM-DD.md. Combine with /loop for a daily self-improving cycle.
---

# /eval-analyze-improve

**Zero-API-spend version.** Does not call `npm run eval:llm`. The session model judges the drafts directly.

## Steps (the agent runs these)

1. **Run the deterministic engine (no API cost).**

   ```bash
   CS_DISABLE_LLM=1 npm run eval -- --jsonl > reports/_engine_out.jsonl
   ```

   ※ If `--jsonl` isn't implemented yet, extend `src/eval/run.ts` to emit per-row JSONL (`{id, category, escalate, draft, needsInfo, notices, confidence}`).

   Fallback: run `src/eval/run.ts` as-is and read its stdout / report file.

2. **Read both files and score.**

   I (Claude Code) read `reports/_engine_out.jsonl` and `data/eval/golden_set.jsonl`.
   I score each case 0/1/2 on each axis following `.claude/skills/eval-rubric/SKILL.md` (factual_alignment, no_hallucination).

   The judge is the same Claude model that polishes drafts in production (`compose_llm.ts`), but on a separate session — judging here does not bias production output.

3. **Extract improvement candidates from worst-N (5 cases).**

   Classify each into one of these buckets:

   | bucket | reflect in |
   |---|---|
   | KB addition | `data/kb/master_*.json` |
   | prompt revision | `src/engine/compose_llm.ts` `SYSTEM_PROMPT` |
   | alias addition | `compose_llm.ts` `PRODUCT_ALIASES` |
   | template addition | `data/extracted/templates_v2.jsonl` |
   | classifier tweak | `src/engine/classify.ts` |
   | needs operator confirmation | external (file as TODO) |

4. **Append to `reports/improvement_log_YYYY-MM-DD.md`.**

   ```markdown
   # Improvement log YYYY-MM-DD (in-session scoring; zero API spend)

   ## Summary
   - scored: NN/NN
   - factual_alignment avg: X.XX
   - no_hallucination avg: X.XX
   - both axes ≥ 2: NN/NN
   - delta vs previous day: F=±0.XX, H=±0.XX, pass rate=±N%

   ## Worst-5 improvement candidates

   ### CASE-XXX [category] — F=X H=X
   - customer: …
   - draft: …
   - root-cause bucket: …
   - proposal: … (concrete change)
   - estimated impact: low/mid/high
   - action: apply now / pending operator / blocked

   ## Applied changes
   - (default: none — proposals only)

   ## To confirm with operator
   - …
   ```

5. **Prepend a 1-line summary to `reports/improvement_log_index.md`.**

   ```
   - YYYY-MM-DD: pass rate NN% (Δ +N) — primary driver: …
   ```

## Daily mode

```bash
/loop 1d /eval-analyze-improve
```

Runs while the PC is open. Independent of the Workers production loop.

## Cost guardrails

- **This command never calls `npm run eval:llm`** (which would hit Anthropic's API).
- "No key, deterministic fallback" is sufficient for: classification accuracy, template coverage, structural check, scoring (I do it directly).
- "Key + LLM polish" is reserved for: production drafting in Workers.
- Local `npm run inbox` is off by default — run only when testing.

## Notes

- **Do not modify code on your own.** Write improvement candidates; the human applies them.
- The judge is me directly — re-read the rubric (`eval-rubric/SKILL.md`) each run.
- Always compute the delta vs the prior log (improvement vs regression).
