// Copy data/kb/*.json and data/extracted/templates_v2.jsonl into workers/src/kb/
// so the Workers bundle imports them via `with { type: "json" }`.
// Run after every KB update: `npm run build-kb`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SRC_KB = join(ROOT, "data", "kb");
const SRC_EXT = join(ROOT, "data", "extracted");
const OUT = join(__dirname, "..", "src", "kb");

mkdirSync(OUT, { recursive: true });

for (const name of ["master_products", "master_shipping", "master_subscription", "master_locations", "master_signature"]) {
  const src = readFileSync(join(SRC_KB, `${name}.json`), "utf-8");
  writeFileSync(join(OUT, `${name}.json`), src, "utf-8");
}

// templates: jsonl → json array
const lines = readFileSync(join(SRC_EXT, "templates_v2.jsonl"), "utf-8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => JSON.parse(l));
writeFileSync(join(OUT, "templates_v2.json"), JSON.stringify(lines, null, 2), "utf-8");

console.log(`KB ${5 + 1} files written to ${OUT} (templates=${lines.length})`);
