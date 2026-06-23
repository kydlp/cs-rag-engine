// LLM entry point. Async version of answer() — only the reply body is replaced with
// Claude generation (composeLLM); classification, escalation, and gate are unchanged.

import type { EngineResult, Inquiry } from "./engine/types.ts";
import type { AnswerOptions } from "./engine/index.ts";
import { loadKnowledge } from "./engine/kb.ts";
import { classify } from "./engine/classify.ts";
import { decideEscalation } from "./engine/escalation.ts";
import { composeLLM } from "./engine/compose_llm.ts";

export interface AnswerLLMResult extends EngineResult {
  /** Did the LLM produce the body? (false = deterministic fallback.) */
  usedLLM: boolean;
}

export async function answerLLM(inquiry: Inquiry, options: AnswerOptions = {}): Promise<AnswerLLMResult> {
  const kb = loadKnowledge();
  const today = options.now ?? new Date();
  const includeSignature = options.includeSignature ?? true;

  const cls = classify(inquiry.text);
  const esc = decideEscalation({ text: inquiry.text, category: cls.category, confidence: cls.confidence, kb, today });
  const category = esc.categoryOverride ?? cls.category;

  const composed = await composeLLM(category, inquiry.text, kb, {
    channel: inquiry.channel,
    customerName: inquiry.customerName,
    known: inquiry.known,
    includeSignature,
    today,
  });

  return {
    category,
    escalate: esc.escalate,
    escalationReason: esc.reason,
    draft: composed.draft,
    needsInfo: composed.needsInfo,
    sources: composed.sources,
    confidence: cls.confidence,
    notices: esc.notices,
    usedLLM: composed.usedLLM,
  };
}
