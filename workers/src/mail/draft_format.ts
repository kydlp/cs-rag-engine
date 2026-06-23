// Format a ProcessedReply into a Gmail create_draft payload. Pure function.

import type { InboundMail, ProcessedReply } from "./types.ts";

export interface GmailDraftPayload {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
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
