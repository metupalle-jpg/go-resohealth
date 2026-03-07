"use client";

import React, { useState } from "react";
import { FileText, ArrowUpDown } from "lucide-react";
import DocumentCard, { DocumentCardSkeleton } from "./DocumentCard";
import type { HealthDocument } from "@/lib/mydata-types";

interface DocumentListProps {
  documents: HealthDocument[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore?: boolean;
}

type SortOption = "newest" | "oldest" | "category";

export default function DocumentList({
  documents,
  isLoading,
  hasMore,
  onLoadMore,
  isLoadingMore = false,
}: DocumentListProps) {
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  // ── Sort documents ──────────────────────────────────────────
  const sortedDocuments = [...documents].sort((a, b) => {
    switch (sortBy) {
      case "newest":
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      case "oldest":
        return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
      case "category":
        return a.category.localeCompare(b.category);
      default:
        return 0;
    }
  });

  // ── Loading state ───────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <DocumentCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
        <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-600 mb-1">No records yet</p>
        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          Upload documents or receive outpatient notes from your healthcare
          professional to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sort controls */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="text-xs text-gray-600 bg-transparent border-none focus:ring-0 cursor-pointer pr-6"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="category">By category</option>
          </select>
        </div>
      </div>

      {/* Document cards */}
      {sortedDocuments.map((doc) => (
        <DocumentCard key={doc.id} document={doc} />
      ))}

      {/* Load more */}
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-full py-3 text-sm font-medium text-teal-600 hover:text-teal-700
                     hover:bg-teal-50 rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoadingMore ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
              Loading...
            </span>
          ) : (
            "Load more"
          )}
        </button>
      )}
    </div>
  );
}
