/* =====================================================================
   AdSure settings. Edit this file only; index.html never needs changing.
   ===================================================================== */
window.ADSURE_CONFIG = {

  // Supabase (Project Settings > Data API / API Keys). Paste your values here.
  SUPABASE_URL: "https://zzfldryjluevajwbitra.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Osib6-_IbK-Wi5Xs8OOlng_9s-z4S4h",   // publishable key, NOT the secret key

  TOTAL_SEATS: 500,
  PRICE: 1599,                   // ₹ per month for founding members
  REGULAR_PRICE: null,           // e.g. 2499, ONLY if that will really be your later price

  // Videos: people switch between them with the buttons next to the player.
  // Use "file" for a video in the assets folder, or "youtube" for a YouTube video ID.
  // Add or remove entries to show more or fewer videos.
  VIDEOS: [
    {
      title: "How AdSure works",
      text: "Priya runs ads and gets nothing, until she checks them first.",
      file: "assets/adsure-explainer.mp4",
      youtube: "",
      poster: ""                 // optional cover image, e.g. "assets/poster-1.jpg"
    },
    {
      title: "Rohan's story",
      text: "Rohan pays ₹1 lakh a month… to lose money.",
      file: "assets/adsure-short.mp4",
      youtube: "",
      poster: ""
    }
  ],

  REFRESH_SECONDS: 20,           // how often the live seat count refreshes
  SHOW_SEATS_FROM: 50,           // hide the live seat number until this many real people have joined

  // Microsoft Clarity (free session recordings + heatmaps): paste the project ID from clarity.microsoft.com → Settings → Overview.
  // Leave empty ("") to turn it off.
  CLARITY_ID: "ywwfnusejn",

  // Cloudflare Turnstile (stops bots from filling the sign-up form): paste the SITE key from
  // dash.cloudflare.com → Turnstile → your widget. The SECRET key goes in Vercel, never here (see README).
  // Leave empty ("") to turn it off.
  TURNSTILE_SITE_KEY: "",

  // Sign-up popup
  POPUP_ENABLED: true,           // false = never show the popup
  POPUP_DELAY_SECONDS: 10,       // seconds before it appears
  POPUP_REPEAT_DAYS: 0           // after someone closes it, wait this many days before showing again
};
