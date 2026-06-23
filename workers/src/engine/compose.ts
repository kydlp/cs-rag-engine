// Reply draft composer. Uses ux_enhanced templates as the skeleton and injects facts
// from the masters. Deterministic — no LLM here (reproducible, no API key needed).
// LLM polishing happens in compose_llm.ts; this module produces the grounding context.

import type { Category, Channel, Inquiry, Source } from "./types.ts";
import type { KnowledgeBase, Template } from "./kb.ts";
import { currentFlavors, activeLocations, noticeValid, formatJaDate, buildSignature } from "./kb.ts";

/** Select a template from category + body (handles multi-template categories). */
export function selectTemplate(category: Category, text: string, kb: KnowledgeBase): Template | null {
  const byId = (id: string) => kb.templates.find((t) => t.id === id) ?? null;

  switch (category) {
    case "product_inquiry":
      if (["妊娠", "妊婦", "授乳", "アレルギー", "加熱", "持病"].some((m) => text.includes(m))) return byId("TPL-020");
      if (["1缶", "一缶", "組み合わせ", "単品", "ばら"].some((m) => text.includes(m))) return byId("TPL-022");
      return byId("TPL-001");
    case "flavor_inquiry":
      return byId("TPL-002");
    case "payment":
      if (["送料", "引き落とし", "いつ決済", "いつ支払", "決済のタイミング"].some((m) => text.includes(m))) return byId("TPL-011");
      return byId("TPL-010");
    case "subscription_change":
      return byId("TPL-004");
    case "subscription_cancel":
      return byId("TPL-003");
    case "subscription_payment_fail":
      return byId("TPL-005");
    case "shipping_delay":
      if (["配達完了", "発送メール", "発送通知", "発送済みなのに"].some((m) => text.includes(m))) return byId("TPL-009");
      return byId("TPL-008");
    case "address_change_before":
      return byId("TPL-006");
    case "address_change_after":
      return byId("TPL-007");
    case "receipt":
      return byId("TPL-014");
    case "duplicate_shipping":
      return byId("TPL-015");
    case "email_missing":
      return byId("TPL-012");
    case "vending_location":
      return byId("TPL-013");
    case "other":
      if (["海外", "international", "overseas"].some((m) => text.toLowerCase().includes(m.toLowerCase()))) return byId("TPL-019");
      if (["日時指定", "時間指定", "指定日", "日に届"].some((m) => text.includes(m))) return byId("TPL-018");
      if (["キャンセル", "間違えて注文"].some((m) => text.includes(m))) return byId("TPL-021");
      return null;
    case "vending_install_request":
      return null; // no template — acknowledgement only + escalate
    case "complaint_quality":
      return byId("TPL-016");
    default:
      return null;
  }
}

// Anonymized flavor name list for the public sample. Detection is by substring; the
// engine resolves the canonical name via the KB.
const FLAVOR_NAMES = ["Vanilla Classic", "Mint Cream", "Strawberry Milk", "Cherry Punch", "Mango", "Lemon Zest", "Matcha"];

function detectFlavor(text: string): string | null {
  const lower = text.toLowerCase();
  return FLAVOR_NAMES.find((f) => lower.includes(f.toLowerCase())) ?? null;
}

export interface ComposeOptions {
  channel?: Channel;
  customerName?: string;
  known?: Inquiry["known"];
  /** Append the fixed signature? (true for production sends; false for golden diffing.) */
  includeSignature?: boolean;
  today: Date;
}

export interface Composed {
  draft: string;
  needsInfo: string[];
  sources: Source[];
}

/** Acknowledgement body for escalate-but-no-template cases. */
function acknowledgement(category: Category): string {
  if (category === "vending_install_request") {
    return "ご連絡ありがとうございます。\n\n自動販売機の設置につきまして、ご提案いただきありがとうございます。担当者にて内容を確認のうえ、改めてご連絡させていただきます。\n\n何卒よろしくお願いいたします。";
  }
  return "ご連絡ありがとうございます。\n\nお問い合わせいただいた件につきまして、担当者にて確認のうえ、改めてご連絡させていただきます。\n\n何卒よろしくお願いいたします。";
}

export function compose(category: Category, text: string, kb: KnowledgeBase, opts: ComposeOptions): Composed {
  const sources: Source[] = [];
  const needsInfo: string[] = [];
  const tpl = selectTemplate(category, text, kb);

  let body: string;
  if (tpl) {
    body = tpl.ux_enhanced;
    sources.push({ kind: "template", id: tpl.id, title: tpl.title });
  } else {
    body = acknowledgement(category);
  }

  // ── Inject master-derived facts ──
  if (body.includes("{current_flavors}")) {
    body = body.replaceAll("{current_flavors}", currentFlavors(kb).join("、"));
    sources.push({ kind: "kb", id: "master_products" });
  }
  if (body.includes("{location_list}")) {
    // Internal "詳細UNKNOWN" notes are stripped from customer-facing output.
    const list = activeLocations(kb)
      .map((l) => {
        const addr = l.address.replace(/詳細UNKNOWN/g, "").replace(/\s+$/g, "").trim();
        return addr ? `・${l.name}　${addr}` : `・${l.name}`;
      })
      .join("\n");
    body = body.replaceAll("{location_list}", list);
    sources.push({ kind: "kb", id: "master_locations" });
  }
  if (body.includes("{delivery_deadline}")) {
    if (noticeValid(kb, opts.today)) {
      body = body.replaceAll("{delivery_deadline}", formatJaDate(kb.shipping.current_notice.valid_until));
      sources.push({ kind: "kb", id: "master_shipping.current_notice" });
    } else {
      needsInfo.push("delivery_deadline (current_notice expired — verify latest schedule)");
    }
  }
  if (body.includes("{flavor}")) {
    const f = detectFlavor(text);
    if (f) body = body.replaceAll("{flavor}", f);
    else needsInfo.push("flavor (couldn't identify target flavor)");
  }

  // Known order slots: fill if available, otherwise report needsInfo.
  const slotMap: Record<string, string | undefined> = {
    "{order_id}": opts.known?.order_id,
    "{tracking_number}": opts.known?.tracking_number,
    "{address}": opts.known?.address,
    "{delivery_date}": opts.known?.delivery_date,
  };
  for (const [slot, val] of Object.entries(slotMap)) {
    if (!body.includes(slot)) continue;
    if (val) body = body.replaceAll(slot, val);
    else needsInfo.push(`${slot.replace(/[{}]/g, "")} (needs order management lookup)`);
  }
  for (const slot of ["{flavor_list}", "{宛名}"]) {
    if (body.includes(slot)) needsInfo.push(`${slot.replace(/[{}]/g, "")} (individual info required)`);
  }

  // Author-facing conditional placeholders ({…：example…} / {…case…}) are stripped from auto-drafts.
  body = body.replace(/\{[^{}]*(?:：|:|場合|例|記載|ここで案内)[^{}]*\}/g, "");

  // Prepend customer name as honorific salutation.
  if (opts.customerName) {
    body = `${opts.customerName} 様\n\n${body}`;
  }

  // Collapse extra blank lines.
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  // Fixed signature (assembled from master_signature.json). Instagram channel may omit when instagram_omit=true.
  const isInstagram = opts.channel === "Instagram";
  const omitForInstagram = isInstagram && kb.signature.instagram_omit;
  if (opts.includeSignature && !omitForInstagram) {
    body = `${body}\n\n${buildSignature(kb)}`;
  }

  return { draft: body, needsInfo, sources };
}
