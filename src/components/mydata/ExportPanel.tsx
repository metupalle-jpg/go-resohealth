"use client";

import React, { useState } from "react";
import { Download, FileJson, Loader2, CheckCircle2 } from "lucide-react";
import { exportPDF, exportFHIR } from "@/lib/mydata-api";
import type { DocumentCategory, ExportOptions } from "@/lib/mydata-types";

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

export default function ExportPanel() {
  const [selectedCategories, setSelectedCategories] = useState<DocumentCategory[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingFHIR, setExportingFHIR] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const buildOptions = (format: "pdf" | "fhir"): ExportOptions => ({
    format,
    categories: selectedCategories.length > 0 ? selectedCategories : ALL_CATEGORIES,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });

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

  const handleExportPDF = async () => {
    setExportingPDF(true);
    setSuccess(null);
    try {
      const blob = await exportPDF(buildOptions("pdf"));
      downloadBlob(blob, `health-vault-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      setSuccess("PDF downloaded!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error("PDF export error:", error);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setExportingPDF(false);
    }
  };

  const handleExportFHIR = async () => {
    setExportingFHIR(true);
    setSuccess(null);
    try {
      const blob = await exportFHIR(buildOptions("fhir"));
      downloadBlob(blob, `health-vault-fhir-bundle-${new Date().toISOString().slice(0, 10)}.json`);
      setSuccess("FHIR Bundle downloaded!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error("FHIR export error:", error);
      alert("Failed to export FHIR Bundle. Please try again.");
    } finally {
      setExportingFHIR(false);
    }
  };

  const toggleCategory = (cat: DocumentCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800 mb-1">Export Your Data</h3>
      <p className="text-xs text-gray-500 mb-4">
        Download your health records as a PDF report or FHIR R4 bundle.
      </p>

      {/* Filter toggle */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="text-xs text-teal-600 hover:text-teal-700 mb-3 transition-colors"
      >
        {showFilters ? "Hide filters ▲" : "Customize export ▼"}
      </button>

      {/* Filters */}
      {showFilters && (
        <div className="mb-4 space-y-3 rounded-lg bg-gray-50 p-3">
          {/* Date range */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>

          {/* Category checkboxes */}
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Categories (all if none selected)</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    selectedCategories.includes(cat)
                      ? "border-teal-500 bg-teal-50 text-teal-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {success}
        </div>
      )}

      {/* Export buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleExportPDF}
          disabled={exportingPDF}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl
                     bg-teal-600 px-4 py-2.5 text-sm font-medium text-white
                     hover:bg-teal-700 transition-colors disabled:opacity-50"
        >
          {exportingPDF ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          PDF Report
        </button>
        <button
          onClick={handleExportFHIR}
          disabled={exportingFHIR}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl
                     border border-purple-300 bg-purple-50 px-4 py-2.5
                     text-sm font-medium text-purple-700 hover:bg-purple-100
                     transition-colors disabled:opacity-50"
        >
          {exportingFHIR ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileJson className="h-4 w-4" />
          )}
          FHIR Bundle
        </button>
      </div>
    </div>
  );
}
