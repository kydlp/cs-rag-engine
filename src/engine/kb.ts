// Knowledge base + template loader.
// "Time-varying facts" must live in data/kb/ — the only source of truth.
// The engine MUST NOT hardcode facts anywhere else.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/engine/ → project root
const ROOT = join(__dirname, "..", "..");
const KB = join(ROOT, "data", "kb");
const EXTRACTED = join(ROOT, "data", "extracted");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export interface Template {
  id: string;
  category: string;
  title: string;
  trigger: string;
  standard: string;
  ux_enhanced: string;
  variables: string[];
  escalated: boolean;
  escalation_reason?: string;
  note?: string;
}

export interface ProductsMaster {
  updated_at: string;
  products: { name: string; channels: string[]; status: string; shelf_life: string; notes?: string }[];
  rules: string[];
}

export interface ShippingMaster {
  updated_at: string;
  current_notice: { description: string; value: string; source: string; valid_until: string };
  channels: { channel: string; shipping_estimate: string; date_time_specify: boolean; alternative: string; notes?: string }[];
  rules: string[];
}

export interface SubscriptionMaster {
  updated_at: string;
  subscription: {
    new_signup_status: string;
    platform: string;
    monthly_contents: Record<string, string[] | string>;
    change_rules: Record<string, string>;
    cancel_rules: Record<string, string>;
    auto_cancel: Record<string, string | string[]>;
  };
  rules: string[];
}

export interface LocationsMaster {
  updated_at: string;
  locations: { name: string; address: string; status: string; last_verified: string; notes?: string }[];
  rules: string[];
}

export interface SignatureMaster {
  updated_at: string;
  updated_by?: string;
  email: {
    signoff: string;
    separator: string;
    company: string;
    address: string;
  };
  instagram_omit: boolean;
  rules: string[];
}

export interface KnowledgeBase {
  templates: Template[];
  products: ProductsMaster;
  shipping: ShippingMaster;
  subscription: SubscriptionMaster;
  locations: LocationsMaster;
  signature: SignatureMaster;
}

let cache: KnowledgeBase | null = null;

/** Load masters + templates (process-local cache). */
export function loadKnowledge(): KnowledgeBase {
  if (cache) return cache;
  cache = {
    templates: readJsonl<Template>(join(EXTRACTED, "templates_v2.jsonl")),
    products: readJson<ProductsMaster>(join(KB, "master_products.json")),
    shipping: readJson<ShippingMaster>(join(KB, "master_shipping.json")),
    subscription: readJson<SubscriptionMaster>(join(KB, "master_subscription.json")),
    locations: readJson<LocationsMaster>(join(KB, "master_locations.json")),
    signature: readJson<SignatureMaster>(join(KB, "master_signature.json")),
  };
  return cache;
}

/** Email signature (5 lines). Instagram callers may omit when instagram_omit=true. */
export function buildSignature(kb: KnowledgeBase): string {
  const s = kb.signature.email;
  return [s.signoff, s.separator, s.company, s.address, s.separator].join("\n");
}

/** Reset cache (test helper). */
export function resetKnowledgeCache(): void {
  cache = null;
}

// ── KB-derived helpers (facts always come from the masters) ──

/** Current sale-state flavor names. */
export function currentFlavors(kb: KnowledgeBase): string[] {
  return kb.products.products.filter((p) => p.status.startsWith("販売中")).map((p) => p.name);
}

/** Active vending machine locations. */
export function activeLocations(kb: KnowledgeBase): { name: string; address: string }[] {
  return kb.locations.locations.filter((l) => l.status === "稼働中").map((l) => ({ name: l.name, address: l.address }));
}

/** Is current_notice still valid as of `today`? */
export function noticeValid(kb: KnowledgeBase, today: Date): boolean {
  const until = new Date(kb.shipping.current_notice.valid_until + "T23:59:59+09:00");
  return today.getTime() <= until.getTime();
}

/** "2026-06-15" → "2026年6月15日". */
export function formatJaDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}
