// Escalation decision. Combines:
//   - Hard rules ("must escalate" categories from policy docs + template `escalated` flags)
//   - KB freshness (current_notice expired / UNKNOWN values)
//   - Classification confidence
// Customer auto-send is only permitted when escalate=false AND confidence is sufficient.

import type { Category } from "./types.ts";
import type { KnowledgeBase } from "./kb.ts";
import { noticeValid } from "./kb.ts";

export interface EscalationDecision {
  escalate: boolean;
  reason: string;
  /** Override category (e.g. foreign object → complaint_quality). */
  categoryOverride?: Category;
  notices: string[];
}

interface KeywordRule {
  match: string[];
  reason: string;
  categoryOverride?: Category;
}

// If any of these match the message body, escalate immediately (overrides classifier).
const HARD_ESCALATION: KeywordRule[] = [
  {
    match: ["異物", "虫が", "髪の毛", "毛が入", "カビ", "食中毒", "お腹を壊", "腹痛", "下痢", "嘔吐", "体調を崩", "蕁麻疹"],
    reason: "Foreign object / health complaint (must escalate: photo required → human judgement).",
    categoryOverride: "complaint_quality",
  },
  {
    match: ["弁護士", "訴え", "消費者センター", "消費生活センター", "法的", "警察", "詐欺", "金を返せ", "金返せ", "誠意"],
    reason: "Legal mention / strong complaint (must escalate: apology template only, human handles).",
  },
  {
    match: ["クーポン", "返金", "全額", "振込", "口座", "返品したい", "返品します"],
    reason: "Coupon issuance / refund / bank transfer (must escalate: monetary decisions are human-only).",
  },
  {
    match: ["ギフティング", "pr案件", "案件のご相談", "インフルエンサー", "コラボ", "タイアップ", "商品提供", "ご提供いただ"],
    reason: "Gifting / PR inquiry (must escalate: route to business contact).",
  },
  {
    match: ["妊娠", "妊婦", "授乳", "アレルギー", "アトピー", "加熱処理", "持病", "薬を飲んで"],
    reason: "Health / safety question (must escalate: only KB-confirmed facts may be returned).",
    categoryOverride: "product_inquiry",
  },
];

// Categories that always escalate (mirrors template `escalated=true`).
const ALWAYS_ESCALATE: Partial<Record<Category, string>> = {
  vending_install_request: "Vending machine installation request (must escalate: acknowledge only → human decision).",
  subscription_payment_fail: "Subscription auto-cancel (must escalate: distinguish in-house cancel vs credit error first).",
  complaint_quality: "Quality / mis-shipment complaint (must escalate: reshipment/refund decision + logistics handover).",
  // Duplicate shipping: a draft for the receive-OK case can be generated, but flag for human review.
  duplicate_shipping: "Duplicate shipping (must escalate: receive-OK guidance can be drafted, but return-handling is human-only).",
};

// Markers that hint at "I cancelled before but it didn't go through" — escalate.
const CANCEL_TROUBLE_MARKERS = ["お願いしていました", "お願いしておりました", "手続きをお願い", "したはず", "なのに", "まだ解約", "処理されて", "発送前の連絡", "連絡がきました"];
// Markers asking "what is in this month's subscription" — must check KB; UNKNOWN ⇒ escalate.
const SUB_CONTENT_QUERY = ["今月", "送付予定", "何になり", "内容は何", "次回の内容", "届く内容"];

const CONFIDENCE_FLOOR = 0.4;

export function decideEscalation(args: {
  text: string;
  category: Category;
  confidence: number;
  kb: KnowledgeBase;
  today: Date;
}): EscalationDecision {
  const { text, category, confidence, kb, today } = args;
  const t = text.toLowerCase();
  const notices: string[] = [];

  // 1. Hard escalation (highest priority).
  for (const rule of HARD_ESCALATION) {
    if (rule.match.some((m) => t.includes(m.toLowerCase()))) {
      return { escalate: true, reason: rule.reason, categoryOverride: rule.categoryOverride, notices };
    }
  }

  // 2. Duplicate shipping: receive-OK is AI-eligible; return/refusal is human-only.
  if (category === "duplicate_shipping") {
    if (["返品", "受け取りたくない", "受取拒否", "いらない", "返送"].some((m) => t.includes(m))) {
      return { escalate: true, reason: "Duplicate shipping with return/refusal request (must escalate: return handling is human-only).", notices };
    }
  }

  // 2.5 Cancellation inconsistency (claimed prior cancel didn't go through).
  if (category === "subscription_cancel" && CANCEL_TROUBLE_MARKERS.some((m) => text.includes(m))) {
    return { escalate: true, reason: "Past cancellation inconsistency (possible processing miss — payment/refund verification required).", notices };
  }

  // 3. Subscription new signup is closed → human handles individually.
  if (
    (category === "subscription_change" || category === "subscription_cancel" || category === "other") &&
    text.includes("定期便") &&
    ["新規", "申し込み", "申込", "始めた", "入りたい", "加入", "登録したい", "注文した", "注文しました", "終了して", "終わって"].some((m) => text.includes(m))
  ) {
    notices.push(`subscription new_signup_status: ${kb.subscription.subscription.new_signup_status}`);
    return { escalate: true, reason: "Subscription new signup closed / termination guidance (human handles individually).", notices };
  }

  // 4. Always-escalate category.
  const always = ALWAYS_ESCALATE[category];
  if (always) {
    return { escalate: true, reason: always, notices };
  }

  // 5. KB freshness: shipping deadline (current_notice) expired.
  if (category === "shipping_delay" && !noticeValid(kb, today)) {
    notices.push(`current_notice expired (valid_until=${kb.shipping.current_notice.valid_until}).`);
    return {
      escalate: true,
      reason: "Shipping deadline notice (current_notice) has expired. Verify latest schedule before responding.",
      notices,
    };
  }

  // 6. "What's in this month's subscription" asked but month is UNKNOWN → don't guess.
  if (category === "subscription_change" && SUB_CONTENT_QUERY.some((m) => text.includes(m))) {
    const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const contents = kb.subscription.subscription.monthly_contents[ym];
    if (typeof contents === "string") {
      notices.push(`${ym} subscription contents undefined: ${contents}`);
      return { escalate: true, reason: `${ym} subscription flavor lineup is UNKNOWN. Do not guess — confirm before responding.`, notices };
    }
  }

  // 7. Low classification confidence.
  if (confidence < CONFIDENCE_FLOOR) {
    return { escalate: true, reason: "Classification confidence below threshold (human verification required).", notices };
  }

  return { escalate: false, reason: "", notices };
}
