/* =====================================================================
   AdSure settings. Edit this file only; index.html never needs changing.
   ===================================================================== */
window.ADSURE_CONFIG = {

  // Supabase (Project Settings > Data API / API Keys). Paste your values here.
  SUPABASE_URL: "https://zzfldryjluevajwbitra.supabase.co",              // e.g. "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "sb_publishable_Osib6-_IbK-Wi5Xs8OOlng_9s-z4S4h",         // the publishable or anon key, NOT the secret key

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

  REFRESH_SECONDS: 20            // how often the live seat count refreshes
};
