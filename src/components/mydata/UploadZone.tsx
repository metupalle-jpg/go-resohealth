"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  RotateCcw,
} from "lucide-react";
import {
  requestUploadUrl,
  uploadFileToGCS,
  confirmUpload,
  getDocument,
} from "@/lib/mydata-api";
import type { UploadQueueItem } from "@/lib/mydata-types";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.heic,.zip,.doc,.docx";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

interface UploadZoneProps {
  onUploadComplete?: (documentId: string) => void;
}

export default function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ──────────────────────────────────────────────────
  const updateQueueItem = useCallback(
    (id: string, updates: Partial<UploadQueueItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      );
    },
    []
  );

  const removeQueueItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // ── Upload a single file ────────────────────────────────────
  const processFile = useCallback(
    async (queueItem: UploadQueueItem) => {
      const { id, file } = queueItem;

      try {
        // Step 1: Request signed URL
        updateQueueItem(id, { status: "requesting_url", progress: 0 });
        const { uploadUrl, documentId } = await requestUploadUrl(
          file.name,
          file.type || "application/octet-stream",
          file.size
        );
        updateQueueItem(id, { documentId });

        // Step 2: Upload to GCS
        updateQueueItem(id, { status: "uploading" });
        await uploadFileToGCS(uploadUrl, file, (percent) => {
          updateQueueItem(id, { progress: percent });
        });

        // Step 3: Confirm upload
        updateQueueItem(id, { status: "confirming", progress: 100 });
        await confirmUpload(documentId);

        // Step 4: Poll for processing completion
        updateQueueItem(id, { status: "processing" });
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes at 5s intervals

        const poll = async () => {
          if (attempts >= maxAttempts) {
            updateQueueItem(id, {
              status: "done",
            });
            onUploadComplete?.(documentId);
            return;
          }

          try {
            const doc = await getDocument(documentId);
            if (doc.status === "classified") {
              updateQueueItem(id, { status: "done", progress: 100 });
              onUploadComplete?.(documentId);
              return;
            }
            if (doc.status === "error") {
              updateQueueItem(id, {
                status: "error",
                errorMessage: "Processing failed on server",
              });
              return;
            }
          } catch {
            // Polling error — continue
          }

          attempts++;
          setTimeout(poll, 5000);
        };

        poll();
      } catch (error) {
        updateQueueItem(id, {
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Upload failed",
        });
      }
    },
    [updateQueueItem, onUploadComplete]
  );

  // ── Handle files ────────────────────────────────────────────
  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const newItems: UploadQueueItem[] = [];

      Array.from(files).forEach((file) => {
        // Validate size
        if (file.size > MAX_FILE_SIZE) {
          const errorItem: UploadQueueItem = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            progress: 0,
            status: "error",
            errorMessage: `File too large (max 50 MB)`,
          };
          newItems.push(errorItem);
          return;
        }

        // Validate type (loose check — backend will validate too)
        const ext = file.name.split(".").pop()?.toLowerCase();
        const validExt = ["pdf", "jpg", "jpeg", "png", "heic", "zip", "doc", "docx"];
        if (!ACCEPTED_TYPES.includes(file.type) && ext && !validExt.includes(ext)) {
          const errorItem: UploadQueueItem = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            progress: 0,
            status: "error",
            errorMessage: `Unsupported file type`,
          };
          newItems.push(errorItem);
          return;
        }

        const item: UploadQueueItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          progress: 0,
          status: "queued",
        };
        newItems.push(item);
      });

      setQueue((prev) => [...prev, ...newItems]);

      // Start uploading queued items
      newItems
        .filter((item) => item.status === "queued")
        .forEach((item) => processFile(item));
    },
    [processFile]
  );

  // ── Retry failed upload ─────────────────────────────────────
  const retryUpload = useCallback(
    (id: string) => {
      const item = queue.find((q) => q.id === id);
      if (!item) return;
      updateQueueItem(id, { status: "queued", progress: 0, errorMessage: undefined });
      processFile({ ...item, status: "queued", progress: 0, errorMessage: undefined });
    },
    [queue, updateQueueItem, processFile]
  );

  // ── Drag & Drop handlers ───────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleClick = () => fileInputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = ""; // Reset so same file can be re-selected
    }
  };

  // ── Status label helper ─────────────────────────────────────
  const getStatusLabel = (item: UploadQueueItem): string => {
    switch (item.status) {
      case "queued":
        return "Queued";
      case "requesting_url":
        return "Preparing...";
      case "uploading":
        return `Uploading... ${item.progress}%`;
      case "confirming":
        return "Confirming...";
      case "processing":
        return "Processing OCR & Classifying...";
      case "done":
        return "Done ✓";
      case "error":
        return item.errorMessage || "Error";
      default:
        return "";
    }
  };

  const getStatusIcon = (item: UploadQueueItem) => {
    switch (item.status) {
      case "done":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Loader2 className="h-4 w-4 text-teal-500 animate-spin" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative cursor-pointer rounded-xl border-2 border-dashed p-8
          transition-all duration-200 text-center
          ${
            isDragging
              ? "border-teal-500 bg-teal-500/10 scale-[1.02]"
              : "border-gray-300 hover:border-teal-400 hover:bg-teal-500/5"
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          onChange={handleInputChange}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-3">
          <div
            className={`
              rounded-full p-3 transition-colors duration-200
              ${isDragging ? "bg-teal-500/20" : "bg-gray-100"}
            `}
          >
            <Upload
              className={`h-6 w-6 transition-colors duration-200 ${
                isDragging ? "text-teal-500" : "text-gray-400"
              }`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">
              {isDragging ? "Drop files here" : "Tap to upload or drag & drop"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              PDF, Images, DOCX, ZIP — up to 50 MB each
            </p>
          </div>
        </div>
      </div>

      {/* Upload Queue */}
      {queue.length > 0 && (
        <div className="space-y-2">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">
                  {item.file.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {getStatusIcon(item)}
                  <p
                    className={`text-xs ${
                      item.status === "error" ? "text-red-500" : "text-gray-500"
                    }`}
                  >
                    {getStatusLabel(item)}
                  </p>
                </div>

                {/* Progress bar */}
                {(item.status === "uploading" || item.status === "requesting_url") && (
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {item.status === "error" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    retryUpload(item.id);
                  }}
                  className="p-1 text-teal-600 hover:text-teal-700"
                  title="Retry"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              {(item.status === "done" || item.status === "error") && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQueueItem(item.id);
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
