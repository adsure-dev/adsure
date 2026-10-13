// POST /api/signup  (Vercel serverless function)
// Saves one early-access sign-up, but only after Cloudflare Turnstile confirms a real person filled the form.
// Bots can't skip this: once the "lock" SQL in supabase.sql is run, the public key can no longer add rows,
// so this function (with the secret key) is the only way in.
//
// Vercel env (Project → Settings → Environment Variables):
//   TURNSTILE_SECRET_KEY   from Cloudflare → Turnstile → your widget → Secret key
//   SUPABASE_SECRET_KEY    from the website's Supabase project → Project Settings → API Keys → Secret key
//   SUPABASE_URL           optional, defaults to the website's project
// Until both keys are set, this answers 503 { fallback: true } and the page saves the old way.

const SB_URL = String(process.env.SUPABASE_URL || "https://zzfldryjluevajwbitra.supabase.co").trim().replace(/\/+$/, "");
const SB_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const TS_SECRET = String(process.env.TURNSTILE_SECRET_KEY || "").trim();

const HUMAN_MSG = "We couldn't confirm you're a person. Please try again. If it keeps happening, turn off ad blockers for this page or email hi@adsure.in.";
const str = (v, n) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

async function isHuman(token, ip) {
  if (!token || token.length > 2048) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: TS_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const v = await r.json();
    if (!v.success) console.warn("turnstile rejected", v["error-codes"]);
    return v.success === true && (!v.action || v.action === "signup");
  } catch (e) {
    console.error("turnstile verify failed", e);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SB_KEY || !TS_SECRET) return res.status(503).json({ error: "not_ready", fallback: true });

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const ip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0]).trim();

  if (!(await isHuman(String(b.turnstile || ""), ip))) return res.status(403).json({ error: "human_check", message: HUMAN_MSG });

  // Same rules as the early_access table, checked here so bad input gets a clear answer.
  const row = {
    name: str(b.name, 80),
    email: str(b.email, 120).toLowerCase(),
    phone: str(b.phone, 13),
    business_type: str(b.business_type, 60) || null,
    monthly_ad_spend: str(b.monthly_ad_spend, 60) || null,
    platforms: Array.isArray(b.platforms) ? b.platforms.filter((x) => typeof x === "string").map((x) => str(x, 40)).filter(Boolean).slice(0, 5) : [],
    biggest_problem: str(b.biggest_problem, 80) || null,
    consent: b.consent === true,
    source: str(b.source, 200) || null,
  };
  if (row.name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(row.email) || !/^\+91[6-9][0-9]{9}$/.test(row.phone) || !row.consent) {
    return res.status(400).json({ error: "invalid", message: "Please check your name, email and phone number." });
  }

  try {
    const headers = { apikey: SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal" };
    if (!/^sb_/.test(SB_KEY)) headers.Authorization = `Bearer ${SB_KEY}`;   // older (JWT) service_role keys also need this
    const r = await fetch(`${SB_URL}/rest/v1/early_access`, { method: "POST", headers, body: JSON.stringify(row), signal: AbortSignal.timeout(10000) });
    if (r.status === 409) return res.status(200).json({ ok: true, exists: true });
    if (!r.ok) {
      const t = await r.text();
      console.error("signup insert", r.status, t.slice(0, 300));
      let code = ""; try { code = JSON.parse(t).code || ""; } catch { /* not json */ }
      return res.status(500).json({ error: "save_failed", code, message: "Your details weren't saved. Please try again, or email hi@adsure.in." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("signup", e);
    return res.status(500).json({ error: "save_failed", message: "Your details weren't saved. Please try again, or email hi@adsure.in." });
  }
}
