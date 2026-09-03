import { getAccessToken, checkRequestAuth } from "./_googleAuth.js";

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
    const { fileName, mimeType, folderId } = req.body || {};
    if (!fileName || !mimeType || !folderId) {
      res.status(400).json({ error: "Missing fileName, mimeType, or folderId" });
      return;
    }

    const accessToken = await getAccessToken();

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
        },
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      }
    );

    if (!initRes.ok) {
      res.status(502).json({ error: `Drive session init failed: ${await initRes.text()}` });
      return;
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("Drive did not return a session URL");

    // Only the upload session URL goes to the browser now — the access
    // token itself stays entirely server-side (see drive-upload-chunk.js),
    // which also sidesteps the CORS restriction on direct browser-to-Google
    // requests authenticated with a service account.
    res.status(200).json({ uploadUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
