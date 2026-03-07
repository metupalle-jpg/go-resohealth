import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MYDATA_API_URL || process.env.NEXT_PUBLIC_MYDATA_API_URL || "https://mydata-api.resohealth.life";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${API_BASE}/api/v1/export/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: errorData.error || "Export failed" },
        { status: response.status }
      );
    }

    const blob = await response.blob();
    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", 'attachment; filename="health-vault-report.pdf"');

    return new NextResponse(blob, { status: 200, headers });
  } catch (error) {
    console.error("PDF export proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy PDF export request" },
      { status: 500 }
    );
  }
}
