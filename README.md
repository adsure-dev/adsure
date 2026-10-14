# AdSure landing page

One page, no build step. Upload this folder to GitHub and it works.

```
index.html          the whole page (HTML, CSS and JavaScript)
terms.html, privacy.html, refund-policy.html   policy pages (styles in assets/legal.css)
heatmap.html        free ad attention heatmap at /heatmap (no sign-up; runs in the browser, ads are never uploaded)
assets/heatmap.js   the heatmap model used by heatmap.html
vercel.json         clean links: /terms, /privacy, /refund-policy
supabase.sql        run once in Supabase to create the sign-up table and live counter
assets/
  logo-dark.png     black logo (used on cream)
  logo-light.png    cream logo (used on black)
  favicon.png, apple-touch-icon.png, og-image.png
  adsure-explainer.mp4    <- ADD your main video here
  adsure-short.mp4        <- optional: your vertical short video
  google-ads-logo.svg     <- ADD the official file (see step 3)
  meta-logo.svg           <- ADD the official file (see step 3)
```

## 1. Connect the form and live seat counter (Supabase, free plan)

1. Open your Supabase project, go to **SQL Editor**, paste everything from `supabase.sql`, and press **Run**.
2. Go to **Project Settings > API** (or **API Keys**). Copy the **Project URL** and the **anon public** key (newer projects call it the **publishable** key).
3. Open `index.html`, scroll to the bottom, and paste them into `CONFIG`:
   ```js
   SUPABASE_URL: "https://yourproject.supabase.co",
   SUPABASE_ANON_KEY: "your-anon-or-publishable-key",
   ```
   This key is safe to put in a public page: nobody can read the list with it (and after step 1b, nobody can add rows with it either).

To see sign-ups: Supabase > **Table Editor** > `early_access`. You can export to CSV from there.

The seat counter shows the real number of sign-ups and refreshes every 20 seconds. On launch day it shows 0 taken, 500 left. After 500, the form changes to a waitlist automatically.

## 1b. Stop bots from filling the form (Cloudflare Turnstile, free)

Sign-ups go through `api/signup.mjs`, which asks Cloudflare whether a real person sent the form, then saves
it with the secret key. Most people see nothing; a tick box appears only when Cloudflare isn't sure.

1. **dash.cloudflare.com → Turnstile → Add widget.** Name: AdSure website. Hostnames: `adsure.in` and `www.adsure.in`.
   Widget mode: **Managed**. Create it, then copy the **Site key** and the **Secret key**.
2. **config.js:** paste the Site key into `TURNSTILE_SITE_KEY` (the site key is meant to be public).
3. **Vercel → this website's project → Settings → Environment Variables**, add for Production:
   - `TURNSTILE_SECRET_KEY` = the Turnstile Secret key
   - `SUPABASE_SECRET_KEY` = the website Supabase project's **secret** key (Project Settings → API Keys)
   Then **Deployments → ⋯ → Redeploy**.
4. Send one test sign-up from www.adsure.in and check it shows in Supabase → Table Editor → `early_access`.
5. **Only then**, lock direct saves: Supabase → SQL Editor, run:
   ```sql
   drop policy if exists "Website can add sign-ups" on public.early_access;
   revoke insert, update, delete, select on public.early_access from anon, authenticated;
   grant select, insert on public.early_access to service_role;
   ```
   Before step 3 the form still saves the old way, so nothing breaks while you set this up.

Never put the Secret key or the Supabase secret key in `config.js` or `index.html`.

## 2. Add your videos

- Rename your main video to `adsure-explainer.mp4` and put it in `assets/`.
- Optional: put the short vertical video in `assets/` as `adsure-short.mp4`. If it's not there, that slot stays hidden.
- GitHub's web upload allows files up to 25 MB. If your video is bigger, compress it (for example with HandBrake, "Fast 1080p30"), or upload it to YouTube and put the video ID in `YOUTUBE_ID` in `CONFIG`.

## 3. Add the Google Ads and Meta logos

Download the official files and save them as `assets/google-ads-logo.svg` and `assets/meta-logo.svg`:
- Google: Google's brand resource centre and the Google Ads brand guidelines
- Meta: Meta's brand resources page

Use them as provided (don't recolour or stretch) and keep the "Works with" wording, so it doesn't look like a partnership. Until the files are there, the page shows the names as text.

## 4. Put it live

**Vercel (recommended, you already use it):**
1. Create a new GitHub repository and upload all files (keep the `assets` folder).
2. In Vercel: **Add New > Project**, pick the repository, Framework: **Other**, and press **Deploy**.
3. **Settings > Domains**: add your domain and follow the DNS steps Vercel shows.

**Or GitHub Pages:** repository **Settings > Pages**, Source: **Deploy from a branch**, Branch: `main`, folder `/ (root)`.

## 5. Settings you can change (bottom of index.html)

| Setting | What it does |
|---|---|
| `TOTAL_SEATS` | Beta seat limit (500) |
| `PRICE` | Founding price per month (1599). The per-day price updates itself. |
| `REGULAR_PRICE` | Shows a struck-through later price. Only set it if that will really be your price. |
| `VIDEO_MAIN`, `VIDEO_SHORT`, `YOUTUBE_ID` | Video sources |
| `REFRESH_SECONDS` | How often the live counter updates |

After your domain is live, change `assets/og-image.png` in the `og:image` line at the top of `index.html` to the full address (for example `https://yourdomain.com/assets/og-image.png`) so WhatsApp and LinkedIn show the preview image.
