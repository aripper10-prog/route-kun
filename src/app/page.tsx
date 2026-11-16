"use client";

import React, { useEffect, useRef, useState } from "react";

interface CheckpointItem {
  stage: string;
  title: string;
  detail: string;
}

interface RouteData {
  empathy_message: string;
  route_badge: string;
  summit_vision: string;
  checkpoints: CheckpointItem[];
  plan_a: {
    action: string;
    duration: string;
  };
  plan_b_micro: {
    action: string;
    reason: string;
  };
  plan_b_rest: {
    action: string;
    reason: string;
  };
}

interface ConsultEntry {
  id: string;
  question: string;
  advice: string;
  concrete_action: string;
  action_tip: string;
}

type BranchChoice = "none" | "plan_a" | "plan_b";
type CompletedChoice = "none" | "plan_a" | "b_micro" | "b_rest";

interface SavedState {
  goalInput: string;
  obstacleInput: string;
  routeData: RouteData | null;
  branch: BranchChoice;
  completed: CompletedChoice;
  consultHistory: ConsultEntry[];
}

const STORAGE_KEY = "route_kun_mountain_v3";

const MAX_GOAL_LENGTH = 100;
const MAX_OBSTACLE_LENGTH = 150;
const MAX_CONSULT_LENGTH = 200;
const CLIENT_TIMEOUT_MS = 30000;

const GOAL_PRESETS = [
  "就労移行事業所に通う",
  "納得のいく再就職をする",
  "生活を安定させて心に余裕を持つ",
  "作りたい作品・サービスを完成させる",
];

const OBSTACLE_PRESETS = [
  "外出・交通機関に乗るのがしんどい",
  "気力・体力が湧かず動けない",
  "電話や手続き・対人連絡が怖い",
  "何から手をつければいいか分からない",
  "お金や時間に余裕がない",
];

const CONSULT_PRESETS = [
  "最初の一歩、具体的に何て検索すればいい？",
  "不安で手が止まる時はどうしたらいい？",
  "もっと負荷を下げたやり方を教えて",
];

// localStorageやAPIレスポンスの構造が壊れていないか検証する型ガード
function isValidRouteData(data: unknown): data is RouteData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;

  if (
    typeof d.empathy_message !== "string" ||
    typeof d.summit_vision !== "string" ||
    !Array.isArray(d.checkpoints) ||
    d.checkpoints.length < 3
  ) {
    return false;
  }

  const checkpointsValid = d.checkpoints.every((cp) => {
    if (!cp || typeof cp !== "object") return false;
    const c = cp as Record<string, unknown>;
    return (
      typeof c.stage === "string" &&
      typeof c.title === "string" &&
      typeof c.detail === "string"
    );
  });
  if (!checkpointsValid) return false;

  const planA = d.plan_a as Record<string, unknown> | undefined;
  const planBMicro = d.plan_b_micro as Record<string, unknown> | undefined;
  const planBRest = d.plan_b_rest as Record<string, unknown> | undefined;

  return (
    typeof planA?.action === "string" &&
    typeof planA?.duration === "string" &&
    typeof planBMicro?.action === "string" &&
    typeof planBMicro?.reason === "string" &&
    typeof planBRest?.action === "string" &&
    typeof planBRest?.reason === "string"
  );
}

function isValidConsultEntry(item: unknown): item is ConsultEntry {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.question === "string" &&
    typeof e.advice === "string" &&
    typeof e.concrete_action === "string" &&
    typeof e.action_tip === "string"
  );
}

// HTMLエラーページ等でもクラッシュしない安全なJSONパーサー
async function parseJsonSafely(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    throw new Error(
      `サーバーの応答を正しく読み取れませんでした（ステータス: ${res.status}）。少し時間をおいて再試行してください。`
    );
  }
}

// 日本語変換（IME）確定時のEnter誤送信を判定
function isConfirmedEnterKey(e: React.KeyboardEvent<HTMLInputElement>): boolean {
  return (
    e.key === "Enter" &&
    !e.nativeEvent.isComposing &&
    e.keyCode !== 229
  );
}

function ClimbArrowUp({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1 text-emerald-600/70" aria-hidden="true">
      <svg className="h-4 w-4 -mb-1" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 6a.75.75 0 01.53.22l4.5 4.5a.75.75 0 01-1.06 1.06L10 7.81l-3.97 3.97a.75.75 0 01-1.06-1.06l4.5-4.5A.75.75 0 0110 6z"
          clipRule="evenodd"
        />
      </svg>
      <div className="h-5 w-0.5 bg-emerald-300" />
      {label && (
        <span className="text-[10px] font-medium text-slate-400 mt-0.5">{label}</span>
      )}
    </div>
  );
}

function RemainingChars({ current, max }: { current: number; max: number }) {
  const remaining = Math.max(0, max - current);
  const isLow = remaining <= 15;
  return (
    <span
      className={`text-[11px] tabular-nums ${
        isLow ? "text-amber-600 font-semibold" : "text-slate-400"
      }`}
    >
      あと {remaining}文字
    </span>
  );
}

export default function RouteKunPage() {
  const [goalInput, setGoalInput] = useState("");
  const [obstacleInput, setObstacleInput] = useState("");
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [branch, setBranch] = useState<BranchChoice>("none");
  const [completed, setCompleted] = useState<CompletedChoice>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [isDetourOpen, setIsDetourOpen] = useState(false);

  const [consultInput, setConsultInput] = useState("");
  const [consultHistory, setConsultHistory] = useState<ConsultEntry[]>([]);
  const [consultLoading, setConsultLoading] = useState(false);
  const [consultError, setConsultError] = useState<string | null>(null);

  // ダブルクリック等の瞬間的な二重送信を防ぐ同期ロック
  const isGeneratingRef = useRef(false);
  const isConsultingRef = useRef(false);

  // リセット・再送信・タイムアウト時に通信を中断するためのコントローラー
  const generateAbortRef = useRef<AbortController | null>(null);
  const consultAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedState>;
        if (typeof saved.goalInput === "string") {
          setGoalInput(saved.goalInput.slice(0, MAX_GOAL_LENGTH));
        }
        if (typeof saved.obstacleInput === "string") {
          setObstacleInput(saved.obstacleInput.slice(0, MAX_OBSTACLE_LENGTH));
        }
        if (isValidRouteData(saved.routeData)) {
          setRouteData(saved.routeData);
        }
        if (
          saved.branch === "none" ||
          saved.branch === "plan_a" ||
          saved.branch === "plan_b"
        ) {
          setBranch(saved.branch);
        }
        if (
          saved.completed === "none" ||
          saved.completed === "plan_a" ||
          saved.completed === "b_micro" ||
          saved.completed === "b_rest"
        ) {
          setCompleted(saved.completed);
        }
        if (Array.isArray(saved.consultHistory)) {
          setConsultHistory(saved.consultHistory.filter(isValidConsultEntry));
        }
      }
    } catch {
      // 破損データがあった場合は安全に破棄して初期化
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }

    return () => {
      generateAbortRef.current?.abort("unmount");
      consultAbortRef.current?.abort("unmount");
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const stateToSave: SavedState = {
        goalInput,
        obstacleInput,
        routeData,
        branch,
        completed,
        consultHistory,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // ignore
    }
  }, [goalInput, obstacleInput, routeData, branch, completed, consultHistory, hydrated]);

  const canAppendObstacleChip = (chip: string) => {
    if (obstacleInput.includes(chip)) return true;
    const parts = obstacleInput
      .split("／")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...parts, chip].join(" ／ ");
    return next.length <= MAX_OBSTACLE_LENGTH;
  };

  const toggleObstaclePreset = (chip: string) => {
    setObstacleInput((prev) => {
      const parts = prev
        .split("／")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.includes(chip)) {
        return parts.filter((p) => p !== chip).join(" ／ ");
      }
      const next = [...parts, chip].join(" ／ ");
      if (next.length > MAX_OBSTACLE_LENGTH) return prev;
      return next;
    });
  };

  const generateRoute = async (
    targetGoal: string,
    targetObstacle: string,
    isRegenerate = false
  ) => {
    const trimmedGoal = targetGoal.trim().slice(0, MAX_GOAL_LENGTH);
    const trimmedObstacle = targetObstacle.trim().slice(0, MAX_OBSTACLE_LENGTH);
    if (!trimmedGoal || isGeneratingRef.current || loading) return;

    isGeneratingRef.current = true;
    generateAbortRef.current?.abort("superseded");
    consultAbortRef.current?.abort("superseded");

    const controller = new AbortController();
    generateAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), CLIENT_TIMEOUT_MS);

    setLoading(true);
    setError(null);
    setBranch("none");
    setCompleted("none");
    setConsultHistory([]);
    setConsultError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          goalInput: trimmedGoal,
          obstacle: trimmedObstacle,
          previousPlan: isRegenerate && routeData ? routeData.plan_a.action : undefined,
        }),
      });

      const data = await parseJsonSafely(res);
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "登山ルートの作成に失敗しました。"
        );
      }

      if (!isValidRouteData(data)) {
        throw new Error("受信したルートデータの形式が正しくありません。再度お試しください。");
      }

      setRouteData(data);
      setIsDetourOpen(false);
    } catch (err) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === "timeout") {
          setError("通信がタイムアウトしました。電波状況をご確認のうえ再試行してください。");
        }
        return;
      }
      setError(err instanceof Error ? err.message : "通信エラーが発生しました。");
    } finally {
      clearTimeout(timeoutId);
      if (generateAbortRef.current === controller) {
        isGeneratingRef.current = false;
        setLoading(false);
      }
    }
  };

  const handleAskConsult = async (targetQuestion: string) => {
    const trimmedQ = targetQuestion.trim().slice(0, MAX_CONSULT_LENGTH);
    if (!trimmedQ || !routeData || isConsultingRef.current || consultLoading) return;

    isConsultingRef.current = true;
    consultAbortRef.current?.abort("superseded");

    const controller = new AbortController();
    consultAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), CLIENT_TIMEOUT_MS);

    setConsultLoading(true);
    setConsultError(null);

    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmedQ,
          goalInput: goalInput.trim().slice(0, MAX_GOAL_LENGTH),
          obstacle: obstacleInput.trim().slice(0, MAX_OBSTACLE_LENGTH),
          routeData,
          history: consultHistory.map((h) => ({
            question: h.question,
            advice: h.advice,
            concrete_action: h.concrete_action,
          })),
        }),
      });

      const data = await parseJsonSafely(res);
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "回答の取得に失敗しました。"
        );
      }

      if (
        typeof data.advice !== "string" ||
        typeof data.concrete_action !== "string"
      ) {
        throw new Error("回答データの形式が正しくありませんでした。");
      }

      const newEntry: ConsultEntry = {
        id: `${Date.now()}`,
        question: trimmedQ,
        advice: data.advice,
        concrete_action: data.concrete_action,
        action_tip: typeof data.action_tip === "string" ? data.action_tip : "",
      };

      setConsultHistory((prev) => [...prev, newEntry]);
      setConsultInput("");
    } catch (err) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === "timeout") {
          setConsultError("通信がタイムアウトしました。もう一度お試しください。");
        }
        return;
      }
      setConsultError(
        err instanceof Error ? err.message : "通信エラーが発生しました。"
      );
    } finally {
      clearTimeout(timeoutId);
      if (consultAbortRef.current === controller) {
        isConsultingRef.current = false;
        setConsultLoading(false);
      }
    }
  };

  const handleGoalPresetClick = (preset: string) => {
    const clipped = preset.slice(0, MAX_GOAL_LENGTH);
    setGoalInput(clipped);
    generateRoute(clipped, obstacleInput, false);
  };

  const handleClear = () => {
    // 進行中のAPI通信を即座にキャンセルして、リセット後の画面書き戻しを防止
    generateAbortRef.current?.abort("reset");
    consultAbortRef.current?.abort("reset");
    generateAbortRef.current = null;
    consultAbortRef.current = null;
    isGeneratingRef.current = false;
    isConsultingRef.current = false;

    setLoading(false);
    setConsultLoading(false);
    setGoalInput("");
    setObstacleInput("");
    setRouteData(null);
    setBranch("none");
    setCompleted("none");
    setError(null);
    setIsDetourOpen(false);
    setConsultHistory([]);
    setConsultInput("");
    setConsultError(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const descendingCheckpoints = routeData ? [...routeData.checkpoints].reverse() : [];

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50/70 via-slate-50 to-emerald-50/40 text-slate-800 py-8 px-4 sm:px-6">
      <div className="max-w-xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18L14 6l-4 7-3-4-4 11z" />
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-bold text-emerald-700 tracking-wide">
                焦燥・迷走思考整理ツール
              </p>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">るーと君</h1>
            </div>
          </div>

          {(routeData || goalInput || obstacleInput || loading) && (
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-slate-500 hover:text-slate-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              リセット
            </button>
          )}
        </header>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 mb-6 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="goal-input" className="text-sm font-bold text-slate-800">
                1. たどり着きたい最終地点（山頂）は？
              </label>
              <RemainingChars current={goalInput.length} max={MAX_GOAL_LENGTH} />
            </div>
            <input
              id="goal-input"
              type="text"
              maxLength={MAX_GOAL_LENGTH}
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value.slice(0, MAX_GOAL_LENGTH))}
              onKeyDown={(e) => {
                if (isConfirmedEnterKey(e)) {
                  e.preventDefault();
                  generateRoute(goalInput, obstacleInput, false);
                }
              }}
              placeholder="例：就労移行事業所に通う、再就職する、部屋を片付ける…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              {GOAL_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={loading}
                  onClick={() => handleGoalPresetClick(preset)}
                  className="text-xs bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-transparent hover:border-emerald-200 px-2.5 py-1 rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1 gap-2">
              <label htmlFor="obstacle-input" className="text-sm font-bold text-slate-800">
                2. いま立ちはだかる壁・できない理由
                <span className="ml-2 text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  任意
                </span>
              </label>
              <div className="flex items-center gap-2.5 shrink-0">
                {obstacleInput && (
                  <button
                    type="button"
                    onClick={() => setObstacleInput("")}
                    className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    壁をクリア
                  </button>
                )}
                <RemainingChars current={obstacleInput.length} max={MAX_OBSTACLE_LENGTH} />
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              事情を入れると、その壁にぶつからない<strong className="text-emerald-700 font-semibold">迂回ルート（別の登山口）</strong>を引きます。
            </p>
            <input
              id="obstacle-input"
              type="text"
              maxLength={MAX_OBSTACLE_LENGTH}
              value={obstacleInput}
              onChange={(e) =>
                setObstacleInput(e.target.value.slice(0, MAX_OBSTACLE_LENGTH))
              }
              onKeyDown={(e) => {
                if (isConfirmedEnterKey(e)) {
                  e.preventDefault();
                  generateRoute(goalInput, obstacleInput, false);
                }
              }}
              placeholder="例：パニック障害があり交通機関に乗れない、気力が湧かない…"
              className="w-full rounded-xl border border-amber-200/80 bg-amber-50/30 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              {OBSTACLE_PRESETS.map((chip) => {
                const isSelected = obstacleInput.includes(chip);
                const isDisabled = loading || (!isSelected && !canAppendObstacleChip(chip));
                return (
                  <button
                    key={chip}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => toggleObstaclePreset(chip)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed ${
                      isSelected
                        ? "bg-amber-100 border-amber-400 text-amber-900 font-semibold"
                        : "bg-slate-50 hover:bg-amber-50/70 text-slate-600 border-slate-200/80 hover:border-amber-200"
                    }`}
                  >
                    {isSelected ? `✓ ${chip}` : `＋ ${chip}`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-1 flex justify-end">
            <button
              type="button"
              disabled={!goalInput.trim() || loading}
              onClick={() => generateRoute(goalInput, obstacleInput, false)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-sm transition cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {obstacleInput.trim() ? "迂回ルートを設計中…" : "登山ルートを設計中…"}
                </>
              ) : obstacleInput.trim() ? (
                "迂回ルートを引く"
              ) : (
                "登山ルートを引く"
              )}
            </button>
          </div>
        </section>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 mb-6 flex items-center justify-between gap-3">
            <p className="text-sm">{error}</p>
            <button
              type="button"
              disabled={loading || !goalInput.trim()}
              onClick={() => generateRoute(goalInput, obstacleInput, false)}
              className="shrink-0 text-xs font-semibold bg-white border border-rose-200 hover:bg-rose-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition cursor-pointer"
            >
              再試行
            </button>
          </div>
        )}

        {routeData && !loading && (
          <div className="space-y-1">
            <div className="bg-white/95 border border-emerald-200 rounded-2xl p-3.5 mb-3 flex items-start gap-2.5 shadow-sm">
              <span className="shrink-0 text-xs font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-md mt-0.5">
                るーと君
              </span>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {routeData.empathy_message}
              </p>
            </div>

            <div className="mb-3">
              {!isDetourOpen ? (
                <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 text-xs text-amber-950 truncate">
                    {obstacleInput.trim() ? (
                      <span>
                        🚧 考慮中の壁：<strong>{obstacleInput}</strong>
                      </span>
