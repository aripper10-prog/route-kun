
import { NextResponse } from "next/server";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const responseSchema = {
  type: "OBJECT",
  properties: {
    empathy_message: {
      type: "STRING",
      description:
        "焦りや迷走を抱えるユーザーを落ち着かせ、一歩ずつ登れば大丈夫と伝えるるーと君の一言（40〜70文字程度）",
    },
    summit_vision: {
      type: "STRING",
      description:
        "入力された最終地点を、達成イメージが湧くように少し具体化した山頂タイトル（30文字以内）",
    },
    checkpoints: {
      type: "ARRAY",
      description:
        "麓から山頂に至るまでの3段階の中継地点（必ず配列の0番目を2合目、1番目を5合目、2番目を8合目の順で出力すること）",
      items: {
        type: "OBJECT",
        properties: {
          stage: {
            type: "STRING",
            description: "合目表示（例：2合目、5合目、8合目）",
          },
          title: {
            type: "STRING",
            description: "その地点でクリアしている状態・見出し（18文字以内）",
          },
          detail: {
            type: "STRING",
            description: "具体的な通過ポイント（40文字以内）",
          },
        },
        required: ["stage", "title", "detail"],
      },
    },
    plan_a: {
      type: "OBJECT",
      description: "現在地（麓）から今日踏み出す最初の一歩（プランA）",
      properties: {
        action: { type: "STRING", description: "具体的な行動（35文字以内）" },
        duration: { type: "STRING", description: "目安時間（例：15分、30分など）" },
      },
      required: ["action", "duration"],
    },
    plan_b_micro: {
      type: "OBJECT",
      description: "足が重い時のプランB①：1分以内で終わる超・細分化アクション",
      properties: {
        action: {
          type: "STRING",
          description: "ハードルを極限まで下げた行動（例：求人サイトを開くだけ、メモに1行書くだけ）",
        },
        reason: { type: "STRING", description: "これだけでも登山が進む理由（35文字以内）" },
      },
      required: ["action", "reason"],
    },
    plan_b_rest: {
      type: "OBJECT",
      description: "足が重い時のプランB②：天候回復待ち（罪悪感ゼロの積極的休息）",
      properties: {
        action: {
          type: "STRING",
          description: "体力を回復するための具体的な休み方（例：画面を閉じて15分横になる）",
        },
        reason: { type: "STRING", description: "休むことが登頂に不可欠な理由（35文字以内）" },
      },
      required: ["action", "reason"],
    },
  },
  required: [
    "empathy_message",
    "summit_vision",
    "checkpoints",
    "plan_a",
    "plan_b_micro",
    "plan_b_rest",
  ],
};

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "サーバーに GEMINI_API_KEY が設定されていません。" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const goalInput = typeof body.goalInput === "string" ? body.goalInput.trim() : "";
    const previousPlan =
      typeof body.previousPlan === "string" ? body.previousPlan.trim() : "";

    if (!goalInput) {
      return NextResponse.json(
        { error: "目指したい最終地点（山頂）を入力してください。" },
        { status: 400 }
      );
    }

    const systemInstruction = `あなたは焦燥・迷走思考整理ツール「るーと君」の登山ガイドです。
ユーザーが入力した「最終地点（山頂）」から逆算（バックキャスト）し、現在地（麓）から無理なく登るための登山ルートを作成してください。
焦りや迷走を煽る表現・根性論は禁止です。穏やかで頼もしい山の案内人のようなトーンで出力してください。
checkpointsは必ず「2合目 → 5合目 → 8合目」の順で3要素出力してください。`;

    const userPrompt = previousPlan
      ? `目指す最終地点（山頂）：「${goalInput}」\n※前回は最初の一歩として「${previousPlan}」を提案しました。今回は別の登山ルート（異なる切り口やアプローチ）を作成してください。`
      : `目指す最終地点（山頂）：「${goalInput}」`;

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Gemini API Error:", errorText);
      return NextResponse.json(
        { error: "ルートの生成に失敗しました。少し時間をおいて再試行してください。" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json(
        { error: "ルートの生成結果が空でした。" },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(rawText);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Route Handler Error:", err);
    return NextResponse.json(
      { error: "予期しないエラーが発生しました。" },
      { status: 500 }
    );
  }
}
