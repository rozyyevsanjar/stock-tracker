import { NextResponse } from "next/server";
import { getGeminiUsageSummary } from "@/lib/assistant-usage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const usage = await getGeminiUsageSummary();
    return NextResponse.json({ usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini usage is unavailable.";
    return NextResponse.json({ error: message, unavailable: true }, { status: 503 });
  }
}
