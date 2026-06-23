// Batch runner: inbound mails (JSON) → AI processing → Gmail draft payloads (JSON).
// Designed to be driven by a Claude Code + MCP Gmail loop:
//   1) MCP search_threads / get_thread → assemble InboundMail[]
//   2) Pipe that JSON to this runner via stdin
//   3) For each item, call MCP create_draft with item.draft (no actual send)
//   4) Append item.audit to reports/shadow_log.jsonl
//
// Usage:
//   echo '[{...InboundMail}, ...]' | node src/mail/run_inbox.ts
//   node src/mail/run_inbox.ts < inbox.json
//   node src/mail/run_inbox.ts --file inbox.json [--log reports/shadow_log.jsonl]

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { processInbound } from "./process.ts";
import { toGmailDraft, type GmailDraftPayload } from "./draft_format.ts";
import type { InboundMail, ProcessedReply } from "./types.ts";

interface BatchItem {
  inbound: InboundMail;
  draft: GmailDraftPayload;
  audit: AuditRecord;
}

interface AuditRecord {
  ts: string;
  threadId?: string;
  from?: string;
  subject?: string;
  category: ProcessedReply["category"];
  escalate: boolean;
  escalationReason: string;
  confidence: number;
  usedLLM: boolean;
  predictedMode: ProcessedReply["predictedMode"];
  effectiveMode: ProcessedReply["effectiveMode"];
  gateReasons: string[];
  needsInfo: string[];
  notices: string[];
}

function parseArgs(argv: string[]): { file?: string; log?: string } {
  const out: { file?: string; log?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") out.file = argv[++i];
    else if (a === "--log") out.log = argv[++i];
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function toAudit(inbound: InboundMail, reply: ProcessedReply): AuditRecord {
  return {
    ts: new Date().toISOString(),
    threadId: inbound.threadId,
    from: inbound.from,
    subject: inbound.subject,
    category: reply.category,
    escalate: reply.escalate,
    escalationReason: reply.escalationReason,
    confidence: reply.confidence,
    usedLLM: reply.usedLLM,
    predictedMode: reply.predictedMode,
    effectiveMode: reply.effectiveMode,
    gateReasons: reply.gateReasons,
    needsInfo: reply.needsInfo,
    notices: reply.notices,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.file ? readFileSync(args.file, "utf8") : await readStdin();
  if (!raw.trim()) {
    process.stderr.write("Empty input. Pass an InboundMail[] JSON via stdin or --file.\n");
    process.exit(2);
  }

  let inputs: InboundMail[];
  try {
    const parsed = JSON.parse(raw);
    inputs = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    process.stderr.write(`JSON parse failed: ${(e as Error).message}\n`);
    process.exit(2);
    return;
  }

  const items: BatchItem[] = [];
  for (const inbound of inputs) {
    const reply = await processInbound(inbound);
    items.push({
      inbound,
      draft: toGmailDraft(inbound, reply),
      audit: toAudit(inbound, reply),
    });
  }

  if (args.log) {
    mkdirSync(dirname(args.log), { recursive: true });
    const lines = items.map((i) => JSON.stringify(i.audit)).join("\n") + "\n";
    appendFileSync(args.log, lines, "utf8");
  }

  process.stdout.write(JSON.stringify(items, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`run_inbox failed: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
