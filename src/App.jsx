import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { Upload, Download, Radio, Calendar, Clock, Tag, Disc3, Loader2, CheckCircle2 } from "lucide-react";

const HIGHLIGHT = "#FEBAED";
const INK = "#341616";

// ---- CONFIGURE THESE VALUES ----
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/REPLACE_WITH_YOUR_WEBHOOK_ID";
// Sent as a header on every /api call. Must match APP_UPLOAD_SECRET in Vercel's
// env vars. NOTE: since this is a static site, this string is visible to
// anyone who inspects the compiled JS — it's a speed bump against casual
// discovery of the endpoint, not a cryptographic secret.
const APP_SECRET = "REPLACE_WITH_YOUR_SHARED_SECRET";
// ---------------------------------

const JINGLE_URL = "https://drive.google.com/drive/folders/1ZCNkK2DDHu0maema4xB-Xd1m74dvZs2M?usp=drive_link";

function apiHeaders() {
  return { "Content-Type": "application/json", "x-app-secret": APP_SECRET };
}

// Filesystem/URL-safe slug: keeps letters, numbers, hyphens and underscores,
// turns whitespace into underscores, strips everything else.
function slugify(s) {
  return (s || "").toString().trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
}

function renameFile(file, newName) {
  return new File([file], newName, { type: file.type });
}

function extOf(name, fallback) {
  const m = /\.[^.]+$/.exec(name || "");
  return m ? m[0] : fallback;
}

// Finds/creates the show's Drive folder once — called BEFORE any per-file
// uploads, so parallel uploads never race and create duplicate folders.
async function getOrCreateShowFolder(folderName) {
  const res = await fetch("/api/drive-folder", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ folderName }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Folder lookup failed (HTTP ${res.status})`);
  }
  const { folderId } = await res.json();
  return folderId;
}

// Uploads a single file to Google Drive, into an already-known folder, by
// relaying it in small pieces through this app's own /api/drive-upload-chunk
// endpoint — the browser never talks to Google directly (Google's CORS
// policy doesn't allow browser-authenticated service-account requests, so a
// direct upload isn't possible), and the access token never leaves the server.
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — comfortably under Vercel's ~4.5MB function payload cap

async function uploadFileToDrive(file, folderId) {
  const initRes = await fetch("/api/drive-upload-init", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      folderId,
    }),
  });
  if (!initRes.ok) {
    const errData = await initRes.json().catch(() => ({}));
    throw new Error(errData.error || `Drive upload init failed (HTTP ${initRes.status})`);
  }
  const { uploadUrl } = await initRes.json();

  const total = file.size;
  let start = 0;
  let result = null;

  while (start < total) {
    const end = Math.min(start + CHUNK_SIZE, total);
    const chunk = file.slice(start, end);
    const chunkRes = await fetch("/api/drive-upload-chunk", {
      method: "POST",
      headers: {
        ...apiHeaders(),
        "Content-Type": "application/octet-stream",
        "x-upload-url": uploadUrl,
        "x-range-start": String(start),
        "x-range-end": String(end - 1),
        "x-total-size": String(total),
      },
      body: chunk,
    });
    if (!chunkRes.ok) {
      const errData = await chunkRes.json().catch(() => ({}));
      throw new Error(errData.error || `Drive chunk upload failed (${file.name}, HTTP ${chunkRes.status})`);
    }
    const data = await chunkRes.json();
    if (data.done) result = data;
    start = end;
  }

  if (!result) throw new Error(`Drive upload did not complete (${file.name})`);
  return {
    fileId: result.id,
    url: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
  };
}

// Wraps text into lines that each fit within maxWidth, using whatever font
// is currently set on ctx (caller must set ctx.font before calling this).
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatDateFr(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  const formatted = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatDateDMY(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

// Standard DD-MM-YYYY, used only for the webhook payload sent to Make (so it
// reads cleanly in a Google Sheet etc) — the raw YYYY-MM-DD value is kept
// everywhere else (form state, Drive folder/file names) since that sorts
// correctly chronologically.
function formatDateDashDMY(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function fontStackFor(FONTS_READY) {
  return FONTS_READY
    ? `"Alte Haas Grotesk", -apple-system, "Helvetica Neue", Arial, sans-serif`
    : `-apple-system, "Helvetica Neue", Arial, sans-serif`;
}

// ============================================================
// Main cover renderer (IG story / 1080x1440 / SoundCloud square)
// ============================================================
function renderCover(ctx, w, h, format, state) {
  const { djName, showName, date, time, genres, imgEl, logoEl, FONTS_READY, darkOverlay, isGuest, hostName } = state;

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  if (imgEl) {
    const scale = Math.max(w / imgEl.width, h / imgEl.height);
    const iw = imgEl.width * scale;
    const ih = imgEl.height * scale;
    ctx.drawImage(imgEl, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#1c1c22");
    grad.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font = `${Math.round(w * 0.045)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("upload a cover image", w / 2, h / 2);
  }

  const k = w / 1080;
  const fontStack = fontStackFor(FONTS_READY);
  const padX = 40 * k;
  const padTop = 40 * k;
  const padBottom = 40 * k;
  const maxTextWidth = 500 * k;

  const storyPad = format === "story" ? ((h - 1440 * k) / 2) : 0;
  const contentTop = storyPad;
  const contentBottom = storyPad;

  if (darkOverlay) {
    const overlayH = (format === "story" ? 550 : 260) * k;
    const grad = ctx.createLinearGradient(0, 0, 0, overlayH);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, overlayH);
  }

  // ======== LEFT COLUMN: (guest / host line) + DJ name + genre pills ========
  let leftCursor = contentTop + padTop;
  const topFontSize = 48 * k;
  const topLineHeight = topFontSize * 1.15;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (hostName && hostName.trim()) {
    const baseline = leftCursor + topFontSize * 0.78;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${topFontSize}px ${fontStack}`;
    ctx.fillText(hostName.trim(), padX, baseline);
    const hostW = ctx.measureText(hostName.trim()).width;
    ctx.font = `400 ${topFontSize}px ${fontStack}`;
    ctx.fillText(" invite", padX + hostW, baseline);
    leftCursor += topLineHeight;
  } else if (isGuest) {
    const baseline = leftCursor + topFontSize * 0.78;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `400 ${topFontSize}px ${fontStack}`;
    ctx.fillText("Guest", padX, baseline);
    leftCursor += topLineHeight;
  }

  // DJ name — bold, wraps within maxTextWidth, tighter line height + slight negative letter-spacing
  const djFontSize = 96 * k;
  const djLineHeight = djFontSize * 0.87;
  ctx.font = `700 ${djFontSize}px ${fontStack}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(-0.03 * djFontSize).toFixed(2)}px`;
  const djLines = wrapLines(ctx, djName || "dj name", maxTextWidth);
  ctx.fillStyle = "#FFFFFF";
  djLines.forEach((line, i) => {
    const baseline = leftCursor + djFontSize * 0.78 + i * djLineHeight;
    ctx.fillText(line, padX, baseline);
  });
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  leftCursor += djLines.length * djLineHeight;

  // Genre pills — up to 10, wrapping onto new rows with a 4px gap on x and y
  const genreFontSize = 32 * k;
  const genreList = genres.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 10);
  const pillGap = 4 * k;
  const pillPadX = 24 * k;
  const pillH = genreFontSize + 28 * k;
  const rightContentEdge = w - padX;
  let cx = padX;
  let pillRowY = leftCursor + 24 * k;
  ctx.font = `400 ${genreFontSize}px ${fontStack}`;
  genreList.forEach((g) => {
    const tw = ctx.measureText(g).width + pillPadX * 2;
    if (cx + tw > rightContentEdge && cx > padX) {
      cx = padX;
      pillRowY += pillH + pillGap;
    }
    ctx.fillStyle = "#FEBAED";
    ctx.beginPath();
    ctx.rect(cx, pillRowY, tw, pillH);
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "middle";
    ctx.fillText(g, cx + pillPadX, pillRowY + pillH / 2 + 1);
    ctx.textBaseline = "alphabetic";
    cx += tw + pillGap;
  });

  // ======== RIGHT COLUMN: show name + date + time ========
  let rightCursor = contentTop + padTop;
  const showFontSize = 48 * k;
  const showLineHeight = showFontSize * 1.15;
  ctx.textAlign = "right";
  const rightX = w - padX;

  ctx.font = `700 ${showFontSize}px ${fontStack}`;
  const showLines = wrapLines(ctx, showName || "Show name", maxTextWidth);
  ctx.fillStyle = "#FFFFFF";
  showLines.forEach((line, i) => {
    const baseline = rightCursor + showFontSize * 0.78 + i * showLineHeight;
    ctx.fillText(line, rightX, baseline);
  });
  rightCursor += showLines.length * showLineHeight;

  ctx.font = `400 ${showFontSize}px ${fontStack}`;
  ctx.fillText(formatDateFr(date), rightX, rightCursor + showFontSize * 0.78);
  rightCursor += showLineHeight;
  ctx.fillText(time || "", rightX, rightCursor + showFontSize * 0.78);
  rightCursor += showLineHeight;

  ctx.textAlign = "left";

  if (logoEl) {
    const logoW = w - padX * 2;
    const logoH = logoW * (logoEl.height / logoEl.width);
    ctx.drawImage(logoEl, padX, h - logoH - padBottom - contentBottom, logoW, logoH);
  }
}

function dimsForFormat(format) {
  return format === "story" ? { w: 1080, h: 1920 } :
    format === "tall" ? { w: 1080, h: 1440 } :
    { w: 1200, h: 1200 };
}

// ============================================================
// Recap text card renderer ("who's/what's playing", "tracklist")
// ============================================================
function renderTextCard(ctx, w, h, { imgEl, text, pinkText, pinkSize, bodySize, FONTS_READY }) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  if (imgEl) {
    const scale = Math.max(w / imgEl.width, h / imgEl.height);
    const iw = imgEl.width * scale;
    const ih = imgEl.height * scale;
    ctx.drawImage(imgEl, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = `${Math.round(w * 0.04)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("upload an image", w / 2, h / 2);
    ctx.textAlign = "left";
  }

  const k = w / 1080;
  const fontStack = fontStackFor(FONTS_READY);
  const margin = 40 * k;
  const pad = 24 * k;
  const stackWidth = w - margin * 2;
  const innerWidth = stackWidth - pad * 2;

  const pinkFontPx = pinkSize * k;
  const bodyFontPx = bodySize * k;
  const bodyLineHeight = bodyFontPx * 1.25;

  ctx.font = `400 ${bodyFontPx}px ${fontStack}`;
  const bodyLines = wrapLines(ctx, text || "", innerWidth);
  const bodyBlockHeight = pad * 2 + bodyLines.length * bodyLineHeight;
  const pinkBlockHeight = pad * 2 + pinkFontPx * 1.2;

  const stackTotalHeight = pinkBlockHeight + bodyBlockHeight;
  const stackBottom = h - margin;
  const stackTop = Math.max(0, stackBottom - stackTotalHeight);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#FEBAED";
  ctx.fillRect(margin, stackTop, stackWidth, pinkBlockHeight);
  ctx.fillStyle = "#111111";
  ctx.font = `400 ${pinkFontPx}px ${fontStack}`;
  ctx.fillText(pinkText, margin + pad, stackTop + pad + pinkFontPx * 0.78);

  const brownTop = stackTop + pinkBlockHeight;
  ctx.fillStyle = INK;
  ctx.fillRect(margin, brownTop, stackWidth, bodyBlockHeight);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `400 ${bodyFontPx}px ${fontStack}`;
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, margin + pad, brownTop + pad + bodyFontPx * 0.78 + i * bodyLineHeight);
  });
}

// ============================================================
// Recap video-card frame renderer ("timestamp" cards)
// ============================================================
function renderVideoFrame(ctx, w, h, video, state) {
  const { hostName, djName, showName, timestamp, date, FONTS_READY } = state;

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  if (video && video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh);
    const iw = vw * scale, ih = vh * scale;
    ctx.drawImage(video, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = `${Math.round(w * 0.04)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("upload a video", w / 2, h / 2);
  }

  const k = w / 1080;
  const fontStack = fontStackFor(FONTS_READY);
  const padX = 40 * k;
  const padTop = 40 * k;
  const fontSize = 40 * k;
  const lineHeight = fontSize * 1.3;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";

  let cursorY = padTop;
  const line1Baseline = cursorY + fontSize * 0.78;
  if (hostName && hostName.trim()) {
    ctx.font = `700 ${fontSize}px ${fontStack}`;
    ctx.fillText(hostName.trim(), padX, line1Baseline);
    const w1 = ctx.measureText(hostName.trim()).width;
    ctx.font = `400 ${fontSize}px ${fontStack}`;
    ctx.fillText(" invite ", padX + w1, line1Baseline);
    const w2 = ctx.measureText(" invite ").width;
    ctx.font = `700 ${fontSize}px ${fontStack}`;
    ctx.fillText(djName || "dj name", padX + w1 + w2, line1Baseline);
  } else {
    ctx.font = `700 ${fontSize}px ${fontStack}`;
    ctx.fillText(djName || "dj name", padX, line1Baseline);
  }
  cursorY += lineHeight;

  ctx.font = `700 ${fontSize}px ${fontStack}`;
  ctx.fillText(showName || "Show name", padX, cursorY + fontSize * 0.78);
  cursorY += lineHeight;

  ctx.font = `400 ${fontSize}px ${fontStack}`;
  ctx.fillText(timestamp || "", padX, cursorY + fontSize * 0.78);

  ctx.textAlign = "right";
  ctx.fillText(formatDateDMY(date), w - padX, padTop + fontSize * 0.78);
  ctx.textAlign = "left";
}

function waitForVideoReady(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 1) resolve();
    else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
}

function pickVideoMimeType() {
  const options = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const opt of options) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(opt)) return opt;
  }
  return "video/webm";
}

// ============================================================
// Recap sub-components
// ============================================================
const TextRecapCard = forwardRef(function TextRecapCard(
  { title, pinkText, pinkSize, bodySize, maxChars, FONTS_READY },
  ref
) {
  const [imgEl, setImgEl] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [text, setText] = useState("");
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const W = 1080, H = 1440;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    renderTextCard(canvas.getContext("2d"), W, H, { imgEl, text, pinkText, pinkSize, bodySize, FONTS_READY });
  }, [imgEl, text, pinkText, pinkSize, bodySize, FONTS_READY]);

  useEffect(() => { draw(); }, [draw]);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImgFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => setImgEl(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${title.replace(/\s+/g, "_")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  useImperativeHandle(ref, () => ({
    hasContent: () => !!imgFile,
    getBlob: () => new Promise((resolve) => canvasRef.current.toBlob(resolve, "image/png")),
  }));

  return (
    <div className="border-t pt-5" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
      <label className="label mb-2 block">{title}</label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer border border-dashed flex items-center justify-center py-8 px-2 text-center"
          style={{ borderColor: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)" }}
        >
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
            {imgFile ? imgFile.name : "upload image"}
          </span>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </div>
        <textarea
          className="input"
          rows={4}
          maxLength={maxChars || undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Text..."
        />
      </div>
      {maxChars ? (
        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{text.length}/{maxChars}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors hover:opacity-80"
          style={{ borderColor: HIGHLIGHT, color: HIGHLIGHT }}
        >
          <Download size={13} /> download image
        </button>
      </div>
      <div className="overflow-hidden border mt-3 max-w-[220px]" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
        <canvas ref={canvasRef} className="w-full h-auto block" style={{ aspectRatio: `${W} / ${H}` }} />
      </div>
    </div>
  );
});

const TimestampRecapCard = forwardRef(function TimestampRecapCard(
  { label, hostName, djName, showName, date, FONTS_READY },
  ref
) {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [timestamp, setTimestamp] = useState("");
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef(null);
  const videoElRef = useRef(null);
  const fileInputRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef({});
  const W = 1080, H = 1440;

  useEffect(() => {
    stateRef.current = { hostName, djName, showName, date, timestamp, FONTS_READY };
  }, [hostName, djName, showName, date, timestamp, FONTS_READY]);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("video/")) return;
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  useEffect(() => {
    const video = videoElRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    let active = true;

    function loop() {
      if (!active) return;
      renderVideoFrame(ctx, W, H, video, stateRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    if (videoUrl) {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.play().catch(() => {});
      rafRef.current = requestAnimationFrame(loop);
    } else {
      renderVideoFrame(ctx, W, H, null, stateRef.current);
    }
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) {
      const canvas = canvasRef.current;
      if (canvas) renderVideoFrame(canvas.getContext("2d"), W, H, null, stateRef.current);
    }
  }, [hostName, djName, showName, date, timestamp, FONTS_READY, videoUrl]);

  const exportVideo = useCallback(async () => {
    const video = videoElRef.current;
    if (!video || !videoFile) throw new Error("No video uploaded");
    await waitForVideoReady(video);

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = W;
    exportCanvas.height = H;
    const ctx = exportCanvas.getContext("2d");
    const stream = exportCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: pickVideoMimeType() });
    const chunks = [];

    const donePromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      recorder.onerror = reject;
    });

    video.currentTime = 0;
    video.muted = true;
    video.loop = true;
    await video.play().catch(() => {});

    const DURATION_MS = 20000;
    const startTime = performance.now();
    recorder.start();

    await new Promise((resolve) => {
      function frameLoop() {
        const elapsed = performance.now() - startTime;
        renderVideoFrame(ctx, W, H, video, stateRef.current);
        if (elapsed < DURATION_MS) {
          requestAnimationFrame(frameLoop);
        } else {
          video.loop = false;
          recorder.stop();
          resolve();
        }
      }
      requestAnimationFrame(frameLoop);
    });

    return donePromise;
  }, [videoFile]);

  const handleDownload = async () => {
    setExporting(true);
    try {
      const blob = await exportVideo();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${label.replace(/\s+/g, "_")}.webm`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  useImperativeHandle(ref, () => ({
    hasContent: () => !!videoFile,
    getBlob: () => exportVideo(),
  }));

  return (
    <div className="border-t pt-5" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
      <label className="label mb-2 block">{label}</label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer border border-dashed flex items-center justify-center py-8 px-2 text-center"
          style={{ borderColor: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)" }}
        >
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
            {videoFile ? videoFile.name : "upload video"}
          </span>
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </div>
        <Field label="Timestamp">
          <input className="input" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} placeholder="e.g. 01:23:45" />
        </Field>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={exporting || !videoFile}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ borderColor: HIGHLIGHT, color: HIGHLIGHT }}
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {exporting ? "processing (~20s)…" : "download video"}
        </button>
      </div>
      <video ref={videoElRef} src={videoUrl || undefined} className="hidden" playsInline muted />
      <div className="overflow-hidden border mt-3 max-w-[220px]" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
        <canvas ref={canvasRef} className="w-full h-auto block" style={{ aspectRatio: `${W} / ${H}` }} />
      </div>
    </div>
  );
});

// ============================================================
// Main component
// ============================================================
export default function ShowCoverStudio() {
  const [djName, setDjName] = useState("");
  const [isGuest, setIsGuest] = useState(false);
  const [hostName, setHostName] = useState("");
  const [showName, setShowName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [genres, setGenres] = useState("");
  const [igSoundtrack, setIgSoundtrack] = useState("");
  const [jingleConfirmed, setJingleConfirmed] = useState(false);
  const [format, setFormat] = useState("story");
  const [imgEl, setImgEl] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [logoEl, setLogoEl] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [FONTS_READY, setFontsReady] = useState(false);
  const [darkOverlay, setDarkOverlay] = useState(true);
  const [convertingImage, setConvertingImage] = useState(false);
  const [wantsRecap, setWantsRecap] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  const recap1Ref = useRef(null); // who's playing (conditional)
  const recap2Ref = useRef(null); // what's playing
  const recap3Ref = useRef(null); // tracklist
  const recap4Ref = useRef(null); // timestamp x4
  const recap5Ref = useRef(null);
  const recap6Ref = useRef(null);
  const recap7Ref = useRef(null);

  useEffect(() => {
    Promise.all([
      document.fonts.load('700 96px "Alte Haas Grotesk"'),
      document.fonts.load('700 48px "Alte Haas Grotesk"'),
      document.fonts.load('400 48px "Alte Haas Grotesk"'),
      document.fonts.load('400 32px "Alte Haas Grotesk"'),
      document.fonts.load('400 36px "Alte Haas Grotesk"'),
    ])
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(false));
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoEl(img);
    img.src = "/logo.svg";
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    if (!isHeic && !file.type.startsWith("image/")) return;

    let workingFile = file;
    if (isHeic) {
      setConvertingImage(true);
      try {
        const heic2any = (await import("heic2any")).default;
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
        const blob = Array.isArray(converted) ? converted[0] : converted;
        workingFile = new File([blob], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
      } catch (err) {
        console.error("HEIC conversion failed:", err);
        setConvertingImage(false);
        return;
      }
      setConvertingImage(false);
    }

    setImgFile(workingFile);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => setImgEl(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(workingFile);
  }, []);

  const dims = dimsForFormat(format);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dims;
    canvas.width = w;
    canvas.height = h;
    renderCover(canvas.getContext("2d"), w, h, format, {
      djName, showName, date, time, genres, imgEl, logoEl, FONTS_READY, darkOverlay, isGuest, hostName,
    });
  }, [djName, showName, date, time, genres, format, imgEl, logoEl, dims, FONTS_READY, darkOverlay, isGuest, hostName]);

  useEffect(() => { draw(); }, [draw]);

  const renderFormatToBlob = useCallback((fmt) => {
    const { w, h } = dimsForFormat(fmt);
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    renderCover(offscreen.getContext("2d"), w, h, fmt, {
      djName, showName, date, time, genres, imgEl, logoEl, FONTS_READY, darkOverlay, isGuest, hostName,
    });
    return new Promise((resolve) => offscreen.toBlob(resolve, "image/png"));
  }, [djName, showName, date, time, genres, imgEl, logoEl, FONTS_READY, darkOverlay, isGuest, hostName]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = `BLTshow-${slugify(djName) || "artist"}-${date || "date"}`;
    const link = document.createElement("a");
    link.download = `${base}-${format}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const canSubmit = djName && showName && date && time && imgFile && audioFile && status !== "submitting";

  const isDateTooSoon = () => {
    if (!date) return false;
    const showDate = new Date(date + "T00:00:00");
    const now = new Date();
    return showDate - now < 7 * 24 * 60 * 60 * 1000;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!jingleConfirmed) {
      setStatus("error");
      setErrorMessage("You need to add the jingle in your sound file before submitting.");
      return;
    }
    if (isDateTooSoon()) {
      setStatus("error");
      setErrorMessage("Your show is in less than a week : too late to submit your info :( - Check with us to set another date.");
      return;
    }

    setStatus("submitting");
    setErrorMessage("");
    try {
      const base = `BLTshow-${slugify(djName) || "artist"}-${date || "date"}`;
      const folderId = await getOrCreateShowFolder(base);

      const [storyBlob, tallBlob, squareBlob] = await Promise.all([
        renderFormatToBlob("story"),
        renderFormatToBlob("tall"),
        renderFormatToBlob("square"),
      ]);

      const imgExt = extOf(imgFile.name, ".jpg");
      const audioExt = extOf(audioFile.name, ".mp3");

      const [coverRes, audioRes, storyRes, tallRes, scRes] = await Promise.all([
        uploadFileToDrive(renameFile(imgFile, `${base}-cover${imgExt}`), folderId),
        uploadFileToDrive(renameFile(audioFile, `${base}-audio${audioExt}`), folderId),
        uploadFileToDrive(new File([storyBlob], `${base}-story.png`, { type: "image/png" }), folderId),
        uploadFileToDrive(new File([tallBlob], `${base}-1440.png`, { type: "image/png" }), folderId),
        uploadFileToDrive(new File([squareBlob], `${base}-soundcloud.png`, { type: "image/png" }), folderId),
      ]);

      const recapPayload = {};
      if (wantsRecap) {
        const textRefs = [recap1Ref, recap2Ref, recap3Ref];
        const textResults = await Promise.all(
          textRefs.map(async (r, i) => {
            if (!r.current || !r.current.hasContent()) return null;
            const blob = await r.current.getBlob();
            return uploadFileToDrive(new File([blob], `${base}-recap${i + 1}.png`, { type: "image/png" }), folderId);
          })
        );
        textResults.forEach((r, i) => { if (r) recapPayload[`recap${i + 1}Url`] = r.url; });

        // Video exports run one at a time (each takes ~20s to record) rather
        // than in parallel, to avoid overloading the browser with several
        // simultaneous video decodes + canvas recordings at once.
        const videoRefs = [recap4Ref, recap5Ref, recap6Ref, recap7Ref];
        for (let i = 0; i < videoRefs.length; i++) {
          const r = videoRefs[i];
          if (r.current && r.current.hasContent()) {
            const blob = await r.current.getBlob();
            const uploaded = await uploadFileToDrive(new File([blob], `${base}-timestamp${i + 4}.webm`, { type: "video/webm" }), folderId);
            recapPayload[`recap${i + 4}Url`] = uploaded.url;
          }
        }
      }

      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        // text/plain avoids a CORS preflight; Make still auto-parses JSON regardless of header
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          djName, isGuest, hostName, showName, date: formatDateDashDMY(date), time, genres, igSoundtrack,
          coverImageUrl: coverRes.url,
          audioDriveUrl: audioRes.url,
          audioFileName: audioFile.name,
          igStoryImageUrl: storyRes.url,
          tallImageUrl: tallRes.url,
          soundcloudImageUrl: scRes.url,
          showFolderId: folderId,
          wantsRecap,
          ...recapPayload,
        }),
      });
      if (!res.ok) throw new Error("Webhook rejected the submission");
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorMessage(err.message || "Something went wrong — check the console and your Drive/webhook config.");
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#341616] text-white p-6 md:p-10" style={{ fontFamily: `"Alte Haas Grotesk", -apple-system, "Helvetica Neue", Arial, sans-serif` }}>
      <div className="max-w-5xl mx-auto relative mb-8">
        <a href="https://blt-radio.com/" target="_blank" rel="noopener noreferrer" className="block">
          <img src="/logo.svg" alt="BLT Radio" className="w-full h-auto block" />
        </a>
        <div className="absolute top-0 right-0 flex items-center gap-4">
          <a href="https://www.instagram.com/blt_radio/" target="_blank" rel="noopener noreferrer">
            <img src="/instagram-logo.svg" alt="Instagram" style={{ width: 22, height: 22, filter: "brightness(0) invert(1)" }} />
          </a>
          <a href="https://soundcloud.com/blt-radio" target="_blank" rel="noopener noreferrer">
            <img src="/soundcloud-logo.svg" alt="SoundCloud" style={{ width: 22, height: 22, filter: "brightness(0) invert(1)" }} />
          </a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <Radio size={20} color={HIGHLIGHT} />
          <span className="text-xs tracking-widest uppercase" style={{ color: HIGHLIGHT }}>
            resident show submission
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold mb-8">Submit your show</h1>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-5">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Field label="DJ name" icon={<Disc3 size={14} />}>
                  <input className="input" value={djName} onChange={(e) => setDjName(e.target.value)} placeholder="DJ Nova" />
                </Field>
              </div>
              <div>
                <label className="label mb-1.5 block">Guest</label>
                <div className="flex border" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
                  {[{ id: false, label: "No" }, { id: true, label: "Yes" }].map((opt) => (
                    <button
                      key={String(opt.id)}
                      type="button"
                      onClick={() => setIsGuest(opt.id)}
                      className="px-3 py-2.5 text-xs transition-colors"
                      style={{ background: isGuest === opt.id ? HIGHLIGHT : "transparent", color: isGuest === opt.id ? INK : "rgba(255,255,255,0.6)" }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Field label="IF invitation:">
              <input className="input" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Host name (optional)" />
            </Field>

            <Field label="Show name">
              <input className="input" value={showName} onChange={(e) => setShowName(e.target.value)} placeholder="Midnight Frequencies" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <Field label="Air date" icon={<Calendar size={14} />}>
                  <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
              <div className="min-w-0">
                <Field label="Air time" icon={<Clock size={14} />}>
                  <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
            </div>

            <Field label="Genres (comma-separated, up to 10)" icon={<Tag size={14} />}>
              <input className="input" value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="deep house, techno" />
            </Field>

            <Field label="Soundtrack for the IG story (optional)">
              <input
                className="input"
                value={igSoundtrack}
                onChange={(e) => setIgSoundtrack(e.target.value)}
                placeholder="Song or artist to use as the story's audio"
              />
            </Field>

            <div>
              <label className="label mb-2 block">Cover image</label>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer border border-dashed flex flex-col items-center justify-center gap-2 py-8 transition-colors"
                style={{ borderColor: dragOver ? HIGHLIGHT : "rgba(255,255,255,0.2)", background: dragOver ? "rgba(254,186,237,0.08)" : "rgba(255,255,255,0.03)" }}
              >
                <Upload size={18} color={dragOver ? HIGHLIGHT : "rgba(255,255,255,0.5)"} />
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {convertingImage ? "converting HEIC…" : imgFile ? imgFile.name : "drag & drop, or click to upload"}
                </span>
                <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
              </div>
            </div>

            <div>
              <label className="label mb-2 block">Show audio file (.mp3 / .wav)</label>
              <div
                onClick={() => audioInputRef.current?.click()}
                className="cursor-pointer border border-dashed flex flex-col items-center justify-center gap-2 py-6 transition-colors"
                style={{ borderColor: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)" }}
              >
                <Upload size={18} color="rgba(255,255,255,0.5)" />
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {audioFile ? audioFile.name : "click to upload the show file"}
                </span>
                <input ref={audioInputRef} type="file" accept=".mp3,.wav,audio/*" className="hidden" onChange={(e) => setAudioFile(e.target.files[0])} />
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={jingleConfirmed}
                onChange={(e) => setJingleConfirmed(e.target.checked)}
                className="mt-1 accent-[#FEBAED]"
              />
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                I added the BLT{" "}
                <a href={JINGLE_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: HIGHLIGHT }}>
                  jingle
                </a>{" "}
                in my show audio file
              </span>
            </label>

            <div className="flex items-center justify-between border-t pt-5" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
              <label className="label">Want a recap post on Instagram?</label>
              <div className="flex border" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
                {[{ id: false, label: "No" }, { id: true, label: "Yes" }].map((opt) => (
                  <button
                    key={String(opt.id)}
                    type="button"
                    onClick={() => setWantsRecap(opt.id)}
                    className="px-3 py-2 text-xs transition-colors"
                    style={{ background: wantsRecap === opt.id ? HIGHLIGHT : "transparent", color: wantsRecap === opt.id ? INK : "rgba(255,255,255,0.6)" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {wantsRecap && (
              <div className="space-y-5">
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Fill in whichever recap visuals you want — none are required. The four "timestamp" videos each take about 20 seconds to process when you download them or submit, so keep this tab open.
                </p>
                {(isGuest || hostName.trim()) && (
                  <TextRecapCard ref={recap1Ref} title="Who's playing" pinkText="On écoute qui ?" pinkSize={32} bodySize={36} maxChars={600} FONTS_READY={FONTS_READY} />
                )}
                <TextRecapCard ref={recap2Ref} title="What's playing" pinkText="On écoute quoi ?" pinkSize={32} bodySize={36} maxChars={600} FONTS_READY={FONTS_READY} />
                <TextRecapCard ref={recap3Ref} title="Tracklist (optional)" pinkText="Tracklist" pinkSize={32} bodySize={32} maxChars={null} FONTS_READY={FONTS_READY} />
                <TimestampRecapCard ref={recap4Ref} label="Timestamp clip 1" hostName={hostName} djName={djName} showName={showName} date={date} FONTS_READY={FONTS_READY} />
                <TimestampRecapCard ref={recap5Ref} label="Timestamp clip 2" hostName={hostName} djName={djName} showName={showName} date={date} FONTS_READY={FONTS_READY} />
                <TimestampRecapCard ref={recap6Ref} label="Timestamp clip 3" hostName={hostName} djName={djName} showName={showName} date={date} FONTS_READY={FONTS_READY} />
                <TimestampRecapCard ref={recap7Ref} label="Timestamp clip 4" hostName={hostName} djName={djName} showName={showName} date={date} FONTS_READY={FONTS_READY} />
              </div>
            )}

            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
              Download your visuals now so you can post your recap on instagram!
            </p>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm uppercase tracking-wide transition-opacity disabled:opacity-40"
              style={{ background: HIGHLIGHT, color: INK }}
            >
              {status === "submitting" && <Loader2 size={16} className="animate-spin" />}
              {status === "done" && <CheckCircle2 size={16} />}
              {status === "submitting" ? "Uploading…" : status === "done" ? "Submitted!" : "Submit show"}
            </button>
            {status === "error" && (
              <p className="text-xs" style={{ color: "#e07a5f" }}>{errorMessage}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
                {[
                  { id: "story", label: "IG story" },
                  { id: "tall", label: "1080×1440" },
                  { id: "square", label: "SoundCloud" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className="px-3 py-1.5 text-xs transition-colors"
                    style={{ background: format === f.id ? HIGHLIGHT : "transparent", color: format === f.id ? INK : "rgba(255,255,255,0.6)" }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors hover:opacity-80"
                style={{ borderColor: HIGHLIGHT, color: HIGHLIGHT }}
              >
                <Download size={13} /> download
              </button>
            </div>

            <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={darkOverlay}
                onChange={(e) => setDarkOverlay(e.target.checked)}
                className="accent-[#FEBAED]"
              />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Dark overlay behind text (recommended for light images)
              </span>
            </label>

            <div className="overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
              <canvas ref={canvasRef} className="w-full h-auto block" style={{ aspectRatio: `${dims.w} / ${dims.h}` }} />
            </div>
            <p className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.4)" }}>
              This preview updates as you type. Submitting sends your files + info to the automation pipeline.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); border-radius: 0; padding: 10px 12px; color: #FFFFFF; font-size: 14px; outline: none; font-family: inherit; }
        .input:focus { border-color: ${HIGHLIGHT}; }
        .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.5); }
      `}</style>
    </div>
  );
}

function Field({ label, icon, children }) {
  return (
    <div>
      <label className="label mb-1.5 flex items-center gap-1.5">{icon} {label}</label>
      {children}
    </div>
  );
}
