// Shadow-mode evaluation of the send-gate. On the golden set we check:
//   - Safety (top priority): cases marked escalated=true must NEVER be predicted auto_send.
//   - Shadow prediction distribution: how many would auto_send vs human_approval, by category.
//   - Auto-send prediction soundness: every auto_send prediction is on a non-escalated case.
//   Run: node src/eval/gate_report.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answer } from "../engine/index.ts";
import { decideSend } from "../engine/gate.ts";
import type { Category } from "../engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const EVAL_NOW = new Date("2026-06-13T12:00:00+09:00");

interface GoldenRow {
  id: string;
  channel: string;
  customer_name: string;
  customer_msg: string;
  category: Category;
  escalated: boolean;
}

function loadGolden(): GoldenRow[] {
  return readFileSync(join(ROOT, "data", "eval", "golden_set.jsonl"), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow);
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

const rows = loadGolden();
let autoCount = 0;
let humanCount = 0;
const autoByCategory = new Map<Category, number>();
const dangerous: string[] = []; // gold-escalated but predicted auto_send — must be 0
const autoButGoldEscalated: string[] = [];

for (const r of rows) {
  const res = answer(
    { text: r.customer_msg, channel: r.channel as never, customerName: r.customer_name },
    { now: EVAL_NOW, includeSignature: false },
  );
  const gate = decideSend(res, { shadow: true });

  if (gate.predictedMode === "auto_send") {
    autoCount++;
    autoByCategory.set(res.category, (autoByCategory.get(res.category) ?? 0) + 1);
    if (r.escalated) {
      dangerous.push(`${r.id}(${r.category})`);
      autoButGoldEscalated.push(r.id);
    }
  } else {
    humanCount++;
  }
}

const n = rows.length;
const goldEsc = rows.filter((r) => r.escalated).length;
const goldNonEsc = n - goldEsc;

const lines: string[] = [];
lines.push(`count: ${n} (gold escalated=${goldEsc} / non-escalated=${goldNonEsc})`);
lines.push(`shadow prediction: auto_send=${autoCount} / human_approval=${humanCount}`);
lines.push(`  └ auto_send by category: ${[...autoByCategory.entries()].map(([c, k]) => `${c}:${k}`).join(", ") || "none"}`);
lines.push(`deflection rate on non-escalated cases: ${pct(autoCount, goldNonEsc)} (${autoCount}/${goldNonEsc})`);
lines.push("");
lines.push(`[safety check] gold-escalated mis-predicted as auto_send: ${dangerous.length} ${dangerous.length === 0 ? "✓" : "← unsafe: " + dangerous.join(", ")}`);
lines.push("shadow=true ⇒ no actual sends (everything is routed to human approval).");

console.log(lines.join("\n"));

if (autoButGoldEscalated.length > 0) {
  process.exitCode = 1;
}
