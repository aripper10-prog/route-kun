"use client";

import React, { useEffect, useState } from "react";

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: SavedState = JSON.parse(raw);
        if (saved.goalInput) setGoalInput(saved.goalInput.slice(0, MAX_GOAL_LENGTH));
        if (saved.obstacleInput) {
          setObstacleInput(saved.obstacleInput.slice(0, MAX_OBSTACLE_LENGTH));
        }
        if (saved.routeData) setRouteData(saved.routeData);
        if (saved.branch) setBranch(saved.branch);
        if (saved.completed) setCompleted(saved.completed);
        if (Array.isArray(saved.consultHistory)) {
          setConsultHistory(saved.consultHistory);
        }
      }
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
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
    if (!trimmedGoal || loading) return;

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
        body: JSON.stringify({
          goalInput: trimmedGoal,
          obstacle: trimmedObstacle,
          previousPlan: isRegenerate && routeData ? routeData.plan_a.action : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登山ルートの作成に失敗しました。");
      }

      setRouteData(data);
      setIsDetourOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleAskConsult = async (targetQuestion: string) => {
    const trimmedQ = targetQuestion.trim().slice(0, MAX_CONSULT_LENGTH);
    if (!trimmedQ || !routeData || consultLoading) return;

    setConsultLoading(true);
    setConsultError(null);

    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "回答の取得に失敗しました。");
      }

      const newEntry: ConsultEntry = {
        id: `${Date.now()}`,
        question: trimmedQ,
        advice: data.advice,
        concrete_action: data.concrete_action,
        action_tip: data.action_tip,
      };

      setConsultHistory((prev) => [...prev, newEntry]);
      setConsultInput("");
    } catch (err) {
      setConsultError(
        err instanceof Error ? err.message : "通信エラーが発生しました。"
      );
    } finally {
      setConsultLoading(false);
    }
  };

  const handleGoalPresetClick = (preset: string) => {
    const clipped = preset.slice(0, MAX_GOAL_LENGTH);
    setGoalInput(clipped);
    generateRoute(clipped, obstacleInput, false);
  };

  const handleClear = () => {
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

          {(routeData || goalInput || obstacleInput) && (
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
                if (e.key === "Enter") {
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
                if (e.key === "Enter") {
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
              onClick={() => generateRoute(goalInput, obstacleInput, false)}
              className="shrink-0 text-xs font-semibold bg-white border border-rose-200 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition cursor-pointer"
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
                    ) : (
                      <span>「でも〇〇ができない…」という事情がありますか？</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDetourOpen(true)}
                    className="shrink-0 text-xs font-bold text-amber-800 hover:text-amber-950 bg-white border border-amber-300 hover:border-amber-400 px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    {obstacleInput.trim() ? "壁を修正・再計算" : "＋ できない理由を追加"}
                  </button>
                </div>
              ) : (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3.5 sm:p-4 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-amber-950">
                      🚧 立ちはだかる壁を追加・修正して迂回ルートを引き直す
                    </span>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <RemainingChars
                        current={obstacleInput.length}
                        max={MAX_OBSTACLE_LENGTH}
                      />
                      <button
                        type="button"
                        onClick={() => setIsDetourOpen(false)}
                        className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    maxLength={MAX_OBSTACLE_LENGTH}
                    value={obstacleInput}
                    onChange={(e) =>
                      setObstacleInput(e.target.value.slice(0, MAX_OBSTACLE_LENGTH))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        generateRoute(goalInput, obstacleInput, false);
                      }
                    }}
                    placeholder="例：電車に乗れない、外に出るのが怖い…"
                    className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {OBSTACLE_PRESETS.map((chip) => {
                      const isSelected = obstacleInput.includes(chip);
                      const isDisabled = !isSelected && !canAppendObstacleChip(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => toggleObstaclePreset(chip)}
                          className={`text-[11px] px-2 py-1 rounded-md border transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed ${
                            isSelected
                              ? "bg-amber-200 border-amber-500 text-amber-950 font-semibold"
                              : "bg-white text-slate-600 border-amber-200 hover:bg-amber-100/60"
                          }`}
                        >
                          {isSelected ? `✓ ${chip}` : `＋ ${chip}`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => generateRoute(goalInput, obstacleInput, false)}
                      className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl shadow-sm transition cursor-pointer"
                    >
                      この条件で迂回ルートを再計算
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative bg-gradient-to-br from-amber-50 via-white to-sky-50 border-2 border-amber-400 rounded-2xl p-4 sm:p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-200/80 px-2.5 py-0.5 rounded-full">
                    🚩 山頂（最終地点）
                  </span>
                  {routeData.route_badge && (
                    <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                      🧭 {routeData.route_badge}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => generateRoute(goalInput, obstacleInput, true)}
                  className="text-xs text-slate-400 hover:text-emerald-700 underline underline-offset-2 transition cursor-pointer"
                >
                  別ルートで引き直す
                </button>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                {routeData.summit_vision}
              </h2>
              <p className="text-xs text-slate-500 mt-1">目標：{goalInput}</p>
            </div>

            {descendingCheckpoints.map((cp, index) => (
              <React.Fragment key={`${cp.stage}-${index}`}>
                <ClimbArrowUp />
                <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 shadow-sm flex items-start gap-3">
                  <span className="shrink-0 text-xs font-extrabold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg mt-0.5">
                    {cp.stage}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">{cp.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{cp.detail}</p>
                  </div>
                </div>
              </React.Fragment>
            ))}

            <ClimbArrowUp label="ここから登り始める" />

            <div
              className={`rounded-2xl p-4 sm:p-5 border-2 transition ${
                branch === "plan_a"
                  ? "bg-emerald-50/80 border-emerald-500 shadow-md"
                  : branch === "plan_b"
                  ? "bg-slate-100/80 border-slate-200 opacity-65"
                  : "bg-white border-emerald-400 shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-extrabold tracking-wide text-white bg-emerald-600 px-2.5 py-0.5 rounded-full">
                  📍 現在地（麓）：最初の一歩
                </span>
                <span className="text-xs font-medium text-slate-500">
                  目安：{routeData.plan_a.duration}
                </span>
              </div>
              <p className="text-base font-bold text-slate-900 mt-1">
                {routeData.plan_a.action}
              </p>

              {branch === "plan_a" && (
                <div className="mt-4 pt-3 border-t border-emerald-200 flex items-center justify-between gap-2">
                  <span className="text-xs text-emerald-900 font-medium">
                    {completed === "plan_a"
                      ? "1合目クリア！素晴らしい一歩です。"
                      : "山頂を見上げつつ、まずはこれだけ"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCompleted(completed === "plan_a" ? "none" : "plan_a")
                    }
                    className={`shrink-0 text-xs font-bold px-3.5 py-1.5 rounded-lg transition cursor-pointer ${
                      completed === "plan_a"
                        ? "bg-emerald-600 text-white"
                        : "bg-white border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                    }`}
                  >
                    {completed === "plan_a" ? "✓ 一歩踏み出した！" : "完了にする"}
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2">
              <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 text-center">
                <p className="text-sm font-bold text-amber-950 mb-3">
                  今、この一歩を踏み出せそう？
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setBranch("plan_a");
                      if (completed !== "plan_a") setCompleted("none");
                    }}
                    className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold border-2 transition cursor-pointer ${
                      branch === "plan_a"
                        ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                        : "bg-white border-emerald-200 text-emerald-800 hover:border-emerald-400"
                    }`}
                  >
                    踏み出せる！（このルートへ）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBranch("plan_b");
                      if (completed === "plan_a") setCompleted("none");
                    }}
                    className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold border-2 transition cursor-pointer ${
                      branch === "plan_b"
                        ? "bg-amber-600 border-amber-600 text-white shadow-sm"
                        : "bg-white border-amber-300 text-amber-900 hover:border-amber-500"
                    }`}
                  >
                    今は足が重い…（プランBへ迂回）
                  </button>
                </div>
              </div>
            </div>

            {branch === "plan_b" && (
              <div className="pt-1">
                <div className="flex justify-center" aria-hidden="true">
                  <svg className="w-64 h-7 text-amber-400" viewBox="0 0 256 28" fill="none">
                    <path
                      d="M128 0 V10 H48 V28 M128 10 H208 V28"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    className={`rounded-2xl p-4 border-2 transition flex flex-col justify-between ${
                      completed === "b_micro"
                        ? "bg-sky-50 border-sky-500 shadow-sm"
                        : "bg-white border-sky-200"
                    }`}
                  >
                    <div>
                      <span className="inline-block text-xs font-bold text-sky-700 bg-sky-100 px-2.5 py-0.5 rounded-full mb-2">
                        迂回B-1：1分だけ進む
                      </span>
                      <p className="text-sm font-bold text-slate-900">
                        {routeData.plan_b_micro.action}
                      </p>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                        {routeData.plan_b_micro.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCompleted(completed === "b_micro" ? "none" : "b_micro")
                      }
                      className={`mt-4 w-full py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        completed === "b_micro"
                          ? "bg-sky-600 border-sky-600 text-white"
                          : "bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100"
                      }`}
                    >
                      {completed === "b_micro" ? "✓ 1分前進完了！" : "これならできた！"}
                    </button>
                  </div>

                  <div
                    className={`rounded-2xl p-4 border-2 transition flex flex-col justify-between ${
                      completed === "b_rest"
                        ? "bg-teal-50 border-teal-500 shadow-sm"
                        : "bg-white border-teal-200"
                    }`}
                  >
                    <div>
                      <span className="inline-block text-xs font-bold text-teal-700 bg-teal-100 px-2.5 py-0.5 rounded-full mb-2">
                        待機B-2：天候回復待ち（休息）
                      </span>
                      <p className="text-sm font-bold text-slate-900">
                        {routeData.plan_b_rest.action}
                      </p>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                        {routeData.plan_b_rest.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCompleted(completed === "b_rest" ? "none" : "b_rest")
                      }
                      className={`mt-4 w-full py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        completed === "b_rest"
                          ? "bg-teal-600 border-teal-600 text-white"
                          : "bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100"
                      }`}
                    >
                      {completed === "b_rest" ? "✓ ベースキャンプで休息中" : "堂々と休む！"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <section className="pt-5">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <span>💬</span>
                      <span>るーと君にさらに相談する（具体的な動き方を聞く）</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      「何て検索すればいい？」「メールの文面は？」など、迷う点を聞くと具体的な行動を提案します。
                    </p>
                  </div>
                  {consultHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setConsultHistory([])}
                      className="shrink-0 text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      履歴クリア
                    </button>
                  )}
                </div>

                {consultHistory.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {consultHistory.map((item) => (
                      <div
                        key={item.id}
                        className="bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5 space-y-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
                            あなた
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-slate-800">
                            {item.question}
                          </p>
                        </div>

                        <div className="pl-2 border-l-2 border-emerald-400 space-y-2">
                          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                            {item.advice}
                          </p>

                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                            <p className="text-[11px] font-extrabold text-emerald-800 mb-1">
                              ✨ こうしたらいいよ！（具体的な行動）
                            </p>
                            <p className="text-xs sm:text-sm font-bold text-slate-900 leading-relaxed select-all">
                              {item.concrete_action}
                            </p>
                            {item.action_tip && (
                              <p className="text-[11px] text-emerald-700 mt-1.5">
                                💡 {item.action_tip}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {consultError && (
                  <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {consultError}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {CONSULT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={consultLoading}
                      onClick={() => handleAskConsult(preset)}
                      className="text-xs bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-transparent hover:border-emerald-200 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-end">
                    <RemainingChars
                      current={consultInput.length}
                      max={MAX_CONSULT_LENGTH}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={MAX_CONSULT_LENGTH}
                      value={consultInput}
                      onChange={(e) =>
                        setConsultInput(e.target.value.slice(0, MAX_CONSULT_LENGTH))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAskConsult(consultInput);
                        }
                      }}
                      placeholder="例：問い合わせの文章を作って、どこを見ればいい？…"
                      className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                    />
                    <button
                      type="button"
                      disabled={!consultInput.trim() || consultLoading}
                      onClick={() => handleAskConsult(consultInput)}
                      className="shrink-0 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold text-xs sm:text-sm px-4 py-2 rounded-xl shadow-sm transition cursor-pointer disabled:cursor-not-allowed"
                    >
                      {consultLoading ? (
                        <>
                          <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          考え中…
                        </>
                      ) : (
                        "聞く"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
