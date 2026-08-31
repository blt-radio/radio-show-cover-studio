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
    const { folderName } = req.body || {};
    if (!folderName) {
      res.status(400).json({ error: "Missing folderName" });
      return;
    }
    const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    if (!parentId) {
      res.status(500).json({ error: "Server is missing GOOGLE_DRIVE_PARENT_FOLDER_ID env var" });
      return;
    }

    const accessToken = await getAccessToken();

    const safeName = folderName.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const searchData = await searchRes.json();
    let folderId = searchData.files && searchData.files[0] && searchData.files[0].id;

    if (!folderId) {
      const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        }),
      });
      if (!createRes.ok) {
        res.status(502).json({ error: `Folder creation failed: ${await createRes.text()}` });
        return;
      }
      const createData = await createRes.json();
      folderId = createData.id;
    }

    res.status(200).json({ folderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
