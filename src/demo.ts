// Manual demo for the deterministic engine.
//   node src/demo.ts "賞味期限はどれくらいですか？"
//   node src/demo.ts "自販機を設置したいのですが可能ですか"
// With no args, runs a handful of representative inquiries.

import { answer } from "./engine/index.ts";

const NOW = new Date("2026-06-13T12:00:00+09:00");

function show(text: string): void {
  const r = answer({ text }, { now: NOW, includeSignature: true });
  console.log("─".repeat(60));
  console.log(`Q: ${text}`);
  console.log(`category: ${r.category}  confidence: ${r.confidence.toFixed(2)}`);
  console.log(`escalate: ${r.escalate ? "★required (human approval)" : "no (auto-draft eligible)"}${r.escalate ? "  reason: " + r.escalationReason : ""}`);
  if (r.notices.length) console.log(`notices: ${r.notices.join(" / ")}`);
  if (r.needsInfo.length) console.log(`needs: ${r.needsInfo.join(" / ")}`);
  console.log(`sources: ${r.sources.map((s) => s.id).join(", ") || "—"}`);
  console.log("--- draft ---");
  console.log(r.draft);
}

const args = process.argv.slice(2);
const samples = args.length
  ? args
  : [
      "賞味期限はどれくらいですか？",
      "自販機はどこにありますか？",
      "自販機を設置したいのですが可能ですか",
      "髪の毛のような異物が入っていました",
      "定期便を解約したいです",
      "Mint Cream flavor は通販で買えますか？",
    ];

for (const s of samples) show(s);
