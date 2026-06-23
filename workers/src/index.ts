// Cloudflare Workers entry.
// Cron (every 5 minutes) checks the Gmail inbox and creates an AI draft in the Drafts folder
// for every new mail. It never sends — Hard Rule. Human approval happens in Gmail UI.
//
// The engine (src/engine/*) reads process.env.ANTHROPIC_API_KEY, so we inject Secrets
// into globalThis.process.env at the start of scheduled() (compatibility_flags=nodejs_compat).

import { getAccessToken } from "./auth/google.ts";
import { GmailClient } from "./mail/gmail.ts";
import { processInbound } from "./mail/process.ts";
import { toGmailDraft } from "./mail/draft_format.ts";

export interface Env {
  // Secrets
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  // Vars
  PROCESSED_LABEL: string;
  INBOX_QUERY: string;
  MAX_PER_TICK: string;
}

function injectEnv(env: Env): void {
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process ?? {};
  proc.env = {
    ...(proc.env ?? {}),
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL } : {}),
  };
  (globalThis as { process?: unknown }).process = proc;
}

interface RunResult {
  scanned: number;
  drafted: number;
  errors: { threadId: string; message: string }[];
}

async function runTick(env: Env, _ctx: ExecutionContext): Promise<RunResult> {
  injectEnv(env);

  const accessToken = await getAccessToken({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  });
  const gmail = new GmailClient(accessToken);

  const max = Number(env.MAX_PER_TICK || "5");
  const threads = await gmail.listThreads(env.INBOX_QUERY, max);
  const processedLabelId = await gmail.ensureLabel(env.PROCESSED_LABEL);

  const result: RunResult = { scanned: threads.length, drafted: 0, errors: [] };

  for (const t of threads) {
    try {
      const inbound = await gmail.fetchInbound(t.id);
      if (!inbound || !inbound.body.trim()) {
        // Mark empty mails processed so they don't loop forever.
        await gmail.addLabel(t.id, processedLabelId);
        continue;
      }
      const reply = await processInbound(inbound, { gate: { shadow: true } });
      const draft = toGmailDraft(inbound, reply);
      if (!draft.to) {
        await gmail.addLabel(t.id, processedLabelId);
        continue;
      }
      await gmail.createDraft({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        threadId: draft.threadId,
        inReplyToMessageId: draft.inReplyTo,
      });
      await gmail.addLabel(t.id, processedLabelId);
      result.drafted++;
    } catch (e) {
      result.errors.push({ threadId: t.id, message: (e as Error).message });
    }
  }

  return result;
}

export default {
  // Manual trigger (GET for debugging). Production uses the Cron schedule.
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/run") {
      const r = await runTick(env, ctx);
      return Response.json(r);
    }
    return new Response("cs-rag-engine-mailbot\nGET /health, GET /run", { status: 200 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const r = await runTick(env, ctx);
    console.log(`tick ${new Date().toISOString()} scanned=${r.scanned} drafted=${r.drafted} errors=${r.errors.length}`);
    for (const e of r.errors) console.error(`  err thread=${e.threadId} ${e.message}`);
  },
};
