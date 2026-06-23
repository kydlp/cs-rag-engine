// Format a ProcessedReply into a payload for the Gmail create_draft call.
// This module does not call MCP directly — that's the caller's job. Pure function.

import type { InboundMail, ProcessedReply } from "./types.ts";

export interface GmailDraftPayload {
  /** Recipient (the original sender). */
  to: string;
  /** Reply subject (Re: prefixed). */
  subject: string;
  /** Reply body (signature included). */
  body: string;
  /** Attach to the same Gmail thread (optional). */
  threadId?: string;
  /** In-Reply-To message id for the same thread (optional). */
  inReplyTo?: string;
}

export function toGmailDraft(mail: InboundMail, reply: ProcessedReply): GmailDraftPayload {
  return {
    to: mail.from ?? "",
    subject: reply.replySubject,
    body: reply.draftBody,
    threadId: mail.threadId,
    inReplyTo: mail.id,
  };
}
