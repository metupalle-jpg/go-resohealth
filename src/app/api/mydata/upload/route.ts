export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MYDATA_API_URL || process.env.NEXT_PUBLIC_MYDATA_API_URL || "https://mydata-api-i5aasv3rka-ww.a.run.app";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get("authorization");
    const userId = request.headers.get("x-user-id");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authHeader) headers["Authorization"] = authHeader;
    if (userId) headers["X-User-Id"] = userId;

    const response = await fetch(`${API_BASE}/api/mydata/upload/request`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Upload proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy upload request" },
      { status: 500 }
    );
  }
}
