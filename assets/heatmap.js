/* AdSure attention heatmap: predicts where people look first on an ad.
   Runs fully in the browser. The creative is never uploaded anywhere.

   How it works (a classic visual-attention model, tuned for ads):
   - colour that stands out from the rest of the ad
   - bright/dark and colour contrast against the area around it, at two sizes
   - fine detail and text (edges), which pull the eye in ads
   - faces, when the face finder could load (strongest pull of all)
   - a small pull towards the upper middle, where people start looking on a phone

   It is a prediction, not eye-tracking. It does not know whether people will click or buy. */
(function (root) {
  "use strict";

  var GRID = 128;   /* long side of the working grid */

  function blur(src, w, h, sigma) {
    /* three box blurs ≈ a gaussian blur */
    var out = new Float32Array(src), tmp = new Float32Array(src.length);
    var r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma / 3) + 1) / 2));
    for (var pass = 0; pass < 3; pass++) { boxH(out, tmp, w, h, r); boxV(tmp, out, w, h, r); }
    return out;
  }
  function boxH(s, d, w, h, r) {
    for (var y = 0; y < h; y++) {
      var o = y * w, acc = 0, n = 0, x;
      for (x = -r; x <= r; x++) { if (x >= 0 && x < w) { acc += s[o + x]; n++; } }
      for (x = 0; x < w; x++) {
        d[o + x] = acc / n;
        var add = x + r + 1, rem = x - r;
        if (add < w) { acc += s[o + add]; n++; }
        if (rem >= 0) { acc -= s[o + rem]; n--; }
      }
    }
  }
  function boxV(s, d, w, h, r) {
    for (var x = 0; x < w; x++) {
      var acc = 0, n = 0, y;
      for (y = -r; y <= r; y++) { if (y >= 0 && y < h) { acc += s[y * w + x]; n++; } }
      for (y = 0; y < h; y++) {
        d[y * w + x] = acc / n;
        var add = y + r + 1, rem = y - r;
        if (add < h) { acc += s[add * w + x]; n++; }
        if (rem >= 0) { acc -= s[rem * w + x]; n--; }
      }
    }
  }
  function pctl(a, p) {
    var c = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
    return c[Math.min(c.length - 1, Math.floor(p * c.length))] || 0;
  }
  function norm(a) {
    var top = pctl(a, 0.99) || 1, out = new Float32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = Math.min(1, a[i] / top);
    return out;
  }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }

  /* img: { data: RGBA bytes, width, height } already scaled to the working grid.
     faces: [{ x, y, w, h }] in 0–1 units of the image (optional). */
  function analyze(img, faces) {
    var w = img.width, h = img.height, n = w * h, d = img.data, i;
    var L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var r = lin(d[i * 4]), g = lin(d[i * 4 + 1]), b = lin(d[i * 4 + 2]);
      var X = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505), Y = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
      L[i] = 116 * Y - 16; A[i] = 500 * (X - Y); B[i] = 200 * (Y - Z);
    }
    var long = Math.max(w, h), k = long / GRID;

    /* 1. Colour that stands out from the whole ad */
    var Ls = blur(L, w, h, 1.2 * k), As = blur(A, w, h, 1.2 * k), Bs = blur(B, w, h, 1.2 * k), mL = 0, mA = 0, mB = 0;
    for (i = 0; i < n; i++) { mL += Ls[i]; mA += As[i]; mB += Bs[i]; }
    mL /= n; mA /= n; mB /= n;
    var unique = new Float32Array(n);
    for (i = 0; i < n; i++) unique[i] = Math.sqrt(0.5 * (Ls[i] - mL) * (Ls[i] - mL) + (As[i] - mA) * (As[i] - mA) + (Bs[i] - mB) * (Bs[i] - mB));

    /* 2. Contrast against the area around it, at two sizes */
    var contrast = new Float32Array(n);
    [[2, 8], [4, 16]].forEach(function (s) {
      var a1 = blur(L, w, h, s[0] * k), a2 = blur(L, w, h, s[1] * k), c1 = blur(A, w, h, s[0] * k), c2 = blur(A, w, h, s[1] * k), b1 = blur(B, w, h, s[0] * k), b2 = blur(B, w, h, s[1] * k);
      for (var j = 0; j < n; j++) contrast[j] += Math.abs(a1[j] - a2[j]) + 0.7 * (Math.abs(c1[j] - c2[j]) + Math.abs(b1[j] - b2[j]));
    });

    /* 3. Text and fine detail */
    var edge = new Float32Array(n), Lb = blur(L, w, h, 0.6 * k), x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var p = y * w + x;
      var gx = Lb[p - w + 1] + 2 * Lb[p + 1] + Lb[p + w + 1] - Lb[p - w - 1] - 2 * Lb[p - 1] - Lb[p + w - 1];
      var gy = Lb[p + w - 1] + 2 * Lb[p + w] + Lb[p + w + 1] - Lb[p - w - 1] - 2 * Lb[p - w] - Lb[p - w + 1];
      edge[p] = Math.sqrt(gx * gx + gy * gy);
    }
    var detail = blur(edge, w, h, 3 * k);

    var U = norm(unique), Cn = norm(contrast), D = norm(detail);

    /* 4. Faces */
    var F = new Float32Array(n), hasFace = false;
    (faces || []).forEach(function (f) {
      if (!(f && f.w > 0.02 && f.h > 0.02)) return;
      hasFace = true;
      var cx = (f.x + f.w / 2) * w, cy = (f.y + f.h * 0.42) * h, sx = Math.max(2, f.w * w * 0.45), sy = Math.max(2, f.h * h * 0.45);
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
        var v = Math.exp(-0.5 * (Math.pow((xx - cx) / sx, 2) + Math.pow((yy - cy) / sy, 2)));
        var q = yy * w + xx; if (v > F[q]) F[q] = v;
      }
    });

    /* 5. Combine, with a gentle pull to the upper middle */
    var S = new Float32Array(n), cxp = 0.5 * w, cyp = 0.44 * h, sxp = 0.38 * w, syp = 0.38 * h;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var q2 = y * w + x;
      var base = 0.25 * U[q2] + 0.35 * Cn[q2] + 0.4 * D[q2];
      var centre = Math.exp(-0.5 * (Math.pow((x - cxp) / sxp, 2) + Math.pow((y - cyp) / syp, 2)));
      var s2 = base * (0.6 + 0.4 * centre);
      if (hasFace) s2 = Math.max(s2, F[q2] * 0.95) + 0.25 * F[q2];
      S[q2] = s2;
    }
    S = blur(S, w, h, 0.035 * long);
    var mx = 0, mn = Infinity;
    for (i = 0; i < n; i++) { if (S[i] > mx) mx = S[i]; if (S[i] < mn) mn = S[i]; }
    for (i = 0; i < n; i++) S[i] = Math.pow((S[i] - mn) / ((mx - mn) || 1), 1.7);

    return summarise(S, w, h, D, hasFace, faces || []);
  }

  var SPOT = [["top left", "top", "top right"], ["left", "middle", "right"], ["bottom left", "bottom", "bottom right"]];
  function where(x, y) { return SPOT[Math.min(2, Math.floor(y * 3))][Math.min(2, Math.floor(x * 3))]; }

  function summarise(S, w, h, D, hasFace, faces) {
    var n = w * h, i, total = 0;
    for (i = 0; i < n; i++) total += S[i];

    /* Focus: how much of all the attention sits in the top 10% of the ad's area. Even spread = 0.10. */
    var sorted = Array.prototype.slice.call(S).sort(function (a, b) { return b - a; }), top = 0;
    for (i = 0; i < Math.round(n * 0.1); i++) top += sorted[i];
    var focus = total ? top / total : 0;

    /* Where eyes go: local peaks, strongest first */
    var rad = Math.round(0.14 * Math.max(w, h)), peaks = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = S[y * w + x];
      if (v < 0.3) continue;
      var best = true;
      for (var dy = -rad; dy <= rad && best; dy++) for (var dx = -rad; dx <= rad; dx++) {
        var xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && dx * dx + dy * dy <= rad * rad) {
          var o = S[yy * w + xx];
          if (o > v || (o === v && (yy * w + xx) < (y * w + x))) { best = false; break; }
        }
      }
      if (best) peaks.push({ x: (x + 0.5) / w, y: (y + 0.5) / h, v: v });
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    /* Two peaks joined by a bright path are one thing (a big product box), so keep only the stronger one. */
    var kept = [];
    peaks.forEach(function (p) {
      var joined = kept.some(function (q) {
        var lo = 1;
        for (var t = 1; t < 16; t++) { var sx = Math.round(((q.x + (p.x - q.x) * t / 16) * w) - 0.5), sy = Math.round(((q.y + (p.y - q.y) * t / 16) * h) - 0.5); lo = Math.min(lo, S[sy * w + sx]); }
        return lo >= 0.6 * p.v;
      });
      if (!joined) kept.push(p);
    });
    peaks = kept.slice(0, 3).map(function (p, k) {
      var onFace = faces.some(function (f) { return p.x >= f.x - 0.02 && p.x <= f.x + f.w + 0.02 && p.y >= f.y - 0.02 && p.y <= f.y + f.h + 0.02; });
      return { n: k + 1, x: p.x, y: p.y, strength: Math.round(p.v * 100), where: where(p.x, p.y), face: onFace };
    });
    var strong = peaks.filter(function (p) { return p.strength >= 70; }).length;
    var hot = 0; for (i = 0; i < n; i++) if (S[i] >= 0.45) hot++;
    var coverage = hot / n;   /* share of the ad that gets a lot of attention */

    var dsum = 0; for (i = 0; i < n; i++) dsum += D[i];
    var busy = dsum / n;   /* average detail, 0–1 */

    return { map: S, w: w, h: h, focus: Math.round(focus * 100) / 100, coverage: Math.round(coverage * 100) / 100, peaks: peaks, strongSpots: strong, busy: Math.round(busy * 100) / 100, faces: faces.length, verdict: verdictOf(focus, coverage, busy, peaks, faces.length) };
  }

  /* One plain verdict and what to do about it. */
  function verdictOf(focus, coverage, busy, peaks, faceCount) {
    var first = peaks[0], tips = [], v;
    var rival = peaks[1] && peaks[1].strength >= 80;   /* a second spot almost as strong as the first */
    if (!first || coverage > 0.34 || focus < 0.2 || (busy > 0.5 && peaks.length >= 3 && peaks[2].strength >= 60)) {
      v = { key: "busy", label: "Nothing stands out", tone: "bad", line: "Attention is spread across the whole ad, so nothing gets noticed first. On a fast scroll, that usually means nothing gets noticed at all." };
      tips.push("Cut the number of elements. One product, one line of text and one offer is often enough.");
    } else if (!rival) {
      v = { key: "clear", label: "Clear focus", tone: "good", line: "People's eyes go to one clear place first. Make sure that place is your product or your offer." };
    } else {
      v = { key: "split", label: "Split attention", tone: "mid", line: "Two parts of the ad compete for the first look (spots 1 and 2). People may notice the wrong one." };
      tips.push("Pick the one thing you want seen first and make it bigger or brighter. Tone down the other.");
    }
    if (busy > 0.5) tips.push("There's a lot of text or fine detail. In a feed, people read 5 to 7 words at most. Keep the rest for the ad text or landing page.");
    if (faceCount && first && first.face) tips.push("A face takes the first look. Have the person look at or hold the product, so eyes move from them to it.");
    if (faceCount && first && !first.face) tips.push("The face isn't getting the first look. That's fine if your product is, but check it isn't a background detail.");
    if (first && /bottom/.test(first.where)) tips.push("The first look lands near the bottom. On Instagram and Facebook, buttons and captions can cover the bottom part, so keep key things away from the edges.");
    tips.push("Check spots 1 to 3: is one of them your product or offer? If not, that's the first thing to fix.");
    v.tips = tips.slice(0, 3);
    return v;
  }

  /* Browser drawing: colour the map on top of the ad. mode = "heat" | "spot" */
  function ramp(t) {
    var stops = [[0, [30, 60, 255]], [0.35, [0, 210, 255]], [0.6, [203, 239, 47]], [0.8, [255, 170, 0]], [1, [235, 40, 30]]];
    for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
      return [a[1][0] + f * (b[1][0] - a[1][0]), a[1][1] + f * (b[1][1] - a[1][1]), a[1][2] + f * (b[1][2] - a[1][2])];
    }
    return stops[stops.length - 1][1];
  }
  function overlay(res, mode) {
    var c = document.createElement("canvas"); c.width = res.w; c.height = res.h;
    var ctx = c.getContext("2d"), im = ctx.createImageData(res.w, res.h);
    for (var i = 0; i < res.map.length; i++) {
      var v = res.map[i], o = i * 4;
      if (mode === "spot") { im.data[o] = 17; im.data[o + 1] = 16; im.data[o + 2] = 20; im.data[o + 3] = Math.round(235 * Math.pow(1 - v, 1.4)); }
      else { var col = ramp(v); im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = v < 0.06 ? 0 : Math.round(Math.min(0.72, 0.2 + v * 0.6) * 255); }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }
  function render(canvas, source, res, mode, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(source, 0, 0, W, H);
    if (mode !== "original") { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(overlay(res, mode), 0, 0, W, H); }
    if (mode !== "original") res.peaks.forEach(function (p) {
      var r = Math.max(14, Math.min(W, H) * 0.035), x = p.x * W, y = p.y * H;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = "#CBEF2F"; ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.16); ctx.strokeStyle = "#111014"; ctx.stroke();
      ctx.fillStyle = "#111014"; ctx.font = "800 " + Math.round(r * 1.1) + "px Outfit, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(p.n), x, y + r * 0.04);
    });
    if (opts.stamp) {
      var fs = Math.max(12, Math.round(Math.min(W, H) * 0.028)), label = "Attention heatmap · adsure.in/heatmap";
      ctx.font = "700 " + fs + "px Outfit, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      var tw = ctx.measureText(label).width, pad = fs * 0.6;
      ctx.fillStyle = "rgba(17,16,20,.82)"; ctx.fillRect(W - tw - pad * 3, H - fs - pad * 2.2, tw + pad * 2.4, fs + pad * 1.6);
      ctx.fillStyle = "#CBEF2F"; ctx.fillText(label, W - pad * 1.8, H - pad * 1.2);
    }
  }

  var api = { analyze: analyze, render: render, GRID: GRID, verdictOf: verdictOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AdSureHeatmap = api;
})(this);
