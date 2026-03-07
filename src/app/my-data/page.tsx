"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  ChevronRight,
  CalendarHeart,
  RefreshCw,
} from "lucide-react";
import HealthVaultHeader from "@/components/mydata/HealthVaultHeader";
import UploadZone from "@/components/mydata/UploadZone";
import CategoryFilter from "@/components/mydata/CategoryFilter";
import DocumentList from "@/components/mydata/DocumentList";
import ExportPanel from "@/components/mydata/ExportPanel";
import { getDocuments, getInsights } from "@/lib/mydata-api";
import type {
  DocumentCategory,
  HealthDocument,
  InsightItem,
} from "@/lib/mydata-types";

const PAGE_SIZE = 10;

export default function MyDataPage() {
  // ── State ───────────────────────────────────────────────────
  const [documents, setDocuments] = useState<HealthDocument[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [activeFilters, setActiveFilters] = useState<DocumentCategory[]>([]);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // ── Fetch documents ─────────────────────────────────────────
  const fetchDocuments = useCallback(
    async (pageNum: number, append = false) => {
      try {
        if (!append) setIsLoading(true);
        else setIsLoadingMore(true);

        const result = await getDocuments({
          categories: activeFilters.length > 0 ? activeFilters : undefined,
          page: pageNum,
          pageSize: PAGE_SIZE,
          sortBy: "uploadedAt",
          sortOrder: "desc",
        });

        if (append) {
          setDocuments((prev) => [...prev, ...result.items]);
        } else {
          setDocuments(result.items);
        }
        setTotalDocs(result.total);
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [activeFilters]
  );

  // ── Fetch insights (preview) ────────────────────────────────
  const fetchInsights = useCallback(async () => {
    try {
      setInsightsLoading(true);
      const result = await getInsights();
      setInsights(result.insights.slice(0, 3)); // Show top 3
    } catch (error) {
      console.error("Failed to fetch insights:", error);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // ── Initial load ────────────────────────────────────────────
  useEffect(() => {
    setPage(1);
    fetchDocuments(1);
    fetchInsights();
  }, [fetchDocuments, fetchInsights]);

  // ── Polling for processing documents ────────────────────────
  useEffect(() => {
    const hasProcessing = documents.some(
      (doc) =>
        doc.status !== "classified" && doc.status !== "error"
    );

    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchDocuments(1);
    }, 10000);

    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  // ── Handlers ────────────────────────────────────────────────
  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchDocuments(nextPage, true);
  };

  const handleUploadComplete = () => {
    // Refresh the document list
    setPage(1);
    fetchDocuments(1);
  };

  const handleFilterChange = (filters: DocumentCategory[]) => {
    setActiveFilters(filters);
    setPage(1);
    // fetchDocuments will be called via useEffect dependency
  };

  const hasMore = documents.length < totalDocs;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-2xl lg:max-w-4xl">
        <div className="space-y-6">
          {/* ── Health Vault Header ─────────────────────────── */}
          <HealthVaultHeader />

          {/* ── Upload Zone ─────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Upload Documents
            </h2>
            <UploadZone onUploadComplete={handleUploadComplete} />
          </section>

          {/* ── Category Filter ─────────────────────────────── */}
          <section>
            <CategoryFilter
              activeFilters={activeFilters}
              onFilterChange={handleFilterChange}
            />
          </section>

          {/* ── Recent Activity ─────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                Recent Activity
              </h2>
              <button
                onClick={() => fetchDocuments(1)}
                className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>
            <DocumentList
              documents={documents}
              isLoading={isLoading}
              hasMore={hasMore}
              onLoadMore={handleLoadMore}
              isLoadingMore={isLoadingMore}
            />
          </section>

          {/* ── AI Insights Preview ─────────────────────────── */}
          <section>
            <Link
              href="/my-data/insights"
              className="block rounded-2xl bg-gradient-to-br from-purple-600 to-violet-700
                         p-5 text-white shadow-lg hover:shadow-xl transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  <h3 className="text-sm font-semibold">AI Health Insights</h3>
                </div>
                <ChevronRight className="h-4 w-4 text-white/60" />
              </div>
              {insightsLoading ? (
                <div className="space-y-2">
                  <div className="h-3 w-3/4 rounded bg-white/20 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-white/20 animate-pulse" />
                </div>
              ) : insights.length > 0 ? (
                <div className="space-y-1.5">
                  {insights.map((insight) => (
                    <p key={insight.id} className="text-xs text-purple-100">
                      • {insight.title}
                    </p>
                  ))}
                  <p className="text-[10px] text-purple-200 mt-2">
                    Tap to see all insights and ask questions →
                  </p>
                </div>
              ) : (
                <p className="text-xs text-purple-200">
                  Upload health records to get personalized AI insights.
                </p>
              )}
            </Link>
          </section>

          {/* ── Book Healthcare Professional ─────────────────── */}
          <section>
            <Link
              href="/bookings"
              className="flex items-center justify-between rounded-2xl border border-gray-200
                         bg-white p-4 shadow-sm hover:border-teal-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-teal-50 p-2.5">
                  <CalendarHeart className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Book a Healthcare Professional
                  </h3>
                  <p className="text-xs text-gray-500">
                    Get your results reviewed by a specialist
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </Link>
          </section>

          {/* ── Export Panel ─────────────────────────────────── */}
          <ExportPanel />

          {/* ── Disclaimer ──────────────────────────────────── */}
          <p className="text-center text-[10px] text-gray-400 pb-4">
            AI-generated summaries and insights are not medical advice.
            Always consult a healthcare professional.
          </p>
        </div>
      </div>
    </div>
  );
}
