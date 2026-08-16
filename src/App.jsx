import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Radio, Calendar, Clock, Tag, Disc3, Loader2, CheckCircle2 } from "lucide-react";

const HIGHLIGHT = "#FEBAED";
const INK = "#341616";
const WHITE = "#FFFFFF";

// ---- CONFIGURE THESE THREE VALUES ----
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/5g4awnajt7q4iz6hp2i554v4v3364jfc";
const CLOUDINARY_CLOUD_NAME = "rkk64dqh";
const CLOUDINARY_UPLOAD_PRESET = "iggjii4o";
// ---------------------------------------

async function uploadToCloudinary(file, resourceType) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Cloudinary upload failed (${resourceType})`);
  const data = await res.json();
  return data.secure_url;
}

export default function ShowCoverStudio() {
  const [djName, setDjName] = useState("");
  const [showName, setShowName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [genres, setGenres] = useState("");
  const [format, setFormat] = useState("story");
  const [imgEl, setImgEl] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [logoEl, setLogoEl] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("idle");
  const [FONTS_READY, setFontsReady] = useState(false);
  const [darkOverlay, setDarkOverlay] = useState(true);
  const [igSoundtrack, setIgSoundtrack] = useState("");

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  // Wait for the custom font to actually be loaded before the canvas draws
  // text with it — canvas doesn't re-flow on late font load like the DOM does.
  useEffect(() => {
    Promise.all([
      document.fonts.load('700 96px "Alte Haas Grotesk"'),
      document.fonts.load('700 48px "Alte Haas Grotesk"'),
      document.fonts.load('400 48px "Alte Haas Grotesk"'),
      document.fonts.load('400 32px "Alte Haas Grotesk"'),
    ])
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(false)); // falls back to system font if not installed yet
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoEl(img);
    img.src = "/logo.svg";
  }, []);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImgFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => setImgEl(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const dims =
    format === "story" ? { w: 1080, h: 1920 } :
    format === "tall" ? { w: 1080, h: 1440 } :
    { w: 1200, h: 1200 };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dims;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

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

    // All measurements below are calibrated against a 1080px-wide canvas,
    // so we scale everything by k = w / 1080 to stay correct at other widths
    // (e.g. the 1200px-wide SoundCloud square).
    const k = w / 1080;
    const fontStack = FONTS_READY
      ? `"Alte Haas Grotesk", -apple-system, "Helvetica Neue", Arial, sans-serif`
      : `-apple-system, "Helvetica Neue", Arial, sans-serif`;
    const padX = 40 * k;
    const padTop = 40 * k;
    const padBottom = 40 * k;

    // The story format (1080x1920) gets equal top/bottom padding so the
    // actual text-to-logo content zone is a consistent 1440px tall, matching
    // the "tall" 1080x1440 export. Other formats have no added padding.
    const storyPad = format === "story" ? ((h - 1440 * k) / 2) : 0;
    const contentTop = storyPad;
    const contentBottom = storyPad;

    // ---- Optional dark gradient overlay behind the top text block ----
    // Helps text stay legible when the uploaded cover photo is light.
    // Always anchored to the very top of the canvas (not the padded content
    // zone), so in the story format it spans the padding *and* into the
    // text area rather than being offset by it.
    if (darkOverlay) {
      const overlayH = (format === "story" ? 550 : 260) * k;
      const grad = ctx.createLinearGradient(0, 0, 0, overlayH);
      grad.addColorStop(0, "rgba(0,0,0,0.55)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, overlayH);
    }

    // ---- DJ name (top-left) ----
    const djFontSize = 96 * k;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${djFontSize}px ${fontStack}`;
    const djBaseline = contentTop + padTop + djFontSize * 0.78;
    ctx.fillText(djName || "dj name", padX, djBaseline);

    // ---- Genre pills (below DJ name) ----
    const genreFontSize = 32 * k;
    const genreList = genres.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 4);
    let cx = padX;
    const pillY = djBaseline + djFontSize * 0.32;
    const pillH = genreFontSize + 28 * k;
    const pillPadX = 24 * k;
    const pillGap = 18 * k;
    ctx.font = `400 ${genreFontSize}px ${fontStack}`;
    genreList.forEach((g) => {
      const tw = ctx.measureText(g).width + pillPadX * 2;
      ctx.fillStyle = "#FEBAED";
      ctx.beginPath();
      ctx.rect(cx, pillY, tw, pillH);
      ctx.fill();
      ctx.fillStyle = "#111111";
      ctx.textBaseline = "middle";
      ctx.fillText(g, cx + pillPadX, pillY + pillH / 2 + 1);
      ctx.textBaseline = "alphabetic";
      cx += tw + pillGap;
    });

    // ---- Show name / date / time (top-right, right-aligned) ----
    const showFontSize = 48 * k;
    const lineHeight = showFontSize * 1.15;
    ctx.textAlign = "right";
    const rightX = w - padX;
    ctx.fillStyle = "#FFFFFF";
    const showBaseline = contentTop + padTop + showFontSize * 0.78;
    ctx.font = `700 ${showFontSize}px ${fontStack}`;
    ctx.fillText(showName || "Show name", rightX, showBaseline);
    ctx.font = `400 ${showFontSize}px ${fontStack}`;
    ctx.fillText(formatDateFr(date), rightX, showBaseline + lineHeight);
    ctx.fillText(time || "", rightX, showBaseline + lineHeight * 2);
    ctx.textAlign = "left";

    // ---- Logo (bottom-left) ----
    if (logoEl) {
      const logoW = w - padX * 2;
      const logoH = logoW * (logoEl.height / logoEl.width);
      ctx.drawImage(logoEl, padX, h - logoH - padBottom - contentBottom, logoW, logoH);
    }
  }, [djName, showName, date, time, genres, format, imgEl, logoEl, dims, FONTS_READY, darkOverlay]);

  useEffect(() => { draw(); }, [draw]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${(showName || "show").replace(/\s+/g, "_").toLowerCase()}_${format}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const canSubmit = djName && showName && date && time && imgFile && audioFile && status !== "submitting";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStatus("submitting");
    try {
      const [coverImageUrl, audioUrl] = await Promise.all([
        uploadToCloudinary(imgFile, "image"),
        uploadToCloudinary(audioFile, "video"), // Cloudinary uses the "video" resource type for audio files too
      ]);

      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          djName, showName, date, time, genres, igSoundtrack,
          coverImageUrl, audioUrl, audioFileName: audioFile.name,
        }),
      });
      if (!res.ok) throw new Error("Webhook rejected the submission");
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#341616] text-white p-6 md:p-10" style={{ fontFamily: `"Alte Haas Grotesk", -apple-system, "Helvetica Neue", Arial, sans-serif` }}>
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
            <Field label="DJ name" icon={<Disc3 size={14} />}>
              <input className="input" value={djName} onChange={(e) => setDjName(e.target.value)} placeholder="DJ Nova" />
            </Field>

            <Field label="Show name">
              <input className="input" value={showName} onChange={(e) => setShowName(e.target.value)} placeholder="Midnight Frequencies" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Air date" icon={<Calendar size={14} />}>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Air time" icon={<Clock size={14} />}>
                <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>

            <Field label="Genres (comma-separated)" icon={<Tag size={14} />}>
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
                  {imgFile ? imgFile.name : "drag & drop, or click to upload"}
                </span>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
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
              <p className="text-xs" style={{ color: "#e07a5f" }}>Something went wrong — check the console and your webhook/Cloudinary config.</p>
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

function formatDateFr(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  // "Dimanche 9 août" — capitalized weekday, day number, lowercase month, no year (matches template)
  const formatted = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
