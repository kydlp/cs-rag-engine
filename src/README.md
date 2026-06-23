# Reply engine (src/)

The **reply-draft + escalation-decision** core. Pure functions:
inquiry → (`escalate` / `draft` / sources). No UI deps.
Written in TypeScript so the same module can be imported directly into a Cloudflare Worker (`workers/`) or a Node CLI.

> **Hard Rule**: AI does **not** auto-send to customers. This engine only produces a draft + an approval decision. The send action is performed by a human in the admin UI / Gmail UI.

## Quick start

Node 22.18+ (TS runs natively — no build step).

```bash
npm run eval            # evaluate against the sample golden set
npm run eval:report     # ↑ + writes reports/eval_baseline.md
npm run demo            # run sample inquiries
node src/demo.ts "賞味期限はどれくらい？"   # try any text
```

Programmatically:

```ts
import { answer } from "./engine/index.ts";
const r = answer({ text: "自販機を設置したいのですが", channel: "LINE" });
// r.escalate / r.draft / r.escalationReason / r.sources / r.confidence / r.notices / r.needsInfo
```

## Layout

```
src/
├── engine/
│   ├── types.ts        I/O type contract (Inquiry / EngineResult)
│   ├── kb.ts           knowledge base loader (data/kb + data/extracted)
│   ├── classify.ts     category classifier (keyword/trigger baseline, LLM-swappable)
│   ├── escalation.ts   escalation decision (hard rules + KB freshness + confidence)
│   ├── compose.ts      template-based deterministic composer (signature-aware)
│   ├── compose_llm.ts  KB-grounded LLM polish (Claude Sonnet 4.6; falls back on failure)
│   ├── gate.ts         safety floor + auto-send allowlist + shadow mode
│   └── index.ts        answer() orchestration
├── eval/
│   ├── run.ts          golden-set evaluation runner (category / escalation / template)
│   ├── gate_report.ts  shadow-mode prediction analysis
│   └── llm_quality.ts  structural check + LLM judge (factual_alignment / no_hallucination)
├── mail/               half-manual MCP-Gmail loop (see mail/README.md)
├── adapters/line-harness.ts   LINE webhook → draft adapter (stubs for real endpoints)
└── cli.ts / demo.ts / demo_llm.ts   manual probes
```

## Baseline evaluation (sample golden set)

| metric | value |
|---|---|
| category accuracy | dependent on sample size |
| escalation precision | high (FN must be 0 by design) |
| FN (missed escalation = unsafe) | **must remain 0** |
| template coverage on non-escalated cases | depends on KB completeness |

> The sample golden set in this public mirror is 10 synthetic cases for a fictional D2C brand. The production set is 50 real cases anchored to a fixed reference date (2026-06-13). When you change KB rules, re-run `npm run eval` to verify no regression.

## Hard Rule enforcement, baked in

- The engine has **no `sendMessage` call**. The only Gmail/LINE write is `createDraft`. A model change cannot cause an unintended send.
- Escalation is **code-based logic** (`escalation.ts`), not a prompt instruction. Foreign objects, refunds, legal mentions, vending install requests, etc. are filtered before any LLM call.
- The signature is **machine-concatenated from `master_signature.json`**; the LLM is forbidden from generating it.
- Author-facing conditional placeholders (`{…：example…}`) are stripped from auto-drafts so they never reach a customer.

## LINE adapter (`adapters/line-harness.ts`)

Two wiring options (both produce a `DraftSuggestion` and write it back):

- **A. Sidecar**: deploy this repo as a separate Worker/cron; call the LINE Worker API to fetch unanswered and PATCH a draft. The LINE Worker code is untouched.
- **B. Embedded**: import `answer()` directly inside the LINE Worker's cron handler.

`fetchUnanswered` / `postDraft` are stubs until the real endpoints are defined. See `.claude/commands/cs-triage.md` for the MCP-driven manual loop (fastest path).
