// Shared helper used by the other /api functions. Files prefixed with an
// underscore are NOT turned into their own routes by Vercel — this is just
// a shared module.

// Personal Gmail accounts can't grant a service account any storage quota
// (that only works with paid Google Workspace + Shared Drives), so instead
// this authenticates as the real Gmail account itself via a long-lived OAuth
// refresh token — uploads then count against that account's own normal quota,
// exactly like uploading through drive.google.com yourself.
export async function getAccessToken() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN env vars");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to refresh Google access token: ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token endpoint did not return an access_token");
  return data.access_token;
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
