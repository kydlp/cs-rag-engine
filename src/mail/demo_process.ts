// Manual smoke-test for processInbound.
//   node src/mail/demo_process.ts
// Runs a few synthetic inbound mails through processInbound and prints subject, gate decision, and draft.

import { processInbound } from "./process.ts";
import type { InboundMail } from "./types.ts";

const EVAL_NOW = new Date("2026-06-13T12:00:00+09:00");

const samples: InboundMail[] = [
  { from: "customer1@example.com", subject: "Shelf life", body: "賞味期限はどれくらいですか？冷凍のままでいいですか？", channel: "メール", customerName: "山田" },
  { from: "customer2@example.com", subject: "Shipping status", body: "5/1に注文したのですがまだ届きません。注文番号は#12345です。", channel: "メール", customerName: "佐藤" },
  { from: "customer3@example.com", subject: "Foreign object", body: "商品に髪の毛が入っていました。体調も悪くなり困っています。", channel: "メール", customerName: "鈴木" },
];

for (const m of samples) {
  const r = await processInbound(m, { now: EVAL_NOW });
  console.log("=".repeat(64));
  console.log(`[in] ${m.subject} — ${m.body}`);
  console.log(`category=${r.category} conf=${r.confidence.toFixed(2)} LLM=${r.usedLLM ? "used" : "fallback"}`);
  console.log(`escalate=${r.escalate ? "yes" : "no"} / gate predicted=${r.predictedMode} effective=${r.effectiveMode}`);
  console.log(`subject: ${r.replySubject}`);
  if (r.needsInfo.length) console.log(`needs: ${r.needsInfo.join(" / ")}`);
  console.log("--- draft ---");
  console.log(r.draftBody);
}
console.log("=".repeat(64));
