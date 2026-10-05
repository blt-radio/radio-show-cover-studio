// Called by the web app once a show's files are safely in Drive. It does NOT
// move any audio itself (Vercel can't handle 800MB bodies) — it just starts
// the GitHub Actions workflow that streams Drive -> SoundCloud.
import { checkRequestAuth } from "./_googleAuth.js";

const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const auth = checkRequestAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const { audioFileId, imageFileId = "", title = "", tags = "", description = "" } = req.body || {};
    if (!ID_RE.test(audioFileId || "") || (imageFileId && !ID_RE.test(imageFileId))) {
      return res.status(400).json({ error: "Invalid file id" });
    }

    const token = process.env.GITHUB_DISPATCH_TOKEN;
    const repo = process.env.GITHUB_REPO; // "owner/repo"
    const ref = process.env.GITHUB_REF_NAME || "main";
    if (!token || !repo) return res.status(500).json({ error: "Missing GITHUB_DISPATCH_TOKEN / GITHUB_REPO env vars" });

    const ghRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/soundcloud-upload.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          audio_file_id: audioFileId,
          image_file_id: imageFileId,
          title: String(title).slice(0, 200),
          tags: String(tags).slice(0, 500),
          description: String(description).slice(0, 2000),
        },
      }),
    });
    if (!ghRes.ok) {
      return res.status(502).json({ error: `GitHub dispatch failed (${ghRes.status}): ${await ghRes.text()}` });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
