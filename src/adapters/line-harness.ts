// LINE messaging adapter (integration point definition).
//
// === Topology (a LINE webhook service deployed on Cloudflare) ===
//   - Worker: https://sample-cs.example.workers.dev
//       * Receives LINE webhooks → persists conversations to D1 (sample-cs).
//       * cron "*/5 * * * *" (5-minute batch tick — ideal hook for auto-drafting).
//       * API-key-protected HTTP API (also used by the admin UI).
//   - Admin UI: https://sample-cs-admin.pages.dev/chats (manual reply console)
//   - "line-harness" MCP server: read/write conversations from Claude Code / Cursor
//
// === Verified MCP capabilities (29 tools) ===
//   Read: list_conversations (unanswered queue, sorted by wait time, returns friendId),
//         get_conversation (history per friendId; each msg has source: user/manual/auto_reply/…)
//   Send: send_message (friendId, content, messageType: text|image|flex, isTest for test sends)
//         ※ No "save draft" tool — send_message is immediate; approval is human-driven.
//   Other: list_friends / manage_tags / manage_message_templates / broadcast etc.
//
// In practice, the fastest loop is the local Claude Code + MCP flow defined in
//   `.claude/commands/cs-triage.md`
// (list_conversations → get_conversation → answer() → human approval → send_message
//  with isTest=true for verification then re-send without isTest).
// This adapter file is reserved for the future cron-driven auto-draft path (option B below).
//
// === Hard Rule ===
//   AI MUST NOT actually send to customers. This adapter only:
//     fetch unanswered → answer() → produce a draft + escalation decision → write back as draft
//   The send action is performed by a human in the admin UI.
//
// === Wiring options ===
//   A. Sidecar: deploy this repo as a separate Worker/cron. It calls the LINE Worker API
//      to fetch unanswered messages and PATCH a draft back. The LINE Worker code is not touched.
//   B. Embedded: import answer() directly inside the LINE Worker's cron handler (TS-friendly).
//
// Replace the fetch stubs below with real API/MCP endpoints once finalized.

import { answer, type AnswerOptions } from "../engine/index.ts";
import type { Channel, EngineResult } from "../engine/types.ts";

/** Minimal conversation record (align to actual schema once finalized). */
export interface HarnessMessage {
  conversationId: string;
  text: string;
  /** From LINE if available. */
  channel?: Channel;
  customerName?: string;
}

/** Draft suggestion written back to /chats. */
export interface DraftSuggestion {
  conversationId: string;
  draft: string;
  /** When true, UI shows a "human approval required" badge and blocks auto-send. */
  needsHumanApproval: boolean;
  category: EngineResult["category"];
  escalationReason: string;
  needsInfo: string[];
  sources: EngineResult["sources"];
  confidence: number;
  notices: string[];
}

/** Pure conversion: one message → draft suggestion. */
export function toDraftSuggestion(msg: HarnessMessage, options: AnswerOptions = {}): DraftSuggestion {
  const res = answer(
    { text: msg.text, channel: msg.channel, customerName: msg.customerName },
    options,
  );
  return {
    conversationId: msg.conversationId,
    draft: res.draft,
    needsHumanApproval: res.escalate, // escalate ⇒ always require human approval
    category: res.category,
    escalationReason: res.escalationReason,
    needsInfo: res.needsInfo,
    sources: res.sources,
    confidence: res.confidence,
    notices: res.notices,
  };
}

// ── Worker API client stubs (implement once real endpoints are defined) ──

export interface HarnessClientConfig {
  baseUrl: string; // e.g. https://sample-cs.example.workers.dev
  apiKey: string; // shared API key — pass via env
}

/** Fetch unanswered messages (stub — wire to the real API). */
export async function fetchUnanswered(_cfg: HarnessClientConfig): Promise<HarnessMessage[]> {
  throw new Error("not implemented: fetch unanswered (e.g. GET /api/conversations?status=unanswered)");
}

/** Write back the draft (stub — wire to the real API). */
export async function postDraft(_cfg: HarnessClientConfig, _d: DraftSuggestion): Promise<void> {
  throw new Error("not implemented: post draft (e.g. PATCH /api/conversations/:id/draft)");
}

/** Called from a 5-minute cron: fetch → draft → write back. Never sends. */
export async function runDraftBatch(cfg: HarnessClientConfig, options: AnswerOptions = {}): Promise<DraftSuggestion[]> {
  const msgs = await fetchUnanswered(cfg);
  const drafts = msgs.map((m) => toDraftSuggestion(m, options));
  for (const d of drafts) await postDraft(cfg, d);
  return drafts;
}
