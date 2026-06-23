// Send-gate decision. Implements the "safety floor + confidence + shadow rollout" policy:
//   1. Safety floor (highest, permanent): if the engine returned escalate=true, the message
//      MUST go to human approval regardless of AI confidence. This covers: foreign object/
//      health, refund/coupon/transfer, legal/strong complaint, vending install request,
//      duplicate-shipping final call, subscription payment failure, quality complaint,
//      KB expiry/UNKNOWN, and low confidence — all returned by escalation.ts.
//   2. Auto-send eligibility: only a low-risk allowlist of categories with no unresolved
//      slots, no KB notices, and confidence above the floor are predicted "auto_send".
//   3. Shadow mode (default ON): never actually auto-send — record what the AI WOULD have
//      sent (predictedMode) and compare against the human's final send to measure agreement.
//      Once a category proves out, the operator can turn shadow off per-category.

import type { Category } from "./types.ts";
import type { EngineResult } from "./types.ts";

export type SendMode = "auto_send" | "human_approval";

export interface GateOptions {
  /** Shadow mode (never actually send; route everything to human approval). Default: true. */
  shadow?: boolean;
  /** Categories eligible for auto-send. */
  autoSendCategories?: ReadonlySet<Category>;
  /** Minimum confidence for auto-send (0..1). */
  confidenceFloor?: number;
}

export interface GateDecision {
  /** What the AI would do if allowed to send autonomously. */
  predictedMode: SendMode;
  /** What actually happens. With shadow=true, always human_approval. */
  effectiveMode: SendMode;
  /** Did the safety floor (hard rule) force human approval? */
  safetyFloor: boolean;
  shadow: boolean;
  /** Decision reasons (for audit / agreement analysis). */
  reasons: string[];
}

// Default auto-send allowlist: only fact-based KB-backed categories where errors are
// low-impact. product_inquiry (shelf-life, storage), flavor_inquiry, vending_location.
// payment etc. is added later after shadow shows high agreement.
export const DEFAULT_AUTO_SEND_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  "product_inquiry",
  "flavor_inquiry",
  "vending_location",
]);

export const DEFAULT_CONFIDENCE_FLOOR = 0.7;

export function decideSend(result: EngineResult, options: GateOptions = {}): GateDecision {
  const shadow = options.shadow ?? true;
  const allow = options.autoSendCategories ?? DEFAULT_AUTO_SEND_CATEGORIES;
  const floor = options.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;

  const reasons: string[] = [];
  let predictedMode: SendMode = "auto_send";
  let safetyFloor = false;

  // 1. Safety floor.
  if (result.escalate) {
    predictedMode = "human_approval";
    safetyFloor = true;
    reasons.push(`safety floor: ${result.escalationReason || "must escalate"}`);
  } else if (result.needsInfo.length > 0) {
    // 2a. Draft still has unresolved slots (order_id / address / deadline).
    predictedMode = "human_approval";
    reasons.push(`unresolved slots: ${result.needsInfo.join(" / ")}`);
  } else if (result.notices.length > 0) {
    // 2b. KB freshness / operational notice (current_notice expired, UNKNOWN, etc.).
    predictedMode = "human_approval";
    reasons.push(`kb notice: ${result.notices.join(" / ")}`);
  } else if (!allow.has(result.category)) {
    // 2c. Category not in allowlist.
    predictedMode = "human_approval";
    reasons.push(`category not in auto-send allowlist (${result.category})`);
  } else if (result.confidence < floor) {
    // 2d. Confidence insufficient.
    predictedMode = "human_approval";
    reasons.push(`confidence below floor (${result.confidence.toFixed(2)} < ${floor})`);
  } else {
    reasons.push(`low-risk, high-confidence, KB-backed (${result.category}, conf=${result.confidence.toFixed(2)}) → auto_send`);
  }

  // 3. Shadow mode: predicted auto_send is recorded but the action is still human_approval.
  let effectiveMode: SendMode = predictedMode;
  if (shadow && predictedMode === "auto_send") {
    effectiveMode = "human_approval";
    reasons.push("shadow mode: do not auto-send; record predicted action and route to human approval");
  }

  return { predictedMode, effectiveMode, safetyFloor, shadow, reasons };
}
