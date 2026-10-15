// /api/free-image  (Vercel serverless function)
// One free AI-improved version of an ad, from the free heatmap page (/heatmap). No sign-up.
// The heatmap itself still runs only in the browser. This is a separate step the person chooses:
// a small copy of their ad (under 512 px) and the heatmap's tips are sent to Cloudflare Workers AI
// (FLUX.2 klein, a basic model); the new image goes straight back. Neither image is stored.
//
//   GET   -> { ready }                      (the page shows the button only when ready)
//   POST  { image: dataURL (small jpeg), width, height, tips: [..], device, turnstile }
//         -> { image: "data:image/...;base64,..." }
//
// Limits (so it can't be used again and again):
//   1 per browser (device id kept in the browser), FREE_IMAGE_PER_IP_DAY per IP address per day (default 3),
//   FREE_IMAGE_DAILY_CAP for everyone together per day (default 60, inside Cloudflare's free daily allowance),
//   plus Cloudflare Turnstile (the same "are you human" check as the sign-up form).
// IP addresses and device ids are stored only as salted hashes (table free_images, see supabase.sql).
// Days reset at midnight India time. Failed attempts don't count.
//
// Vercel env (Project → Settings → Environment Variables):
//   CF_ACCOUNT_ID         Cloudflare → Workers AI (or any page) → Account ID
//   CF_API_TOKEN          Cloudflare → My Profile → API Tokens → Create token → "Workers AI" template
//   SUPABASE_SECRET_KEY   already set for /api/signup
//   TURNSTILE_SECRET_KEY  already set for /api/signup (if missing, the human check is skipped)
//   optional: FREE_IMAGE_DAILY_CAP, FREE_IMAGE_PER_IP_DAY, FREE_IMAGE_MODEL, IP_HASH_SALT

import { createHash } from "node:crypto";

export const config = { maxDuration: 60 };

const SB_URL = String(process.env.SUPABASE_URL || "https://zzfldryjluevajwbitra.supabase.co").trim().replace(/\/+$/, "");
const SB_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const TS_SECRET = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
const CF_ACCOUNT = String(process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = String(process.env.CF_API_TOKEN || "").trim();
const MODEL = String(process.env.FREE_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-klein-4b").trim();
const DAILY_CAP = Number(process.env.FREE_IMAGE_DAILY_CAP) || 60;
const PER_IP = Number(process.env.FREE_IMAGE_PER_IP_DAY) || 3;
const SALT = String(process.env.IP_HASH_SALT || SB_KEY);
const READY = !!(SB_KEY && CF_ACCOUNT && CF_TOKEN);

const hash = (s) => createHash("sha256").update(SALT + "|" + s).digest("hex").slice(0, 40);
function dayStartIST() {
  const n = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - 5.5 * 3600e3).toISOString();
}
async function db(path, { method = "GET", body, prefer } = {}) {
  const headers = { apikey: SB_KEY, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
  if (!/^sb_/.test(SB_KEY)) headers.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`db ${method} ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function count(filter) {
  const rows = await db(`free_images?select=id&status=neq.failed&${filter}&limit=1000`);
  return rows ? rows.length : 0;
}

async function isHuman(token, ip) {
  if (!TS_SECRET) return true;
  if (!token || token.length > 2048) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: TS_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const v = await r.json();
    return v.success === true && (!v.action || v.action === "free_image");
  } catch (e) { console.error("turnstile verify failed", e); return false; }
}

// Keep the ad's shape: longest side 1024, both sides divisible by 16, within 256-1920.
function sizeFor(w, h) {
  const r = Math.min(3, Math.max(1 / 3, (Number(w) || 1) / (Number(h) || 1)));
  const W = r >= 1 ? 1024 : 1024 * r, H = r >= 1 ? 1024 / r : 1024;
  const s = (x) => Math.min(1920, Math.max(256, Math.round(x / 16) * 16));
  return [s(W), s(H)];
}
const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 220)).filter(Boolean).slice(0, 4);

function prompt(tips) {
  return `Professional advertising image. Recreate the ad in image 0 as an improved version of the SAME ad.
Keep exactly: the same product (shape, colours, details), the same brand and logo, the same people. Do not invent new products or logos.
Improve it so the product or offer is the first thing people notice:
${tips.map((t) => `- ${t}`).join("\n")}
Keep any text short and spelled exactly as in the original. Do not add prices, discounts, ratings or claims that are not in the original.
Clean, sharp, well-lit, high-quality ad for social media.`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    // Names of what's missing only, never any values, so setup problems are easy to spot.
    const missing = [!CF_ACCOUNT && "CF_ACCOUNT_ID", !CF_TOKEN && "CF_API_TOKEN", !SB_KEY && "SUPABASE_SECRET_KEY"].filter(Boolean);
    if (!READY) return res.status(200).json({ ready: false, missing });
    try { await db("free_images?select=id&limit=1"); return res.status(200).json({ ready: true }); }
    catch (e) { console.error("free-image status", e); return res.status(200).json({ ready: false, missing: ["free_images table (run the SQL in supabase.sql)"] }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!READY) return res.status(503).json({ error: "The free AI image isn't switched on yet." });

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const ip = String(req.headers["x-vercel-forwarded-for"] || req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0]).split(",")[0].trim();
  const device = String(b.device || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64);
  const image = String(b.image || "");
  const tips = clean(b.tips);

  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 600000) return res.status(400).json({ error: "Please add your ad image again." });
  if (!tips.length) return res.status(400).json({ error: "There's nothing to change in this ad." });
  if (device.length < 16) return res.status(400).json({ error: "Please refresh the page and try again." });
  if (!(await isHuman(String(b.turnstile || ""), ip))) return res.status(403).json({ error: "We couldn't confirm you're a person. Please try again, or turn off ad blockers for this page." });

  const ipHash = hash("ip:" + (ip || "unknown")), devHash = hash("dev:" + device), today = encodeURIComponent(dayStartIST());
  let rowId = null;
  try {
    if (await count(`device_hash=eq.${devHash}`) >= 1) return res.status(429).json({ error: "You've already used your free AI image on this device.", used: true });
    if (await count(`ip_hash=eq.${ipHash}&created_at=gte.${today}`) >= PER_IP) return res.status(429).json({ error: "Free AI images from this network are used up for today. Try again tomorrow.", used: true });
    if (await count(`created_at=gte.${today}`) >= DAILY_CAP) return res.status(429).json({ error: "Today's free AI images are all gone. Please try again tomorrow." });

    // Hold the place first, so quick repeat clicks can't get past the limits.
    const held = await db("free_images", { method: "POST", prefer: "return=representation", body: { ip_hash: ipHash, device_hash: devHash, status: "pending", model: MODEL } });
    rowId = held && held[0] && held[0].id;

    const [w, h] = sizeFor(b.width, b.height);
    const form = new FormData();
    form.append("prompt", prompt(tips));
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(image);
    form.append("input_image_0", new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), "ad.jpg");
    form.append("width", String(w));
    form.append("height", String(h));

    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${MODEL}`, {
      method: "POST", headers: { Authorization: `Bearer ${CF_TOKEN}` }, body: form, signal: AbortSignal.timeout(50000),
    });
    const text = await r.text();
    let out = null; try { out = JSON.parse(text); } catch { /* not JSON */ }
    const b64 = out && out.result && out.result.image;
    if (!r.ok || !b64) {
      console.error("free-image cloudflare", r.status, text.slice(0, 400));
      const why = out && Array.isArray(out.errors) && out.errors.length ? out.errors.map((x) => `${x.code || ""} ${x.message || ""}`.trim()).join("; ") : text.slice(0, 160);
      throw new Error(`cloudflare ${r.status}: ${why}`);
    }
    // Privacy policy promise: hashes are deleted within 90 days. Tidy up now and then (about 1 in 20 images).
    if (Math.random() < 0.05) await db(`free_images?created_at=lt.${encodeURIComponent(new Date(Date.now() - 85 * 864e5).toISOString())}`, { method: "DELETE", prefer: "return=minimal" }).catch((e) => console.error("free-image cleanup", e));
    const type = b64.startsWith("/9j/") ? "jpeg" : b64.startsWith("UklG") ? "webp" : "png";
    if (rowId) await db(`free_images?id=eq.${rowId}`, { method: "PATCH", body: { status: "done" }, prefer: "return=minimal" }).catch(() => {});
    return res.status(200).json({ image: `data:image/${type};base64,${b64}` });
  } catch (e) {
    console.error("free-image", e);
    if (rowId) await db(`free_images?id=eq.${rowId}`, { method: "PATCH", body: { status: "failed" }, prefer: "return=minimal" }).catch(() => {});
    // detail: the technical reason (no keys or personal data), for fixing setup problems; the page doesn't show it.
    return res.status(502).json({ error: "Couldn't make the image right now. Please try again in a minute. This didn't use up your free image.", detail: String(e && e.message || e).slice(0, 300) });
  }
}
