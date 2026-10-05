import { writeSoundcloudTokens } from "./_driveToken.js";

function redirectUri(req) {
  return process.env.SOUNDCLOUD_REDIRECT_URI || `https://${req.headers.host}/api/soundcloud-callback`;
}

export default async function handler(req, res) {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`SoundCloud returned an error: ${error}`);

    const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("sc_oauth="));
    const [savedState, verifier] = cookie ? cookie.slice("sc_oauth=".length).split(".") : [];
    if (!code || !state || !savedState || state !== savedState || !verifier) {
      return res.status(400).send("Invalid or expired session. Start again from /api/soundcloud-connect.");
    }

    const tokenRes = await fetch("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.SOUNDCLOUD_CLIENT_ID,
        client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        code_verifier: verifier,
        code,
      }),
    });
    const data = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !data.refresh_token) {
      return res.status(500).send(`Token exchange failed: ${JSON.stringify(data)}`);
    }

    await writeSoundcloudTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      obtained_at: Date.now(),
      expires_in: data.expires_in,
    });

    res.setHeader("Set-Cookie", "sc_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send("<h2>SoundCloud connected.</h2><p>Tokens saved to your Drive. You can close this tab.</p>");
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
}
