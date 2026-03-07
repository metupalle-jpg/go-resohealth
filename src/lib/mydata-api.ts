// src/lib/mydata-api.ts
import type {
  ApiResponse,
  AskAIResponse,
  DocumentFilters,
  ExportOptions,
  HealthDocument,
  HealthScore,
  InsightItem,
  PaginatedResponse,
  ShareLinkResponse,
  UploadResponse,
} from "./mydata-types";

// ─── Base URL Configuration ──────────────────────────────────────
const API_BASE =
  process.env.NEXT_PUBLIC_MYDATA_API_URL ||
  "https://mydata-api.resohealth.life";

// ─── Helper: Build Headers ──────────────────────────────────────
function getHeaders(extraHeaders?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  // Retrieve token from localStorage (set by auth flow)
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("reso_auth_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return headers;
}

// ─── Helper: API Fetch ──────────────────────────────────────────
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error || parsed.message || `API error ${response.status}`;
    } catch {
      errorMessage = `API error ${response.status}: ${errorBody}`;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

// ─── Upload Flow ─────────────────────────────────────────────────

/**
 * Step 1: Request a signed upload URL from the backend.
 */
export async function requestUploadUrl(
  filename: string,
  contentType: string,
  sizeBytes: number
): Promise<UploadResponse> {
  const res = await apiFetch<ApiResponse<UploadResponse>>("/api/v1/upload/request", {
    method: "POST",
    body: JSON.stringify({ filename, contentType, sizeBytes }),
  });

  if (!res.success) throw new Error(res.error || "Failed to get upload URL");
  return res.data;
}

/**
 * Step 2: Upload file directly to GCS using the signed URL.
 * Uses XMLHttpRequest for progress tracking.
 */
export function uploadFileToGCS(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed: network error"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

/**
 * Step 3: Confirm the upload so the backend begins processing.
 */
export async function confirmUpload(documentId: string): Promise<void> {
  const res = await apiFetch<ApiResponse<null>>(`/api/v1/upload/${documentId}/confirm`, {
    method: "POST",
  });

  if (!res.success) throw new Error(res.error || "Failed to confirm upload");
}

// ─── Documents ───────────────────────────────────────────────────

/**
 * Get a paginated, filtered list of documents.
 */
export async function getDocuments(
  filters?: DocumentFilters
): Promise<PaginatedResponse<HealthDocument>> {
  const params = new URLSearchParams();

  if (filters) {
    if (filters.categories?.length) {
      params.set("categories", filters.categories.join(","));
    }
    if (filters.status?.length) {
      params.set("status", filters.status.join(","));
    }
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.search) params.set("search", filters.search);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
    if (filters.sortBy) params.set("sortBy", filters.sortBy);
    if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
  }

  const query = params.toString();
  const endpoint = `/api/v1/documents${query ? `?${query}` : ""}`;

  const res = await apiFetch<ApiResponse<PaginatedResponse<HealthDocument>>>(endpoint);
  if (!res.success) throw new Error(res.error || "Failed to fetch documents");
  return res.data;
}

/**
 * Get a single document by ID.
 */
export async function getDocument(id: string): Promise<HealthDocument> {
  const res = await apiFetch<ApiResponse<HealthDocument>>(`/api/v1/documents/${id}`);
  if (!res.success) throw new Error(res.error || "Failed to fetch document");
  return res.data;
}

/**
 * Update a document (e.g., change category override).
 */
export async function updateDocument(
  id: string,
  updates: Partial<Pick<HealthDocument, "category" | "providerName" | "dateOfService">>
): Promise<HealthDocument> {
  const res = await apiFetch<ApiResponse<HealthDocument>>(`/api/v1/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.success) throw new Error(res.error || "Failed to update document");
  return res.data;
}

/**
 * Delete a document.
 */
export async function deleteDocument(id: string): Promise<void> {
  const res = await apiFetch<ApiResponse<null>>(`/api/v1/documents/${id}`, {
    method: "DELETE",
  });
  if (!res.success) throw new Error(res.error || "Failed to delete document");
}

// ─── Insights ────────────────────────────────────────────────────

/**
 * Get AI-generated health insights.
 */
export async function getInsights(
  refresh = false
): Promise<{ insights: InsightItem[]; generatedAt: string }> {
  const endpoint = `/api/v1/insights${refresh ? "?refresh=true" : ""}`;
  const res = await apiFetch<
    ApiResponse<{ insights: InsightItem[]; generatedAt: string }>
  >(endpoint);
  if (!res.success) throw new Error(res.error || "Failed to fetch insights");
  return res.data;
}

/**
 * Ask AI a health question based on your documents.
 */
export async function askAI(question: string): Promise<AskAIResponse> {
  const res = await apiFetch<ApiResponse<AskAIResponse>>("/api/v1/insights/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
  if (!res.success) throw new Error(res.error || "Failed to get AI answer");
  return res.data;
}

/**
 * Get health score.
 */
export async function getHealthScore(): Promise<HealthScore> {
  const res = await apiFetch<ApiResponse<HealthScore>>("/api/v1/insights/score");
  if (!res.success) throw new Error(res.error || "Failed to fetch health score");
  return res.data;
}

// ─── Export ──────────────────────────────────────────────────────

/**
 * Export documents as a PDF report. Returns a Blob.
 */
export async function exportPDF(options: ExportOptions): Promise<Blob> {
  const url = `${API_BASE}/api/v1/export/pdf`;
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("reso_auth_token")
      : null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}`);
  }

  return response.blob();
}

/**
 * Export documents as a FHIR R4 Bundle. Returns a Blob.
 */
export async function exportFHIR(options: ExportOptions): Promise<Blob> {
  const url = `${API_BASE}/api/v1/export/fhir`;
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("reso_auth_token")
      : null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    throw new Error(`FHIR export failed with status ${response.status}`);
  }

  return response.blob();
}

/**
 * Create a shareable link for selected documents.
 */
export async function createShareLink(
  options: ExportOptions & { expiresInHours?: number }
): Promise<ShareLinkResponse> {
  const res = await apiFetch<ApiResponse<ShareLinkResponse>>("/api/v1/export/share", {
    method: "POST",
    body: JSON.stringify(options),
  });
  if (!res.success) throw new Error(res.error || "Failed to create share link");
  return res.data;
}
