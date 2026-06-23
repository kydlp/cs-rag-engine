// Category classification — keyword/trigger baseline.
// Deterministic, no API key needed, runnable for offline evaluation.
// A LLM classifier can be swapped in later without touching downstream code.

import type { Category } from "./types.ts";

interface Rule {
  category: Category;
  /** [keyword, weight] */
  keywords: [string, number][];
}

// Weights: 3=near-certain, 2=strong, 1=weak.
// Order = tiebreaker priority (first wins). More specific categories on top.
const RULES: Rule[] = [
  {
    category: "subscription_payment_fail",
    keywords: [["勝手にキャンセル", 3], ["解約した覚え", 3], ["覚えがない", 2], ["自動キャンセル", 3], ["勝手に解約", 3], ["キャンセルされました", 3], ["キャンセルされた", 3], ["注文がキャンセル", 3], ["なぜキャンセル", 2]],
  },
  {
    category: "subscription_cancel",
    keywords: [["解約", 3], ["解約したい", 3], ["退会", 2], ["やめたい", 2], ["定期便", 2], ["定期", 1]],
  },
  {
    category: "subscription_change",
    keywords: [["フレーバー変更", 3], ["期間限定商品", 2], ["期間限定", 2], ["次回", 2], ["変更したい", 2], ["定期便", 2], ["定期", 2], ["送付予定", 1]],
  },
  {
    category: "duplicate_shipping",
    keywords: [["2回", 3], ["二回", 3], ["重複", 3], ["二重", 3], ["2箱", 3], ["もう一箱", 3], ["同一商品", 3], ["2件", 3], ["2通", 3], ["同じ商品が", 2], ["2つ届", 3], ["発送通知が2", 2]],
  },
  {
    category: "email_missing",
    keywords: [["確認メール", 3], ["メールが来ない", 3], ["メールが届", 3], ["メールが来てい", 3], ["もう一度送", 2], ["再送", 2]],
  },
  {
    category: "receipt",
    keywords: [["領収書", 3], ["インボイス", 3], ["適格請求書", 3], ["宛名", 2]],
  },
  {
    category: "address_change_after",
    keywords: [["発送済", 3], ["発送後", 3], ["もう発送", 2], ["発送されてしまった", 3]],
  },
  {
    category: "address_change_before",
    keywords: [["住所変更", 3], ["送り先", 3], ["住所間違", 3], ["住所を変更", 3], ["送り先住所", 3], ["旧住所", 2], ["お届け先を変更", 3]],
  },
  {
    category: "shipping_delay",
    keywords: [["まだ届", 3], ["まだ発送", 3], ["いつ発送", 3], ["いつ届", 3], ["発送状況", 3], ["届きません", 3], ["届いていません", 3], ["まだ商品が", 2], ["どうなって", 2], ["どうなりました", 2], ["発送はされ", 2], ["遅い", 2], ["発送", 1], ["到着", 1]],
  },
  {
    category: "payment",
    // Co-occurrence weighting: bare "決済" is common in order-completion text, so weak;
    // co-occurring intent words ("決済方法", "決済できない") are strong.
    keywords: [
      ["支払い方法", 3], ["お支払い方法", 3], ["決済方法", 3],
      ["決済できな", 3], ["支払いできな", 3], ["決済できる", 3],
      ["決済が失敗", 3], ["決済エラー", 3], ["決済について", 3], ["支払いについて", 3],
      ["引き落とし", 3], ["引かれる", 2], ["前もって", 2],
      ["あと払い", 3], ["後払い", 3], ["送料", 3],
      ["コンビニ", 2], ["請求", 2], ["クレジット", 2], ["カード払い", 2], ["paypay", 2], ["payid", 2], ["pay id", 2],
      // bare terms are weakened to avoid misclassifying order-completion mentions.
      ["決済", 1], ["支払い", 1], ["お支払い", 1],
    ],
  },
  {
    category: "vending_install_request",
    keywords: [["設置したい", 3], ["設置希望", 3], ["設置を希望", 3], ["設置してほし", 3], ["設置依頼", 3], ["設置していただ", 3], ["設置できますか", 3], ["設置可能", 3], ["置きたい", 3], ["置いてほし", 3], ["導入したい", 3]],
  },
  {
    category: "vending_location",
    keywords: [["設置場所", 3], ["どこで買える", 3], ["どこで売って", 3], ["どこに売", 3], ["どこにある", 2], ["どこにあり", 2], ["販売場所", 2], ["自販機", 1], ["自動販売機", 1], ["店舗", 1]],
  },
  {
    category: "complaint_quality",
    keywords: [["違う商品", 3], ["注文と違", 3], ["足りない", 3], ["不足", 3], ["不良", 3], ["異物", 3], ["間違った商品", 3], ["代替が届かない", 3], ["プルタブ", 3], ["食べれな", 3], ["食べられな", 3], ["しか入って", 3], ["入っておりません", 3], ["入っていません", 3], ["になっていました", 3], ["割れ", 2], ["潰れ", 2], ["欠品", 2], ["開かない", 2], ["開けたら", 2], ["壊れて", 2], ["対応が遅い", 2]],
  },
  {
    category: "flavor_inquiry",
    keywords: [["味はあり", 3], ["味はまだ", 3], ["再販", 3], ["販売予定", 3], ["フレーバー", 2], ["終売", 2], ["販売してます", 2], ["どんな味", 2], ["種類", 1]],
  },
  {
    category: "product_inquiry",
    keywords: [["賞味期限", 3], ["日持ち", 3], ["何日持つ", 3], ["解凍", 3], ["原材料", 3], ["再冷凍", 3], ["保存", 2], ["保管", 2], ["冷凍", 2], ["冷蔵", 2], ["成分", 2], ["カロリー", 2], ["栄養", 2], ["生クリーム", 2], ["スポンジ", 2], ["組み合わせ", 2], ["1缶", 2], ["一缶", 2], ["単品", 2], ["値段", 2], ["価格", 2], ["ギフトボックス", 2], ["内祝", 2], ["中身", 1], ["セット", 1], ["贈り物", 1], ["サイズ", 1]],
  },
  {
    category: "other",
    keywords: [["海外", 3], ["international", 3], ["usa", 3], ["overseas", 3], ["日時指定", 3], ["時間指定", 3], ["キャンセルをお願い", 3], ["キャンセルお願い", 3], ["キャンセルしたい", 3], ["注文をキャンセル", 3], ["間違えて注文", 3], ["指定日", 2], ["購入してしまいました", 2], ["キャンセル", 2]],
  },
];

export interface Classification {
  category: Category;
  confidence: number;
  /** Debug: per-category scores. */
  scores: Partial<Record<Category, number>>;
}

export function classify(text: string): Classification {
  const t = text.toLowerCase();
  const scores: Partial<Record<Category, number>> = {};
  for (const rule of RULES) {
    let s = 0;
    for (const [kw, w] of rule.keywords) {
      if (t.includes(kw.toLowerCase())) s += w;
    }
    if (s > 0) scores[rule.category] = (scores[rule.category] ?? 0) + s;
  }

  let best: Category = "other";
  let bestScore = 0;
  for (const [cat, s] of Object.entries(scores) as [Category, number][]) {
    if (s > bestScore) {
      best = cat;
      bestScore = s;
    }
  }

  // Confidence: score 3 ≈ "near-certain" → 0.85; saturates above. Zero hits → low confidence.
  const confidence = bestScore === 0 ? 0.2 : Math.min(0.95, 0.4 + bestScore * 0.15);
  return { category: best, confidence, scores };
}
