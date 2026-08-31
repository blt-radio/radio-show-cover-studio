import { checkRequestAuth } from "./_googleAuth.js";

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
    const { accessToken } = req.body || {};
    if (!accessToken) {
      res.status(400).json({ error: "Missing accessToken" });
      return;
    }
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
    });
    res.status(200).json({ revoked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
