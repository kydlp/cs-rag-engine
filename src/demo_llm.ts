// LLM + send-gate manual demo.
//   node src/demo_llm.ts "賞味期限はどれくらいですか？"
//   node src/demo_llm.ts "Mint Cream は売ってますか？" メール 山田
// Falls back to the deterministic composer if ANTHROPIC_API_KEY is missing or the call fails.

import { answerLLM } from "./index_llm.ts";
import { decideSend } from "./engine/gate.ts";
import type { Channel } from "./engine/types.ts";

const [, , msg, channel, name] = process.argv;
if (!msg) {
  console.error('Usage: node src/demo_llm.ts "<customer message>" [channel] [name]');
  process.exit(1);
}

const res = await answerLLM({ text: msg, channel: channel as Channel | undefined, customerName: name });
const gate = decideSend(res, { shadow: true });

console.log("─".repeat(60));
console.log(`category : ${res.category}　confidence ${res.confidence.toFixed(2)}　LLM=${res.usedLLM ? "used" : "fallback"}`);
console.log(`escalate : ${res.escalate ? "required (human approval)" : "no"}${res.escalationReason ? " — " + res.escalationReason : ""}`);
console.log(`gate     : predicted=${gate.predictedMode} / effective=${gate.effectiveMode}`);
if (gate.reasons.length) console.log(`  reason : ${gate.reasons.join(" / ")}`);
if (res.needsInfo.length) console.log(`needs    : ${res.needsInfo.join(" / ")}`);
if (res.notices.length) console.log(`notices  : ${res.notices.join(" / ")}`);
console.log("─".repeat(60));
console.log(res.draft);
console.log("─".repeat(60));
