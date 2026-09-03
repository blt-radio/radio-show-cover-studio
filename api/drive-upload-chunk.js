import { getAccessToken, checkRequestAuth } from "./_googleAuth.js";

// The browser talks only to this same-origin endpoint, never directly to
// Google — that's what avoids the CORS issue entirely. This function relays
// each chunk to Google server-side, using a token that never leaves the server.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const auth = checkRequestAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const uploadUrl = req.headers["x-upload-url"];
    const rangeStart = req.headers["x-range-start"];
    const rangeEnd = req.headers["x-range-end"];
    const totalSize = req.headers["x-total-size"];
    if (!uploadUrl || rangeStart === undefined || rangeEnd === undefined || !totalSize) {
      res.status(400).json({ error: "Missing x-upload-url / x-range-start / x-range-end / x-total-size headers" });
      return;
    }

    // With Content-Type: application/octet-stream, Vercel's Node runtime
    // gives us the raw request body as a Buffer directly.
    const chunk = req.body;
    if (!chunk || !chunk.length) {
      res.status(400).json({ error: "Empty chunk body" });
      return;
    }

    const accessToken = await getAccessToken();

    // redirect: "manual" so we see Google's real 308 "keep sending chunks"
    // status ourselves, instead of fetch trying to follow it as a real redirect.
    const googleRes = await fetch(uploadUrl, {
      method: "PUT",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${totalSize}`,
      },
      body: chunk,
    });

    // Google uses 308 mid-protocol to mean "got this chunk, send the next
    // one" — we always answer the browser with a normal 200 + JSON flag so
    // fetch() never tries to treat our own response as an HTTP redirect.
    if (googleRes.status === 308) {
      res.status(200).json({ done: false });
      return;
    }

    if (googleRes.ok) {
      const data = await googleRes.json();
      res.status(200).json({ done: true, id: data.id, webViewLink: data.webViewLink });
      return;
    }

    const errText = await googleRes.text();
    res.status(502).json({ error: `Drive chunk upload failed: ${errText}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
