"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Share2,
  Trash2,
  Loader2,
  FileText,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  User,
  Calendar,
  AlertCircle,
} from "lucide-react";
import ProcessingStatus from "@/components/mydata/ProcessingStatus";
import {
  getDocument,
  updateDocument,
  deleteDocument,
  createShareLink,
} from "@/lib/mydata-api";
import type { HealthDocument, DocumentCategory } from "@/lib/mydata-types";

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

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;

  // ── State ───────────────────────────────────────────────────
  const [doc, setDoc] = useState<HealthDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOCR, setShowOCR] = useState(false);
  const [showFHIR, setShowFHIR] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  const [sharing, setSharing] = useState(false);

  // ── Fetch document ──────────────────────────────────────────
  const fetchDoc = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getDocument(documentId);
      setDoc(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  // ── Poll while processing ───────────────────────────────────
  useEffect(() => {
    if (
      !doc ||
      doc.status === "classified" ||
      doc.status === "error"
    )
      return;

    const interval = setInterval(async () => {
      try {
        const updated = await getDocument(documentId);
        setDoc(updated);
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [doc, documentId]);

  // ── Handlers ────────────────────────────────────────────────
  const handleCategoryChange = async (newCategory: DocumentCategory) => {
    if (!doc) return;
    try {
      const updated = await updateDocument(documentId, { category: newCategory });
      setDoc(updated);
      setEditingCategory(false);
    } catch (err) {
      console.error("Failed to update category:", err);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteDocument(documentId);
      router.push("/my-data");
    } catch (err) {
      console.error("Failed to delete:", err);
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleShare = async () => {
    if (!doc) return;
    try {
      setSharing(true);
      const result = await createShareLink({
        format: "pdf",
        categories: [doc.category],
        dateFrom: null,
        dateTo: null,
        expiresInHours: 72,
      });
      await navigator.clipboard.writeText(result.shareUrl);
      alert("Share link copied to clipboard! Expires in 72 hours.");
    } catch (err) {
      console.error("Failed to create share link:", err);
      alert("Failed to create share link.");
    } finally {
      setSharing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  // ── Loading state ───────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────
  if (error || !doc) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-lg px-4 py-6">
          <Link
            href="/my-data"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Data
          </Link>
          <div className="rounded-xl bg-red-50 p-6 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600">{error || "Document not found"}</p>
            <button
              onClick={fetchDoc}
              className="mt-3 text-sm text-teal-600 hover:text-teal-700"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const categoryColor = CATEGORY_COLORS[doc.category] || "bg-gray-100 text-gray-700";
  const isPDF = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType?.startsWith("image/");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-2xl">
        <div className="space-y-5">
          {/* ── Top bar ─────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <Link
              href="/my-data"
              className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                disabled={sharing}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {sharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="rounded-lg p-2 text-red-400 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Title + Category ─────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {editingCategory ? (
                <select
                  value={doc.category}
                  onChange={(e) =>
                    handleCategoryChange(e.target.value as DocumentCategory)
                  }
                  onBlur={() => setEditingCategory(false)}
                  autoFocus
                  className="text-xs font-medium rounded-full px-2 py-0.5 border border-teal-400 focus:ring-1 focus:ring-teal-400"
                >
                  {ALL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() => setEditingCategory(true)}
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${categoryColor} hover:opacity-80 transition-opacity`}
                  title="Click to change category"
                >
                  {doc.category}
                </button>
              )}
            </div>
            <h1 className="text-lg font-bold text-gray-800">
              {doc.summary || doc.fileName}
            </h1>
          </div>

          {/* ── Meta info ────────────────────────────────────── */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Uploaded: {formatDate(doc.uploadedAt)}
            </span>
            {doc.dateOfService && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Service: {formatDate(doc.dateOfService)}
              </span>
            )}
            {doc.providerName && (
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {doc.providerName}
              </span>
            )}
          </div>

          {/* ── Processing Status ────────────────────────────── */}
          {doc.status !== "classified" && (
            <ProcessingStatus status={doc.status} onRetry={fetchDoc} />
          )}

          {/* ── AI Summary ───────────────────────────────────── */}
          {doc.summary && (
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">
                AI Summary
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                {doc.summary}
              </p>
            </div>
          )}

          {/* ── Key Findings ─────────────────────────────────── */}
          {doc.keyFindings.length > 0 && (
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">
                Key Findings
              </h2>
              <div className="flex flex-wrap gap-2">
                {doc.keyFindings.map((finding, idx) => (
                  <span
                    key={idx}
                    className="inline-block text-xs px-3 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200"
                  >
                    {finding}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Original Document Viewer ──────────────────────── */}
          <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Original Document
            </h2>
            {isPDF ? (
              <iframe
                src={`${process.env.NEXT_PUBLIC_MYDATA_API_URL || ""}/api/v1/documents/${doc.id}/file`}
                className="w-full h-96 rounded-lg border border-gray-200"
                title="Document preview"
              />
            ) : isImage ? (
              <img
                src={`${process.env.NEXT_PUBLIC_MYDATA_API_URL || ""}/api/v1/documents/${doc.id}/file`}
                alt={doc.fileName}
                className="w-full rounded-lg border border-gray-200"
              />
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-4">
                <FileText className="h-8 w-8 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-700">{doc.fileName}</p>
                  <p className="text-xs text-gray-400">
                    {(doc.fileSizeBytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <a
                  href={`${process.env.NEXT_PUBLIC_MYDATA_API_URL || ""}/api/v1/documents/${doc.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-teal-600 hover:text-teal-700"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>

          {/* ── OCR Text (expandable) ────────────────────────── */}
          {doc.ocrText && (
            <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
              <button
                onClick={() => setShowOCR(!showOCR)}
                className="w-full flex items-center justify-between p-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                OCR Extracted Text
                {showOCR ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </button>
              {showOCR && (
                <div className="px-4 pb-4">
                  <pre className="whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-64 overflow-y-auto font-mono">
                    {doc.ocrText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* ── FHIR Resources (expandable) ──────────────────── */}
          {doc.fhirResourceIds.length > 0 && (
            <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
              <button
                onClick={() => setShowFHIR(!showFHIR)}
                className="w-full flex items-center justify-between p-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                FHIR Resources ({doc.fhirResourceIds.length})
                {showFHIR ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </button>
              {showFHIR && (
                <div className="px-4 pb-4 space-y-2">
                  {doc.fhirResourceIds.map((resourceId) => (
                    <div
                      key={resourceId}
                      className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 font-mono"
                    >
                      <FileText className="h-3 w-3 text-gray-400" />
                      {resourceId}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Delete Confirmation Modal ──────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-800 mb-2">
              Delete Document?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              This will permanently remove &quot;{doc.fileName}&quot; and all associated
              data. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5
                           text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm
                           font-medium text-white hover:bg-red-700 transition-colors
                           disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
