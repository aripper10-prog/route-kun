
import { NextResponse } from "next/server";
import {
  checkSecurity,
  sanitizeUserText,
  needsImmediateRest,
  createRestPriorityConsult,
  SECURITY_SYSTEM_GUARD,
} from "@/lib/guard";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const consultSchema = {
  type: "OBJECT",
  properties: {
    advice: {
      type: "STRING",
      description:
        "ユーザーの疑問や不安を受け止めつつ、現状の制約（立ちはだかる壁）に寄り添って答えるアドバイス（80〜160文字程度）",
    },
    concrete_action: {
      type: "STRING",
      description:
        "『こうしたらいいよ！』と背中を押す、今すぐそのまま真似できる具体的な行動（具体的な検索キーワード、メモに書く項目、短いメッセージ文例など。50〜120文字程度）",
    },
    action_tip: {
      type: "STRING",
      description:
        "気負わずにやるためのワンポイント補足（35文字以内）",
    },
  },
  required: ["advice", "concrete_action", "action_tip"],
};

interface ConsultHistoryItem {
  question: string;
  advice: string;
  concrete_action: string;
}

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

  try {
    const body = await req.json();

    // 2. 入力データの無害化（タグ除去＋文字数制限）
    const question = sanitizeUserText(body.question, 200);
    const goalInput = sanitizeUserText(body.goalInput, 100);
    const obstacle = sanitizeUserText(body.obstacle, 150);

    if (!question) {
      return NextResponse.json(
        { error: "相談したい内容を入力してください。" },
        { status: 400 }
      );
    }

    // 3. 限界サイン検知時はAIを通さず「休息の提示」を即座に返す
    if (needsImmediateRest(question)) {
      return NextResponse.json(createRestPriorityConsult());
    }

    // ルート情報も改ざん対策としてサニタイズ
    const rawRoute =
      typeof body.routeData === "object" && body.routeData !== null
        ? body.routeData
        : null;
    const summitVision = sanitizeUserText(rawRoute?.summit_vision, 100);
    const planAAction = sanitizeUserText(rawRoute?.plan_a?.action, 100);
    const planBMicroAction = sanitizeUserText(rawRoute?.plan_b_micro?.action, 100);

    // 過去の相談履歴（直近4件）もすべて無害化
    const rawHistory: unknown[] = Array.isArray(body.history)
      ? body.history.slice(-4)
      : [];
    const safeHistory: ConsultHistoryItem[] = rawHistory
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item) => ({
        question: sanitizeUserText(item.question, 200),
        advice: sanitizeUserText(item.advice, 300),
        concrete_action: sanitizeUserText(item.concrete_action, 200),
      }))
      .filter((item) => item.question.length > 0);

    // 4. 最優先の防御プロンプトを先頭に配置
    const systemInstruction = `${SECURITY_SYSTEM_GUARD}

あなたは焦燥・迷走思考整理ツール「るーと君」の登山ガイドです。
ユーザーは現在、提示された登山ルートを見ながら「具体的にどう動けばいいか」「不安な点をどう乗り越えるか」を追加で相談しています。

【回答のルール】
1. ユーザーの「立ちはだかる壁（できない理由）」を絶対に無視せず、その制約の中でも無理なくできる現実的な方法だけを答えてください。
2. 抽象的な精神論（「頑張ろう」「調べてみよう」だけ）は禁止です。
3. concrete_action（こうしたらいいよ！）には、スマホでそのまま打ち込める検索ワード、そのまま使える相談テンプレート、1分で終わる超具体的な手順など「迷わず動ける具体策」を必ず書いてください。`;

    // 5. ユーザー由来のデータをすべて <user_input> タグ内に隔離
    const historyBlock =
      safeHistory.length > 0
        ? safeHistory
            .map(
              (h, i) =>
                `  <turn index="${i + 1}">\n    <q>${h.question}</q>\n    <a>${h.advice}（具体策: ${h.concrete_action}）</a>\n  </turn>`
            )
            .join("\n")
        : "  なし";

    const userPrompt = `<user_input>
  <current_route>
    <goal>${goalInput || "未設定"}</goal>
    <obstacle>${obstacle || "特になし"}</obstacle>
    ${summitVision ? `<summit_vision>\${summitVision}</summit_vision>` : ""}
    ${planAAction ? `<plan_a>${planAAction}</plan_a>` : ""} ${planBMicroAction ? `<plan_b_micro>${planBMicroAction}</plan_b_micro>` : ""}
  </current_route>
  <history>
${historyBlock}
  </history>
  <new_question>${question}</new_question>
</user_input>`;

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
          responseSchema: consultSchema,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Gemini Consult API Error:", errorText);
      return NextResponse.json(
        { error: "回答の取得に失敗しました。少し時間をおいて再試行してください。" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json(
        { error: "回答結果が空でした。" },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(rawText);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Consult Handler Error:", err);
    return NextResponse.json(
      { error: "予期しないエラーが発生しました。" },
      { status: 500 }
    );
  }
}
