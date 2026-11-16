import { NextResponse } from "next/server";
import {
  checkSecurity,
  sanitizeUserText,
  needsImmediateRest,
  createRestPriorityRoute,
  SECURITY_SYSTEM_GUARD,
} from "@/lib/guard";

// Vercelのデフォルト10秒タイムアウトを回避（Hobbyプランでも最大60秒まで指定可能）
export const maxDuration = 30;

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const responseSchema = {
  type: "OBJECT",
  properties: {
    empathy_message: {
      type: "STRING",
      description:
        "ユーザーの不安や立ちはだかる壁（できない理由）を否定せず受け止め、『その条件ならこの迂回ルートで登ろう』と寄り添う一言（50〜90文字程度）",
    },
    route_badge: {
      type: "STRING",
      description:
        "ルートの種類を示す短いバッジ（壁がない場合は『標準登山ルート』、壁がある場合は『迂回ルート：在宅・低負荷』など15文字以内）",
    },
    summit_vision: {
      type: "STRING",
      description:
        "入力された最終地点を、達成イメージが湧くように少し具体化した山頂タイトル（30文字以内）",
    },
    checkpoints: {
      type: "ARRAY",
      // 必ず3要素（2合目・5合目・8合目）で返るようAPIレベルで強制
      minItems: 3,
      maxItems: 3,
      description:
        "麓から山頂に至るまでの3段階の中継地点（必ず配列の0番目を2合目、1番目を5合目、2番目を8合目の順で出力し、立ちはだかる壁にぶつからない代替手段にすること）",
      items: {
        type: "OBJECT",
        properties: {
          stage: {
            type: "STRING",
            description: "合目表示（2合目、5合目、8合目）",
          },
          title: {
            type: "STRING",
            description: "その地点でクリアしている状態・見出し（18文字以内）",
          },
          detail: {
            type: "STRING",
            description: "壁を回避しつつ進む具体的な通過ポイント（45文字以内）",
          },
        },
        required: ["stage", "title", "detail"],
      },
    },
    plan_a: {
      type: "OBJECT",
      description: "現在の制約（できない理由）の中でも無理なく踏み出せる最初の一歩（プランA）",
      properties: {
        action: { type: "STRING", description: "具体的な行動（40文字以内）" },
        duration: { type: "STRING", description: "目安時間（例：5分、15分など）" },
      },
      required: ["action", "duration"],
    },
    plan_b_micro: {
      type: "OBJECT",
      description: "それでも足が重い時のプランB①：1分以内で終わる超・細分化アクション",
      properties: {
        action: {
          type: "STRING",
          description: "ハードルを極限まで下げた行動（例：検索画面を開くだけ、メモに1行書くだけ）",
        },
        reason: { type: "STRING", description: "これだけでも登山が進む理由（40文字以内）" },
      },
      required: ["action", "reason"],
    },
    plan_b_rest: {
      type: "OBJECT",
      description: "それでも足が重い時のプランB②：天候回復待ち（罪悪感ゼロの積極的休息）",
      properties: {
        action: {
          type: "STRING",
          description: "体力を回復するための具体的な休み方（例：スマホを置いて15分横になる）",
        },
        reason: { type: "STRING", description: "休むことが登頂に不可欠な理由（40文字以内）" },
      },
      required: ["action", "reason"],
    },
  },
  required: [
    "empathy_message",
    "route_badge",
    "summit_vision",
    "checkpoints",
    "plan_a",
    "plan_b_micro",
    "plan_b_rest",
  ],
};

export async function POST(req: Request) {
  // 1. Originチェック＆IPベースの連打制限
  const blocked = checkSecurity(req);
  if (blocked) return blocked;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "サーバーに GEMINI_API_KEY が設定されていません。" },
      { status: 500 }
    );
  }

  // 2. 不正なJSONやオブジェクト以外のボディを 400 Bad Request で弾く
  let body: Record<string, unknown>;
  try {
    const parsedBody = await req.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json(
        { error: "リクエスト形式が正しくありません。" },
        { status: 400 }
      );
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "JSONの解析に失敗しました。" },
      { status: 400 }
    );
  }

  try {
    // 3. 入力データの型チェック＋無害化（タグ除去＋文字数制限）
    const rawGoal = typeof body.goalInput === "string" ? body.goalInput : "";
    const rawObstacle = typeof body.obstacle === "string" ? body.obstacle : "";
    const rawPrevious = typeof body.previousPlan === "string" ? body.previousPlan : "";

    const goalInput = sanitizeUserText(rawGoal, 100);
    const obstacle = sanitizeUserText(rawObstacle, 150);
    const previousPlan = sanitizeUserText(rawPrevious, 100);

    if (!goalInput) {
      return NextResponse.json(
        { error: "目指したい最終地点（山頂）を入力してください。" },
        { status: 400 }
      );
    }

    // 4. 限界サイン検知時はAIを通さず「休息優先ルート」を即座に返す
    if (needsImmediateRest(goalInput, obstacle)) {
      return NextResponse.json(createRestPriorityRoute());
    }

    // 5. 最優先の防御プロンプトを先頭に配置
    const systemInstruction = `${SECURITY_SYSTEM_GUARD}

あなたは焦燥・迷走思考整理ツール「るーと君」の登山ガイドです。
ユーザーが入力した「最終地点（山頂）」から逆算（バックキャスト）し、現在地（麓）から無理なく登るための登山ルートを作成してください。

【最重要ルール：立ちはだかる壁（できない理由）への配慮】
ユーザーから「立ちはだかる壁（できない理由・制約）」が入力されている場合、その壁に正面衝突する行動（例：「交通機関に乗れない」人に対する電車移動、「連絡が怖い」人に対するいきなりの電話など）は全ステップ・プランA・プランBから完全に除外してください。
代わりに、在宅・オンライン・テキスト連絡・第三者サポート・超スモールステップなど、その制約を抱えたままでも登れる「現実的な迂回ルート（別の登山口）」を設計してください。

【トーン＆フォーマット】
- 説教・根性論・無理な励ましは禁止。穏やかで頼もしい山の案内人のようなトーンで寄り添うこと。
- checkpointsは必ず「2合目 → 5合目 → 8合目」の順で3要素出力すること。`;

    // 6. ユーザー由来のデータを <user_input> タグ内に隔離（バックスラッシュ修正済み）
    const userPrompt = `<user_input>
  <goal>${goalInput}</goal>
  <obstacle>${obstacle || "特になし（ただし焦りや迷いがあるため無理のない歩幅で）"}</obstacle>
  ${previousPlan ? `<previous_plan>${previousPlan}</previous_plan>` : ""}
</user_input>`;

    // 7. APIキーはURLではなくヘッダーで渡し、maxDuration(30秒)より手前の25秒でタイムアウト制御
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(25000),
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
          // 思考プロセスをオフにしてレスポンス速度を高速化
          thinkingConfig: { thinkingBudget: 0 },
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
    if (err instanceof Error && err.name === "TimeoutError") {
      console.error("Gemini API Timeout");
      return NextResponse.json(
        { error: "ルートの生成に時間がかかりすぎています。もう一度お試しください。" },
        { status: 504 }
      );
    }

    console.error("Route Handler Error:", err);
    return NextResponse.json(
      { error: "予期しないエラーが発生しました。" },
      { status: 500 }
    );
  }
}
