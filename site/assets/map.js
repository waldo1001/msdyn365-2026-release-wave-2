/* Home map: one svg, D3, driven by data/index/features.json.
   Geometry, states and routing follow design/HANDOFF.md section 1. Numbers come from design/tokens.json
   (inlined as #wm-config by site/build.ts); every color is a CSS variable from tokens.css, so the theme switch needs no JS. */
(function () {
  "use strict";
  var root = document.getElementById("wm");
  if (!root || typeof d3 === "undefined") return;
  var base = document.body.getAttribute("data-base") || "/";
  var CFG = JSON.parse(document.getElementById("wm-config").textContent);
  var stage = document.getElementById("wm-stage"), box = document.getElementById("wm-mapbox"), panel = document.getElementById("wm-panel");
  var mobileEl = document.getElementById("wm-mobile"), form = document.getElementById("wm-filters");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ZOOM_MS = reduced ? 0 : CFG.zoom.duration;
  var EASE = cubicBezier.apply(null, (CFG.zoom.easing.match(/[\d.]+/g) || [0.2, 0.8, 0.2, 1]).map(Number));
  var RAD = Math.PI / 180;
  var STATUS = { ga: "GA", implied: "GA", preview: "Preview", announced: "Announced" }; // implied = GA by the launch event rule; same label, paler shape

  // ---------- helpers
  function cubicBezier(x1, y1, x2, y2) {
    function b(s, a, c) { return 3 * a * s * (1 - s) * (1 - s) + 3 * c * s * s * (1 - s) + s * s * s; }
    function db(s, a, c) { return 3 * a * (1 - s) * (1 - s) + 6 * (c - a) * s * (1 - s) + 3 * (1 - c) * s * s; }
    return function (t) {
      var s = t;
      for (var i = 0; i < 8; i++) { var x = b(s, x1, x2) - t, dx = db(s, x1, x2); if (Math.abs(x) < 1e-5 || Math.abs(dx) < 1e-6) break; s -= x / dx; }
      return b(Math.max(0, Math.min(1, s)), y1, y2);
    };
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mmss(t) { t = Math.floor(t || 0); var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); }
  function fmt(x) { return x >= 60 ? Math.round(x / 6) / 10 + " min" : Math.round(x) + " s"; }
  function yt(id, t) { return "https://www.youtube.com/watch?v=" + id + "&t=" + Math.floor(t || 0) + "s"; }
  function trunc(s, n) { return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s; }
  function statusKey(f) { return f.status === "ga" ? (f.status_source === "implied" ? "implied" : "ga") : f.status; }
  var PLAY = '<svg viewBox="0 0 8 9" aria-hidden="true"><path d="M0 0l8 4.5L0 9z"/></svg>';
  function chip(id, t, title) { return '<a class="wm-chip" href="' + yt(id, t) + '" target="_blank" rel="noopener" title="' + esc(title + " at " + mmss(t)) + '"><span>' + mmss(t) + "</span>" + PLAY + '<span class="wm-chip__title">' + esc(trunc(title, 28)) + "</span></a>"; }

  // ---------- geometry (recomputed on resize)
  var G = {};
  function measure() {
    var w = stage.clientWidth || 600;
    var availH = Math.max(380, window.innerHeight - 200);
    var S = Math.floor(Math.min(w, availH));
    var LM = S >= 640 ? CFG.labelMargin.large : CFG.labelMargin.small;
    var R = S / 2 - LM, r = CFG.radii;
    G = { S: S, C: S / 2, R: R, stageW: w, r0: R * r.center, r1: [R * r.ring1[0], R * r.ring1[1]], r2: [R * r.ring2[0], R * r.ring2[1]], r3: [R * r.devTick[0], R * r.devTick[1]] };
  }
  var arcGen = d3.arc();
  function arcPath(radii, a0, a1) { if (!(a1 - a0 > 1e-4)) return ""; return arcGen({ innerRadius: radii[0], outerRadius: radii[1], startAngle: a0 * RAD, endAngle: Math.min(a1, a0 + 359.999) * RAD }); }
  function polar(r, a) { return [Math.sin(a * RAD) * r, -Math.cos(a * RAD) * r]; }

  // ---------- loading state: two pulsing ring outlines + the icon
  measure();
  (function loading() {
    var svg = d3.select(box).style("width", G.S + "px").style("height", G.S + "px").append("svg").attr("class", "wm-map wm-map--loading").attr("viewBox", "0 0 " + G.S + " " + G.S).attr("width", G.S).attr("height", G.S).attr("aria-hidden", "true");
    var g = svg.append("g").attr("transform", "translate(" + G.C + "," + G.C + ")");
    g.append("circle").attr("class", "wm-loading-ring").attr("r", (G.r1[0] + G.r1[1]) / 2).attr("stroke-width", G.r1[1] - G.r1[0]);
    g.append("circle").attr("class", "wm-loading-ring wm-loading-ring--2").attr("r", (G.r2[0] + G.r2[1]) / 2).attr("stroke-width", G.r2[1] - G.r2[0]);
    var s = G.r0 * 1.5; g.append("image").attr("href", CFG.icon).attr("x", -s / 2).attr("y", -s / 2).attr("width", s).attr("height", s);
  })();

  fetch(base + "data/index/features.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(init).catch(function (e) {
    box.removeAttribute("aria-busy");
    box.innerHTML = '<p class="notice">Could not load the map data (' + esc(e.message) + ").</p>";
  });

  function init(fj) {
    // ---------- model: area -> video -> feature appearance (a feature sits under every video it appears in, colored by its own area)
    var areaName = {}; fj.areas.forEach(function (a) { areaName[a.slug] = a.name; });
    var bySlug = {}; fj.features.forEach(function (f) { bySlug[f.slug] = f; });
    var areaBy = {}, vidBy = {};
    var areas = CFG.areaOrder.map(function (slug) { var a = { kind: "area", key: "area:" + slug, slug: slug, area: slug, name: areaName[slug] || slug, videos: [], secs: 0 }; areaBy[slug] = a; return a; });
    fj.videos.forEach(function (v) {
      var a = areaBy[v.area]; if (!a) return;
      var vid = { kind: "video", key: "video:" + v.id, id: v.id, title: v.title, area: v.area, secs: v.duration_seconds || 0, nodes: [] };
      a.videos.push(vid); vidBy[v.id] = vid;
    });
    fj.features.forEach(function (f) {
      f.videos.forEach(function (fv) {
        var v = vidBy[fv.id]; if (!v) return;
        v.nodes.push({ kind: "feature", key: f.slug + "@" + v.id, f: f, slug: f.slug, area: f.area, video: v, secs: fv.seconds > 0 ? fv.seconds : f.airtime_seconds, t: fv.t_start,
          ranges: fv.ranges && fv.ranges.length ? fv.ranges : [[fv.t_start, fv.t_end]], demo: fv.demo || null });
      });
    });
    areas.forEach(function (a) {
      a.videos.sort(function (x, y) { return y.secs - x.secs; });
      a.videos.forEach(function (v, i) {
        v.n = i + 1;
        v.nodes.sort(function (x, y) { return y.secs - x.secs; });
        if (!v.nodes.length) v.nodes.push({ kind: "ghost", key: "ghost@" + v.id, area: v.area, video: v, secs: v.secs });
        a.secs += v.secs;
      });
    });
    areas = areas.filter(function (a) { return a.secs > 0; });
    var total = areas.reduce(function (t, a) { return t + a.secs; }, 0);
    // wave angles, degrees from 12 o'clock clockwise. Area by video seconds, video by its seconds, features normalised inside the video.
    var ang = 0, ring1 = [], ring2 = [];
    areas.forEach(function (a) {
      a.w0 = ang; ring1.push(a);
      a.videos.forEach(function (v) {
        v.w0 = ang; ang += v.secs / total * 360; v.w1 = ang;
        var s = v.nodes.reduce(function (t, n) { return t + n.secs; }, 0), x = v.w0;
        v.nodes.forEach(function (n) { n.w0 = x; x += n.secs / s * (v.w1 - v.w0); n.w1 = x; ring2.push(n); });
      });
      a.w1 = ang;
    });
    areas.forEach(function (a) { a.videos.forEach(function (v) { ring1.push(v); }); });

    // ---------- svg skeleton
    box.innerHTML = ""; box.removeAttribute("aria-busy");
    var svg = d3.select(box).append("svg").attr("class", "wm-map").attr("data-level", "wave").attr("role", "group").attr("aria-label", "Sunburst of the wave with three zoom levels: wave, area, video. Inner ring areas or videos, outer ring features, sized by airtime. Arrow keys move along a ring, Enter zooms in, Escape zooms out.");
    var defs = svg.append("defs");
    defs.append("pattern").attr("id", "wm-hatch").attr("patternUnits", "userSpaceOnUse").attr("width", 7).attr("height", 7).attr("patternTransform", "rotate(45)")
      .append("line").attr("class", "wm-hatch-line").attr("x1", 3.5).attr("y1", 0).attr("x2", 3.5).attr("y2", 7);
    var gRoot = svg.append("g");
    var gR1 = gRoot.append("g").attr("class", "wm-ring wm-ring--1");
    var gR2 = gRoot.append("g").attr("class", "wm-ring wm-ring--2");
    var gOutline = gRoot.append("g").attr("class", "wm-outline").attr("pointer-events", "none");
    var gLabels = gRoot.append("g").attr("class", "wm-labels").attr("aria-hidden", "true");
    var gCenter = gRoot.append("g").attr("class", "wm-center");
    var tip = d3.select(box).append("div").attr("class", "wm-tip").attr("role", "tooltip").style("display", "none");
    var empty = d3.select(stage).append("div").attr("class", "wm-empty").style("display", "none")
      .html("<b>Nothing matches.</b><p>The wave is still there, just dimmed. Loosen a filter or try another word.</p><button type=\"button\" class=\"wm-btn\">Clear filters</button>");
    empty.select("button").on("click", clearFilters);

    var n1 = gR1.selectAll("a").data(ring1, function (d) { return d.key; }).join("a")
      .attr("class", function (d) { return "wm-node wm-node--" + d.kind; })
      .attr("href", function (d) { return d.kind === "area" ? "#/a/" + d.slug : "#/v/" + d.id; })
      .attr("data-area", function (d) { return d.area; })
      .attr("data-video", function (d) { return d.kind === "video" ? d.id : null; })
      .attr("style", function (d) { return "--c:var(--area-" + d.area + ")"; })
      .attr("aria-label", function (d) { return d.kind === "area" ? d.name + ", " + Math.floor(d.secs / 60) + " min in " + d.videos.length + " videos" : d.n + ". " + d.title + ", " + mmss(d.secs) + ", " + featureCount(d) + " features"; });
    n1.append("g").attr("class", "wm-node__body").append("path").attr("class", "wm-node__shape");

    var n2 = gR2.selectAll("a").data(ring2, function (d) { return d.key; }).join("a")
      .attr("class", function (d) { return "wm-node wm-node--" + d.kind; })
      .attr("href", function (d) { return d.kind === "ghost" ? base + "videos/" + d.video.id + "/" : "#/f/" + d.slug; })
      .attr("data-slug", function (d) { return d.f ? d.slug : null; })
      .attr("data-area", function (d) { return d.area; })
      .attr("data-video", function (d) { return d.video.id; })
      .attr("data-status", function (d) { return d.f ? d.f.status : null; })
      .attr("data-source", function (d) { return d.f ? d.f.status_source : null; })
      .attr("data-dev", function (d) { return d.f ? d.f.dev_relevance : null; })
      .attr("style", function (d) { return "--c:var(--area-" + d.area + ")"; })
      .attr("aria-label", function (d) { return d.f ? d.f.name + ", " + fmt(d.secs) + ", " + STATUS[statusKey(d.f)] + (d.f.dev_relevance === "high" ? ", high developer relevance" : "") : d.video.title + ", " + mmss(d.secs) + ", no features extracted"; });
    var body2 = n2.append("g").attr("class", "wm-node__body");
    body2.append("path").attr("class", "wm-node__shape");
    body2.filter(function (d) { return d.f && d.f.status === "preview"; }).append("path").attr("class", "wm-node__hatch");
    body2.filter(function (d) { return d.f && d.f.dev_relevance === "high"; }).append("path").attr("class", "wm-node__dev");

    function featureCount(v) { return v.nodes.filter(function (n) { return n.kind === "feature"; }).length; }
    var nodeByKey = {}; ring2.forEach(function (d) { nodeByKey[d.key] = d; });
    function shortTitle(t) { return t.replace(/^What's new( in|:)? /, ""); }

    // ---------- state: level wave | area | video | feature. video is set when the feature was opened from inside a video.
    var view = { level: "wave", area: null, video: null, slug: null };
    var filt = { status: [], dev: "", area: "", q: "" };
    var hoverKey = null;

    function targets(st) {
      var fa = st.area ? areaBy[st.area] : null, fv = st.video ? vidBy[st.video] : null;
      var win = fv || fa, lo = win ? win.w0 : 0, hi = win ? win.w1 : 360;
      var map = function (x) { return win ? Math.max(0, Math.min(360, (x - lo) / (hi - lo) * 360)) : x; };
      ring1.forEach(function (d) {
        var on = fv ? d.key === fv.key : fa ? d.kind === "video" && d.area === fa.slug : d.kind === "area";
        d.tgt = { a0: map(d.w0), a1: map(d.w1), op: on ? 1 : 0 };
      });
      ring2.forEach(function (d) {
        var on = fv ? d.video.id === fv.id : !fa || d.video.area === fa.slug;
        d.tgt = { a0: map(d.w0), a1: map(d.w1), op: on ? 1 : 0 };
      });
    }
    function drawNode(el, d, ring) {
      var c = d.cur, b = el.firstChild;
      el.style.opacity = c.op;
      el.style.visibility = c.op < 0.01 ? "hidden" : "";
      b.firstChild.setAttribute("d", arcPath(ring === 1 ? G.r1 : G.r2, c.a0, c.a1));
      for (var p = b.firstChild.nextSibling; p; p = p.nextSibling) {
        if (p.classList.contains("wm-node__hatch")) p.setAttribute("d", arcPath(G.r2, c.a0, c.a1));
        else if (p.classList.contains("wm-node__dev")) p.setAttribute("d", c.a1 - c.a0 > 1e-4 ? arcPath(G.r3, c.a0 + 0.3, Math.max(c.a0 + 0.4, c.a1 - 0.3)) : "");
      }
    }
    function settle() {
      [n1, n2].forEach(function (sel) {
        sel.classed("is-hidden", function (d) { return d.tgt.op === 0; })
          .classed("is-narrow", function (d) { return d.tgt.a1 - d.tgt.a0 < CFG.narrowDeg; })
          .attr("tabindex", function (d) { return d.tgt.op === 0 ? -1 : null; })
          .attr("aria-hidden", function (d) { return d.tgt.op === 0 ? "true" : null; });
      });
    }
    function drawAll() {
      n1.each(function (d) { drawNode(this, d, 1); });
      n2.each(function (d) { drawNode(this, d, 2); });
    }
    var moving = false;
    function zoomTo(st, animate) {
      targets(st); settle();
      if (!animate || ZOOM_MS === 0) {
        ring1.concat(ring2).forEach(function (d) { d.cur = { a0: d.tgt.a0, a1: d.tgt.a1, op: d.tgt.op }; });
        drawAll(); moving = false; decorate(); return;
      }
      moving = true; gLabels.classed("is-moving", true); gOutline.selectAll("*").remove(); hideTip();
      var t = svg.transition("zoom").duration(ZOOM_MS).ease(EASE);
      [[n1, 1], [n2, 2]].forEach(function (p) {
        p[0].transition(t).tween("arc", function (d) { var el = this, i = d3.interpolate(d.cur, d.tgt); return function (k) { d.cur = i(k); drawNode(el, d, p[1]); }; });
      });
      t.end().then(done, done);
      function done() { if (!moving) return; moving = false; ring1.concat(ring2).forEach(function (d) { d.cur = { a0: d.tgt.a0, a1: d.tgt.a1, op: d.tgt.op }; }); drawAll(); decorate(); }
    }

    // ---------- labels with simple collision avoidance (nudge along the tangent, drop the smallest first)
    function placeLabels(items) {
      var placed = [], out = [], halfW = Math.max(G.C, G.stageW / 2) - 8;
      items.sort(function (a, b) { return b.prio - a.prio; });
      var offsets = [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6];
      items.forEach(function (it) {
        for (var i = 0; i < offsets.length; i++) {
          var a = it.angle + offsets[i], p = polar(G.R + 12, a), sn = Math.sin(a * RAD), cs = Math.cos(a * RAD);
          var anchor = sn > 0.3 ? "start" : sn < -0.3 ? "end" : "middle";
          var room = anchor === "middle" ? 2 * (halfW - Math.abs(p[0])) : halfW - Math.abs(p[0]);
          var name = trunc(it.name, Math.min(it.max || 40, Math.floor(room / 7)));
          if (name.length < 6) continue;
          var w = Math.max(name.length * 7, it.sub.length * 7.3), h = 32;
          var x0 = anchor === "start" ? p[0] : anchor === "end" ? p[0] - w : p[0] - w / 2;
          var y0 = anchor === "middle" ? (cs > 0 ? p[1] - h : p[1]) : p[1] - h / 2;
          var rect = { x0: x0 - 2, y0: y0 - 2, x1: x0 + w + 2, y1: y0 + h + 2 };
          var hit = placed.some(function (q) { return rect.x0 < q.x1 && rect.x1 > q.x0 && rect.y0 < q.y1 && rect.y1 > q.y0; });
          if (hit) continue;
          placed.push(rect); out.push({ x: p[0], y: y0, anchor: anchor, name: name, sub: it.sub }); return;
        }
      });
      return out;
    }
    function decorate() {
      gLabels.selectAll("*").remove(); gLabels.classed("is-moving", false);
      var items = [];
      if (view.level === "wave") areas.forEach(function (a) { items.push({ angle: (a.tgt.a0 + a.tgt.a1) / 2, name: a.name, sub: Math.floor(a.secs / 60) + " min", prio: a.secs, max: 40 }); });
      else ring2.forEach(function (d) { if (d.f && d.tgt.op && d.tgt.a1 - d.tgt.a0 >= CFG.featureLabelMinAngle) items.push({ angle: (d.tgt.a0 + d.tgt.a1) / 2, name: d.f.name, sub: fmt(d.secs), prio: d.tgt.a1 - d.tgt.a0, max: 30 }); });
      placeLabels(items).forEach(function (l) {
        var t = gLabels.append("text").attr("class", "wm-label").attr("text-anchor", l.anchor);
        t.append("tspan").attr("x", l.x).attr("y", l.y + 12).text(l.name);
        t.append("tspan").attr("class", "wm-label__sub").attr("x", l.x).attr("y", l.y + 28).text(l.sub);
      });
      if (view.level !== "wave" && !view.video) areaBy[view.area].videos.forEach(function (v) {
        var p = polar((G.r1[0] + G.r1[1]) / 2, (v.tgt.a0 + v.tgt.a1) / 2);
        if (v.tgt.a1 - v.tgt.a0 >= 6) gLabels.append("text").attr("class", "wm-badge").attr("x", p[0]).attr("y", p[1]).text(v.n);
      });
      drawCenter(); drawOutline();
    }
    function wrapLines(s, max) {
      var words = s.split(" "), lines = [], cur = "";
      words.forEach(function (w) { if ((cur + " " + w).trim().length > 14 && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); });
      lines.push(cur);
      if (max && lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = trunc(lines[max - 1], 13); }
      return lines;
    }
    function drawCenter() {
      gCenter.selectAll("*").remove();
      if (view.level === "wave") {
        var s = G.r0 * 1.5;
        gCenter.append("image").attr("href", CFG.icon).attr("x", -s / 2).attr("y", -s / 2).attr("width", s).attr("height", s).append("title").text("Business Central icon, the center of the map");
        return;
      }
      var a = areaBy[view.area], v = view.video ? vidBy[view.video] : null;
      var back = gCenter.append("a").attr("class", "wm-center__back").attr("href", v ? "#/a/" + a.slug : "#/").attr("style", "--c:var(--area-" + a.slug + ")")
        .attr("aria-label", v ? "Zoom out to " + a.name + " (Escape)" : "Zoom out to the wave (Escape)");
      back.on("click", function (ev) { ev.preventDefault(); if (v) go({ level: "area", area: a.slug }); else go({ level: "wave" }); });
      back.append("circle").attr("r", G.r0 - 1);
      var lines = wrapLines(v ? shortTitle(v.title) : a.name, 3);
      var top = -((lines.length - 1) * 17) / 2 - 18;
      if (v) {
        var num = back.append("g").attr("class", "wm-center__num").attr("transform", "translate(0," + (top - 36) + ")");
        num.append("circle").attr("r", 11); num.append("text").text(v.n);
      } else back.append("image").attr("href", CFG.icon).attr("x", -17).attr("y", top - 52).attr("width", 34).attr("height", 34);
      var t = back.append("text").attr("class", "wm-center__name");
      lines.forEach(function (l, i) { t.append("tspan").attr("x", 0).attr("y", top + i * 17).text(l); });
      var y = top + (lines.length - 1) * 17;
      back.append("text").attr("class", "wm-center__mins").attr("x", 0).attr("y", y + 22).text(v ? mmss(v.secs) : Math.floor(a.secs / 60) + " min");
      var k = back.append("g").attr("class", "wm-kbd").attr("transform", "translate(0," + (y + 42) + ")");
      k.append("rect").attr("x", -14).attr("y", -8).attr("width", 28).attr("height", 16).attr("rx", 4);
      k.append("text").text("esc");
    }
    function drawOutline() {
      gOutline.selectAll("*").remove();
      if (moving) return;
      n2.each(function (d) {
        var sel = view.level === "feature" && d.slug === view.slug && d.tgt.op, hov = hoverKey === d.key && d.tgt.op;
        if (sel || hov) gOutline.append("path").attr("d", arcPath(G.r2, d.cur.a0, d.cur.a1)).attr("fill", "none").attr("stroke", "var(--text)").attr("stroke-linejoin", "round").attr("stroke-width", sel ? 2.5 : 1.5);
      });
      n1.each(function (d) { if (hoverKey === d.key && d.tgt.op) gOutline.append("path").attr("d", arcPath(G.r1, d.cur.a0, d.cur.a1)).attr("fill", "none").attr("stroke", "var(--text)").attr("stroke-linejoin", "round").attr("stroke-width", 1.5); });
    }

    // ---------- hover, tooltip, click, keyboard
    function showTip(d) {
      if (moving) return;
      var radii = d.kind === "area" || d.kind === "video" ? G.r1 : G.r2, p = polar((radii[0] + radii[1]) / 2, (d.cur.a0 + d.cur.a1) / 2);
      var name, sub;
      if (d.kind === "area") { name = d.name; sub = Math.floor(d.secs / 60) + " min · " + d.videos.length + (d.videos.length === 1 ? " video" : " videos"); }
      else if (d.kind === "video") { name = d.n + ". " + d.title; sub = mmss(d.secs) + " · " + featureCount(d) + " features"; }
      else if (d.kind === "ghost") { name = d.video.title; sub = mmss(d.secs) + " · no features extracted"; }
      else { name = d.f.name; sub = fmt(d.secs) + " · " + STATUS[statusKey(d.f)]; }
      tip.html("<b>" + esc(name) + "</b><span>" + esc(sub) + "</span>").style("left", (G.C + p[0]) + "px").style("top", (G.C + p[1]) + "px").style("display", null);
    }
    function hideTip() { tip.style("display", "none"); }
    // fromList: the hover started on a row of the video panel, so no tooltip and no scrolling of the list
    function setHover(d, fromList) {
      hoverKey = d ? d.key : null;
      n1.classed("is-hover", function (x) { return x.key === hoverKey; });
      n2.classed("is-hover", function (x) { return x.key === hoverKey; });
      if (d && !fromList) showTip(d); else hideTip();
      drawOutline();
      panel.querySelectorAll(".wm-vrow").forEach(function (row) {
        var on = row.getAttribute("data-key") === hoverKey;
        row.classList.toggle("is-hover", on);
        if (on && !fromList && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
      });
    }
    [n1, n2].forEach(function (sel) {
      sel.on("mouseenter", function (ev, d) { setHover(d); }).on("mouseleave", function () { setHover(null); })
        .on("focus", function (ev, d) { setHover(d); }).on("blur", function () { setHover(null); })
        .on("click", function (ev, d) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
          if (d.kind === "ghost") return; // plain link to the video page
          ev.preventDefault();
          var kb = ev.detail === 0;
          if (d.kind === "area") go({ level: "area", area: d.slug }, kb);
          else if (d.kind === "video") go({ level: "video", area: d.area, video: d.id }, kb);
          else go({ level: "feature", area: d.video.area, video: view.video ? d.video.id : null, slug: d.slug }, kb);
        })
        .on("keydown", function (ev, d) {
          if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
          ev.preventDefault();
          var sibs = sel.filter(function (x) { return x.tgt.op === 1; }).nodes(), i = sibs.indexOf(this);
          var next = sibs[(i + (ev.key === "ArrowRight" ? 1 : sibs.length - 1)) % sibs.length];
          if (next) next.focus();
        });
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || (ev.target.closest && ev.target.closest("input,select,textarea"))) return;
      if (view.level === "feature") { closePanel(); ev.preventDefault(); }
      else if (view.level === "video") { go({ level: "area", area: view.area }, true); ev.preventDefault(); }
      else if (view.level === "area") { go({ level: "wave" }, true); ev.preventDefault(); }
    });

    // ---------- filters: dim, never remove. Status pills OR, groups AND.
    function anyFilter() { return filt.status.length > 0 || !!filt.dev || !!filt.area || !!filt.q; }
    function matches(n) {
      if (!n.f) return !anyFilter();
      var f = n.f;
      return (!filt.status.length || filt.status.indexOf(f.status) >= 0) && (!filt.dev || f.dev_relevance === filt.dev) && (!filt.area || f.area === filt.area) &&
        (!filt.q || (f.name + " " + f.summary + " " + f.tags.join(" ")).toLowerCase().indexOf(filt.q) >= 0);
    }
    function applyFilters() {
      var on = anyFilter(), hit = {};
      n2.classed("is-dim", function (d) { var ok = matches(d); if (ok && d.f) hit[d.slug] = 1; return on && !ok; });
      n1.classed("is-dim", function (d) { return d.kind === "area" && !!filt.area && d.slug !== filt.area; });
      applyRowDim();
      var n = Object.keys(hit).length;
      document.getElementById("wm-count").textContent = on ? n + " of " + fj.features.length + " features match" : fj.features.length + " features in " + fj.videos.length + " videos";
      empty.style("display", on && n === 0 ? null : "none");
      form.querySelectorAll("[data-status]").forEach(function (b) { b.setAttribute("aria-pressed", String(filt.status.indexOf(b.getAttribute("data-status")) >= 0)); });
      form.querySelectorAll("[data-dev]").forEach(function (b) { b.setAttribute("aria-pressed", String(filt.dev === b.getAttribute("data-dev"))); });
      root.querySelectorAll("[data-filter-area]").forEach(function (b) { var s = b.getAttribute("data-filter-area"); b.setAttribute("aria-pressed", String(filt.area === s)); b.classList.toggle("is-dim", !!filt.area && filt.area !== s); });
      renderMobile();
      updateSelection();
      renderWatch();
    }
    function clearFilters() { filt = { status: [], dev: "", area: "", q: "" }; form.querySelector("input[name=q]").value = ""; applyFilters(); }
    form.addEventListener("click", function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-status")) { var k = b.getAttribute("data-status"), i = filt.status.indexOf(k); if (i >= 0) filt.status.splice(i, 1); else filt.status.push(k); }
      else if (b.hasAttribute("data-dev")) { var dv = b.getAttribute("data-dev"); filt.dev = filt.dev === dv ? "" : dv; }
      else if (b.hasAttribute("data-filter-area")) { var a = b.getAttribute("data-filter-area"); filt.area = filt.area === a ? "" : a; }
      else return;
      applyFilters();
    });
    form.querySelector("input[name=q]").addEventListener("input", function (ev) { filt.q = ev.target.value.toLowerCase().trim(); applyFilters(); });

    // area legend rows (desktop) and chips (mobile) are the area filter
    var sortedAreas = areas.slice().sort(function (a, b) { return b.secs - a.secs; });
    document.getElementById("wm-area-rows").innerHTML = sortedAreas.map(function (a) {
      return '<button type="button" class="wm-row" data-filter-area="' + a.slug + '" aria-pressed="false" style="--c:var(--area-' + a.slug + ')" title="Filter the map to ' + esc(a.name) + '"><span class="wm-swatch"></span><span class="wm-row__name">' + esc(a.name) + '</span><span class="wm-row__n">' + Math.floor(a.secs / 60) + " min</span></button>";
    }).join("");
    document.getElementById("wm-area-rows").addEventListener("click", function (ev) { var b = ev.target.closest("[data-filter-area]"); if (!b) return; var a = b.getAttribute("data-filter-area"); filt.area = filt.area === a ? "" : a; applyFilters(); });
    document.getElementById("wm-area-chips").innerHTML = sortedAreas.map(function (a) { return '<button type="button" class="wm-pill" data-filter-area="' + a.slug + '" aria-pressed="false" style="--c:var(--area-' + a.slug + ')"><span class="wm-swatch"></span>' + esc(a.name) + "</button>"; }).join("");

    // ---------- selection, crumbs, left column, panel
    function updateSelection() {
      var sel = view.level === "feature";
      n2.classed("is-selected", function (d) { return sel && d.slug === view.slug; })
        .classed("is-unselected", function (d) { return sel && d.slug !== view.slug; })
        .attr("aria-current", function (d) { return sel && d.slug === view.slug ? "true" : null; });
      drawOutline();
    }
    function renderCrumbs() {
      var items = [], label = CFG.waveLabel;
      if (view.level === "wave") items.push("<b>" + esc(label) + "</b>");
      else {
        items.push('<a href="#/">' + esc(label) + "</a>");
        var a = areaBy[view.area], v = view.video ? vidBy[view.video] : null;
        if (view.level === "area") items.push("<b>" + esc(a.name) + "</b>");
        else {
          items.push('<a href="#/a/' + a.slug + '">' + esc(a.name) + "</a>");
          if (v && view.level === "video") items.push("<b>" + v.n + ". " + esc(v.title) + "</b>");
          else if (v) items.push('<a href="#/v/' + v.id + '">' + v.n + ". " + esc(v.title) + "</a>");
          if (view.level === "feature") items.push("<b>" + esc(bySlug[view.slug].name) + "</b>");
        }
      }
      document.getElementById("wm-crumbs").innerHTML = items.join(' <span aria-hidden="true">/</span> ');
    }
    function renderVideos() {
      if (view.level === "wave") return;
      var a = areaBy[view.area];
      document.getElementById("wm-videos-title").textContent = "Videos in " + a.name;
      document.getElementById("wm-video-rows").innerHTML = a.videos.map(function (v) {
        return '<li><a class="wm-row" href="#/v/' + v.id + '" style="--c:var(--area-' + a.slug + ')"' + (view.video === v.id ? ' aria-current="true"' : "") + ' title="Zoom in to this video"><span class="wm-num">' + v.n + '</span><span class="wm-row__name">' + esc(v.title) + '</span><span class="wm-row__n">' + mmss(v.secs) + "</span></a></li>";
      }).join("");
    }
    var lastTrigger = null;
    function showPanel(html, labelledBy) {
      var wasOpen = !panel.hidden;
      panel.innerHTML = html;
      panel.setAttribute("aria-labelledby", labelledBy);
      panel.hidden = false; root.classList.add("has-panel");
      if (wasOpen) { panel.style.animation = "none"; panel.scrollTop = 0; } else panel.style.animation = "";
      renderWatch();
    }
    function renderPanel(focusClose) {
      if (view.level === "video") renderVideoPanel(focusClose);
      else if (view.level === "feature") renderFeaturePanel(focusClose);
      else { panel.hidden = true; panel.innerHTML = ""; root.classList.remove("has-panel"); }
    }
    // video level: every feature of the video in order of appearance, with its summary. Hover links a row to its arc.
    function renderVideoPanel(focusClose) {
      var v = vidBy[view.video], a = areaBy[v.area], feats = v.nodes.filter(function (n) { return n.f; }).slice().sort(function (x, y) { return x.t - y.t; });
      var h = [];
      h.push('<div class="wm-panel__head" style="--c:var(--area-' + a.slug + ')"><div><div class="wm-panel__area"><span class="wm-num">' + v.n + "</span>" + esc(a.name) + '</div><h2 id="wm-panel-title">' + esc(v.title) + '</h2></div><button type="button" class="wm-close" aria-label="Close the video, back to ' + esc(a.name) + '"><svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg></button></div>');
      h.push('<div class="wm-meta"><span class="wm-mono">' + mmss(v.secs) + "</span><span class=\"wm-mono\">" + feats.length + (feats.length === 1 ? " feature" : " features") + "</span>" + chip(v.id, 0, v.title) + '<a class="wm-mono" href="' + base + "videos/" + v.id + '/">video page</a></div>');
      h.push('<div class="wm-meta"><button type="button" class="wm-watch" data-watch="scope"></button></div>');
      if (!feats.length) h.push('<p class="wm-panel__summary">No features were extracted from this video yet. The video page has the chapters and the timeline.</p>');
      else {
        h.push('<p class="wm-eyebrow">Features, in order of appearance</p>');
        h.push('<ol class="wm-vlist">' + feats.map(function (n) {
          var f = n.f, sk = statusKey(f);
          return '<li class="wm-vrow" data-key="' + esc(n.key) + '" style="--c:var(--area-' + f.area + ')">' +
            '<a class="wm-vrow__link" href="#/v/' + v.id + "/f/" + esc(f.slug) + '"><span class="wm-vrow__name"><i class="wm-glyph" data-glyph="' + sk + '"></i>' + esc(f.name) + '</span><span class="wm-mono">' + fmt(n.secs) + " · " + STATUS[sk] + (f.dev_relevance === "high" ? " · dev: high" : "") + '</span><span class="wm-vrow__sum">' + esc(f.summary) + "</span></a>" +
            chip(v.id, n.t, v.title) + "</li>";
        }).join("") + "</ol>");
      }
      showPanel(h.join(""), "wm-panel-title");
      panel.querySelector(".wm-close").addEventListener("click", function () { go({ level: "area", area: a.slug }); });
      panel.querySelectorAll(".wm-vrow").forEach(function (row) {
        var d = nodeByKey[row.getAttribute("data-key")];
        row.addEventListener("mouseenter", function () { setHover(d, true); });
        row.addEventListener("mouseleave", function () { setHover(null, true); });
        row.addEventListener("focusin", function () { setHover(d, true); });
        row.addEventListener("focusout", function () { setHover(null, true); });
        row.querySelector(".wm-vrow__link").addEventListener("click", function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
          ev.preventDefault(); go({ level: "feature", area: v.area, video: v.id, slug: d.slug }, ev.detail === 0);
        });
      });
      applyRowDim();
      if (focusClose) panel.querySelector(".wm-close").focus();
    }
    function applyRowDim() {
      var on = anyFilter();
      panel.querySelectorAll(".wm-vrow").forEach(function (row) { var d = nodeByKey[row.getAttribute("data-key")]; row.classList.toggle("is-dim", on && !!d && !matches(d)); });
    }
    function renderFeaturePanel(focusClose) {
      var f = bySlug[view.slug], sk = statusKey(f), rp = f.release_plan || {}, ev = f.status_evidence;
      var vt = function (id) { return (vidBy[id] && vidBy[id].title) || id; };
      var h = [];
      h.push('<div class="wm-panel__head" style="--c:var(--area-' + f.area + ')"><div><div class="wm-panel__area"><span class="wm-swatch"></span>' + esc(areaName[f.area]) + '</div><h2 id="wm-panel-title">' + esc(f.name) + '</h2></div><button type="button" class="wm-close" aria-label="Close detail panel"><svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg></button></div>');
      h.push('<div class="wm-meta"><span class="wm-status" data-glyph="' + sk + '" style="--c:var(--area-' + f.area + ')"><i class="wm-glyph" data-glyph="' + sk + '"></i>' + STATUS[sk] + '</span><span class="wm-mono">' + fmt(f.airtime_seconds) + ' of airtime</span><span class="wm-mono">dev relevance: ' + esc(f.dev_relevance) + "</span></div>");
      h.push('<div class="wm-meta"><button type="button" class="wm-watch" data-watch="scope"></button><button type="button" class="wm-watch wm-watch--alt" data-watch="demo"></button></div>');
      h.push('<div class="wm-evidence"><p class="wm-eyebrow">The sentence that proves it</p>' + (ev && ev.quote ? "<p>“" + esc(ev.quote) + "”</p>" + chip(ev.video_id, ev.t, vt(ev.video_id)) : "<p>Nobody on stage said when it ships. GA by launch event convention, unless the docs say otherwise.</p>") + "</div>");
      if (f.summary) h.push('<p class="wm-panel__summary">' + esc(f.summary) + "</p>");
      if (f.quotes && f.quotes.length) h.push('<div class="wm-section"><p class="wm-eyebrow">Hear them say it</p>' + f.quotes.slice(0, 5).map(function (q) { return '<div class="wm-quote">' + chip(q.video_id, q.t, vt(q.video_id)) + "<span>" + esc(q.text) + "</span></div>"; }).join("") + "</div>");
      h.push('<div class="wm-section"><p class="wm-eyebrow">Appears in</p>' + f.videos.map(function (v) {
        var len = vidBy[v.id] ? mmss(vidBy[v.id].secs) : "";
        return '<a class="wm-video" href="' + yt(v.id, v.t_start) + '" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg" alt="" loading="lazy" width="96" height="54"><span><b>' + esc(v.title) + '</b><span class="wm-mono">' + len + " · starts " + mmss(v.t_start) + "</span></span></a>" +
          '<div class="wm-video__links">' + chip(v.id, v.t_start, v.title) + (v.demo ? '<span class="wm-mono">demo</span>' + chip(v.id, v.demo.t_start, v.title) : "") + '<a href="' + base + "videos/" + v.id + '/">video page</a></div>';
      }).join("") + "</div>");
      h.push('<div class="wm-section"><p class="wm-eyebrow">Docs match</p><div class="wm-meta">' + (rp.matched ? '<a class="wm-doc" href="' + esc(rp.url) + '" target="_blank" rel="noopener">' + esc(rp.title) + "</a>" + (rp.doc_status ? '<span class="wm-mono">docs: ' + esc(rp.availability || rp.doc_status) + "</span>" : "") : '<span class="wm-doc">Shown, not documented</span>') + '<span class="wm-conf" data-conf="' + esc(rp.confidence || "none") + '">confidence: ' + esc(rp.confidence || "none") + "</span></div></div>");
      if (f.tags && f.tags.length) h.push('<div class="wm-tags">' + f.tags.map(function (t) { return '<span class="wm-tag">' + esc(t) + "</span>"; }).join("") + "</div>");
      h.push('<button type="button" class="wm-share">Copy link to this feature<span>#/f/' + esc(f.slug) + "</span></button>");
      h.push('<p class="wm-mono"><a href="' + base + "features/" + f.slug + '/">Feature page</a></p>');
      showPanel(h.join(""), "wm-panel-title");
      panel.querySelector(".wm-close").addEventListener("click", closePanel);
      var sh = panel.querySelector(".wm-share");
      sh.addEventListener("click", function () {
        var u = location.origin + location.pathname + "#/f/" + f.slug;
        (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { sh.firstChild.textContent = "Link copied"; }, function () { window.prompt("Copy this link", u); });
      });
      if (focusClose) panel.querySelector(".wm-close").focus();
    }
    function closePanel() {
      var slug = view.slug, area = view.area, video = view.video;
      go(video ? { level: "video", area: area, video: video } : { level: "area", area: area });
      var n = n2.filter(function (d) { return d.slug === slug && d.tgt.op === 1; }).node();
      if (lastTrigger === "kb" && n) n.focus();
    }

    // ---------- watch here: the active selection (and filters) as a queue of clips in an embedded YouTube player.
    // A clip is one stretch of one video; overlapping feature ranges of a video merge into one clip, so nothing plays twice.
    // Whole videos start a few seconds before their first feature. Chapters are the features inside a clip, highlighted while they play.
    var PAD = 5, playOrder = [];
    areas.forEach(function (a) { a.videos.forEach(function (v) { v.ord = playOrder.length; playOrder.push(v); }); });
    var dock = document.getElementById("wm-player"), watchBtn = document.getElementById("wm-watch");
    var pl = { q: null, i: 0, at: 0, yt: null, ready: false, booting: false, ch: -1, timer: null };
    var ICON = {
      prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v10M13 3L6 8l7 5z"/></svg>',
      next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 3v10M3 3l7 5-7 5z"/></svg>',
      fs: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>',
      close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>'
    };
    dock.innerHTML = '<div class="wm-player__head"><div class="wm-player__info"><p class="wm-eyebrow" id="wm-player-label"></p><p class="wm-player__now" id="wm-player-now"></p></div>' +
      '<div class="wm-player__ctrl"><button type="button" class="wm-icon" data-pl="prev" aria-label="Previous clip" title="Previous clip">' + ICON.prev + '</button><button type="button" class="wm-icon" data-pl="next" aria-label="Next clip" title="Next clip">' + ICON.next + "</button>" +
      '<button type="button" class="wm-icon" data-pl="fs" aria-label="Full screen with the list" title="Full screen with the list" aria-pressed="false">' + ICON.fs + '</button><button type="button" class="wm-icon" data-pl="close" aria-label="Close the player" title="Close the player">' + ICON.close + "</button></div></div>" +
      '<div class="wm-player__body"><div class="wm-player__screen" id="wm-player-screen"><div class="wm-player__msg" hidden></div></div><ol class="wm-queue" id="wm-queue" aria-label="Playlist"></ol></div>';
    var screenEl = document.getElementById("wm-player-screen"), queueEl = document.getElementById("wm-queue"), msgEl = screenEl.querySelector(".wm-player__msg");
    var fsBtn = dock.querySelector('[data-pl="fs"]');
    function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    if (!(dock.requestFullscreen || dock.webkitRequestFullscreen)) fsBtn.hidden = true; // iPhone: the YouTube full screen button still works

    function chaptersOf(v) { return v.nodes.filter(function (n) { return n.f; }).map(function (n) { return { t: n.t, key: n.key, f: n.f }; }).sort(function (x, y) { return x.t - y.t; }); }
    function wholeClip(v, from) { var ch = chaptersOf(v); return { id: v.id, v: v, start: from != null ? from : ch.length ? Math.max(0, ch[0].t - PAD) : 0, end: null, chapters: ch }; }
    // parts: { v, s, e, n } in play order of their videos; sorted by start inside a video, then merged where they touch
    function rangeClips(parts) {
      var vi = {}, out = [];
      parts.forEach(function (p) { if (!(p.v.id in vi)) vi[p.v.id] = Object.keys(vi).length; });
      parts.sort(function (x, y) { return vi[x.v.id] - vi[y.v.id] || x.s - y.s; });
      parts.forEach(function (p) {
        var last = out[out.length - 1], s = Math.max(0, p.s - PAD), ch = { t: p.s, key: p.n.key, f: p.n.f };
        if (last && last.id === p.v.id && s <= last.end) {
          last.end = Math.max(last.end, p.e);
          if (!last.chapters.some(function (c) { return c.key === ch.key; })) last.chapters.push(ch);
        } else out.push({ id: p.v.id, v: p.v, start: s, end: p.e, chapters: [ch] });
      });
      return out;
    }
    // mode "scope": what is selected; "demo": the demo ranges of the selected feature
    function queueFor(mode) {
      var parts = [];
      if (view.level === "feature") {
        var f = bySlug[view.slug];
        ring2.filter(function (d) { return d.slug === view.slug; })
          .sort(function (x, y) { return (y.video.id === view.video) - (x.video.id === view.video) || x.video.ord - y.video.ord; })
          .forEach(function (n) {
            if (mode === "demo") { if (n.demo) parts.push({ v: n.video, s: n.demo.t_start, e: n.demo.t_end, n: n }); }
            else n.ranges.forEach(function (r) { parts.push({ v: n.video, s: r[0], e: r[1], n: n }); });
          });
        return { clips: rangeClips(parts), label: (mode === "demo" ? "Demo: " : "") + f.name, sig: mode + "|" + f.slug };
      }
      if (mode === "demo") return { clips: [], label: "", sig: "" };
      var vids = view.video ? [vidBy[view.video]] : view.level === "area" ? areaBy[view.area].videos : playOrder;
      var scope = view.video ? vids[0].title : view.level === "area" ? areaBy[view.area].name : "All " + vids.length + " videos";
      if (!anyFilter()) return { clips: vids.map(function (v) { return wholeClip(v); }), label: scope, sig: "scope|" + hashOf(view) };
      vids.forEach(function (v) { v.nodes.forEach(function (n) { if (n.f && matches(n)) n.ranges.forEach(function (r) { parts.push({ v: v, s: r[0], e: r[1], n: n }); }); }); });
      return { clips: rangeClips(parts), label: scope + ", filtered", sig: "scope|" + hashOf(view) + "|" + JSON.stringify(filt) };
    }
    function clipEnd(c) { return c.end != null ? c.end : c.v.secs; }
    function describe(q) {
      var secs = q.clips.reduce(function (t, c) { return t + clipEnd(c) - c.start; }, 0), whole = q.clips.every(function (c) { return c.end == null; });
      var n = q.clips.length, unit = whole ? (n === 1 ? " video" : " videos") : (n === 1 ? " clip" : " clips");
      return n + unit + " · " + mmss(secs);
    }
    function renderWatch() {
      var q = queueFor("scope"), on = !!pl.q;
      [watchBtn].concat([].slice.call(panel.querySelectorAll("[data-watch]"))).forEach(function (b) {
        var m = b.getAttribute("data-watch"), bq = m === "scope" ? q : queueFor(m), same = on && pl.q.sig === bq.sig;
        var text = same ? "Playing here" : m === "demo" ? (on ? "Play the demo instead" : "Watch the demo") : on ? "Play this instead" : "Watch here";
        b.hidden = !bq.clips.length;
        b.classList.toggle("is-playing", same);
        b.innerHTML = PLAY + "<span>" + text + '</span><span class="wm-watch__n">' + esc(bq.clips.length ? describe(bq) : "") + "</span>";
        b.title = (same ? "Now playing: " : "Play on this page: ") + bq.label;
      });
    }

    function loadApi() {
      if (loadApi.p) return loadApi.p;
      loadApi.p = new Promise(function (res, rej) {
        if (window.YT && window.YT.Player) { res(); return; }
        var prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () { if (prev) prev(); res(); };
        var s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.onerror = function () { loadApi.p = null; rej(new Error("YouTube player did not load")); };
        document.head.appendChild(s);
      });
      return loadApi.p;
    }
    function start(q) {
      if (!q.clips.length) return;
      if (pl.q && pl.q.sig === q.sig) { reveal(); return; }
      pl.q = q;
      document.getElementById("wm-player-label").textContent = "Watching here · " + q.label + " · " + describe(q);
      dock.hidden = false;
      renderQueue();
      load(0);
      renderWatch();
      reveal();
      if (!pl.timer) pl.timer = setInterval(tick, 500);
    }
    function reveal() {
      var r = dock.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) dock.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    function load(i, at) {
      var c = pl.q.clips[i];
      pl.i = i; pl.at = at != null ? at : c.start; pl.ch = -1;
      msgEl.hidden = true;
      renderNow();
      if (pl.ready) pl.yt.loadVideoById({ videoId: c.id, startSeconds: pl.at, endSeconds: c.end != null ? c.end : undefined });
      else if (!pl.booting) boot();
    }
    // the iframe is built here (not by the API) so it carries autoplay and fullscreen permissions and the no-cookie host
    function boot() {
      pl.booting = true;
      loadApi().then(function () {
        if (!pl.q) { pl.booting = false; return; }
        var c = pl.q.clips[pl.i], at = pl.at, fr = document.createElement("iframe");
        fr.src = "https://www.youtube-nocookie.com/embed/" + c.id + "?enablejsapi=1&autoplay=1&playsinline=1&rel=0&start=" + Math.floor(at) + (c.end != null ? "&end=" + Math.ceil(c.end) : "") + "&origin=" + encodeURIComponent(location.origin);
        fr.title = "YouTube video player";
        fr.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
        fr.setAttribute("allowfullscreen", "");
        fr.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        screenEl.insertBefore(fr, msgEl);
        pl.yt = new window.YT.Player(fr, { events: {
          onReady: function () {
            pl.ready = true; pl.booting = false;
            var now = pl.q && pl.q.clips[pl.i];
            if (now && (now.id !== c.id || pl.at !== at)) load(pl.i, pl.at); // the selection moved on while the player booted
          },
          onStateChange: function (e) { if (e.data === 0 && pl.q) { if (pl.i < pl.q.clips.length - 1) load(pl.i + 1); else renderNow(true); } },
          onError: function (e) {
            var c2 = pl.q && pl.q.clips[pl.i]; if (!c2) return;
            msgEl.innerHTML = "<p>This clip does not play here (YouTube error " + esc(e.data) + ').</p><p><a href="' + yt(c2.id, pl.at) + '" target="_blank" rel="noopener">Open it on YouTube</a> or skip to the next clip.</p>';
            msgEl.hidden = false;
          }
        } });
      }, function (e) {
        pl.booting = false;
        msgEl.innerHTML = "<p>" + esc(e.message) + '. <a href="' + yt(pl.q.clips[pl.i].id, pl.at) + '" target="_blank" rel="noopener">Open it on YouTube</a>.</p>';
        msgEl.hidden = false;
      });
    }
    function closePlayer() {
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      if (pl.yt) { try { pl.yt.destroy(); } catch (e) { /* already gone */ } pl.yt = null; pl.ready = false; pl.booting = false; }
      [].slice.call(screenEl.querySelectorAll("iframe")).forEach(function (fr) { fr.remove(); });
      clearInterval(pl.timer); pl.timer = null;
      pl.q = null; dock.hidden = true; queueEl.innerHTML = "";
      setHover(null, true);
      renderWatch();
      watchBtn.focus();
    }
    // jump to a clip (and a second inside it) without reloading when it is the clip already playing
    function jump(i, t) {
      if (i === pl.i && pl.ready && t != null) { pl.yt.seekTo(t, true); pl.yt.playVideo(); pl.ch = -1; tick(); }
      else load(i, t);
    }
    // a timestamp link elsewhere on the map: play it in the queue when it is inside a clip, else insert it after the current clip
    function playAt(id, t) {
      var i = -1;
      pl.q.clips.forEach(function (c, k) { if (i < 0 && c.id === id && t >= c.start && t < clipEnd(c)) i = k; });
      if (i < 0) { pl.q.clips.splice(pl.i + 1, 0, wholeClip(vidBy[id], t)); i = pl.i + 1; renderQueue(); }
      jump(i, t);
      reveal();
    }

    function renderQueue() {
      queueEl.innerHTML = pl.q.clips.map(function (c, i) {
        return '<li class="wm-qclip" data-i="' + i + '" style="--c:var(--area-' + c.v.area + ')">' +
          '<button type="button" class="wm-qclip__head" data-go="' + i + '"><img src="https://i.ytimg.com/vi/' + c.id + '/mqdefault.jpg" alt="" loading="lazy" width="64" height="36"><span><b>' + esc(c.v.title) + '</b><span class="wm-mono">' + mmss(c.start) + " – " + mmss(clipEnd(c)) + (c.chapters.length ? " · " + c.chapters.length + (c.chapters.length === 1 ? " feature" : " features") : "") + "</span></span></button>" +
          (c.chapters.length ? '<ol class="wm-qch">' + c.chapters.map(function (ch, k) {
            var sk = statusKey(ch.f);
            return '<li class="wm-qrow" data-key="' + esc(ch.key) + '" data-k="' + k + '" style="--c:var(--area-' + ch.f.area + ')"><button type="button" class="wm-qrow__go" data-go="' + i + '" data-t="' + ch.t + '"><span class="wm-qrow__name"><i class="wm-glyph" data-glyph="' + sk + '"></i>' + esc(ch.f.name) + '</span><span class="wm-mono">' + mmss(ch.t) + " · " + STATUS[sk] + (ch.f.dev_relevance === "high" ? " · dev: high" : "") + '</span><span class="wm-qrow__sum">' + esc(ch.f.summary) + "</span></button>" +
              '<a class="wm-qrow__more" href="#/v/' + c.id + "/f/" + esc(ch.f.slug) + '" title="Open the detail of this feature">detail</a></li>';
          }).join("") + "</ol>" : "") + "</li>";
      }).join("");
    }
    function renderNow(done) {
      if (!pl.q) return;
      var c = pl.q.clips[pl.i], ch = pl.ch >= 0 ? c.chapters[pl.ch] : null;
      document.getElementById("wm-player-now").innerHTML = done ? "<b>End of the list.</b>" : '<span class="wm-mono">' + (pl.i + 1) + " / " + pl.q.clips.length + "</span> <b>" + esc(c.v.title) + "</b>" + (ch ? " · " + esc(ch.f.name) : "");
      dock.querySelector('[data-pl="prev"]').disabled = pl.i === 0;
      dock.querySelector('[data-pl="next"]').disabled = pl.i >= pl.q.clips.length - 1;
      queueEl.querySelectorAll(".wm-qclip").forEach(function (li) {
        var cur = +li.getAttribute("data-i") === pl.i;
        li.classList.toggle("is-current", cur);
        li.querySelectorAll(".wm-qrow").forEach(function (r) { r.classList.toggle("is-current", cur && +r.getAttribute("data-k") === pl.ch); });
      });
      var row = queueEl.querySelector(".wm-qrow.is-current") || queueEl.querySelector(".wm-qclip.is-current .wm-qclip__head");
      if (row && queueEl.scrollHeight > queueEl.clientHeight) { // keep the playing row in view inside the list, never scroll the page
        var top = row.offsetTop - queueEl.offsetTop, bottom = top + row.offsetHeight;
        if (top < queueEl.scrollTop || bottom > queueEl.scrollTop + queueEl.clientHeight) queueEl.scrollTop = Math.max(0, top - 8);
      }
    }
    // twice a second: which chapter of the clip is on screen
    function tick() {
      if (!pl.q || !pl.ready) return;
      var c = pl.q.clips[pl.i], d = pl.yt.getVideoData ? pl.yt.getVideoData() : null;
      if (!d || d.video_id !== c.id) return;
      var t = pl.yt.getCurrentTime() || 0, k = -1;
      c.chapters.forEach(function (ch, j) { if (ch.t <= t + 0.5) k = j; });
      if (k !== pl.ch) { pl.ch = k; renderNow(); }
    }

    dock.addEventListener("click", function (ev) {
      if (ev.target.closest(".wm-qrow__more") && fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); // the detail panel lives outside the dock
      var b = ev.target.closest("[data-pl],[data-go]"); if (!b) return;
      var a = b.getAttribute("data-pl");
      if (a === "close") closePlayer();
      else if (a === "prev" && pl.i > 0) load(pl.i - 1);
      else if (a === "next" && pl.i < pl.q.clips.length - 1) load(pl.i + 1);
      else if (a === "fs") { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else (dock.requestFullscreen || dock.webkitRequestFullscreen).call(dock); }
      else if (b.hasAttribute("data-go")) {
        var i = +b.getAttribute("data-go"), t = b.hasAttribute("data-t") ? Math.max(pl.q.clips[i].start, +b.getAttribute("data-t") - 2) : null;
        jump(i, t);
      }
    });
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (n) { document.addEventListener(n, function () { var on = fsEl() === dock; dock.classList.toggle("is-fs", on); fsBtn.setAttribute("aria-pressed", String(on)); }); });
    // hovering a playlist row lights its arc on the map and opens its summary, like the rows of the video panel
    queueEl.addEventListener("mouseover", function (ev) { var r = ev.target.closest(".wm-qrow"), d = r ? nodeByKey[r.getAttribute("data-key")] : null; if ((d ? d.key : null) !== hoverKey) setHover(d, true); });
    queueEl.addEventListener("mouseleave", function () { setHover(null, true); });
    root.addEventListener("click", function (ev) {
      var w = ev.target.closest("[data-watch]");
      if (w) { start(queueFor(w.getAttribute("data-watch"))); return; }
      if (!pl.q || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button) return;
      var a = ev.target.closest('a[href^="https://www.youtube.com/watch"]');
      if (!a || dock.contains(a)) return;
      var u = new URL(a.href), id = u.searchParams.get("v");
      if (!vidBy[id]) return;
      ev.preventDefault();
      playAt(id, parseInt(u.searchParams.get("t"), 10) || 0);
    });

    // ---------- mobile list (under the tablet breakpoint; no sunburst)
    function donut(a) {
      var g = d3.arc();
      var ring = g({ innerRadius: 11, outerRadius: 20, startAngle: 0, endAngle: 2 * Math.PI }), slice = g({ innerRadius: 11, outerRadius: 20, startAngle: a.w0 * RAD, endAngle: a.w1 * RAD });
      return '<svg class="wm-donut" viewBox="-22 -22 44 44" aria-hidden="true"><path class="wm-donut__ring" d="' + ring + '"/><path class="wm-donut__slice" d="' + slice + '"/></svg>';
    }
    function renderMobile() {
      var on = anyFilter(), h = [];
      if (view.level === "wave") {
        areas.forEach(function (a) {
          var hit = !on || a.videos.some(function (v) { return v.nodes.some(function (n) { return n.f && matches(n); }); });
          h.push('<a class="wm-mcard' + (hit ? "" : " is-dim") + '" href="#/a/' + a.slug + '" style="--c:var(--area-' + a.slug + ')">' + donut(a) + '<span class="wm-mcard__name">' + esc(a.name) + "<small>" + Math.floor(a.secs / 60) + " min · " + a.videos.length + (a.videos.length === 1 ? " video" : " videos") + "</small></span></a>");
        });
      } else {
        var a = areaBy[view.area], seen = {}, rows = [], vid = view.video ? vidBy[view.video] : null;
        (vid ? [vid] : a.videos).forEach(function (v) {
          v.nodes.forEach(function (n) {
            if (!n.f) { rows.push({ ghost: true, n: n }); return; }
            if (seen[n.slug]) { seen[n.slug].secs += n.secs; return; }
            seen[n.slug] = { n: n, secs: n.secs }; rows.push(seen[n.slug]);
          });
        });
        if (vid) rows.sort(function (x, y) { return (x.n.t || 0) - (y.n.t || 0); });
        else rows.sort(function (x, y) { return (y.secs || 0) - (x.secs || 0); });
        h.push(vid ? '<a class="wm-mback" href="#/a/' + a.slug + '">← ' + esc(a.name) + "</a>" : '<a class="wm-mback" href="#/">← ' + esc(CFG.waveLabel) + "</a>");
        if (vid) h.push('<p class="wm-eyebrow">' + vid.n + ". " + esc(vid.title) + " · " + mmss(vid.secs) + "</p>");
        rows.forEach(function (r) {
          if (r.ghost) { h.push('<a class="wm-mcard wm-mcard--feature' + (on ? " is-dim" : "") + '" href="' + base + "videos/" + r.n.video.id + '/"><i class="wm-glyph" data-glyph="ghost"></i><span class="wm-mcard__name">' + esc(r.n.video.title) + "<small>" + mmss(r.n.secs) + " · features pending</small></span></a>"); return; }
          var f = r.n.f;
          h.push('<a class="wm-mcard wm-mcard--feature' + (on && !matches(r.n) ? " is-dim" : "") + '" href="' + (vid ? "#/v/" + vid.id + "/f/" : "#/f/") + f.slug + '" style="--c:var(--area-' + f.area + ')"' + (view.slug === f.slug ? ' aria-current="true"' : "") + '><i class="wm-glyph" data-glyph="' + statusKey(f) + '"></i><span class="wm-mcard__name">' + esc(f.name) + "<small>" + fmt(r.secs) + " · " + STATUS[statusKey(f)] + "</small></span></a>");
        });
      }
      mobileEl.innerHTML = h.join("");
    }

    // ---------- routing: #/ wave, #/a/<area>, #/f/<feature>. pushState per level so back walks feature -> area -> wave.
    function homeArea(slug, prefer) {
      var apps = ring2.filter(function (d) { return d.slug === slug; });
      if (!apps.length) return null;
      if (prefer && apps.some(function (d) { return d.video.area === prefer; })) return prefer;
      var f = bySlug[slug];
      if (apps.some(function (d) { return d.video.area === f.area; })) return f.area;
      return apps.sort(function (x, y) { return y.secs - x.secs; })[0].video.area;
    }
    // #/v/<id> video, #/v/<id>/f/<slug> feature opened inside that video; #/f/<slug> stays the share form (feature at area level).
    function parse() {
      var h = location.hash.replace(/^#\/?/, "").split("/");
      if (h[0] === "area") h[0] = "a"; if (h[0] === "feature") h[0] = "f"; // links from the previous map
      if (h[0] === "a" && areaBy[h[1]]) return { level: "area", area: h[1] };
      if (h[0] === "v" && vidBy[h[1]]) {
        var v = vidBy[h[1]];
        if (h[2] === "f" && nodeByKey[h[3] + "@" + v.id]) return { level: "feature", area: v.area, video: v.id, slug: h[3] };
        if (h[2] === "f" && bySlug[h[3]]) h = ["f", h[3]]; // feature exists but not in that video: fall through to the plain feature route
        else return { level: "video", area: v.area, video: v.id };
      }
      if (h[0] === "f" && bySlug[h[1]]) { var a = homeArea(h[1], view.area); if (a) return { level: "feature", area: a, slug: h[1] }; }
      return { level: "wave" };
    }
    function hashOf(st) {
      if (st.level === "area") return "#/a/" + st.area;
      if (st.level === "video") return "#/v/" + st.video;
      if (st.level === "feature") return st.video ? "#/v/" + st.video + "/f/" + st.slug : "#/f/" + st.slug;
      return "#/";
    }
    function go(st, kb) {
      lastTrigger = kb ? "kb" : "mouse";
      if (hashOf(st) !== location.hash) history.pushState(null, "", hashOf(st));
      apply(st, kb);
    }
    function apply(st, kb) {
      st = { level: st.level, area: st.area || null, video: st.video || null, slug: st.slug || null };
      var windowChanged = st.area !== view.area || st.video !== view.video;
      view = st;
      root.setAttribute("data-level", st.level); svg.attr("data-level", st.level);
      n2.attr("href", function (d) { return d.kind === "ghost" ? base + "videos/" + d.video.id + "/" : st.video ? "#/v/" + d.video.id + "/f/" + d.slug : "#/f/" + d.slug; });
      if (windowChanged) zoomTo(st, true); else drawOutline();
      updateSelection(); renderCrumbs(); renderVideos(); renderPanel(kb && st.level !== "area" && st.level !== "wave"); renderMobile(); renderWatch();
      if (!moving) decorate();
    }
    window.addEventListener("popstate", function () { apply(parse()); });
    window.addEventListener("hashchange", function () { var st = parse(); if (/^#(area|feature)\//.test(location.hash)) history.replaceState(null, "", hashOf(st)); if (hashOf(st) !== hashOf(view)) apply(st); });

    // ---------- size: one svg, redrawn at its real pixel size so type stays at token sizes
    function resize() {
      measure();
      d3.select(box).style("width", G.S + "px").style("height", G.S + "px");
      svg.attr("viewBox", "0 0 " + G.S + " " + G.S).attr("width", G.S).attr("height", G.S);
      gRoot.attr("transform", "translate(" + G.C + "," + G.C + ")");
      if (moving) return;
      drawAll(); decorate();
    }
    var lastW = 0;
    if (window.ResizeObserver) new ResizeObserver(function () { if (stage.clientWidth !== lastW) { lastW = stage.clientWidth; resize(); } }).observe(stage);
    window.addEventListener("resize", resize);

    // first paint: no tween
    var first = parse();
    if (/^#(area|feature)\//.test(location.hash)) history.replaceState(null, "", hashOf(first));
    view = { level: first.level, area: first.area || null, video: first.video || null, slug: first.slug || null };
    n2.attr("href", function (d) { return d.kind === "ghost" ? base + "videos/" + d.video.id + "/" : view.video ? "#/v/" + d.video.id + "/f/" + d.slug : "#/f/" + d.slug; });
    root.setAttribute("data-level", view.level); svg.attr("data-level", view.level);
    zoomTo(view, false); resize();
    applyFilters(); renderCrumbs(); renderVideos(); renderPanel(false);
  }
})();
