// ONE-TIME SETUP: open  https://YOUR-SITE/api/soundcloud-connect?key=YOUR_APP_UPLOAD_SECRET
// in your browser while logged in to the SoundCloud account that should own
// the uploads. It sends you to SoundCloud to approve access, then
// /api/soundcloud-callback saves the resulting tokens to your Drive.
import crypto from "node:crypto";

function redirectUri(req) {
  return process.env.SOUNDCLOUD_REDIRECT_URI || `https://${req.headers.host}/api/soundcloud-callback`;
}

export default function handler(req, res) {
  const secret = process.env.APP_UPLOAD_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(401).send("Invalid or missing key (must equal APP_UPLOAD_SECRET).");
  }
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  if (!clientId) return res.status(500).send("Missing SOUNDCLOUD_CLIENT_ID env var.");

  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  res.setHeader("Set-Cookie", `sc_oauth=${state}.${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=600`);

  const url = new URL("https://secure.soundcloud.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
}
