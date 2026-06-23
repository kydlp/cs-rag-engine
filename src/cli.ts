// JSON-out CLI for the reply engine (used by local Claude Code / MCP loops).
//   node src/cli.ts --text "賞味期限は？" [--channel LINE] [--name "K.O."] [--no-signature]
//   echo "本文" | node src/cli.ts            # stdin is also supported
// Output: { category, escalate, escalationReason, draft, needsInfo, sources, confidence, notices }

import { answer } from "./engine/index.ts";
import type { Channel } from "./engine/types.ts";

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

const text = getFlag("text") ?? (await readStdin());
if (!text) {
  console.error('Usage: node src/cli.ts --text "<customer message>" [--channel LINE] [--name "Name"] [--no-signature]');
  process.exit(2);
}

const result = answer(
  {
    text,
    channel: getFlag("channel") as Channel | undefined,
    customerName: getFlag("name"),
  },
  { includeSignature: !process.argv.includes("--no-signature") },
);

console.log(JSON.stringify(result, null, 2));
