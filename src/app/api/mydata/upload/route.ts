import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MYDATA_API_URL || process.env.NEXT_PUBLIC_MYDATA_API_URL || "https://mydata-api.resohealth.life";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${API_BASE}/api/v1/upload/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
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
