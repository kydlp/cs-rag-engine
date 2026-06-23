// Inbound mail → reply draft + send-gate decision (Workers build).

import { answerLLM } from "../index_llm.ts";
import { decideSend, type GateOptions } from "../engine/gate.ts";
import type { InboundMail, ProcessedReply } from "./types.ts";

export function replySubjectOf(subject?: string): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: your inquiry";
  return /^\s*re:/i.test(s) ? s : `Re: ${s}`;
}

export interface ProcessOptions {
  gate?: GateOptions;
  now?: Date;
}

export async function processInbound(mail: InboundMail, opts: ProcessOptions = {}): Promise<ProcessedReply> {
  const res = await answerLLM(
    { text: mail.body, channel: mail.channel, customerName: mail.customerName },
    { includeSignature: true, now: opts.now },
  );
  const gate = decideSend(res, opts.gate ?? { shadow: true });

  return {
    category: res.category,
    escalate: res.escalate,
    escalationReason: res.escalationReason,
    confidence: res.confidence,
    usedLLM: res.usedLLM,
    predictedMode: gate.predictedMode,
    effectiveMode: gate.effectiveMode,
    gateReasons: gate.reasons,
    replySubject: replySubjectOf(mail.subject),
    draftBody: res.draft,
    needsInfo: res.needsInfo,
    notices: res.notices,
  };
}
