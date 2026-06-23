// Mail integration types + delivery adapter abstraction.

import type { Channel } from "../engine/types.ts";
import type { SendMode } from "../engine/gate.ts";

export interface InboundMail {
  id?: string;
  threadId?: string;
  from?: string;
  subject?: string;
  body: string;
  channel?: Channel;
  customerName?: string;
}

export interface ProcessedReply {
  category: string;
  escalate: boolean;
  escalationReason: string;
  confidence: number;
  usedLLM: boolean;
  predictedMode: SendMode;
  effectiveMode: SendMode;
  gateReasons: string[];
  replySubject: string;
  draftBody: string;
  needsInfo: string[];
  notices: string[];
}

export interface MailGateway {
  listUnanswered(): Promise<InboundMail[]>;
  createDraft(mail: InboundMail, replySubject: string, draftBody: string): Promise<void>;
}
