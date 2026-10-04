import { marked } from "marked";
import { fmtTime, fmtMinutes, ytUrl, ytThumb } from "../../pipeline/lib/text.js";

export { fmtTime, fmtMinutes, ytUrl, ytThumb };
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const attr = esc;

export interface SiteCtx {
  base: string;          // "/msdyn365-2026-release-wave-2/"
  origin: string;        // "https://waldo1001.github.io"
  waveName: string;
  waveId: string;
  repoUrl: string;
  pub: boolean;
  goatcounter: string;   // GoatCounter site code; "" builds the site without analytics
  areas: { slug: string; name: string }[];
  nav: { href: string; label: string; children?: { href: string; label: string }[] }[];
}

export const STATUS_LABEL: Record<string, string> = { ga: "GA", preview: "preview", announced: "announced", unclear: "not stated" };
// A feature is GA unless the presenters said otherwise (launch event rule). The badge just says GA; the footer of every page carries the footnote.
export const statusBadge = (s: string, source?: string) => source === "implied"
  ? `<span class="badge status-${esc(s)} implied" title="${esc(STATUS_LABEL[s] ?? s)} by the launch event rule: nobody on stage said otherwise (see the status note at the bottom of the page)">${esc(STATUS_LABEL[s] ?? s)}</span>`
  : `<span class="badge status-${esc(s)}" title="Status as stated in the video">${esc(STATUS_LABEL[s] ?? s)}</span>`;
export const statusOf = (f: any) => statusBadge(f.status, f.status_source);
export const confBadge = (c: string) => `<span class="badge conf-${esc(c)}" title="Docs match confidence">${esc(c)} match</span>`;
export const areaDot = (slug: string) => `<i class="area-dot" style="--area-color:var(--area-${esc(slug)})" aria-hidden="true"></i>`;
export const tChip = (id: string, t: number, title?: string) => `<a class="chip t" href="${ytUrl(id, t)}" target="_blank" rel="noopener" title="${attr(title ? `${title} at ${fmtTime(t)}` : `Open the video at ${fmtTime(t)}`)}">${fmtTime(t)}</a>`;

export function layout(ctx: SiteCtx, opts: { title: string; description: string; path: string; body: string; og?: string; scripts?: string[]; head?: string; wide?: boolean }): string {
  const url = `${ctx.origin}${ctx.base}${opts.path}`;
  const og = `${ctx.origin}${ctx.base}og/${opts.og ?? "home"}.png`;
  const active = (href: string) => (href === "" ? opts.path === "" : opts.path.startsWith(href)) ? ' aria-current="page"' : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} - BC ${esc(ctx.waveName)} launch event map</title>
<meta name="description" content="${attr(opts.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:title" content="${attr(opts.title)}"><meta property="og:description" content="${attr(opts.description)}"><meta property="og:image" content="${og}"><meta property="og:url" content="${url}"><meta property="og:site_name" content="BC ${esc(ctx.waveName)} launch event map">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${og}">
<link rel="icon" href="${ctx.base}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${ctx.base}assets/tokens.css">
<link rel="stylesheet" href="${ctx.base}assets/site.css">
<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
${ctx.goatcounter ? `<script data-goatcounter="https://${ctx.goatcounter}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>` : ""}
${opts.head ?? ""}
</head>
<body>
<a class="sr-only" href="#main">Skip to content</a>
<header class="top"><div class="wrap${opts.wide ? " wrap-wide" : ""}">
  <a class="brand" href="${ctx.base}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="var(--accent)"/><path d="M16 2v14l13-6.5z" fill="var(--accent-strong)" opacity=".9"/><path d="M16 16v14l13-7.5V9.5z" fill="var(--accent-strong)" opacity=".6"/></svg><span>BC ${esc(ctx.waveName)}<small>unofficial launch event map, by waldo</small></span></a>
  <nav class="main" aria-label="Main">${ctx.nav.map((n) => n.children
    ? `<details class="nav-menu"><summary${active(n.href)}>${esc(n.label)}</summary><div class="nav-menu__panel">${n.children.map((c) => `<a href="${ctx.base}${c.href}"${opts.path === c.href ? ' aria-current="page"' : ""}>${esc(c.label)}</a>`).join("")}</div></details>`
    : `<a href="${ctx.base}${n.href}"${active(n.href)}>${esc(n.label)}</a>`).join("")}</nav>
  <button class="theme-toggle" type="button">Theme</button>
</div></header>
<main id="main"><div class="wrap${opts.wide ? " wrap-wide" : ""}">
${opts.body}
</div></main>
<footer class="bottom"><div class="wrap">
  <p>Unofficial. Built by <a href="https://www.waldo.be" rel="noopener">waldo</a> from the public YouTube auto-captions of Microsoft's launch event videos. Not affiliated with Microsoft. Every claim links to a video and a second; the video is the source.</p>
  <p class="status-note" id="status-note"><b>About the GA label.</b> A feature is shown as GA unless the presenters said otherwise; that is how Microsoft runs the launch event, and it is the rule here. Where they said preview or "later", the badge says so. The docs column shows what Microsoft wrote, and the data keeps the distinction as <code>status_source</code>.</p>
  <p><a href="${ctx.repoUrl}" rel="noopener">Repository</a> · <a href="${ctx.base}about/">About and content notice</a> · <a href="${ctx.base}llms.txt">llms.txt</a> · ${ctx.goatcounter ? `No cookies. Cookieless visit counts with <a href="https://www.goatcounter.com" rel="noopener">GoatCounter</a>; no other external requests except YouTube.` : "No cookies, no analytics, no external requests except YouTube."}</p>
</div></footer>
<script src="${ctx.base}assets/theme.js" defer></script>
${ctx.goatcounter ? `<script src="${ctx.base}assets/analytics.js" defer></script>` : ""}
${(opts.scripts ?? []).map((s) => `<script src="${ctx.base}assets/${s}" defer></script>`).join("\n")}
</body>
</html>
`;
}

/** Render a data/ markdown body (frontmatter already stripped) to HTML, rewriting relative data links to site routes. */
export function renderMarkdown(md: string, ctx: SiteCtx): string {
  const rewritten = md
    .replace(/\]\(\.\.\/features\/([a-z0-9-]+)\.md\)/g, `](${ctx.base}features/$1/)`)
    .replace(/\]\(\.\.\/videos\/([A-Za-z0-9_-]+)\.md\)/g, `](${ctx.base}videos/$1/)`)
    .replace(/\]\(\.\.\/areas\/([a-z0-9-]+)\.md\)/g, `](${ctx.base}areas/$1/)`)
    .replace(/\]\(\.\.\/transcripts\/full\/([A-Za-z0-9_-]+)\.(md|json)\)/g, `](${ctx.repoUrl}/blob/main/data/transcripts/full/$1.$2)`);
  let html = marked.parse(rewritten, { async: false }) as string;
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>"); // markdown tables scroll instead of overflowing at phone width
  html = html.replace(/<a href="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+&amp;t=(\d+)s)">([^<]*)<\/a>/g, (_m, href, _t, label) => {
    const l = label.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(l)) return `<a class="chip t" href="${href}" target="_blank" rel="noopener">${l}</a>`;
    const m = l.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (m) return `<a class="chip t" href="${href}" target="_blank" rel="noopener">${m[1]}</a> <a href="${href}" target="_blank" rel="noopener">${m[2]}</a>`;
    return `<a href="${href}" target="_blank" rel="noopener">${l}</a>`;
  });
  return html;
}

/** Static SVG timeline strip for one video. */
export function timelineSvg(tl: any, opts: { width?: number; compact?: boolean } = {}): string {
  const W = opts.width ?? 1000, H = opts.compact ? 34 : 64, pad = 2;
  const dur = Math.max(1, tl.duration_seconds);
  const x = (t: number) => pad + (Math.max(0, Math.min(dur, t)) / dur) * (W - 2 * pad);
  const parts: string[] = [];
  parts.push(`<g>${(tl.chapters ?? []).map((c: any) => `<a href="${ytUrl(tl.id, c.t_start)}" target="_blank" rel="noopener"><title>${esc(c.title)} (${fmtTime(c.t_start)})</title><rect class="ch" x="${x(c.t_start).toFixed(1)}" y="${opts.compact ? 4 : 14}" width="${Math.max(1, x(c.t_end) - x(c.t_start)).toFixed(1)}" height="${opts.compact ? 26 : 30}" rx="2"/></a>`).join("")}</g>`);
  parts.push(`<g>${(tl.demos ?? []).map((d: any) => `<rect class="demo" x="${x(d.t_start).toFixed(1)}" y="${opts.compact ? 20 : 34}" width="${Math.max(1, x(d.t_end) - x(d.t_start)).toFixed(1)}" height="${opts.compact ? 10 : 10}" rx="1"><title>demo: ${esc(d.name)}</title></rect>`).join("")}</g>`);
  parts.push(`<g>${(tl.features ?? []).map((f: any) => `<a href="${ytUrl(tl.id, f.t_start)}" target="_blank" rel="noopener"><circle class="feat" style="--area-color:var(--area-${esc(f.area)})" cx="${x(f.t_start).toFixed(1)}" cy="${opts.compact ? 10 : 20}" r="${opts.compact ? 3 : 4}"><title>${esc(f.name)} (${fmtTime(f.t_start)})</title></circle></a>`).join("")}</g>`);
  parts.push(`<g>${(tl.disclaimers ?? []).map((d: any) => `<a href="${ytUrl(tl.id, d.t)}" target="_blank" rel="noopener"><line class="disc" x1="${x(d.t).toFixed(1)}" x2="${x(d.t).toFixed(1)}" y1="${opts.compact ? 4 : 14}" y2="${opts.compact ? 30 : 44}"><title>${esc(d.kind)}: ${esc(d.text)} (${fmtTime(d.t)})</title></line></a>`).join("")}</g>`);
  if (!opts.compact) {
    const ticks: number[] = []; const step = dur > 1500 ? 300 : dur > 600 ? 120 : 60;
    for (let t = 0; t <= dur; t += step) ticks.push(t);
    parts.push(`<line class="axis" x1="${pad}" x2="${W - pad}" y1="50" y2="50"/>`);
    parts.push(ticks.map((t) => `<g><line class="axis" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="47" y2="53"/><text x="${x(t).toFixed(1)}" y="62" text-anchor="${t === 0 ? "start" : t + step > dur ? "end" : "middle"}">${fmtTime(t)}</text></g>`).join(""));
  }
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of ${esc(tl.title)}: chapters, demo ranges, feature mentions and disclaimer moments; click to open the video at that moment" preserveAspectRatio="none" style="height:${H}px">${parts.join("")}</svg>`;
}

/** Horizontal bar chart (stacked when segments > 1). */
export function barsSvg(rows: { label: string; segments: { value: number; cls: string; title?: string }[]; href?: string }[], opts: { unit?: (v: number) => string; width?: number } = {}): string {
  const W = opts.width ?? 900, rowH = 26, labelW = 240, H = rows.length * rowH + 8;
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  const unit = opts.unit ?? ((v: number) => String(v));
  const bars = rows.map((r, i) => {
    let xx = labelW; const total = r.segments.reduce((s, x) => s + x.value, 0);
    const segs = r.segments.map((sg) => { const w = (sg.value / max) * (W - labelW - 70); const el = `<rect class="${esc(sg.cls)}" x="${xx.toFixed(1)}" y="${i * rowH + 6}" width="${Math.max(0, w).toFixed(1)}" height="${rowH - 10}" rx="2"><title>${esc(sg.title ?? `${r.label}: ${unit(sg.value)}`)}</title></rect>`; xx += w; return el; }).join("");
    const label = `<text x="${labelW - 8}" y="${i * rowH + rowH / 2 + 4}" text-anchor="end" class="lbl">${esc(r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label)}</text>`;
    return `<g>${r.href ? `<a href="${attr(r.href)}">${label}</a>` : label}${segs}<text x="${(xx + 6).toFixed(1)}" y="${i * rowH + rowH / 2 + 4}" class="val">${esc(unit(total))}</text></g>`;
  }).join("");
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;font-family:var(--font)"><style>.bars .lbl{font-size:12px;fill:var(--text)}.bars .val{font-size:12px;fill:var(--muted);font-family:var(--mono)}.bars rect.ga{fill:var(--accent)}.bars rect.preview{fill:var(--status-preview)}.bars rect.announced{fill:var(--status-announced)}.bars rect.unclear{fill:var(--status-unclear);opacity:.6}.bars rect.plain{fill:var(--accent)}</style>${bars}</svg>`;
}
