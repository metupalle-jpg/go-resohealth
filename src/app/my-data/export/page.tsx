"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileJson,
  Loader2,
  CheckCircle2,
  Share2,
  FileText,
} from "lucide-react";
import {
  exportPDF,
  exportFHIR,
  getDocuments,
  createShareLink,
} from "@/lib/mydata-api";
import type { DocumentCategory, ExportFormat } from "@/lib/mydata-types";

const ALL_CATEGORIES: DocumentCategory[] = [
  "Vitals",
  "Lab Results",
  "Radiology",
  "Outpatient Notes",
  "Inpatient Notes",
  "Medications",
  "Wellness Programs",
  "Insurance",
  "Epigenetic BioAge",
  "Nutrigenomics",
  "Genetic Testing",
  "Longevity Assessments",
];

export default function ExportPage() {
  // ── State ───────────────────────────────────────────────────
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [selectedCategories, setSelectedCategories] = useState<DocumentCategory[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(true);

  // ── Fetch category counts ───────────────────────────────────
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        setLoadingCounts(true);
        const result = await getDocuments({ pageSize: 1000 });
        const counts: Record<string, number> = {};
        result.items.forEach((doc) => {
          counts[doc.category] = (counts[doc.category] || 0) + 1;
        });
        setCategoryCounts(counts);
      } catch (err) {
        console.error("Failed to fetch counts:", err);
      } finally {
        setLoadingCounts(false);
      }
    };
    fetchCounts();
  }, []);

  // ── Helpers ─────────────────────────────────────────────────
  const toggleCategory = (cat: DocumentCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const categoriesToExport =
    selectedCategories.length > 0 ? selectedCategories : ALL_CATEGORIES;

  const totalDocuments = categoriesToExport.reduce(
    (sum, cat) => sum + (categoryCounts[cat] || 0),
    0
  );

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Generate export ─────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    setSuccess(null);
    setShareUrl(null);

    const options = {
      format,
      categories: categoriesToExport,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    };

    try {
      if (format === "pdf") {
        const blob = await exportPDF(options);
        downloadBlob(
          blob,
          `health-vault-report-${new Date().toISOString().slice(0, 10)}.pdf`
        );
        setSuccess("PDF report downloaded successfully!");
      } else {
        const blob = await exportFHIR(options);
        downloadBlob(
          blob,
          `health-vault-fhir-${new Date().toISOString().slice(0, 10)}.json`
        );
        setSuccess("FHIR R4 Bundle downloaded successfully!");
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Generate share link ─────────────────────────────────────
  const handleShare = async () => {
    setIsSharing(true);
    try {
      const result = await createShareLink({
        format,
        categories: categoriesToExport,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        expiresInHours: 72,
      });
      setShareUrl(result.shareUrl);
      await navigator.clipboard.writeText(result.shareUrl);
      setSuccess("Share link copied to clipboard!");
    } catch (err) {
      console.error("Share failed:", err);
      alert("Failed to create share link.");
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-2xl">
        <div className="space-y-6">
          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <Link
              href="/my-data"
              className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-bold text-gray-800">Export Data</h1>
          </div>

          {/* ── Format Selection ─────────────────────────────── */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Export Format</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat("pdf")}
                className={`rounded-xl p-4 border-2 text-left transition-all ${
                  format === "pdf"
                    ? "border-teal-500 bg-teal-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <Download
                  className={`h-6 w-6 mb-2 ${
                    format === "pdf" ? "text-teal-600" : "text-gray-400"
                  }`}
                />
                <p
                  className={`text-sm font-semibold ${
                    format === "pdf" ? "text-teal-700" : "text-gray-700"
                  }`}
                >
                  PDF Report
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Human-readable report with summaries
                </p>
              </button>
              <button
                onClick={() => setFormat("fhir")}
                className={`rounded-xl p-4 border-2 text-left transition-all ${
                  format === "fhir"
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <FileJson
                  className={`h-6 w-6 mb-2 ${
                    format === "fhir" ? "text-purple-600" : "text-gray-400"
                  }`}
                />
                <p
                  className={`text-sm font-semibold ${
                    format === "fhir" ? "text-purple-700" : "text-gray-700"
                  }`}
                >
                  FHIR R4 Bundle
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Machine-readable healthcare standard
                </p>
              </button>
            </div>
          </div>

          {/* ── Category Selection ───────────────────────────── */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Categories{" "}
              <span className="font-normal text-gray-400">
                (all if none selected)
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((cat) => {
                const count = categoryCounts[cat] || 0;
                const isSelected = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                      isSelected
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {cat}
                    <span
                      className={`text-[10px] ${
                        isSelected ? "text-teal-500" : "text-gray-400"
                      }`}
                    >
                      {loadingCounts ? "…" : count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Date Range ───────────────────────────────────── */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Date Range</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700
                             focus:border-teal-400 focus:ring-1 focus:ring-teal-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700
                             focus:border-teal-400 focus:ring-1 focus:ring-teal-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* ── Preview ──────────────────────────────────────── */}
          <div className="rounded-xl bg-white p-4 border border-gray-200 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Export Preview
            </h3>
            {loadingCounts ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Counting documents...
              </div>
            ) : (
              <div className="space-y-1.5">
                {categoriesToExport.map((cat) => {
                  const count = categoryCounts[cat] || 0;
                  if (count === 0) return null;
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-600 flex items-center gap-1.5">
                        <FileText className="h-3 w-3 text-gray-400" />
                        {cat}
                      </span>
                      <span className="text-gray-800 font-medium">
                        {count} document{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  );
                })}
                <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between text-sm">
                  <span className="font-semibold text-gray-700">Total</span>
                  <span className="font-bold text-gray-800">{totalDocuments}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Success message ───────────────────────────────── */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {success}
            </div>
          )}

          {/* ── Share URL ────────────────────────────────────── */}
          {shareUrl && (
            <div className="rounded-lg bg-gray-100 px-3 py-2">
              <p className="text-[10px] text-gray-500 mb-1">Share Link (expires in 72h):</p>
              <code className="text-xs text-gray-700 break-all">{shareUrl}</code>
            </div>
          )}

          {/* ── Action buttons ───────────────────────────────── */}
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={isExporting || totalDocuments === 0}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                format === "pdf"
                  ? "bg-teal-600 text-white hover:bg-teal-700"
                  : "bg-purple-600 text-white hover:bg-purple-700"
              }`}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : format === "pdf" ? (
                <Download className="h-4 w-4" />
              ) : (
                <FileJson className="h-4 w-4" />
              )}
              {isExporting
                ? "Generating..."
                : format === "pdf"
                ? "Download PDF Report"
                : "Download FHIR Bundle"}
            </button>
            <button
              onClick={handleShare}
              disabled={isSharing || totalDocuments === 0}
              className="rounded-xl border border-gray-200 px-4 py-3 text-gray-600
                         hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isSharing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
