// Golden-set evaluation runner.
//   node src/eval/run.ts            … print summary to stdout
//   node src/eval/run.ts --report   … also write reports/eval_baseline.md
//
// Metrics (we score the operationally-important decisions, not pure text match):
//   - Escalation precision (top priority — FN = misrouted to auto-reply = unsafe)
//   - Category accuracy
//   - Template coverage (non-escalated cases that found a backing template)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answer } from "../engine/index.ts";
import type { Category } from "../engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

interface GoldenRow {
  id: string;
  channel: string;
  customer_name: string;
  customer_msg: string;
  category: Category;
  escalated: boolean;
  escalation_reason: string;
  difficulty: string;
}

// The sample golden set is dated around mid-June 2026 (current_notice valid through 6/15).
const EVAL_NOW = new Date("2026-06-13T12:00:00+09:00");

function loadGolden(): GoldenRow[] {
  return readFileSync(join(ROOT, "data", "eval", "golden_set.jsonl"), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow);
}

interface Eval {
  id: string;
  difficulty: string;
  goldCategory: Category;
  predCategory: Category;
  categoryOk: boolean;
  goldEscalate: boolean;
  predEscalate: boolean;
  escalateOk: boolean;
  hasTemplate: boolean;
  confidence: number;
}

function run(): { evals: Eval[]; rows: GoldenRow[] } {
  const rows = loadGolden();
  const evals: Eval[] = rows.map((r) => {
    const res = answer(
      { text: r.customer_msg, channel: r.channel as never, customerName: r.customer_name },
      { now: EVAL_NOW, includeSignature: false },
    );
    return {
      id: r.id,
      difficulty: r.difficulty,
      goldCategory: r.category,
      predCategory: res.category,
      categoryOk: res.category === r.category,
      goldEscalate: r.escalated,
      predEscalate: res.escalate,
      escalateOk: res.escalate === r.escalated,
      hasTemplate: res.sources.some((s) => s.kind === "template"),
      confidence: res.confidence,
    };
  });
  return { evals, rows };
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

function summarize(evals: Eval[]): string {
  const n = evals.length;
  const catOk = evals.filter((e) => e.categoryOk).length;
  const escOk = evals.filter((e) => e.escalateOk).length;

  // Escalation confusion (FN is the dangerous outcome: should-escalate that auto-replied).
  const tp = evals.filter((e) => e.goldEscalate && e.predEscalate).length;
  const fn = evals.filter((e) => e.goldEscalate && !e.predEscalate).length;
  const fp = evals.filter((e) => !e.goldEscalate && e.predEscalate).length;
  const tn = evals.filter((e) => !e.goldEscalate && !e.predEscalate).length;

  // Template coverage on non-escalated cases.
  const nonEsc = evals.filter((e) => !e.goldEscalate);
  const covered = nonEsc.filter((e) => e.hasTemplate).length;

  const lines: string[] = [];
  lines.push(`count: ${n}`);
  lines.push(`category accuracy: ${pct(catOk, n)} (${catOk}/${n})`);
  lines.push(`escalation precision: ${pct(escOk, n)} (${escOk}/${n})`);
  lines.push(`  └ TP=${tp} TN=${tn} FP=${fp} FN=${fn}`);
  lines.push(`  └ FN (missed escalation = unsafe): ${fn} ${fn === 0 ? "✓" : "← fix"}`);
  lines.push(`template coverage on non-escalated cases: ${pct(covered, nonEsc.length)} (${covered}/${nonEsc.length})`);
  return lines.join("\n");
}

function reportMd(evals: Eval[]): string {
  const head = "| id | difficulty | gold cat | pred cat | cat | gold esc | pred esc | esc | tpl | conf |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|";
  const body = evals
    .map(
      (e) =>
        `| ${e.id} | ${e.difficulty} | ${e.goldCategory} | ${e.predCategory} | ${e.categoryOk ? "✓" : "✗"} | ${e.goldEscalate ? "Y" : "N"} | ${e.predEscalate ? "Y" : "N"} | ${e.escalateOk ? "✓" : "✗"} | ${e.hasTemplate ? "✓" : "—"} | ${e.confidence.toFixed(2)} |`,
    )
    .join("\n");
  return `# Engine baseline evaluation\n\nBaseline date: 2026-06-13 (current_notice valid)\n\n## Summary\n\n\`\`\`\n${summarize(evals)}\n\`\`\`\n\n## All rows\n\n${head}\n${sep}\n${body}\n`;
}

const { evals } = run();
console.log(summarize(evals));

if (process.argv.includes("--report")) {
  const out = join(ROOT, "reports", "eval_baseline.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, reportMd(evals), "utf-8");
  console.log(`\nReport: ${out}`);
}
