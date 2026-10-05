// Stores SoundCloud's OAuth tokens as a small JSON file in your Drive parent
// folder. SoundCloud refresh tokens are single-use (every refresh returns a
// NEW one), so they have to be saved somewhere writable between runs — Drive
// is already connected, so no database is needed.
import { getAccessToken } from "./_googleAuth.js";

const TOKEN_FILE_NAME = "soundcloud-token.json";

function parentId() {
  const id = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!id) throw new Error("Missing GOOGLE_DRIVE_PARENT_FOLDER_ID env var");
  return id;
}

async function findTokenFile(accessToken) {
  const q = `name='${TOKEN_FILE_NAME}' and '${parentId()}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive lookup of token file failed: ${await res.text()}`);
  const { files } = await res.json();
  return files && files.length ? files[0].id : null;
}

export async function readSoundcloudTokens() {
  const accessToken = await getAccessToken();
  const fileId = await findTokenFile(accessToken);
  if (!fileId) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Reading SoundCloud token file failed: ${await res.text()}`);
  return res.json();
}

export async function writeSoundcloudTokens(tokens) {
  const accessToken = await getAccessToken();
  const fileId = await findTokenFile(accessToken);
  const content = JSON.stringify(tokens);

  if (fileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: content,
      }
    );
    if (!res.ok) throw new Error(`Updating SoundCloud token file failed: ${await res.text()}`);
    return;
  }

  const boundary = "scstudio" + Math.random().toString(16).slice(2);
  const metadata = JSON.stringify({ name: TOKEN_FILE_NAME, parents: [parentId()], mimeType: "application/json" });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) throw new Error(`Creating SoundCloud token file failed: ${await res.text()}`);
}
