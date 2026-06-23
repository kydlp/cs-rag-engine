// Gmail API client (Workers-only, minimal surface):
//   list(query) → get(id) → createDraft(to, subject, body, threadId, replyToMessageId)
//             → addLabel(threadId, labelId) to mark "processed"
//
// One cron tick obtains an access token once via google.ts and reuses it.

import type { InboundMail } from "./types.ts";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface ListThreadsResp {
  threads?: { id: string; snippet?: string }[];
}

interface MessagePayloadHeader { name: string; value: string }
interface MessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: MessagePayloadHeader[];
  body?: { data?: string; size?: number };
  parts?: MessagePart[];
}
interface Message {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: MessagePart;
  snippet?: string;
}
interface Thread {
  id: string;
  messages?: Message[];
}

function b64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  // Workers atob returns ASCII — convert to UTF-8.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function b64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64UrlEncode(s: string): string {
  return b64Encode(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function rfc2047Subject(s: string): string {
  return `=?UTF-8?B?${b64Encode(s)}?=`;
}

function header(headers: MessagePayloadHeader[] | undefined, key: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === key.toLowerCase())?.value;
}

function extractPlain(payload: MessagePart | undefined): string {
  if (!payload) return "";
  const stack: MessagePart[] = [payload];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.mimeType === "text/plain" && p.body?.data) return b64UrlDecode(p.body.data);
    if (p.parts) for (const c of p.parts) stack.push(c);
  }
  // Fall back to naive HTML→text if no text/plain part exists.
  const stack2: MessagePart[] = [payload];
  while (stack2.length) {
    const p = stack2.pop()!;
    if (p.mimeType === "text/html" && p.body?.data) {
      return b64UrlDecode(p.body.data).replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
    }
    if (p.parts) for (const c of p.parts) stack2.push(c);
  }
  return "";
}

function parseFromEmail(from: string | undefined): string {
  if (!from) return "";
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function parseFromName(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<.+>/);
  return m?.[1]?.trim();
}

export class GmailClient {
  constructor(private accessToken: string) {}

  private async req(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gmail API ${path} ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res;
  }

  async listThreads(query: string, max = 5): Promise<{ id: string }[]> {
    const u = new URLSearchParams({ q: query, maxResults: String(max) });
    const res = await this.req(`/threads?${u}`);
    const data = (await res.json()) as ListThreadsResp;
    return data.threads ?? [];
  }

  async getThread(threadId: string): Promise<Thread> {
    const res = await this.req(`/threads/${threadId}?format=full`);
    return (await res.json()) as Thread;
  }

  /** Convert the last customer message into an InboundMail. */
  async fetchInbound(threadId: string): Promise<InboundMail | null> {
    const thread = await this.getThread(threadId);
    const messages = thread.messages ?? [];
    const last = messages[messages.length - 1];
    if (!last) return null;
    const fromRaw = header(last.payload?.headers, "From");
    const subject = header(last.payload?.headers, "Subject");
    const body = extractPlain(last.payload);
    return {
      id: last.id,
      threadId: thread.id,
      from: parseFromEmail(fromRaw),
      subject,
      body,
      channel: "メール",
      customerName: parseFromName(fromRaw),
    };
  }

  /** Get or create a label and return its id. */
  async ensureLabel(name: string): Promise<string> {
    const list = (await (await this.req("/labels")).json()) as { labels?: { id: string; name: string }[] };
    const found = list.labels?.find((l) => l.name === name);
    if (found) return found.id;
    const res = await this.req("/labels", {
      method: "POST",
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  async addLabel(threadId: string, labelId: string): Promise<void> {
    await this.req(`/threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  /** Create a draft. For replies: same thread + In-Reply-To/References. */
  async createDraft(args: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyToMessageId?: string;
  }): Promise<string> {
    // In-Reply-To / References need the Message-ID header (<...>), not the Gmail internal id.
    let inReplyToHdr: string | undefined;
    if (args.inReplyToMessageId) {
      try {
        const res = await this.req(
          `/messages/${args.inReplyToMessageId}?format=metadata&metadataHeaders=Message-Id`,
        );
        const data = (await res.json()) as Message;
        inReplyToHdr = header(data.payload?.headers, "Message-Id");
      } catch {
        // Fall through: draft is still created without the header.
      }
    }

    const headers: string[] = [
      `To: ${args.to}`,
      `Subject: ${rfc2047Subject(args.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ];
    if (inReplyToHdr) {
      headers.push(`In-Reply-To: ${inReplyToHdr}`);
      headers.push(`References: ${inReplyToHdr}`);
    }
    // Body is base64 (per CTE: base64 header); the whole RFC822 message is then base64url-encoded.
    const rfc822 = headers.join("\r\n") + "\r\n\r\n" + b64Encode(args.body);
    const raw = b64UrlEncode(rfc822);

    const payload: Record<string, unknown> = { message: { raw } };
    if (args.threadId) (payload.message as Record<string, unknown>).threadId = args.threadId;

    const res = await this.req("/drafts", { method: "POST", body: JSON.stringify(payload) });
    const data = (await res.json()) as { id: string };
    return data.id;
  }
}
