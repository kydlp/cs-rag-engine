// Engine entry point.
// answer(inquiry) = classify → escalation → compose. Adapters import this only.

import type { EngineResult, Inquiry } from "./types.ts";
import { loadKnowledge } from "./kb.ts";
import { classify } from "./classify.ts";
import { decideEscalation } from "./escalation.ts";
import { compose } from "./compose.ts";

export interface AnswerOptions {
  /** Reference date for KB freshness checks (default: now). */
  now?: Date;
  /** Append fixed signature? (default: true.) */
  includeSignature?: boolean;
}

export function answer(inquiry: Inquiry, options: AnswerOptions = {}): EngineResult {
  const kb = loadKnowledge();
  const today = options.now ?? new Date();
  const includeSignature = options.includeSignature ?? true;

  const cls = classify(inquiry.text);
  const esc = decideEscalation({
    text: inquiry.text,
    category: cls.category,
    confidence: cls.confidence,
    kb,
    today,
  });

  // Escalation may override category (e.g. foreign object → complaint_quality).
  const category = esc.categoryOverride ?? cls.category;

  const composed = compose(category, inquiry.text, kb, {
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
  };
}

export type { EngineResult, Inquiry } from "./types.ts";
export { loadKnowledge } from "./kb.ts";
