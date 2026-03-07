import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MYDATA_API_URL || process.env.NEXT_PUBLIC_MYDATA_API_URL || "https://mydata-api.resohealth.life";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${API_BASE}/api/v1/documents/${params.id}`, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Document detail proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy document detail request" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${API_BASE}/api/v1/documents/${params.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Document update proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy document update request" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");

    const response = await fetch(`${API_BASE}/api/v1/documents/${params.id}`, {
      method: "DELETE",
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Document delete proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to proxy document delete request" },
      { status: 500 }
    );
  }
}
