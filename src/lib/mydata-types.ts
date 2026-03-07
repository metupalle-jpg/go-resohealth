// src/lib/mydata-types.ts

// ─── Document Status ─────────────────────────────────────────────
export type DocumentStatus =
  | "pending"
  | "uploading"
  | "ocr_processing"
  | "classifying"
  | "classified"
  | "error";

// ─── Document Categories ─────────────────────────────────────────
export type DocumentCategory =
  | "Vitals"
  | "Lab Results"
  | "Radiology"
  | "Outpatient Notes"
  | "Inpatient Notes"
  | "Medications"
  | "Wellness Programs"
  | "Insurance"
  | "Epigenetic BioAge"
  | "Nutrigenomics"
  | "Genetic Testing"
  | "Longevity Assessments";

// ─── Health Document ─────────────────────────────────────────────
export interface HealthDocument {
  id: string;
  fileName: string;
  uploadedAt: string; // ISO 8601
  status: DocumentStatus;
  category: DocumentCategory;
  subcategories: string[];
  summary: string;
  keyFindings: string[];
  dateOfService: string | null; // ISO 8601 or null
  providerName: string | null;
  fhirResourceIds: string[];
  aiClassification: {
    category: DocumentCategory;
    confidence: number; // 0-1
    subcategories: string[];
  } | null;
  gcsRawPath: string;
  ocrText?: string;
  mimeType: string;
  fileSizeBytes: number;
  thumbnailUrl?: string;
}

// ─── Upload Types ────────────────────────────────────────────────
export interface UploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface UploadResponse {
  uploadUrl: string;
  documentId: string;
  expiresAt: string;
}

// ─── Insight Types ───────────────────────────────────────────────
export type InsightSeverity = "info" | "warning" | "action-needed";

export type InsightType =
  | "trend"
  | "anomaly"
  | "reminder"
  | "recommendation"
  | "summary";

export interface InsightItem {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  severity: InsightSeverity;
  relatedDocuments: string[]; // document IDs
  generatedAt: string; // ISO 8601
  dismissed?: boolean;
}

// ─── Export Types ────────────────────────────────────────────────
export type ExportFormat = "pdf" | "fhir";

export interface ExportOptions {
  format: ExportFormat;
  categories: DocumentCategory[];
  dateFrom: string | null; // ISO 8601
  dateTo: string | null; // ISO 8601
}

export interface ShareLinkResponse {
  shareUrl: string;
  expiresAt: string;
}

// ─── API Response Wrapper ────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}

// ─── Paginated Response ──────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Document Filters ────────────────────────────────────────────
export interface DocumentFilters {
  categories?: DocumentCategory[];
  status?: DocumentStatus[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "uploadedAt" | "dateOfService" | "category";
  sortOrder?: "asc" | "desc";
}

// ─── AI Q&A Types ────────────────────────────────────────────────
export interface AskAIRequest {
  question: string;
}

export interface AskAIResponse {
  answer: string;
  sources: {
    documentId: string;
    documentName: string;
    relevantExcerpt: string;
  }[];
}

// ─── Health Score ────────────────────────────────────────────────
export interface HealthScore {
  overall: number; // 0-100
  categories: {
    category: string;
    score: number;
    trend: "up" | "down" | "stable";
  }[];
  lastUpdated: string;
}

// ─── Upload Queue Item (client-side only) ────────────────────────
export interface UploadQueueItem {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "queued" | "requesting_url" | "uploading" | "confirming" | "processing" | "done" | "error";
  documentId?: string;
  errorMessage?: string;
}
