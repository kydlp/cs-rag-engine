// Progress ledger — track how the engine improves run-over-run.
//   node src/eval/progress.ts            … record a snapshot + print delta vs last time
//   node src/eval/progress.ts --note "…" … annotate what changed since last time
//   node src/eval/progress.ts --show     … print the ledger + latest delta (no new row)
//   node src/eval/progress.ts --md       … also (re)render reports/progress.md
//
// A snapshot always captures the deterministic golden-set metrics (free, reproducible).
// LLM-judge metrics (pass rate / factual_alignment / no_hallucination) are attached
// automatically when a recent `npm run eval:llm -- --report` left a sidecar, or via flags.
//
// The ledger (reports/progress.jsonl) and rendered table (reports/progress.md) are
// committed to git on purpose — the growth story is part of the repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { answer } from "../engine/index.ts";
import type { Category } from "../engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const LEDGER = join(ROOT, "reports", "progress.jsonl");
const LEDGER_MD = join(ROOT, "reports", "progress.md");
const JUDGE_SIDECAR = join(ROOT, "reports", "llm_quality.latest.json");
const EVAL_NOW = new Date("2026-06-13T12:00:00+09:00");

export interface JudgeMetrics {
  judged: number;
  pass_rate: number; // 0..1
  factual_alignment: number; // 0..2
  no_hallucination: number; // 0..2
}

export interface ProgressRow {
  ts: string;
  git: string;
  dataset: string; // "public-sample" | "production"
  note: string;
  count: number;
  category_accuracy: number | null; // 0..1 (null = not measured for this dataset)
  escalation_precision: number; // 0..1
  fn: number;
  fp: number;
  template_coverage: number | null; // 0..1 (null = not measured)
  judge: JudgeMetrics | null;
}

interface GoldenRow {
  id: string;
  channel: string;
  customer_name: string;
  customer_msg: string;
  category: Category;
  escalated: boolean;
}

/** Deterministic golden-set metrics (no API key, reproducible). */
export function computeDeterministic(): Omit<ProgressRow, "ts" | "git" | "dataset" | "note" | "judge"> {
  const rows = readFileSync(join(ROOT, "data", "eval", "golden_set.jsonl"), "utf-8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow);

  let catOk = 0, escOk = 0, fn = 0, fp = 0, covered = 0, nonEsc = 0;
  for (const r of rows) {
    const res = answer(
      { text: r.customer_msg, channel: r.channel as never, customerName: r.customer_name },
      { now: EVAL_NOW, includeSignature: false },
    );
    if (res.category === r.category) catOk++;
    if (res.escalate === r.escalated) escOk++;
    if (r.escalated && !res.escalate) fn++;
    if (!r.escalated && res.escalate) fp++;
    if (!r.escalated) {
      nonEsc++;
      if (res.sources.some((s) => s.kind === "template")) covered++;
    }
  }
  const n = rows.length;
  return {
    count: n,
    category_accuracy: n ? catOk / n : 0,
    escalation_precision: n ? escOk / n : 0,
    fn,
    fp,
    template_coverage: nonEsc ? covered / nonEsc : 0,
  };
}

export function readLedger(): ProgressRow[] {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf-8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as ProgressRow);
}

function shortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** Pick up judge metrics left by `npm run eval:llm -- --report`. */
function readJudgeSidecar(): JudgeMetrics | null {
  if (!existsSync(JUDGE_SIDECAR)) return null;
  try {
    const o = JSON.parse(readFileSync(JUDGE_SIDECAR, "utf-8"));
    if (typeof o.pass_rate !== "number") return null;
    return {
      judged: Number(o.judged) || 0,
      pass_rate: o.pass_rate,
      factual_alignment: Number(o.factual_alignment) || 0,
      no_hallucination: Number(o.no_hallucination) || 0,
    };
  } catch {
    return null;
  }
}

export function appendRow(row: ProgressRow): void {
  mkdirSync(dirname(LEDGER), { recursive: true });
  const existing = existsSync(LEDGER) ? readFileSync(LEDGER, "utf-8") : "";
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(LEDGER, prefix + JSON.stringify(row) + "\n", { flag: "a" });
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const pctN = (x: number | null) => (x == null ? "—" : pct(x));

/** Arrow + signed delta between two numbers (already scaled for display). */
function arrow(prev: number, curr: number, digits: number, suffix = ""): string {
  const d = curr - prev;
  const sign = d > 0 ? "+" : "";
  const mark = Math.abs(d) < Math.pow(10, -digits) / 2 ? "＝" : d > 0 ? "▲" : "▼";
  return `${mark} ${sign}${d.toFixed(digits)}${suffix}`;
}

/** Human-readable delta of curr vs the previous same-dataset snapshot. */
export function formatDelta(ledger: ProgressRow[], curr: ProgressRow): string {
  const prev = [...ledger].reverse().find((r) => r !== curr && r.dataset === curr.dataset);
  const lines: string[] = [];
  lines.push(`前回比（dataset=${curr.dataset}）`);
  if (!prev) {
    lines.push("  初回記録 — 比較対象なし。");
    return lines.join("\n");
  }
  lines.push(`  基準: ${prev.ts.slice(0, 10)} (${prev.git})${prev.note ? ` "${prev.note}"` : ""}`);
  if (prev.category_accuracy != null && curr.category_accuracy != null) {
    lines.push(`  カテゴリ精度   : ${pct(prev.category_accuracy)} → ${pct(curr.category_accuracy)}  ${arrow(prev.category_accuracy * 100, curr.category_accuracy * 100, 1, "pt")}`);
  }
  lines.push(`  エスカレ精度   : ${pct(prev.escalation_precision)} → ${pct(curr.escalation_precision)}  ${arrow(prev.escalation_precision * 100, curr.escalation_precision * 100, 1, "pt")}`);
  lines.push(`  FN(危険な見逃し): ${prev.fn} → ${curr.fn}  ${arrow(prev.fn, curr.fn, 0)}`);
  if (prev.template_coverage != null && curr.template_coverage != null) {
    lines.push(`  テンプレ網羅   : ${pct(prev.template_coverage)} → ${pct(curr.template_coverage)}  ${arrow(prev.template_coverage * 100, curr.template_coverage * 100, 1, "pt")}`);
  }
  if (prev.judge && curr.judge) {
    lines.push(`  LLM合格率      : ${pct(prev.judge.pass_rate)} → ${pct(curr.judge.pass_rate)}  ${arrow(prev.judge.pass_rate * 100, curr.judge.pass_rate * 100, 1, "pt")}`);
    lines.push(`  事実整合(0-2)  : ${prev.judge.factual_alignment.toFixed(2)} → ${curr.judge.factual_alignment.toFixed(2)}  ${arrow(prev.judge.factual_alignment, curr.judge.factual_alignment, 2)}`);
    lines.push(`  無ハルシ(0-2)  : ${prev.judge.no_hallucination.toFixed(2)} → ${curr.judge.no_hallucination.toFixed(2)}  ${arrow(prev.judge.no_hallucination, curr.judge.no_hallucination, 2)}`);
  } else if (curr.judge && !prev.judge) {
    lines.push(`  LLM合格率      : (前回未計測) → ${pct(curr.judge.pass_rate)}`);
  }
  return lines.join("\n");
}

export function renderMd(ledger: ProgressRow[]): string {
  const head = "| 日付 | dataset | カテゴリ精度 | エスカレ精度 | FN | テンプレ網羅 | LLM合格率 | 事実整合 | 無ハルシ | git | メモ |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|";
  const body = ledger.map((r) => {
    const j = r.judge;
    return `| ${r.ts.slice(0, 10)} | ${r.dataset} | ${pctN(r.category_accuracy)} | ${pct(r.escalation_precision)} | ${r.fn} | ${pctN(r.template_coverage)} | ${j ? pct(j.pass_rate) : "—"} | ${j ? j.factual_alignment.toFixed(2) : "—"} | ${j ? j.no_hallucination.toFixed(2) : "—"} | ${r.git} | ${r.note || ""} |`;
  }).join("\n");

  // Headline delta: the most recent snapshot that actually has a same-dataset baseline
  // to compare against (so the block shows real movement, not "初回記録").
  let deltaBlock = "";
  const hasBaseline = (i: number) => ledger.slice(0, i).some((r) => r.dataset === ledger[i].dataset);
  let headlineIdx = -1;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (hasBaseline(i)) { headlineIdx = i; break; }
  }
  if (headlineIdx < 0) headlineIdx = ledger.length - 1;
  const headline = ledger[headlineIdx];
  if (headline) deltaBlock = `\n## 最新の前回比\n\n\`\`\`\n${formatDelta(ledger.slice(0, headlineIdx + 1), headline)}\n\`\`\`\n`;

  return [
    "# 進捗ログ（run-over-run）",
    "",
    "各スナップショットの見出し指標。決定的評価はゴールデンセット上で毎回再現可能。",
    "LLM合格率など judge 列は `npm run eval:llm -- --report` を走らせた回のみ埋まる。",
    "`dataset=production` は本番50件での実測履歴（README掲載値の出典）、",
    "`dataset=public-sample` は本リポジトリの匿名サンプル10件での計測。",
    deltaBlock,
    "## 全スナップショット",
    "",
    head,
    sep,
    body,
    "",
  ].join("\n");
}

// ---- CLI ----

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const show = argv.includes("--show");
  const wantMd = argv.includes("--md");
  const noJudge = argv.includes("--no-judge");
  const noteIdx = argv.indexOf("--note");
  const note = noteIdx >= 0 ? (argv[noteIdx + 1] ?? "") : "";

  if (show) {
    const ledger = readLedger();
    if (!ledger.length) {
      console.log("進捗ログは空です。`npm run progress` で最初のスナップショットを記録してください。");
    } else {
      console.log(renderMd(ledger).replace(/^# .*$/m, "進捗ログ").trim());
      if (wantMd) {
        writeFileSync(LEDGER_MD, renderMd(ledger), "utf-8");
        console.log(`\nMarkdown: ${LEDGER_MD}`);
      }
    }
  } else {
    const prior = readLedger(); // history before this snapshot — the delta baseline
    const det = computeDeterministic();
    const row: ProgressRow = {
      ts: new Date().toISOString(),
      git: shortSha(),
      dataset: "public-sample",
      note,
      ...det,
      judge: noJudge ? null : readJudgeSidecar(),
    };
    appendRow(row);
    console.log(`記録しました → ${LEDGER}`);
    console.log(`  カテゴリ精度 ${pctN(row.category_accuracy)} / エスカレ精度 ${pct(row.escalation_precision)} / FN ${row.fn} / テンプレ網羅 ${pctN(row.template_coverage)}${row.judge ? ` / LLM合格率 ${pct(row.judge.pass_rate)}` : " (LLM未計測)"}`);
    console.log("");
    console.log(formatDelta(prior, row));
    if (wantMd) {
      writeFileSync(LEDGER_MD, renderMd([...prior, row]), "utf-8");
      console.log(`\nMarkdown: ${LEDGER_MD}`);
    }
  }
}
