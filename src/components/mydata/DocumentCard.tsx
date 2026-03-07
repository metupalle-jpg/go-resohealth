"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Clock,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { HealthDocument } from "@/lib/mydata-types";

// ── Category color map ───────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  Vitals: "bg-rose-100 text-rose-700",
  "Lab Results": "bg-blue-100 text-blue-700",
  Radiology: "bg-purple-100 text-purple-700",
  "Outpatient Notes": "bg-teal-100 text-teal-700",
  "Inpatient Notes": "bg-cyan-100 text-cyan-700",
  Medications: "bg-green-100 text-green-700",
  "Wellness Programs": "bg-emerald-100 text-emerald-700",
  Insurance: "bg-indigo-100 text-indigo-700",
  "Epigenetic BioAge": "bg-violet-100 text-violet-700",
  Nutrigenomics: "bg-lime-100 text-lime-700",
  "Genetic Testing": "bg-amber-100 text-amber-700",
  "Longevity Assessments": "bg-orange-100 text-orange-700",
};

interface DocumentCardProps {
  document: HealthDocument;
}

function StatusBadge({ status }: { status: HealthDocument["status"] }) {
  switch (status) {
    case "classified":
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" /> Error
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing
        </span>
      );
  }
}

export default function DocumentCard({ document }: DocumentCardProps) {
  const router = useRouter();
  const categoryColor =
    CATEGORY_COLORS[document.category] || "bg-gray-100 text-gray-700";

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return null;
    }
  };

  return (
    <button
      onClick={() => router.push(`/my-data/documents/${document.id}`)}
      className="w-full text-left rounded-xl border border-gray-200 bg-white p-4
                 hover:border-teal-300 hover:shadow-md transition-all duration-200
                 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
    >
      {/* Top row: category + status */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${categoryColor}`}>
          {document.category}
        </span>
        <StatusBadge status={document.status} />
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-gray-800 line-clamp-1 mb-1">
        {document.summary || document.fileName}
      </h3>

      {/* Summary */}
      {document.summary && document.summary !== document.fileName && (
        <p className="text-xs text-gray-500 line-clamp-2 mb-2">
          {document.summary}
        </p>
      )}

      {/* Key findings chips */}
      {document.keyFindings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {document.keyFindings.slice(0, 3).map((finding, idx) => (
            <span
              key={idx}
              className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"
            >
              {finding}
            </span>
          ))}
          {document.keyFindings.length > 3 && (
            <span className="text-[10px] text-gray-400">
              +{document.keyFindings.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDate(document.uploadedAt) || "Unknown date"}
        </span>
        {document.dateOfService && (
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Service: {formatDate(document.dateOfService)}
          </span>
        )}
        {document.providerName && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {document.providerName}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Skeleton variant ─────────────────────────────────────────────
export function DocumentCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 w-20 rounded-full bg-gray-200" />
        <div className="h-4 w-16 rounded bg-gray-200" />
      </div>
      <div className="h-4 w-3/4 rounded bg-gray-200 mb-2" />
      <div className="h-3 w-full rounded bg-gray-200 mb-1" />
      <div className="h-3 w-2/3 rounded bg-gray-200 mb-3" />
      <div className="flex gap-2">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-3 w-20 rounded bg-gray-200" />
      </div>
    </div>
  );
}
