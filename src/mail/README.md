# Mail integration (MCP Gmail half-manual loop)

End-to-end loop: inbound mail → AI draft → **Gmail Drafts folder**. The system never sends;
all sends are human-approved in the Gmail UI (Hard Rule).

## Topology

```
Gmail inbox
   ├─ MCP search_threads / get_thread → InboundMail[]
   │     └─ node src/mail/run_inbox.ts                  … processInbound for each
   │          ├─ stdout: BatchItem[] (with draft payload)
   │          └─ --log:  reports/shadow_log.jsonl (predicted / effective decision)
   │     └─ MCP create_draft → Gmail Drafts (never sends)
Operator reviews drafts in Gmail UI → sends manually.
```

The engine (`process.ts` / `index_llm.ts` / `gate.ts`) is unmodified. This directory adds
only the draft payload formatter (`draft_format.ts`) and the batch runner (`run_inbox.ts`).

## One loop (driven by a Claude Code session)

1. **Fetch unanswered threads**
   - `mcp__claude_ai_Gmail__search_threads` with e.g. `label:CS is:unread newer_than:7d`
   - For each, `mcp__claude_ai_Gmail__get_thread` → pull the latest customer message.

2. **Assemble InboundMail[]** (the session builds this JSON):

   ```json
   [
     {
       "id": "<gmail message id>",
       "threadId": "<gmail thread id>",
       "from": "<sender email>",
       "subject": "<subject>",
       "body": "<plain text body>",
       "channel": "メール",
       "customerName": "<if known>"
     }
   ]
   ```

3. **Run AI processing**

   ```bash
   node src/mail/run_inbox.ts --file inbox.json --log reports/shadow_log.jsonl > out.json
   ```

   - `out.json` is `BatchItem[]`: `{ inbound, draft, audit }`
   - `--log` appends one audit row per inbound mail (JSONL).

4. **Create Gmail drafts (never send)**
   - For each `item.draft`, call `mcp__claude_ai_Gmail__create_draft` with:
     - `to` = `draft.to`
     - `subject` = `draft.subject`
     - `body` = `draft.body`
     - `threadId` = `draft.threadId` (so the draft sticks to the same thread)
   - **Even `predictedMode=auto_send` items are saved as drafts** — to measure human-AI agreement.

5. **Done.** Operator opens Gmail UI, reviews drafts, edits if needed, sends manually.

## Audit log (shadow_log.jsonl)

Each inbound mail produces one JSONL line in `reports/shadow_log.jsonl`:

| key | description |
|---|---|
| ts | ISO timestamp |
| threadId / from / subject | thread identifiers |
| category | classified category |
| escalate / escalationReason | safety-floor trigger and reason |
| confidence | classifier confidence |
| usedLLM | did Claude produce the body? (false = deterministic fallback) |
| predictedMode | what the AI would do if autonomous (auto_send / human_approval) |
| effectiveMode | actual action (always human_approval while shadow=true) |
| gateReasons | decision reasons (for agreement analysis) |
| needsInfo / notices | unresolved slots and KB notices |

A later analysis step reconciles `predictedMode=auto_send` rows against actual human sends to decide which categories can be promoted out of shadow.

## Local smoke test

```bash
node src/mail/run_inbox.ts --file data/mock/inbox_sample.json --log reports/shadow_log.jsonl
```

Three samples (shelf life / shipping delay / foreign object) are processed; expected
outcomes are `auto_send` (shadow ⇒ effectively human_approval), `human_approval` (current_notice expired), and `human_approval` (safety floor).

## Known limits

- Session-driven: works only while a Claude Code session is running.
- Gmail only: BASE / Instagram / contact forms are out of scope here.
- Attachments (photos) not handled in this loop — foreign-object cases escalate to a human.
