/* AdSure free heatmap page. Everything runs in the visitor's browser: the ad is never uploaded.
   Where people look comes from a trained eye-tracking model (UNISAL, fine-tuned on the MIT1003
   eye-tracking study, Apache-2.0), run with ONNX Runtime Web. On slow or data-saver connections,
   or if the model can't load, the instant built-in model in heatmap.js is used instead. */
(function () {
  "use strict";
  var HM = window.AdSureHeatmap, MAX_FILES = 4, MAX_MB = 80, SHOW = 1080;
  var ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/", MODEL_URL = "/models/unisal-mit1003.onnx";
  var drop = document.getElementById("drop"), input = document.getElementById("file"), statusEl = document.getElementById("status"), out = document.getElementById("results");
  var items = [];

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function say(msg, err) { statusEl.textContent = msg || ""; statusEl.className = "status" + (err ? " err" : ""); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th"];

  /* ---------- Trained model (loaded once, only when someone is about to use the tool) ---------- */
  /* The model + runtime is a one-time ~8 MB download (cached after). Results always show instantly with the quick
     model first, then upgrade by themselves when the eye-tracking model is ready. On data-saver or 2G connections
     it only downloads if the person taps the button. */
  function autoLoad() {
    var c = navigator.connection || {};
    return !c.saveData && !/2g/.test(c.effectiveType || "");
  }
  var modelP = null, modelState = "idle", modelObj = null;
  function model(force) {
    if (modelP) return modelP;
    if (!force && !autoLoad()) { modelState = "skipped"; return Promise.resolve(null); }
    modelState = "loading";
    var load = import(ORT + "ort.wasm.min.mjs").then(function (ort) {
      ort = ort.default && ort.default.InferenceSession ? ort.default : ort;
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = 1;
      return ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }).then(function (s) { return { ort: ort, s: s }; });
    });
    modelP = Promise.race([load, new Promise(function (_, no) { setTimeout(function () { no(new Error("slow")); }, 120000); })])
      .then(function (m) { modelState = "ready"; modelObj = m; return m; }, function (e) { modelState = "failed"; if (window.console) console.warn("Eye-tracking model unavailable, using the quick model.", e); return null; });
    return modelP;
  }
  function runModel(m, canvas) {
    var sz = HM.modelSize(canvas.width, canvas.height), c = document.createElement("canvas");
    c.width = sz.w; c.height = sz.h;
    var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(canvas, 0, 0, sz.w, sz.h);
    var t = new m.ort.Tensor("float32", HM.modelInput(ctx.getImageData(0, 0, sz.w, sz.h).data, sz.w, sz.h), [1, 3, sz.h, sz.w]);
    return m.s.run({ image: t }).then(function (o) { return HM.modelMap(o.saliency.data, sz.w, sz.h); });
  }

  /* ---------- Reading files ---------- */
  function loadImage(file) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok({ frames: [{ el: img, t: null }], w: img.naturalWidth, h: img.naturalHeight, done: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error("We couldn't open " + file.name + ".")); };
      img.src = url;
    });
  }
  /* Videos: the opening frame plus one frame a second for the first 3 seconds. */
  function loadVideo(file) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), v = document.createElement("video"), frames = [], times = [], k = 0, t;
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      function done() { URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); }
      function fail() { clearTimeout(t); done(); no(new Error("We couldn't read " + file.name + ". Try an MP4, or a screenshot of its first frame.")); }
      t = setTimeout(fail, 25000);
      v.onerror = fail;
      v.onloadedmetadata = function () {
        var d = isFinite(v.duration) ? v.duration : 1;
        times = [0.1, 1, 2, 3].filter(function (x, i) { return i === 0 || x < d - 0.05; });
        v.currentTime = times[0];
      };
      v.onseeked = function () {
        var c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        frames.push({ el: c, t: times[k] });
        k++;
        if (k < times.length) { v.currentTime = times[k]; return; }
        clearTimeout(t);
        var w = v.videoWidth, h = v.videoHeight; done();
        ok({ frames: frames, w: w, h: h, video: true, done: function () {} });
      };
    });
  }

  function analyseFrame(src, w, h, m) {
    var s = Math.min(1, SHOW / Math.max(w, h)), W = Math.round(w * s), H = Math.round(h * s);
    var base = document.createElement("canvas"); base.width = W; base.height = H;
    base.getContext("2d").drawImage(src, 0, 0, W, H);
    var g = HM.GRID / Math.max(W, H), gw = Math.max(8, Math.round(W * g)), gh = Math.max(8, Math.round(H * g));
    var grid = document.createElement("canvas"); grid.width = gw; grid.height = gh;
    var gctx = grid.getContext("2d"); gctx.imageSmoothingQuality = "high"; gctx.drawImage(base, 0, 0, gw, gh);
    var img = gctx.getImageData(0, 0, gw, gh);
    var mapP = m ? runModel(m, base).catch(function () { return null; }) : Promise.resolve(null);
    return mapP.then(function (map) { return { base: base, res: HM.analyze(img, [], map ? { model: map } : null) }; });
  }

  function analyseFile(file, idx) {
    var isVideo = /^video\//.test(file.type);
    if (!/^(image\/(jpeg|png|webp)|video\/)/.test(file.type)) return Promise.reject(new Error(file.name + ": please use a JPG, PNG, WebP or MP4 file."));
    if (file.size > MAX_MB * 1024 * 1024) return Promise.reject(new Error(file.name + " is over " + MAX_MB + " MB."));
    return (isVideo ? loadVideo(file) : loadImage(file)).then(function (src) {
      var m = modelObj;
      if (!src.w || !src.h) throw new Error("We couldn't read the size of " + file.name + ".");
      var frames = [];
      return src.frames.reduce(function (p, f) {
        return p.then(function () { return analyseFrame(f.el, src.w, src.h, m).then(function (r) { r.t = f.t; frames.push(r); }); });
      }, Promise.resolve()).then(function () {
        src.done();
        return { name: file.name, video: !!src.video, frames: frames, f: 0, mode: "heat", idx: idx, marks: [], marking: null, safe: false, phone: false, ratio: src.h / src.w, model: !!m };
      });
    });
  }
  function cur(it) { return it.frames[it.f]; }

  /* ---------- Marked areas: how much attention the product, offer, logo and button get ---------- */
  var KINDS = { product: "Product", offer: "Offer or price", logo: "Logo", button: "Button or CTA", face: "Face", text: "Main text" };
  function markStats(it) {
    var r = cur(it).res, S = r.map, w = r.w, h = r.h, total = 0, i;
    for (i = 0; i < S.length; i++) total += S[i];
    var list = it.marks.map(function (m) {
      var x0 = Math.max(0, Math.floor(m.x * w)), x1 = Math.min(w, Math.ceil((m.x + m.w) * w)), y0 = Math.max(0, Math.floor(m.y * h)), y1 = Math.min(h, Math.ceil((m.y + m.h) * h)), sum = 0, peak = 0;
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var v = S[y * w + x]; sum += v; if (v > peak) peak = v; }
      var area = Math.max(1e-6, m.w * m.h);
      return { m: m, share: total ? sum / total : 0, peak: peak, lift: total ? (sum / total) / area : 0 };
    });
    list.slice().sort(function (a, b) { return b.peak - a.peak; }).forEach(function (s, k) { s.order = k + 1; });
    return list;
  }
  function markTips(stats) {
    var tips = [];
    stats.forEach(function (s) {
      var k = s.m.kind, pct = Math.round(s.share * 100);
      if ((k === "product" || k === "offer") && s.order > 2 && stats.length > 2) tips.push(KINDS[k] + " is seen " + ORD[s.order] + ". Make it bigger, brighter or move it up so it's in the first two looks.");
      else if ((k === "product" || k === "offer") && s.lift < 1) tips.push(KINDS[k] + " gets less attention than its size deserves (" + pct + "%). Add contrast around it or cut what competes with it.");
      if (k === "button" && s.peak < 0.35) tips.push("Few people will notice the button area. That's fine on Meta (the app shows its own button), but if your ad says \"tap below\", make that line stand out.");
      if (k === "logo" && s.order === 1 && stats.length > 1) tips.push("The logo takes the first look. Unless this is a brand ad, give that spot to the product or the offer.");
    });
    if (!tips.length && stats.length) tips.push("The areas you marked get attention in a sensible order.");
    return tips.slice(0, 3);
  }

  /* ---------- Reels and Stories safe zones (9:16): Instagram and Facebook cover the top 14%, bottom 35% and 6% at each side ---------- */
  var SAFE = { top: 0.14, bottom: 0.35, side: 0.06 };
  function isTall(it) { return it.ratio >= 1.6; }
  function safeStats(it) {
    var r = cur(it).res, S = r.map, w = r.w, h = r.h, total = 0, bad = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = S[y * w + x], fy = (y + 0.5) / h, fx = (x + 0.5) / w; total += v;
      if (fy < SAFE.top || fy > 1 - SAFE.bottom || fx < SAFE.side || fx > 1 - SAFE.side) bad += v;
    }
    var spots = r.peaks.filter(function (p) { return p.y < SAFE.top || p.y > 1 - SAFE.bottom || p.x < SAFE.side || p.x > 1 - SAFE.side; });
    return { share: total ? bad / total : 0, spots: spots };
  }

  /* ---------- Drawing ---------- */
  function draw(el, it, stamp, mode) {
    var c = el.tagName === "CANVAS" ? el : el.querySelector(".res-media canvas"), fr = cur(it);
    c.width = fr.base.width; c.height = fr.base.height;
    HM.render(c, fr.base, fr.res, mode || it.mode, { stamp: !!stamp });
    var ctx = c.getContext("2d"), W = c.width, H = c.height, lw = Math.max(2, Math.min(W, H) * 0.006);
    if (it.safe && isTall(it)) {
      ctx.save(); ctx.fillStyle = "rgba(217,72,59,.28)";
      ctx.fillRect(0, 0, W, H * SAFE.top); ctx.fillRect(0, H * (1 - SAFE.bottom), W, H * SAFE.bottom);
      ctx.fillRect(0, H * SAFE.top, W * SAFE.side, H * (1 - SAFE.top - SAFE.bottom)); ctx.fillRect(W * (1 - SAFE.side), H * SAFE.top, W * SAFE.side, H * (1 - SAFE.top - SAFE.bottom));
      ctx.setLineDash([lw * 3, lw * 2]); ctx.strokeStyle = "#fff"; ctx.lineWidth = lw;
      ctx.strokeRect(W * SAFE.side, H * SAFE.top, W * (1 - 2 * SAFE.side), H * (1 - SAFE.top - SAFE.bottom));
      ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.font = "700 " + Math.round(W * 0.03) + "px Outfit, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("Covered by profile name", W / 2, H * SAFE.top / 2); ctx.fillText("Covered by caption and buttons", W / 2, H * (1 - SAFE.bottom / 2));
      ctx.restore();
    }
    it.marks.forEach(function (m) {
      ctx.save(); ctx.strokeStyle = "#CBEF2F"; ctx.lineWidth = lw * 1.4; ctx.strokeRect(m.x * W, m.y * H, m.w * W, m.h * H);
      ctx.strokeStyle = "#111014"; ctx.lineWidth = lw * 0.5; ctx.strokeRect(m.x * W, m.y * H, m.w * W, m.h * H);
      var fs = Math.max(12, Math.round(Math.min(W, H) * 0.03)), label = KINDS[m.kind];
      ctx.font = "800 " + fs + "px Outfit, system-ui, sans-serif"; var tw = ctx.measureText(label).width;
      var ly = m.y * H > fs * 1.6 ? m.y * H - fs * 1.5 : m.y * H + lw;
      ctx.fillStyle = "#CBEF2F"; ctx.fillRect(m.x * W, ly, tw + fs * 0.8, fs * 1.4);
      ctx.fillStyle = "#111014"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(label, m.x * W + fs * 0.4, ly + fs * 0.72);
      ctx.restore();
    });
    if (it.drag) { ctx.save(); ctx.setLineDash([lw * 2, lw * 2]); ctx.strokeStyle = "#CBEF2F"; ctx.lineWidth = lw * 1.4; var d = it.drag; ctx.strokeRect(Math.min(d.x0, d.x1) * W, Math.min(d.y0, d.y1) * H, Math.abs(d.x1 - d.x0) * W, Math.abs(d.y1 - d.y0) * H); ctx.restore(); }
    return c;
  }
  function stripCanvas(it, k) {
    var fr = it.frames[k], c = document.createElement("canvas"), s = 160 / Math.max(fr.base.width, fr.base.height);
    c.width = Math.round(fr.base.width * s); c.height = Math.round(fr.base.height * s);
    HM.render(c, fr.base, fr.res, "heat", {});
    return c;
  }

  /* ---------- Cards ---------- */
  var LABELS = { heat: "Heatmap", spot: "Spotlight", original: "Original" };
  function scoreRing(n, tone) {
    var C2 = 2 * Math.PI * 26;
    return '<div class="sc ' + tone + '" role="img" aria-label="Focus score ' + n + ' out of 100"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="var(--line)" stroke-width="6"/><circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (C2 * n / 100) + ' ' + C2 + '" transform="rotate(-90 30 30)"/></svg><b>' + n + '</b></div>';
  }
  function bodyHTML(it, i) {
    var fr = cur(it), r = fr.res, v = r.verdict, tips = v.tips.slice();
    var spots = r.peaks.length ? r.peaks.map(function (p) {
      return '<li><i>' + p.n + '</i><span>' + (p.n === 1 ? "First look: " : "") + esc(cap(p.where)) + '</span><small>' + (p.strength >= 85 ? "Strong" : p.strength >= 55 ? "Medium" : "Weak") + '</small></li>';
    }).join("") : '<li><i>–</i><span>No spot stands out</span><small></small></li>';
    var tall = isTall(it), safe = tall ? safeStats(it) : null;
    if (safe && safe.spots.length) tips.unshift("Spot " + safe.spots.map(function (p) { return p.n; }).join(" and ") + " sits where Reels and Stories show the profile name, caption or buttons. Move key words and the product into the middle.");
    var stats = it.marks.length ? markStats(it) : [];
    var frames = it.frames.length > 1 ? '<h3>First ' + Math.round(it.frames[it.frames.length - 1].t) + ' seconds</h3><div class="strip" role="group" aria-label="Video frames">' + it.frames.map(function (f, k) {
      return '<button type="button" data-frame="' + k + '" aria-pressed="' + (k === it.f) + '"><span class="ph" data-strip="' + k + '"></span><small>' + (k === 0 ? "Opening" : f.t + "s") + ' · ' + f.res.score + '</small></button>';
    }).join("") + '</div><p class="small muted">The opening frame decides whether people stop scrolling. Tap a frame to see it.</p>' : "";
    return '<p class="res-name">' + (items.length > 1 ? "Version " + (i + 1) + " · " : "") + esc(it.name) + (it.video ? " · " + (it.f === 0 ? "opening frame" : "at " + fr.t + "s") : "") + '</p>' +
      '<div class="head-row">' + scoreRing(r.score, v.tone) + '<div><span class="verdict ' + v.tone + '">' + esc(v.label) + '</span><p class="small muted" style="margin:6px 0 0">Focus score ' + r.score + '/100 · ' + (r.source === "model" ? "Eye-tracking model" : "Quick model") + '</p></div></div>' +
      '<p class="res-line">' + esc(v.line) + '</p>' +
      '<div class="seg" role="group" aria-label="View">' + ["heat", "spot", "original"].map(function (m) { return '<button type="button" data-mode="' + m + '" aria-pressed="' + (it.mode === m) + '">' + LABELS[m] + '</button>'; }).join("") + '</div>' +
      frames +
      '<h3>Where eyes go</h3><ol class="spots">' + spots + '</ol>' +
      '<h3>Is your product seen?</h3>' +
      (stats.length ? '<ul class="marks">' + stats.map(function (s, k) {
        return '<li><b>' + esc(KINDS[s.m.kind]) + '</b><span class="bar"><span style="width:' + Math.min(100, Math.round(s.share * 100 * 2)) + '%"></span></span><span>' + Math.round(s.share * 100) + '% · seen ' + ORD[s.order] + '</span><button type="button" class="x" data-unmark="' + k + '" aria-label="Remove ' + esc(KINDS[s.m.kind]) + '">×</button></li>';
      }).join("") + '</ul>' : '<p class="small muted" style="margin:0 0 8px">Mark your product, offer, logo or button on the ad. We\'ll show how much attention each gets and the order people see them.</p>') +
      '<div class="mark-btns">' + Object.keys(KINDS).map(function (k) { return '<button type="button" data-mark="' + k + '" aria-pressed="' + (it.marking === k) + '">+ ' + KINDS[k] + '</button>'; }).join("") + '</div>' +
      (it.marking ? '<p class="small mark-hint">Now drag a box around the ' + esc(KINDS[it.marking].toLowerCase()) + ' on the ad.</p>' : "") +
      (tall ? '<label class="chk"><input type="checkbox" data-safe' + (it.safe ? " checked" : "") + '> Show Reels and Stories safe zones <span class="muted">(' + Math.round(safe.share * 100) + '% of attention falls in covered areas)</span></label>' : "") +
      '<h3>What to change</h3><ul class="tips">' + markTips(stats).concat(tips).slice(0, 4).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + '</ul>' +
      '<div class="res-actions"><button type="button" class="btn btn-ink btn-sm" data-save>Save heatmap</button><button type="button" class="btn btn-ghost btn-sm" data-phone aria-pressed="' + it.phone + '">' + (it.phone ? "Hide phone preview" : "Phone preview") + '</button><a class="btn btn-ghost btn-sm" href="/#join">Get the full ad review</a></div>';
  }
  function phoneHTML(it) {
    if (!it.phone) return "";
    return '<div class="phones"><figure><div class="phone"><div class="ph-top"><span class="av"></span><b>yourbrand</b><small>Sponsored</small></div><div class="ph-ad" data-phone-img></div><div class="ph-cta"><span>Shop now</span><span>›</span></div><div class="ph-cap"></div></div><figcaption>In the feed, at real phone size</figcaption></figure>' +
      '<figure><div class="phone glance"><div class="ph-top"><span class="av"></span><b>yourbrand</b><small>Sponsored</small></div><div class="ph-ad" data-phone-img></div><div class="ph-cta"><span>Shop now</span><span>›</span></div><div class="ph-cap"></div></div><figcaption>What people take in during a fast scroll</figcaption></figure></div>';
  }
  function card(it, i) {
    return '<article class="res" data-i="' + i + '"><div class="res-left"><div class="res-media"><canvas aria-label="Attention heatmap for ' + esc(it.name) + '"></canvas></div>' + phoneHTML(it) + '</div><div class="res-body">' + bodyHTML(it, i) + '</div></article>';
  }
  function fillCard(el, it) {
    draw(el, it);
    var c = el.querySelector(".res-media canvas");
    c.style.touchAction = it.marking ? "none" : "";
    c.style.cursor = it.marking ? "crosshair" : "";
    Array.prototype.forEach.call(el.querySelectorAll("[data-strip]"), function (s) { s.appendChild(stripCanvas(it, +s.getAttribute("data-strip"))); });
    Array.prototype.forEach.call(el.querySelectorAll("[data-phone-img]"), function (s) { var im = new Image(); im.alt = ""; im.src = cur(it).base.toDataURL("image/jpeg", 0.85); s.appendChild(im); });
  }
  function repaint(el, it) {
    var i = +el.getAttribute("data-i");
    el.outerHTML = card(it, i);
    var fresh = out.querySelector('.res[data-i="' + i + '"]');
    fillCard(fresh, it);
    var c = out.querySelector(".compare"); if (c) c.outerHTML = compareHTML();
    return fresh;
  }
  function compareHTML() {
    if (items.length < 2) return "";
    var sorted = items.slice().sort(function (a, b) { return cur(b).res.score - cur(a).res.score; }), best = sorted[0], second = sorted[1];
    var close = cur(best).res.score - cur(second).res.score < 6;
    return '<div class="compare on-ink"><h2>' + (close ? "These versions are close." : "Version " + (items.indexOf(best) + 1) + " has the clearest focus.") + '</h2>' +
      '<p>' + items.map(function (x, k) { return "Version " + (k + 1) + ": <b>" + cur(x).res.score + "</b>/100"; }).join(" · ") + '</p>' +
      '<p>' + (close ? "Neither pulls the eye much better. Change the layout more boldly to see a difference." : esc(best.name) + " gets the first look most clearly. Check that its spot 1 is your product or offer before you pick it.") + '</p></div>';
  }
  function paint() {
    out.innerHTML = compareHTML() + items.map(card).join("");
    Array.prototype.forEach.call(out.querySelectorAll(".res"), function (el) { fillCard(el, items[+el.getAttribute("data-i")]); });
  }

  /* Re-check every ad with the eye-tracking model once it's ready. Marks, views and frames are kept. */
  function upgrade(m) {
    var todo = items.filter(function (it) { return !it.model; });
    if (!m || !todo.length) return Promise.resolve();
    return todo.reduce(function (p, it) {
      return p.then(function () {
        return it.frames.reduce(function (q, fr) {
          return q.then(function () { return analyseFrame(fr.base, fr.base.width, fr.base.height, m).then(function (r) { fr.res = r.res; }); });
        }, Promise.resolve()).then(function () { it.model = true; });
      });
    }, Promise.resolve()).then(function () { paint(); });
  }
  function modelNote() {
    if (modelState === "ready") return "Checked with the eye-tracking model. Your ad stayed on this device.";
    if (modelState === "loading") return "Quick result shown. Loading the eye-tracking model (one time only); your results will update by themselves.";
    if (modelState === "skipped") return "Quick result shown to save data on this connection. ";
    return "Checked with the quick model. Your ad stayed on this device.";
  }
  function showNote(prefix) {
    say((prefix || "") + modelNote());
    if (modelState === "skipped") statusEl.insertAdjacentHTML("beforeend", '<button type="button" class="btn btn-ghost btn-sm" id="use-model" style="margin-left:6px">Use the eye-tracking model (one-time 8 MB)</button>');
  }
  statusEl.addEventListener("click", function (e) {
    if (!e.target.closest("#use-model")) return;
    modelP = null;
    model(true).then(function (m) { return upgrade(m); }).then(function () { showNote(); });
    showNote();
  });

  /* ---------- Flow ---------- */
  function handle(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var note = "";
    if (files.length > MAX_FILES) { note = "Up to " + MAX_FILES + " ads at a time, so we took the first " + MAX_FILES + ". "; files = files.slice(0, MAX_FILES); }
    items = []; out.innerHTML = "";
    say(note + "Checking your ad…");
    var mp = model();
    var errors = [], i = 0;
    (function next() {
      if (i >= files.length) {
        items.sort(function (a, b) { return a.idx - b.idx; });
        paint();
        if (errors.length) say(note + errors.join(" "), true); else if (items.length) showNote(note); else say("");
        if (items.length) out.scrollIntoView({ behavior: "smooth", block: "start" });
        if (items.some(function (x) { return !x.model; })) mp.then(function (m) { return upgrade(m); }).then(function () { if (!errors.length && items.length) showNote(note); });
        return;
      }
      var f = files[i], idx = i++;
      analyseFile(f, idx).then(function (it) { items.push(it); }, function (e) { errors.push(e.message || String(e)); }).then(function () {
        if (i < files.length) say(note + "Checking ad " + (i + 1) + " of " + files.length + "…");
        setTimeout(next, 16);
      });
    })();
  }

  input.addEventListener("change", function () { handle(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer) handle(e.dataTransfer.files); });
  /* Start loading the model as soon as someone shows they're about to add an ad. */
  ["pointerenter", "focusin", "touchstart"].forEach(function (ev) { drop.addEventListener(ev, function () { model(); }, { once: true, passive: true }); });

  function itemOf(node) { var el = node.closest(".res"); return el ? { el: el, it: items[+el.getAttribute("data-i")] } : null; }
  out.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var o = itemOf(b); if (!o || !o.it) return;
    var it = o.it, el = o.el;
    if (b.hasAttribute("data-mode")) { it.mode = b.getAttribute("data-mode"); Array.prototype.forEach.call(el.querySelectorAll(".seg button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); }); draw(el, it); return; }
    if (b.hasAttribute("data-frame")) { it.f = +b.getAttribute("data-frame"); repaint(el, it); return; }
    if (b.hasAttribute("data-mark")) { var k = b.getAttribute("data-mark"); it.marking = it.marking === k ? null : k; repaint(el, it).querySelector(".res-media").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (b.hasAttribute("data-unmark")) { it.marks.splice(+b.getAttribute("data-unmark"), 1); repaint(el, it); return; }
    if (b.hasAttribute("data-phone")) { it.phone = !it.phone; repaint(el, it); return; }
    if (b.hasAttribute("data-save")) {
      var c = document.createElement("canvas");
      draw(c, it, true, it.mode === "original" ? "heat" : it.mode);
      var a = document.createElement("a");
      a.download = it.name.replace(/\.[a-z0-9]+$/i, "") + "-adsure-heatmap.png";
      a.href = c.toDataURL("image/png");
      document.body.appendChild(a); a.click(); a.remove();
    }
  });
  out.addEventListener("change", function (e) {
    if (!e.target.hasAttribute("data-safe")) return;
    var o = itemOf(e.target); if (!o) return;
    o.it.safe = e.target.checked; repaint(o.el, o.it);
  });

  /* Drag a box on the ad to mark an area */
  function pos(c, e) { var r = c.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; }
  out.addEventListener("pointerdown", function (e) {
    if (!(e.target.tagName === "CANVAS" && e.target.closest(".res-media"))) return;
    var o = itemOf(e.target); if (!o || !o.it.marking) return;
    e.preventDefault();
    var p = pos(e.target, e); o.it.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, c: e.target };
    try { e.target.setPointerCapture(e.pointerId); } catch (er) { /* older browsers */ }
  });
  out.addEventListener("pointermove", function (e) {
    var o = e.target.tagName === "CANVAS" ? itemOf(e.target) : null; if (!o || !o.it.drag) return;
    var p = pos(o.it.drag.c, e); o.it.drag.x1 = p.x; o.it.drag.y1 = p.y; draw(o.el, o.it);
  });
  out.addEventListener("pointerup", function (e) {
    var o = e.target.tagName === "CANVAS" ? itemOf(e.target) : null; if (!o || !o.it.drag) return;
    var d = o.it.drag, it = o.it; it.drag = null;
    var box = { kind: it.marking, x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
    if (box.w > 0.02 && box.h > 0.02) {
      it.marks = it.marks.filter(function (m) { return m.kind !== box.kind; }).concat([box]);
      it.marking = null;
    }
    repaint(o.el, it);
  });
})();
