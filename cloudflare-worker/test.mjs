// Local logic test (node cloudflare-worker/test.mjs): stubs Google + FixedLengthStream.
import worker from "./worker.js";
import assert from "node:assert/strict";

globalThis.FixedLengthStream = class {
  constructor(n) { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; this.n = n; }
};
let lastUpstream = null;
globalThis.fetch = async (url, init) => {
  const body = new Uint8Array(await new Response(init.body).arrayBuffer());
  lastUpstream = { url, init, size: body.length };
  const total = Number(init.headers["Content-Range"].split("/")[1]);
  const end = Number(init.headers["Content-Range"].match(/-(\d+)\//)[1]);
  if (url.includes("bad")) return new Response("nope", { status: 403 });
  return end + 1 < total
    ? new Response(null, { status: 308 })
    : new Response(JSON.stringify({ id: "FILE123", webViewLink: "https://drive.google.com/file/d/FILE123/view" }), { status: 200 });
};

const env = { ALLOWED_ORIGIN: "https://site.example", APP_UPLOAD_SECRET: "s3cret" };
const GOOD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";
const mk = (over = {}, body = new Uint8Array(1000)) => new Request("https://w.example/", {
  method: "POST", body,
  headers: { Origin: "https://site.example", "x-app-secret": "s3cret", "x-upload-url": GOOD,
    "x-range-start": "0", "x-range-end": "999", "x-total-size": "2000", "content-type": "application/octet-stream", "content-length": String(body.length), ...over },
});

let r = await worker.fetch(new Request("https://w.example/", { method: "OPTIONS", headers: { Origin: "https://site.example" } }), env);
assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "https://site.example");

r = await worker.fetch(new Request("https://w.example/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
assert.equal(r.status, 403);

r = await worker.fetch(mk({ Origin: "https://evil.example" }), env); assert.equal(r.status, 403);
r = await worker.fetch(mk({ "x-app-secret": "wrong" }), env); assert.equal(r.status, 401);
r = await worker.fetch(mk({ "x-upload-url": "https://evil.example/steal" }), env); assert.equal(r.status, 400);

r = await worker.fetch(mk(), env);
assert.equal(r.status, 200); assert.deepEqual(await r.json(), { done: false });
assert.equal(lastUpstream.size, 1000); assert.equal(lastUpstream.init.headers["Content-Range"], "bytes 0-999/2000");
assert.equal(lastUpstream.init.redirect, "manual");

r = await worker.fetch(mk({ "x-range-start": "1000", "x-range-end": "1999" }), env);
assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.done, true); assert.equal(j.id, "FILE123");

r = await worker.fetch(mk({ "x-upload-url": GOOD + "&bad=1" }), env); assert.equal(r.status, 502);
console.log("worker logic: all checks passed");
