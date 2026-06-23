# Evaluation methodology

## The two evaluation passes

| pass | runs | scores | when to run |
|---|---|---|---|
| `npm run eval` | deterministic engine on golden set | category accuracy, escalation precision (FN must be 0), template coverage | every code/KB change |
| `npm run eval:llm -- --judge` | LLM-polished output + LLM-as-judge | factual_alignment 0–2, no_hallucination 0–2, both axes ≥ 2 ("pass") | after prompt/KB changes that touch LLM output |

The deterministic pass is **fast, free, and reproducible** — it should be wired into CI. The LLM-judged pass requires an Anthropic API key and is run on demand (typically daily during active iteration; weekly during steady state).

## Golden set

50 cases in production; 10 synthetic cases in the public sample. Each case fixes a single inbound message and the canonical reply category + escalation flag. The reference date is hardcoded (`EVAL_NOW = 2026-06-13T12:00:00+09:00`) so that KB freshness checks (current_notice valid_until) reproduce.

| field | use |
|---|---|
| `category` | label for category-accuracy score |
| `escalated` | label for escalation-precision score (FN is the unsafe miss) |
| `escalation_reason` | human-readable reference for inspection |
| `difficulty` | `easy` / `normal` / `trap` — trap cases test "surface category looks innocuous but Hard Rule says escalate" |
| `final` | one-line description of the canonical reply |

When a new failure mode is found in production, it gets added to the golden set with `difficulty: "trap"`. The set grows as the system matures.

## Metrics

### Escalation precision (top priority)

```
TP = should escalate AND did escalate
FN = should escalate BUT did not    ← UNSAFE — must be 0
FP = should not escalate BUT did    ← annoying — minimize
TN = should not escalate AND did not
```

`FN > 0` is treated as a failure that blocks deploy. The system is biased to over-escalate (FP > 0 is acceptable; FN is not).

### Category accuracy

Useful as a regression metric but not safety-critical. A category miss that still routes to the right escalation is OK.

### Template coverage

For non-escalated cases, did the composer find a template? If not, the draft is the generic acknowledgement (which is safe but unhelpful). Low coverage on a category ⇒ add a template to `templates_v2.jsonl`.

### LLM-judge axes (when `--judge`)

| axis | 0 | 1 | 2 |
|---|---|---|---|
| `factual_alignment` | clearly contradicts KB | partial misalignment / vague paraphrase | matches KB (or correctly says "I'll check") |
| `no_hallucination` | asserts a fact not in KB | hedges instead of citing the KB value | asserts only KB-backed facts |

A "pass" is both axes ≥ 2. The pass rate is the headline metric for prompt iteration.

The rubric itself is in `.claude/skills/eval-rubric/SKILL.md` and is fed directly to the judge as the system prompt. Same rubric, scored by the same model that polishes drafts — so the judge knows what the composer was trained against.

## Worst-N analysis loop

```
1. eval-runs LLM-polished draft per case
2. judge scores each
3. take the 5 lowest-scoring cases (worst 5)
4. classify root cause:
   - KB addition
   - prompt revision (compose_llm.ts SYSTEM_PROMPT)
   - alias addition (PRODUCT_ALIASES)
   - new template
   - classifier tweak
   - needs operator confirmation
5. propose changes, apply
6. re-run eval; verify the worst-5 closed without regressing the rest
```

A representative iteration in production:

> Day N baseline: factual_alignment avg 1.67, pass rate 73% (36/49).
> Worst-5 root causes: 3 × "SYSTEM_PROMPT didn't enforce template `notes`"; 1 × "product alias missing"; 1 × "classifier mis-routed payment".
> Day N changes: SYSTEM_PROMPT line added; PRODUCT_ALIASES expanded; payment co-occurrence rule.
> Day N+5 (5 business days): factual_alignment avg 1.77, pass rate 80% (+7pt). 3 of the worst-5 closed.

## Anti-overfit notes

- The baseline classifier was tuned **on the golden set itself** (transparent — it's keyword-based, not a model). For production we re-validate on a **holdout** of 10–15 new cases sent over by the operator.
- The reference date is fixed so KB freshness checks are deterministic. When the KB's `current_notice` is updated, the date in `src/eval/run.ts` should be bumped to match.
- The judge runs on the same draft body the composer produced — so prompt changes affect both. A small calibration set of human-rated cases is recommended quarterly to detect judge drift.

## CI hookup

A trivial GitHub Action wires the deterministic pass:

```yaml
- run: npm install
- run: npm run eval
```

The runner exits non-zero on `FN > 0` or `allOk !== n`, which fails the build. The LLM pass is too expensive to run on every push — schedule it for daily on `main` only.
