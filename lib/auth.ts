export const SESSION_COOKIE = "dashboard_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signingKey() {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) throw new Error("Dashboard authentication is not configured.");
  return crypto.subtle.importKey("raw", bytes(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign", "verify"]);
}

export async function createSessionToken() {
  const payload = base64Url(bytes(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), bytes(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const padded = signature.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(signature.length / 4) * 4, "=");
    const signatureBytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", await signingKey(), signatureBytes, bytes(payload))) return false;
    const payloadPadded = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payloadPadded), (character) => character.charCodeAt(0))));
    return Number(data.exp) > Date.now() / 1000;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  maxAge: SESSION_SECONDS,
  path: "/",
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
};
