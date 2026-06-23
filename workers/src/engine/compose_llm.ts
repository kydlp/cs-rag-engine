// KB-grounded LLM reply composer.
// Design: classification, escalation, slot resolution, and audit sources are reused from
// the deterministic compose.ts. The LLM is only responsible for tone polishing in keigo
// (formal Japanese). All facts come from the KB / templates — invention is forbidden.
// On API failure or no API key, falls back to compose() deterministically.
//
// Model: claude-sonnet-4-6 (quality-focused). Calls the Anthropic Messages API directly
// with fetch (the engine has zero deps; ANTHROPIC_BASE_URL proxy is supported).

import type { Category } from "./types.ts";
import type { KnowledgeBase } from "./kb.ts";
import { currentFlavors, noticeValid, formatJaDate, buildSignature } from "./kb.ts";
import { selectTemplate, compose, type ComposeOptions, type Composed } from "./compose.ts";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

/** Grounding context handed to the LLM. Facts MUST come from here. */
export interface GroundingContext {
  category: Category;
  customerText: string;
  channel?: string;
  customerName?: string;
  /** Reference template (style guide + must-have/must-not-have rules). */
  template?: { id: string; title: string; ux_enhanced: string; note?: string };
  /** Deterministically resolved facts (current_flavors etc.). */
  facts: Record<string, string>;
  /** Deterministic reference draft (fallback + tone basis). */
  referenceDraft: string;
  /** Unresolved slots (LLM MUST NOT invent; leave as [要確認: …]). */
  unresolved: string[];
}

// Product alias map (lookup hints — production version migrates aliases into the KB).
const PRODUCT_ALIASES: Record<string, string[]> = {
  "Vanilla Classic": ["plain", "regular", "ノーマル", "プレーン"],
  "Mint Cream": ["mint", "ミント"],
  "Strawberry Milk": ["strawberry", "いちご", "苺", "ストロベリー"],
  "Cherry Punch": ["cherry", "さくら", "桜"],
  "Mango": ["mango", "マンゴー"],
  "Lemon Zest": ["lemon", "レモン", "🍋"],
  "Matcha": ["matcha", "抹茶"],
};

/** Match products by canonical name or alias. */
function matchProducts(text: string, kb: KnowledgeBase): typeof kb.products.products {
  const t = text.toLowerCase();
  return kb.products.products.filter((p) => {
    if (t.includes(p.name.toLowerCase())) return true;
    for (const a of PRODUCT_ALIASES[p.name] ?? []) {
      if (t.includes(a.toLowerCase())) return true;
    }
    return false;
  });
}

/** Pull category-relevant facts from the KB. Masters are the sole source of truth. */
function collectFacts(category: Category, text: string, kb: KnowledgeBase, today: Date): Record<string, string> {
  const facts: Record<string, string> = {};
  facts["販売中フレーバー"] = currentFlavors(kb).join("、");

  const sellable = kb.products.products.find((p) => p.status.startsWith("販売中"));
  if (sellable?.shelf_life) facts["賞味期限/日持ち"] = sellable.shelf_life;

  // If the body matches a known product (canonical or alias), expose its status + notes.
  // Prevents the LLM from claiming a product is unavailable when the KB says otherwise.
  const matched = matchProducts(text, kb);
  if (matched.length) {
    facts["問い合わせ対象の商品"] = matched.map((p) =>
      `${p.name}（status="${p.status}"${p.notes ? `, 〔notes: ${p.notes}〕` : ""}）`,
    ).join(" / ");
  }

  if (category === "vending_location" || category === "vending_install_request") {
    // Include notes so the LLM honors operator instructions (e.g. mention multiple sites).
    facts["稼働中の自販機設置場所"] = kb.locations.locations
      .filter((l) => l.status === "稼働中")
      .map((l) => {
        const addr = l.address.replace(/詳細UNKNOWN/g, "").trim();
        const head = addr ? `${l.name}（${addr}）` : l.name;
        return l.notes ? `${head}〔notes: ${l.notes}〕` : head;
      })
      .join(" / ");
    // Removed locations are also flagged ("don't confuse with these").
    const removed = kb.locations.locations.filter((l) => l.status === "撤去済み");
    if (removed.length) {
      facts["過去に撤去された自販機（混同注意）"] = removed
        .map((l) => l.notes ? `${l.name}〔notes: ${l.notes}〕` : l.name)
        .join(" / ");
    }
  }
  if (category === "shipping_delay" && noticeValid(kb, today)) {
    facts["発送目安(current_notice)"] = `${formatJaDate(kb.shipping.current_notice.valid_until)}までに発送予定`;
  }
  if (category === "shipping_delay" || category === "address_change_before" || category === "address_change_after" || category === "duplicate_shipping") {
    facts["発送チャネル別の調整手段"] = kb.shipping.channels
      .map((c) => `${c.channel}: 日時指定=${c.date_time_specify ? "可" : "不可"}, alternative="${c.alternative}"`)
      .join(" / ");
  }
  if (category === "subscription_change" || category === "subscription_cancel") {
    facts["定期便_新規受付状態"] = kb.subscription.subscription.new_signup_status;
  }
  return facts;
}

/** Build the grounding context (pure, no API key needed, unit-testable). */
export function buildGroundingContext(
  category: Category,
  text: string,
  kb: KnowledgeBase,
  opts: ComposeOptions,
): { ctx: GroundingContext; det: Composed } {
  // Run the deterministic composer once → unified ref draft + unresolved slots + sources.
  const det = compose(category, text, kb, { ...opts, includeSignature: false });
  const tpl = selectTemplate(category, text, kb);
  const ctx: GroundingContext = {
    category,
    customerText: text,
    channel: opts.channel,
    customerName: opts.customerName,
    template: tpl ? { id: tpl.id, title: tpl.title, ux_enhanced: tpl.ux_enhanced, note: tpl.note } : undefined,
    facts: collectFacts(category, text, kb, opts.today),
    referenceDraft: det.draft,
    unresolved: det.needsInfo,
  };
  return { ctx, det };
}

const SYSTEM_PROMPT = [
  "あなたは食品ECブランドのカスタマーサポート担当です。",
  "顧客メッセージに対し、丁寧で温かい日本語の敬語で返信文を作成します。",
  "",
  "厳守ルール：",
  "1. 事実は『提供された事実・テンプレ』のみを使用する。記載のない事実（在庫・日付・価格・住所・注文番号・追跡番号）は推測・創作しない。",
  "2. テンプレの note（禁止事項・必須要素）を必ず守る（例：再冷凍を勧めない／終売フレーバーには代替提案を添える）。",
  "3. 提供された事実欄に `〔notes: …〕` が付随する項目があれば、その notes の指示を返信本文に必ず反映する。",
  "4. 未確定スロットの値は発明せず、`[要確認: 項目名]` のまま残す。",
  "5. 固定署名や会社情報は付けない（システムが後で付与する）。",
  "6. Instagram の場合のみ絵文字を使った柔らかい口調で可。それ以外は通常の敬語。",
  "7. テンプレの ux_enhanced を手本に、顧客の文面に合わせて自然に整える。前置きの説明やメタ発言は書かず、返信本文だけを出力する。",
].join("\n");

function buildUserPrompt(ctx: GroundingContext): string {
  const lines: string[] = [];
  lines.push(`# 顧客メッセージ\n${ctx.customerText}`);
  lines.push(`\n# チャネル\n${ctx.channel ?? "unknown"}`);
  if (ctx.customerName) lines.push(`\n# 宛名\n${ctx.customerName} 様`);
  if (Object.keys(ctx.facts).length) {
    lines.push("\n# 提供された事実（これ以外の事実を述べない）");
    for (const [k, v] of Object.entries(ctx.facts)) lines.push(`- ${k}: ${v}`);
  }
  if (ctx.template) {
    lines.push(`\n# 手本テンプレ（${ctx.template.id} ${ctx.template.title}）\n${ctx.template.ux_enhanced}`);
    if (ctx.template.note) lines.push(`\n# テンプレの厳守事項(note)\n${ctx.template.note}`);
  }
  lines.push(`\n# 参照下書き（整文の土台。事実はこの範囲を超えない）\n${ctx.referenceDraft}`);
  if (ctx.unresolved.length) {
    lines.push(`\n# 未確定スロット（値を発明せず [要確認: …] で残す）\n- ${ctx.unresolved.join("\n- ")}`);
  }
  lines.push("\n上記に基づき、返信本文のみを日本語で出力してください（署名・会社情報は不要）。");
  return lines.join("\n");
}

/** Is an LLM call possible? */
export function llmAvailable(): boolean {
  if (process.env.CS_DISABLE_LLM === "1") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function callClaude(system: string, user: string, signal?: AbortSignal): Promise<string | null> {
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (process.env.ANTHROPIC_API_KEY) {
    headers["x-api-key"] = process.env.ANTHROPIC_API_KEY;
  } else if (process.env.ANTHROPIC_AUTH_TOKEN) {
    headers["authorization"] = `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { effort: "medium" },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (data.stop_reason === "refusal") return null;
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

export interface ComposeLLMResult extends Composed {
  /** Did the LLM produce the body? (false = deterministic fallback.) */
  usedLLM: boolean;
}

/** Polish with Claude; fall back to deterministic compose on failure. */
export async function composeLLM(
  category: Category,
  text: string,
  kb: KnowledgeBase,
  opts: ComposeOptions,
): Promise<ComposeLLMResult> {
  const { ctx, det } = buildGroundingContext(category, text, kb, opts);
  const includeSignature = opts.includeSignature ?? true;
  const isInstagram = opts.channel === "Instagram";

  let body: string | null = null;
  if (llmAvailable()) {
    try {
      body = await callClaude(SYSTEM_PROMPT, buildUserPrompt(ctx));
    } catch (err) {
      console.error(`[composeLLM] fallback (${(err as Error).message})`);
      body = null;
    }
  }

  if (!body) {
    return { draft: det.draft + signatureSuffix(kb, includeSignature, isInstagram), needsInfo: det.needsInfo, sources: det.sources, usedLLM: false };
  }

  // If the LLM didn't include the salutation, prepend it (same policy as compose()).
  if (opts.customerName && !body.startsWith(`${opts.customerName} 様`)) {
    body = `${opts.customerName} 様\n\n${body}`;
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim() + signatureSuffix(kb, includeSignature, isInstagram);
  return { draft: body, needsInfo: det.needsInfo, sources: det.sources, usedLLM: true };
}

function signatureSuffix(kb: KnowledgeBase, includeSignature: boolean, isInstagram: boolean): string {
  if (!includeSignature) return "";
  if (isInstagram && kb.signature.instagram_omit) return "";
  return `\n\n${buildSignature(kb)}`;
}
