// Shared helper used by the other /api functions. Files prefixed with an
// underscore are NOT turned into their own routes by Vercel — this is just
// a shared module.
import { JWT } from "google-auth-library";

export async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars");
  }
  const client = new JWT({
    email,
    key: rawKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain Google access token");
  return token;
}

// Two lightweight, low-effort checks — not bulletproof (this is a public
// static site, so a determined attacker can still find the shared secret in
// the compiled JS), but both are free, require no extra infrastructure, and
// meaningfully raise the bar above "wide open":
//  - Origin check: blocks requests that don't come from your deployed site's
//    browser context (a real browser always sends this; casual scripts often don't bother).
//  - Shared secret: blocks casual discovery/scanning of the endpoint URL.
export function checkRequestAuth(req) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) {
    const allowed = allowedOrigin.split(",").map((o) => o.trim());
    const origin = req.headers.origin || "";
    if (!allowed.includes(origin)) {
      return { ok: false, status: 403, error: "Origin not allowed" };
    }
  }
  const secret = process.env.APP_UPLOAD_SECRET;
  if (secret) {
    const provided = req.headers["x-app-secret"];
    if (provided !== secret) {
      return { ok: false, status: 401, error: "Invalid or missing app secret" };
    }
  }
  return { ok: true };
}
