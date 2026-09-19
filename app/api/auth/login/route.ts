import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getDashboardDb } from "@/lib/mongodb";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const data = await request.formData();
  const username = String(data.get("username") ?? "").trim();
  const password = String(data.get("password") ?? "");
  const next = String(data.get("next") ?? "/");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const id = digest(forwarded);
  const db = await getDashboardDb();
  const attempts = db.collection<{ _id: string; count: number; windowStartedAt: Date }>("auth_attempts");
  const existing = await attempts.findOne({ _id: id });
  const activeWindow = existing && existing.windowStartedAt.getTime() > Date.now() - WINDOW_MS;
  if (activeWindow && existing.count >= MAX_ATTEMPTS) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const expectedUsername = process.env.DASHBOARD_USERNAME ?? "sanjar";
  const expectedHash = process.env.DASHBOARD_PASSWORD_SHA256 ?? "";
  const valid = username === expectedUsername && expectedHash.length === 64 && digest(password) === expectedHash;
  if (!valid) {
    if (activeWindow) await attempts.updateOne({ _id: id }, { $inc: { count: 1 } });
    else await attempts.updateOne(
      { _id: id },
      { $set: { count: 1, windowStartedAt: new Date() } },
      { upsert: true },
    );
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  await attempts.deleteOne({ _id: id });
  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return response;
}
