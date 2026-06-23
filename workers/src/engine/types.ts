// CS reply engine — type definitions.
// Inquiry → (escalate, draft) contract. UI/adapter layers depend only on these
// types so the engine internals can be swapped out freely.

/** Inquiry categories (derived from the FAQ + template inventory). */
export type Category =
  | "product_inquiry"
  | "flavor_inquiry"
  | "payment"
  | "subscription_change"
  | "subscription_cancel"
  | "subscription_payment_fail"
  | "shipping_delay"
  | "address_change_before"
  | "address_change_after"
  | "receipt"
  | "duplicate_shipping"
  | "email_missing"
  | "vending_location"
  | "vending_install_request"
  | "complaint_quality"
  | "other";

/** Inbound channel. Used for signature / tone routing. */
export type Channel =
  | "BASE"
  | "Shopify"
  | "メール"
  | "LINE"
  | "LINEギフト"
  | "Instagram"
  | "フォーム"
  | "unknown";

/** Engine input. */
export interface Inquiry {
  /** Customer message body. */
  text: string;
  /** Inbound channel ("unknown" if not detected). */
  channel?: Channel;
  /** Customer name (for {customer_name} slot; optional). */
  customerName?: string;
  /** Known order info (masked is fine; used for slot filling). */
  known?: Partial<Record<"order_id" | "tracking_number" | "address" | "delivery_date", string>>;
}

/** Audit/UI source — what was used to compose the draft. */
export interface Source {
  kind: "template" | "kb";
  id: string;
  title?: string;
}

/** Engine output. */
export interface EngineResult {
  category: Category;
  /** Human approval required? (true ⇒ never auto-send to customer.) */
  escalate: boolean;
  /** Escalation reason (required when escalate=true). */
  escalationReason: string;
  /** Reply draft (still produced for escalated cases as a reference). */
  draft: string;
  /** Slots a human/system must fill before the draft can be sent. */
  needsInfo: string[];
  /** Audit sources for the draft. */
  sources: Source[];
  /** Classification confidence 0..1 (below the floor ⇒ escalate). */
  confidence: number;
  /** KB freshness / operational notices (current_notice expired, UNKNOWN values, etc.). */
  notices: string[];
}
