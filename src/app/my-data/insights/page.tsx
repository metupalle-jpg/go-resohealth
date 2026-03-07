"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Send,
  CalendarHeart,
  RefreshCw,
  Loader2,
  Bot,
  User,
} from "lucide-react";
import InsightCard from "@/components/mydata/InsightCard";
import { getInsights, getHealthScore, askAI } from "@/lib/mydata-api";
import type { InsightItem, HealthScore } from "@/lib/mydata-types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { documentId: string; documentName: string; relevantExcerpt: string }[];
}

export default function InsightsPage() {
  // ── State ───────────────────────────────────────────────────
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch data ──────────────────────────────────────────────
  const fetchData = useCallback(async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      const [insightsResult, scoreResult] = await Promise.allSettled([
        getInsights(refresh),
        getHealthScore(),
      ]);

      if (insightsResult.status === "fulfilled") {
        setInsights(insightsResult.value.insights);
      }
      if (scoreResult.status === "fulfilled") {
        setHealthScore(scoreResult.value);
      }
    } catch (error) {
      console.error("Failed to fetch insights:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Scroll chat to bottom ───────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Dismiss insight ─────────────────────────────────────────
  const handleDismiss = (id: string) => {
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  // ── Ask AI ──────────────────────────────────────────────────
  const handleAsk = async () => {
    const q = question.trim();
    if (!q || isAsking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setIsAsking(true);

    try {
      const result = await askAI(q);
      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I couldn't process that question. Please try again.",
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  // ── Health Score Ring ───────────────────────────────────────
  const ScoreRing = ({ score }: { score: number }) => {
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (score / 100) * circumference;
    const color =
      score >= 75
        ? "text-emerald-500"
        : score >= 50
        ? "text-amber-500"
        : "text-red-500";

    return (
      <div className="relative inline-flex items-center justify-center">
        <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            className="stroke-gray-200"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`stroke-current ${color} transition-all duration-1000`}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={`text-2xl font-bold ${color}`}>{score}</span>
          <span className="text-[9px] text-gray-400">/ 100</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-2xl">
        <div className="space-y-6">
          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/my-data"
                className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                <h1 className="text-lg font-bold text-gray-800">AI Insights</h1>
              </div>
            </div>
            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* ── Loading state ───────────────────────────────── */}
          {isLoading ? (
            <div className="space-y-4">
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
              </div>
            </div>
          ) : (
            <>
              {/* ── Health Score ─────────────────────────────── */}
              {healthScore && (
                <div className="rounded-2xl bg-white p-5 shadow-sm text-center">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">
                    Overall Health Score
                  </h2>
                  <ScoreRing score={healthScore.overall} />

                  {/* Category scores */}
                  {healthScore.categories.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {healthScore.categories.map((cat) => (
                        <div
                          key={cat.category}
                          className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                        >
                          <span className="text-xs text-gray-600">{cat.category}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-semibold text-gray-800">
                              {cat.score}
                            </span>
                            <span
                              className={`text-[10px] ${
                                cat.trend === "up"
                                  ? "text-emerald-500"
                                  : cat.trend === "down"
                                  ? "text-red-500"
                                  : "text-gray-400"
                              }`}
                            >
                              {cat.trend === "up" ? "↑" : cat.trend === "down" ? "↓" : "→"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 mt-3">
                    Last updated:{" "}
                    {new Date(healthScore.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
              )}

              {/* ── Trend Charts Placeholder ────────────────── */}
              <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                <p className="text-xs text-gray-400">
                  Trend charts will appear here as more data is collected.
                </p>
                <p className="text-[10px] text-gray-300 mt-1">
                  Chart.js integration — coming soon
                </p>
              </div>

              {/* ── Insight Cards ────────────────────────────── */}
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Your Insights
                </h2>
                {insights.length > 0 ? (
                  insights.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onDismiss={handleDismiss}
                    />
                  ))
                ) : (
                  <div className="rounded-xl bg-gray-100 p-6 text-center">
                    <Sparkles className="h-6 w-6 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">
                      Upload more health records to generate personalized insights.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Ask a Question ───────────────────────────── */}
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  Ask a Question
                </h2>

                {/* Chat messages */}
                {chatMessages.length > 0 && (
                  <div className="mb-4 max-h-64 overflow-y-auto space-y-3 rounded-lg bg-gray-50 p-3">
                    {chatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-2 ${
                          msg.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        {msg.role === "assistant" && (
                          <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center">
                            <Bot className="h-3.5 w-3.5 text-purple-600" />
                          </div>
                        )}
                        <div
                          className={`rounded-xl px-3 py-2 max-w-[80%] ${
                            msg.role === "user"
                              ? "bg-teal-600 text-white"
                              : "bg-white border border-gray-200"
                          }`}
                        >
                          <p
                            className={`text-xs leading-relaxed ${
                              msg.role === "user" ? "text-white" : "text-gray-700"
                            }`}
                          >
                            {msg.content}
                          </p>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              <p className="text-[10px] text-gray-400">
                                Sources:
                              </p>
                              {msg.sources.map((src, idx) => (
                                <Link
                                  key={idx}
                                  href={`/my-data/documents/${src.documentId}`}
                                  className="block text-[10px] text-teal-600 hover:underline mt-0.5"
                                >
                                  {src.documentName}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                        {msg.role === "user" && (
                          <div className="flex-shrink-0 h-6 w-6 rounded-full bg-teal-100 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-teal-600" />
                          </div>
                        )}
                      </div>
                    ))}
                    {isAsking && (
                      <div className="flex gap-2">
                        <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center">
                          <Bot className="h-3.5 w-3.5 text-purple-600" />
                        </div>
                        <div className="rounded-xl bg-white border border-gray-200 px-3 py-2">
                          <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}

                {/* Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                    placeholder="e.g., What are my cholesterol trends?"
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm
                               text-gray-700 placeholder:text-gray-400
                               focus:border-purple-400 focus:ring-1 focus:ring-purple-400 focus:outline-none"
                  />
                  <button
                    onClick={handleAsk}
                    disabled={!question.trim() || isAsking}
                    className="rounded-xl bg-purple-600 px-3 py-2 text-white
                               hover:bg-purple-700 transition-colors disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Book Professional CTA ───────────────────────── */}
          <Link
            href="/bookings"
            className="flex items-center justify-between rounded-2xl
                       bg-gradient-to-r from-teal-600 to-teal-700 p-4 text-white shadow-lg"
          >
            <div className="flex items-center gap-3">
              <CalendarHeart className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">Book a Professional</p>
                <p className="text-[10px] text-teal-200">
                  Get your results reviewed by a specialist
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-white/60" />
          </Link>

          {/* ── Disclaimer ──────────────────────────────────── */}
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
            <p className="text-[10px] text-amber-700 text-center leading-relaxed">
              ⚠️ AI-generated insights are for informational purposes only and are
              not a substitute for professional medical advice, diagnosis, or
              treatment. Always consult a qualified healthcare provider.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
