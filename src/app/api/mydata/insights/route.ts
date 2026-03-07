import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MYDATA_API_URL || process.env.NEXT_PUBLIC_MYDATA_API_URL || "https://mydata-api.resohealth.life";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const refresh = searchParams.get("refresh");
    const authHeader = request.headers.get("authorization");

    const url = `${API_BASE}/api/v1/insights${refresh ? "?refresh=true" : ""}`;

    const response = await fetch(url, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Insights proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy insights request" },
      { status: 500 }
    );
  }
}
