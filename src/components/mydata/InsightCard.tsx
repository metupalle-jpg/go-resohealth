"use client";

import React from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Bell,
  Lightbulb,
  FileBarChart,
  X,
} from "lucide-react";
import type { InsightItem } from "@/lib/mydata-types";

interface InsightCardProps {
  insight: InsightItem;
  onDismiss?: (id: string) => void;
}

const TYPE_CONFIG: Record<
  InsightItem["type"],
  { icon: React.ElementType; color: string }
> = {
  trend: { icon: TrendingUp, color: "text-blue-500" },
  anomaly: { icon: AlertTriangle, color: "text-amber-500" },
  reminder: { icon: Bell, color: "text-purple-500" },
  recommendation: { icon: Lightbulb, color: "text-teal-500" },
  summary: { icon: FileBarChart, color: "text-indigo-500" },
};

const SEVERITY_STYLES: Record<InsightItem["severity"], string> = {
  info: "border-l-blue-400 bg-blue-50/50",
  warning: "border-l-amber-400 bg-amber-50/50",
  "action-needed": "border-l-red-400 bg-red-50/50",
};

export default function InsightCard({ insight, onDismiss }: InsightCardProps) {
  const { icon: Icon, color } = TYPE_CONFIG[insight.type] || TYPE_CONFIG.summary;
  const severityStyle = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;

  return (
    <div
      className={`relative rounded-xl border-l-4 p-4 ${severityStyle} transition-all duration-200`}
    >
      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={() => onDismiss(insight.id)}
          className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-6">
          <h4 className="text-sm font-semibold text-gray-800 mb-0.5">
            {insight.title}
          </h4>
          <p className="text-xs text-gray-600 leading-relaxed">
            {insight.description}
          </p>

          {/* Related docs */}
          {insight.relatedDocuments.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-2">
              Based on {insight.relatedDocuments.length} document
              {insight.relatedDocuments.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
