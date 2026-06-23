// Mail integration types + delivery adapter abstraction.
// The delivery layer is pluggable:
//   (a) Production: Gmail API (OAuth) running on Cloudflare Workers cron
//   (b) Dev: half-manual MCP-Gmail loop driven from Claude Code

import type { Channel } from "../engine/types.ts";
import type { SendMode } from "../engine/gate.ts";

/** Inbound mail (from a Gmail thread/message; body is plain text). */
export interface InboundMail {
  /** Gmail message id (optional). */
  id?: string;
  /** Gmail thread id (used to attach the draft to the same thread). */
  threadId?: string;
  /** Sender (customer). */
  from?: string;
  /** Subject line. */
  subject?: string;
  /** Plain-text body. */
  body: string;
  /** Inbound channel (signature/tone routing). */
  channel?: Channel;
  /** Customer name when known. */
  customerName?: string;
}

/** processInbound output: draft body + gate decision + audit info. */
export interface ProcessedReply {
  category: string;
  escalate: boolean;
  escalationReason: string;
  confidence: number;
  /** Was Claude used? (false = deterministic fallback.) */
  usedLLM: boolean;
  /** What the AI would do if autonomous. */
  predictedMode: SendMode;
  /** What actually happens (always human_approval while shadow=true). */
  effectiveMode: SendMode;
  gateReasons: string[];
  /** Reply subject ("Re:" prefixed). */
  replySubject: string;
  /** Reply draft body (signature included). */
  draftBody: string;
  needsInfo: string[];
  notices: string[];
}

/** Delivery adapter — read inbox + create drafts. Implementations swap freely. */
export interface MailGateway {
  /** List unanswered inquiry mails. */
  listUnanswered(): Promise<InboundMail[]>;
  /** Create a draft reply (do not send — approval happens in Gmail UI). */
  createDraft(mail: InboundMail, replySubject: string, draftBody: string): Promise<void>;
}
