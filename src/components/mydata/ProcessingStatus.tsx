"use client";

import React from "react";
import {
  Upload,
  ScanSearch,
  Tags,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { DocumentStatus } from "@/lib/mydata-types";

interface ProcessingStatusProps {
  status: DocumentStatus;
  onRetry?: () => void;
}

interface Step {
  label: string;
  icon: React.ElementType;
  key: DocumentStatus;
}

const STEPS: Step[] = [
  { label: "Upload", icon: Upload, key: "uploading" },
  { label: "OCR", icon: ScanSearch, key: "ocr_processing" },
  { label: "Classify", icon: Tags, key: "classifying" },
  { label: "Done", icon: CheckCircle2, key: "classified" },
];

const STATUS_ORDER: DocumentStatus[] = [
  "pending",
  "uploading",
  "ocr_processing",
  "classifying",
  "classified",
];

export default function ProcessingStatus({ status, onRetry }: ProcessingStatusProps) {
  const currentIndex = STATUS_ORDER.indexOf(status);
  const isError = status === "error";

  const getStepState = (stepIndex: number): "completed" | "active" | "pending" | "error" => {
    if (isError) return stepIndex <= currentIndex ? "error" : "pending";
    // Map step index: Upload=1, OCR=2, Classify=3, Done=4 in STATUS_ORDER
    const stepStatusIndex = stepIndex + 1; // offset since pending=0
    if (currentIndex >= stepStatusIndex + 1) return "completed";
    if (currentIndex === stepStatusIndex) return "active";
    if (status === "classified" && stepIndex === 3) return "completed";
    return "pending";
  };

  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const state = getStepState(idx);
          const Icon = step.icon;

          return (
            <React.Fragment key={step.key}>
              {/* Step */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300
                    ${state === "completed" ? "bg-emerald-500 text-white" : ""}
                    ${state === "active" ? "bg-teal-500 text-white" : ""}
                    ${state === "pending" ? "bg-gray-200 text-gray-400" : ""}
                    ${state === "error" ? "bg-red-500 text-white" : ""}
                  `}
                >
                  {state === "completed" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : state === "active" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : state === "error" ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium ${
                    state === "completed"
                      ? "text-emerald-600"
                      : state === "active"
                      ? "text-teal-600"
                      : state === "error"
                      ? "text-red-500"
                      : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-2 rounded-full transition-colors duration-300 ${
                    getStepState(idx) === "completed"
                      ? "bg-emerald-500"
                      : "bg-gray-200"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Error retry */}
      {isError && onRetry && (
        <div className="mt-3 text-center">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Retry processing
          </button>
        </div>
      )}

      {/* Estimated time */}
      {status !== "classified" && status !== "error" && (
        <p className="mt-2 text-center text-[10px] text-gray-400">
          Estimated time remaining: ~30 seconds
        </p>
      )}
    </div>
  );
}
