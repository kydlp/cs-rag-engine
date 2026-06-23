// Knowledge base + template loader (Workers variant).
// Uses JSON-modules bundling instead of fs (workers/src/kb/*.json).
// Regenerate workers/src/kb/ with `npm run build-kb` whenever the source KB changes.

import templates from "../kb/templates_v2.json" with { type: "json" };
import products from "../kb/master_products.json" with { type: "json" };
import shipping from "../kb/master_shipping.json" with { type: "json" };
import subscription from "../kb/master_subscription.json" with { type: "json" };
import locations from "../kb/master_locations.json" with { type: "json" };
import signature from "../kb/master_signature.json" with { type: "json" };

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

export function loadKnowledge(): KnowledgeBase {
  if (cache) return cache;
  cache = {
    templates: templates as Template[],
    products: products as ProductsMaster,
    shipping: shipping as ShippingMaster,
    subscription: subscription as SubscriptionMaster,
    locations: locations as LocationsMaster,
    signature: signature as SignatureMaster,
  };
  return cache;
}

export function buildSignature(kb: KnowledgeBase): string {
  const s = kb.signature.email;
  return [s.signoff, s.separator, s.company, s.address, s.separator].join("\n");
}

export function resetKnowledgeCache(): void {
  cache = null;
}

export function currentFlavors(kb: KnowledgeBase): string[] {
  return kb.products.products.filter((p) => p.status.startsWith("販売中")).map((p) => p.name);
}

export function activeLocations(kb: KnowledgeBase): { name: string; address: string }[] {
  return kb.locations.locations.filter((l) => l.status === "稼働中").map((l) => ({ name: l.name, address: l.address }));
}

export function noticeValid(kb: KnowledgeBase, today: Date): boolean {
  const until = new Date(kb.shipping.current_notice.valid_until + "T23:59:59+09:00");
  return today.getTime() <= until.getTime();
}

export function formatJaDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}
