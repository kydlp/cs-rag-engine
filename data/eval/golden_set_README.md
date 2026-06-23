# Golden set

10 synthetic cases for evaluating the engine end-to-end. The production version of this file has 50 anchored cases pulled from a real CS log; this public sample preserves the schema and difficulty distribution.

## Schema (one row = one JSON object on one line)

| field | type | purpose |
|---|---|---|
| `id` | string | unique id (e.g. `CASE-001`) |
| `channel` | string | inbound channel (`メール`, `LINE`, `BASE`, `Instagram`) |
| `customer_name` | string | salutation name (initials in this sample) |
| `customer_msg` | string | the customer message itself |
| `category` | string | expected category label (one of the 16 in `engine/types.ts`) |
| `escalated` | boolean | must this case be human-approved? |
| `escalation_reason` | string | brief reason when `escalated=true` (empty otherwise) |
| `difficulty` | string | `easy` / `normal` / `trap` (trap = surface category vs deeper escalation) |
| `final` | string | one-line summary of the canonical reply |

## Difficulty distribution

The public sample mirrors the production distribution:

| difficulty | share |
|---|---|
| easy | ~30% — straight-shot facts (shelf life, vending location) |
| normal | ~50% — needs slot filling or KB lookup |
| trap | ~20% — surface category looks innocuous but Hard Rule says escalate (foreign object, intl shipping, discontinued flavor) |

The escalation rate in production is around 24% (12/50). The public sample keeps the same proportion (3/10).

## Adding new cases

When you find a category the current set doesn't cover, append a new row. Re-run:

```bash
npm run eval
```

The reference date in `src/eval/run.ts` is fixed (`2026-06-13`) so KB freshness checks (current_notice valid_until) reproduce.
