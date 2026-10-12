// Cloudflare Worker: relays upload chunks to Google Drive so that the heavy
// bytes no longer pass through Vercel (which counts them against the free
// plan's "Fast Origin Transfer" limit).
//
// It needs NO Google credentials: the resumable-upload session URL that
// /api/drive-upload-init creates is itself the permission to upload to that
// one file. The Worker only (1) checks the caller, (2) adds the CORS headers
// the browser needs, and (3) streams the chunk to Google.
//
// Settings (Cloudflare dashboard > your Worker > Settings > Variables and Secrets):
//   ALLOWED_ORIGIN     e.g. https://blt-radio-show-submission.vercel.app   (comma-separated if several)
//   APP_UPLOAD_SECRET  same value as in Vercel / the APP_SECRET constant in the app

const GOOGLE_UPLOAD_PREFIX = "https://www.googleapis.com/upload/drive/v3/files";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-app-secret, x-upload-url, x-range-start, x-range-end, x-total-size",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return { headers, originOk: allowed.includes(origin) };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors.headers },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors.originOk ? 204 : 403, headers: cors.headers });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!cors.originOk) return json({ error: "Origin not allowed" }, 403, cors);

    if (!env.APP_UPLOAD_SECRET) return json({ error: "Worker is missing APP_UPLOAD_SECRET" }, 500, cors);
    if (request.headers.get("x-app-secret") !== env.APP_UPLOAD_SECRET) {
      return json({ error: "Invalid or missing app secret" }, 401, cors);
    }

    try {
      const uploadUrl = request.headers.get("x-upload-url");
      const rangeStart = request.headers.get("x-range-start");
      const rangeEnd = request.headers.get("x-range-end");
      const totalSize = request.headers.get("x-total-size");
      const length = Number(request.headers.get("content-length"));

      if (!uploadUrl || rangeStart === null || rangeEnd === null || !totalSize) {
        return json({ error: "Missing x-upload-url / x-range-start / x-range-end / x-total-size headers" }, 400, cors);
      }
      // Never act as an open relay: only Google Drive upload sessions are allowed.
      if (!uploadUrl.startsWith(GOOGLE_UPLOAD_PREFIX)) {
        return json({ error: "Upload URL not allowed" }, 400, cors);
      }
      if (!request.body || !Number.isFinite(length) || length <= 0) {
        return json({ error: "Empty chunk body" }, 400, cors);
      }

      // Stream the chunk through (never held in memory). FixedLengthStream
      // gives the outgoing request a known Content-Length, which Google needs.
      const { readable, writable } = new FixedLengthStream(length);
      request.body.pipeTo(writable);

      // redirect: "manual" so Google's 308 ("got it, send the next chunk") is
      // returned to us instead of being followed as a redirect.
      const googleRes = await fetch(uploadUrl, {
        method: "PUT",
        redirect: "manual",
        headers: { "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${totalSize}` },
        body: readable,
      });

      if (googleRes.status === 308) return json({ done: false }, 200, cors);

      if (googleRes.ok) {
        const data = await googleRes.json();
        return json({ done: true, id: data.id, webViewLink: data.webViewLink }, 200, cors);
      }
      return json({ error: `Drive chunk upload failed (${googleRes.status}): ${await googleRes.text()}` }, 502, cors);
    } catch (err) {
      return json({ error: err.message || "Unknown worker error" }, 500, cors);
    }
  },
};
