"use client";

import React from "react";
import {
  Activity,
  TestTube2,
  ScanLine,
  FileText,
  ClipboardList,
  Pill,
  HeartPulse,
  Shield,
  Dna,
  Wheat,
  FlaskConical,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { DocumentCategory } from "@/lib/mydata-types";

interface CategoryFilterProps {
  activeFilters: DocumentCategory[];
  onFilterChange: (filters: DocumentCategory[]) => void;
}

const CATEGORIES: {
  label: DocumentCategory;
  icon: React.ElementType;
}[] = [
  { label: "Vitals", icon: Activity },
  { label: "Lab Results", icon: TestTube2 },
  { label: "Radiology", icon: ScanLine },
  { label: "Outpatient Notes", icon: FileText },
  { label: "Inpatient Notes", icon: ClipboardList },
  { label: "Medications", icon: Pill },
  { label: "Wellness Programs", icon: HeartPulse },
  { label: "Insurance", icon: Shield },
  { label: "Epigenetic BioAge", icon: Dna },
  { label: "Nutrigenomics", icon: Wheat },
  { label: "Genetic Testing", icon: FlaskConical },
  { label: "Longevity Assessments", icon: TrendingUp },
];

export default function CategoryFilter({
  activeFilters,
  onFilterChange,
}: CategoryFilterProps) {
  const toggleCategory = (category: DocumentCategory) => {
    if (activeFilters.includes(category)) {
      onFilterChange(activeFilters.filter((c) => c !== category));
    } else {
      onFilterChange([...activeFilters, category]);
    }
  };

  const clearAll = () => onFilterChange([]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-600">Filter by category</h3>
        {activeFilters.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {CATEGORIES.map(({ label, icon: Icon }) => {
          const isActive = activeFilters.includes(label);
          return (
            <button
              key={label}
              onClick={() => toggleCategory(label)}
              className={`
                flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5
                text-xs font-medium border transition-all duration-150
                flex-shrink-0
                ${
                  isActive
                    ? "border-teal-500 bg-teal-500/10 text-teal-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                }
              `}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
