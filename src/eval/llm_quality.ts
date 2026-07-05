// LLM reply-quality evaluation.
//   - Structural check (no API key): signature OK / no leftover placeholders
//   - LLM judge (--judge, requires API key): score factual_alignment and no_hallucination on 0/1/2
//   Run: node src/eval/llm_quality.ts [--judge] [--sample N] [--seed S] [--report]
// Without an API key, the deterministic-fallback body is scored with the structural check only.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answerLLM } from "../index_llm.ts";
import { callClaude, llmAvailable } from "../engine/compose_llm.ts";
import { loadKnowledge, currentFlavors, noticeValid, formatJaDate, buildSignature, type KnowledgeBase } from "../engine/kb.ts";
import type { Category, Channel } from "../engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const EVAL_NOW = new Date("2026-06-13T12:00:00+09:00");
const RUBRIC_PATH = join(ROOT, ".claude", "skills", "eval-rubric", "SKILL.md");

interface GoldenRow {
  id: string;
  channel: string;
  customer_name: string;
  customer_msg: string;
  category: Category;
  escalated: boolean;
  final: string;
}

interface JudgeScore {
  factual_alignment: 0 | 1 | 2;
  no_hallucination: 0 | 1 | 2;
  reason: string;
}

interface Check {
  id: string;
  channel: string;
  category: Category;
  customer_msg: string;
  draft: string;
  usedLLM: boolean;
  signatureOk: boolean;
  placeholderOk: boolean;
  ok: boolean;
  judge?: JudgeScore | null;
}

interface Args {
  judge: boolean;
  sample?: number;
  seed?: number;
  report: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { judge: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--judge") a.judge = true;
    else if (v === "--report") a.report = true;
    else if (v === "--sample") a.sample = Number(argv[++i]);
    else if (v === "--seed") a.seed = Number(argv[++i]);
  }
  return a;
}

function loadGolden(): GoldenRow[] {
  return readFileSync(join(ROOT, "data", "eval", "golden_set.jsonl"), "utf-8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow);
}

/** Deterministic PRNG (LCG-style) for reproducible sub-sampling. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function subset(rows: GoldenRow[], sample?: number, seed?: number): GoldenRow[] {
  if (!sample || sample >= rows.length) return rows;
  if (seed == null) return rows.slice(0, sample);
  const rng = mulberry32(seed);
  const idx = rows.map((_, i) => i).sort(() => rng() - 0.5);
  return idx.slice(0, sample).sort((a, b) => a - b).map((i) => rows[i]);
}

function structuralCheck(
  kb: KnowledgeBase,
  id: string, channel: string, category: Category, customer_msg: string, draft: string,
  usedLLM: boolean, needsInfoCount: number,
): Check {
  const isInstagram = channel === "Instagram";
  const hasSig = draft.includes(buildSignature(kb));
  const signatureOk = isInstagram ? !hasSig : hasSig;
  const hasRawPlaceholder = /\{[^{}]+\}/.test(draft);
  const placeholderOk = needsInfoCount > 0 ? true : !hasRawPlaceholder;
  const ok = signatureOk && placeholderOk;
  return { id, channel, category, customer_msg, draft, usedLLM, signatureOk, placeholderOk, ok };
}

/** Build the KB snapshot the judge sees, scoped by category. */
function kbSnapshot(kb: KnowledgeBase, category: Category, today: Date): string {
  const lines: string[] = [];
  lines.push("## Currently selling (master_products)");
  lines.push(currentFlavors(kb).join("、"));
  const productsForCat = kb.products.products.slice(0, 12).map((p) =>
    `- ${p.name}: status="${p.status}", shelf_life="${p.shelf_life}"${p.notes ? `, notes="${p.notes}"` : ""}`,
  );
  lines.push("\n## Product details (master_products)");
  lines.push(...productsForCat);

  const relTpls = kb.templates.filter((t) => t.category === category).slice(0, 3);
  if (relTpls.length) {
    lines.push("\n## Related templates (templates_v2 — treated as ground truth)");
    for (const t of relTpls) {
      lines.push(`### ${t.id} ${t.title}`);
      lines.push(t.ux_enhanced.replace(/\n/g, " "));
      if (t.note) lines.push(`(note: ${t.note})`);
    }
  }

  if (category === "shipping_delay" || category === "address_change_before" || category === "address_change_after") {
    lines.push("\n## Shipping (master_shipping)");
    const valid = noticeValid(kb, today);
    lines.push(`- current_notice: ${kb.shipping.current_notice.description} (valid_until=${kb.shipping.current_notice.valid_until}, expired=${valid ? "no" : "yes"})`);
    if (valid) lines.push(`  - valid through: ${formatJaDate(kb.shipping.current_notice.valid_until)}`);
    for (const c of kb.shipping.channels) {
      lines.push(`- ${c.channel}: ${c.shipping_estimate} (date_time_specify=${c.date_time_specify ? "yes" : "no"})`);
    }
  }
  if (category === "subscription_change" || category === "subscription_cancel" || category === "subscription_payment_fail") {
    lines.push("\n## Subscription (master_subscription)");
    lines.push(`- new_signup_status: ${kb.subscription.subscription.new_signup_status}`);
    lines.push(`- platform: ${kb.subscription.subscription.platform}`);
  }
  if (category === "vending_location" || category === "vending_install_request") {
    lines.push("\n## Vending machines (master_locations, all entries incl. notes)");
    for (const l of kb.locations.locations) {
      const tail = l.notes ? `, notes="${l.notes}"` : "";
      lines.push(`- ${l.name}: status="${l.status ?? "?"}", address="${l.address}"${tail}`);
    }
  }
  return lines.join("\n");
}

/** Extract a JSON block from Claude's raw response. */
function extractJudgeJson(text: string): JudgeScore | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const f = obj.factual_alignment;
    const h = obj.no_hallucination;
    const r = obj.reason;
    if (![0, 1, 2].includes(f) || ![0, 1, 2].includes(h) || typeof r !== "string") return null;
    return { factual_alignment: f, no_hallucination: h, reason: r };
  } catch {
    return null;
  }
}

/** Strip the signature block from the draft (we don't score it). */
function stripSignature(draft: string, kb: KnowledgeBase): string {
  const idx = draft.indexOf(buildSignature(kb));
  if (idx < 0) return draft;
  return draft.slice(0, idx).replace(/\s+$/, "");
}

async function judgeOne(
  rubric: string, row: GoldenRow, draft: string, kb: KnowledgeBase, today: Date,
): Promise<JudgeScore | null> {
  const body = stripSignature(draft, kb);
  const user = [
    "# 顧客メッセージ",
    row.customer_msg,
    "",
    "# 期待カテゴリ",
    row.category,
    "",
    "# 期待エスカレ判定",
    row.escalated ? "true (escalate)" : "false (auto-eligible)",
    "",
    "# 関連KB抜粋",
    kbSnapshot(kb, row.category, today),
    "",
    "# 採点対象の下書き（署名は事前除去済み）",
    body,
  ].join("\n");
  let text: string | null = null;
  try {
    text = await callClaude(rubric, user);
  } catch (err) {
    console.error(`[judge ${row.id}] ${(err as Error).message}`);
    return null;
  }
  if (!text) return null;
  return extractJudgeJson(text);
}

// ---- main ----

const args = parseArgs(process.argv.slice(2));
const all = loadGolden();
const rows = subset(all, args.sample, args.seed);
const kb = loadKnowledge();

const judgeEnabled = args.judge && llmAvailable();
const rubric = args.judge ? readFileSync(RUBRIC_PATH, "utf-8") : "";

if (args.judge && !llmAvailable()) {
  console.error("--judge passed but ANTHROPIC_API_KEY unset; running structural check only.");
}

console.error(`target: ${rows.length}/${all.length}  judge: ${judgeEnabled ? "on" : "off"}`);

const checks: Check[] = [];
let llmUsed = 0;
let judgeFailed = 0;

for (const r of rows) {
  const res = await answerLLM(
    { text: r.customer_msg, channel: r.channel as Channel, customerName: r.customer_name },
    { now: EVAL_NOW, includeSignature: true },
  );
  if (res.usedLLM) llmUsed++;
  const c = structuralCheck(kb, r.id, r.channel, res.category, r.customer_msg, res.draft, res.usedLLM, res.needsInfo.length);
  if (judgeEnabled) {
    c.judge = await judgeOne(rubric, r, res.draft, kb, EVAL_NOW);
    if (!c.judge) judgeFailed++;
    process.stderr.write(`  ${r.id} ${c.judge ? `F=${c.judge.factual_alignment} H=${c.judge.no_hallucination}` : "judge-fail"}\n`);
  }
  checks.push(c);
}

const n = checks.length;
const sigOk = checks.filter((c) => c.signatureOk).length;
const phOk = checks.filter((c) => c.placeholderOk).length;
const allOk = checks.filter((c) => c.ok).length;

const summaryLines = [
  `count: ${n}  LLM-used: ${llmUsed}/${n}${llmUsed === 0 ? " (no key — all fallback)" : ""}`,
  `signature OK: ${sigOk}/${n}`,
  `placeholder invariant (no {…} left when auto-send eligible): ${phOk}/${n}`,
  `structural check overall: ${allOk}/${n} ${allOk === n ? "✓" : "← review"}`,
];

let judgeSection = "";
if (judgeEnabled) {
  const judged = checks.filter((c) => c.judge);
  const fSum = judged.reduce((s, c) => s + c.judge!.factual_alignment, 0);
  const hSum = judged.reduce((s, c) => s + c.judge!.no_hallucination, 0);
  const fAvg = judged.length ? fSum / judged.length : 0;
  const hAvg = judged.length ? hSum / judged.length : 0;
  const fDist = [0, 1, 2].map((v) => judged.filter((c) => c.judge!.factual_alignment === v).length);
  const hDist = [0, 1, 2].map((v) => judged.filter((c) => c.judge!.no_hallucination === v).length);
  const passed = judged.filter((c) => c.judge!.factual_alignment >= 1.5 && c.judge!.no_hallucination >= 1.5).length;
  // Machine-readable sidecar for the progress ledger (src/eval/progress.ts picks this up).
  if (judged.length) {
    const sidecar = join(ROOT, "reports", "llm_quality.latest.json");
    mkdirSync(dirname(sidecar), { recursive: true });
    writeFileSync(sidecar, JSON.stringify({
      ts: new Date().toISOString(),
      judged: judged.length,
      pass_rate: passed / judged.length,
      factual_alignment: fAvg,
      no_hallucination: hAvg,
    }) + "\n", "utf-8");
  }
  summaryLines.push("");
  summaryLines.push(`judged: ${judged.length}/${n} (parse failures: ${judgeFailed})`);
  summaryLines.push(`factual_alignment avg ${fAvg.toFixed(2)}  [0=${fDist[0]} / 1=${fDist[1]} / 2=${fDist[2]}]`);
  summaryLines.push(`no_hallucination  avg ${hAvg.toFixed(2)}  [0=${hDist[0]} / 1=${hDist[1]} / 2=${hDist[2]}]`);
  summaryLines.push(`passed (both ≥ 2): ${passed}/${judged.length}`);

  const worst = judged
    .map((c) => ({ c, score: c.judge!.factual_alignment + c.judge!.no_hallucination }))
    .sort((a, b) => a.score - b.score || a.c.judge!.factual_alignment - b.c.judge!.factual_alignment)
    .slice(0, 5);

  const snip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s).replace(/\n/g, " ");
  const worstRows = worst.map(({ c }) =>
    `| ${c.id} | ${c.category} | ${snip(c.customer_msg, 40)} | ${snip(c.draft, 60)} | ${c.judge!.factual_alignment} | ${c.judge!.no_hallucination} | ${snip(c.judge!.reason, 80)} |`,
  ).join("\n");
  judgeSection = [
    "",
    "## Judge scores (factual_alignment, no_hallucination)",
    "",
    `- factual_alignment: avg ${fAvg.toFixed(2)}  0=${fDist[0]} / 1=${fDist[1]} / 2=${fDist[2]}`,
    `- no_hallucination:  avg ${hAvg.toFixed(2)}  0=${hDist[0]} / 1=${hDist[1]} / 2=${hDist[2]}`,
    `- passed (both ≥ 2): ${passed}/${judged.length}`,
    `- JSON parse failures: ${judgeFailed}`,
    "",
    "### Worst 5",
    "",
    "| id | category | customer | draft snippet | F | H | judge reason |",
    "|---|---|---|---|---|---|---|",
    worstRows || "| - | - | - | - | - | - | (none) |",
  ].join("\n");
}

const summary = summaryLines.join("\n");
console.log(summary);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log("\n[structural NG]");
  for (const c of failed) console.log(`  ${c.id} ${c.category} sig=${c.signatureOk} ph=${c.placeholderOk}`);
}

if (args.report) {
  const head = "| id | ch | category | LLM | sig | placeholder | ok | F | H |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const body = checks.map((c) =>
    `| ${c.id} | ${c.channel} | ${c.category} | ${c.usedLLM ? "Y" : "—"} | ${c.signatureOk ? "✓" : "✗"} | ${c.placeholderOk ? "✓" : "✗"} | ${c.ok ? "✓" : "✗"} | ${c.judge ? c.judge.factual_alignment : "—"} | ${c.judge ? c.judge.no_hallucination : "—"} |`,
  ).join("\n");
  const out = join(ROOT, "reports", "llm_quality.md");
  mkdirSync(dirname(out), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(out, `# LLM reply quality\n\nRun date: ${today}  Evaluation reference time: 2026-06-13\n\n\`\`\`\n${summary}\n\`\`\`\n${judgeSection}\n\n## All rows\n\n${head}\n${sep}\n${body}\n`, "utf-8");
  console.log(`\nReport: ${out}`);
}

if (allOk !== n) process.exitCode = 1;
