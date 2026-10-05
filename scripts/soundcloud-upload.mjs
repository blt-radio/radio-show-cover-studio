// Runs inside GitHub Actions (see .github/workflows/soundcloud-upload.yml).
// Streams the audio from Google Drive to disk, then to SoundCloud, so none of
// the (large) audio passes through Make.com.
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { getAccessToken } from "../api/_googleAuth.js";
import { readSoundcloudTokens, writeSoundcloudTokens } from "../api/_driveToken.js";

const env = (k) => process.env[k] || "";
const need = (k) => { if (!env(k)) throw new Error(`Missing env var ${k}`); return env(k); };

async function driveMeta(token, id) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,parents&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive metadata failed for ${id}: ${await res.text()}`);
  return res.json();
}

// Safety: only handle files that live inside a show folder under the configured parent folder.
async function assertInsideParent(token, meta) {
  const folderId = meta.parents && meta.parents[0];
  if (!folderId) throw new Error("File has no parent folder");
  const folder = await driveMeta(token, folderId);
  if (!(folder.parents || []).includes(need("GOOGLE_DRIVE_PARENT_FOLDER_ID"))) {
    throw new Error("Refusing to upload a file outside the show submissions folder");
  }
}

async function downloadDriveFile(token, id, dest) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) throw new Error(`Drive download failed for ${id}: ${await res.text()}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  console.log(`Downloaded ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

// Refresh tokens are single-use: persist the new pair to Drive IMMEDIATELY.
async function freshSoundcloudAccessToken() {
  const stored = await readSoundcloudTokens();
  if (!stored || !stored.refresh_token) {
    throw new Error("SoundCloud isn't connected yet — open /api/soundcloud-connect?key=... once in your browser.");
  }
  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: need("SOUNDCLOUD_CLIENT_ID"),
      client_secret: need("SOUNDCLOUD_CLIENT_SECRET"),
      refresh_token: stored.refresh_token,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(`SoundCloud token refresh failed (${res.status}): ${JSON.stringify(data)}. If it says invalid_grant, reconnect via /api/soundcloud-connect.`);
  }
  console.log(`::add-mask::${data.access_token}`);
  console.log(`::add-mask::${data.refresh_token}`);
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      await writeSoundcloudTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        obtained_at: Date.now(),
        expires_in: data.expires_in,
      });
      return data.access_token;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw new Error(`Could not save the rotated SoundCloud token: ${lastErr.message}. You'll need to reconnect via /api/soundcloud-connect.`);
}

function curlUpload(scToken, fields) {
  const args = ["-sS", "--http1.1", "-X", "POST", "https://api.soundcloud.com/tracks",
    "-H", `Authorization: OAuth ${scToken}`, "-H", "Accept: application/json; charset=utf-8",
    "-w", "\n%{http_code}"];
  // --form-string sends text literally (no ';type=' / '@' / quote parsing); -F is only for file parts.
  for (const [k, v] of fields) args.push(...(k.endsWith("asset_data]") || k.endsWith("artwork_data]") ? ["-F", `${k}=${v}`] : ["--form-string", `${k}=${v}`]));
  return new Promise((resolve, reject) => {
    const p = spawn("curl", args);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err}`));
      const idx = out.lastIndexOf("\n");
      resolve({ status: Number(out.slice(idx + 1)), body: out.slice(0, idx) });
    });
  });
}

async function main() {
  const audioId = need("AUDIO_FILE_ID");
  const imageId = env("IMAGE_FILE_ID");
  const googleToken = await getAccessToken();

  const audioMeta = await driveMeta(googleToken, audioId);
  await assertInsideParent(googleToken, audioMeta);
  const audioPath = `/tmp/${audioMeta.name}`;
  await downloadDriveFile(googleToken, audioId, audioPath);

  let imagePath = "";
  if (imageId) {
    try {
      const imgMeta = await driveMeta(googleToken, imageId);
      await assertInsideParent(googleToken, imgMeta);
      imagePath = `/tmp/${imgMeta.name}`;
      await downloadDriveFile(googleToken, imageId, imagePath);
    } catch (e) { console.warn(`Skipping artwork: ${e.message}`); imagePath = ""; }
  }

  const scToken = await freshSoundcloudAccessToken();

  const base = [
    ["track[title]", need("TRACK_TITLE")],
    ["track[sharing]", env("SOUNDCLOUD_SHARING") || "private"],
    ["track[asset_data]", `@${audioPath}`],
  ];
  if (env("TRACK_TAGS")) base.push(["track[tag_list]", env("TRACK_TAGS")]);
  if (env("TRACK_DESCRIPTION")) base.push(["track[description]", env("TRACK_DESCRIPTION")]);

  let result = await curlUpload(scToken, imagePath ? [...base, ["track[artwork_data]", `@${imagePath}`]] : base);
  if (result.status >= 400 && imagePath) {
    console.warn(`Upload with artwork failed (${result.status}): ${result.body}\nRetrying without artwork…`);
    result = await curlUpload(scToken, base);
  }
  if (result.status >= 400) throw new Error(`SoundCloud upload failed (${result.status}): ${result.body}`);

  let info = {};
  try { info = JSON.parse(result.body); } catch {}
  console.log(`Uploaded to SoundCloud: ${info.permalink_url || result.body}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
