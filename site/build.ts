/**
 * Static site generator. Reads data/ and writes site/dist/. No framework.
 *   SITE_BASE   sub-path the site is served from (default from package name)
 *   SITE_ORIGIN origin for canonical and og URLs (default https://waldo1001.github.io)
 */
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, DATA, parseArgs, loadWaves, isPublicBuild } from "../pipeline/lib/config.js";
import { readJson, listFiles } from "../pipeline/lib/fsx.js";
import { parseFrontmatter } from "../pipeline/lib/frontmatter.js";
import { layout, esc, attr, renderMarkdown, timelineSvg, barsSvg, statusBadge, statusOf, confBadge, areaDot, tChip, fmtTime, fmtMinutes, ytUrl, ytThumb, STATUS_LABEL, type SiteCtx } from "./lib/html.js";
import { ogSvg, writeOg } from "./og.js";
import { tokensCss, mapConfig } from "./lib/tokens.js";

const { wave, cfg } = parseArgs();
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const base = (process.env.SITE_BASE ?? `/${pkg.name}/`).replace(/\/?$/, "/");
const origin = (process.env.SITE_ORIGIN ?? "https://waldo1001.github.io").replace(/\/$/, "");
const DIST = resolve(ROOT, "site", "dist");
const pub = isPublicBuild();
const waveDef = cfg.waves[wave];
const audiences: any[] = readJson<any>(resolve(ROOT, "config", "audiences.json")).audiences;
const ctx: SiteCtx = {
  base, origin, waveName: waveDef.name, waveId: wave, repoUrl: `https://github.com/waldo1001/${pkg.name}`, pub, areas: cfg.areas,
  nav: [{ href: "", label: "Map" }, { href: "videos/", label: "Videos" }, { href: "features/", label: "Features" }, { href: "airtime/", label: "Airtime" }, { href: "digests/", label: "Digests", children: [...audiences.map((a) => ({ href: `digests/${a.slug}/`, label: a.nav })), { href: "digests/", label: "All digests" }] }, { href: "what-they-didnt-say/", label: "Gaps" }, { href: "bingo/", label: "Bingo" }, { href: "ask/", label: "Ask" }, { href: "about/", label: "About" }],
};
const fj = readJson<any>(resolve(DATA, "index", "features.json"));
const docsChecked = String(fj.release_plan?.fetched_at ?? "").slice(0, 10) || "unknown date";
const airtime = readJson<any>(resolve(DATA, "index", "airtime.json"));
const gaps = readJson<any>(resolve(DATA, "index", "gap-analysis.json"));
const wc = readJson<any>(resolve(DATA, "index", "wordcount.json"));
const timelines = readJson<any>(resolve(DATA, "index", "timelines.json"));
const videosJson = readJson<any>(resolve(DATA, "videos.json"));
const videos = videosJson.videos.filter((v: any) => v.wave === wave);
const tlById = new Map<string, any>(timelines.videos.map((t: any) => [t.id, t]));
const features: any[] = fj.features;
const areaName = (slug: string) => cfg.areas.find((a) => a.slug === slug)?.name ?? slug;
const videoPages = new Map<string, { meta: any; body: string }>();
for (const f of listFiles(resolve(DATA, "videos"), ".md")) { const p = parseFrontmatter(readFileSync(resolve(DATA, "videos", f), "utf8")); videoPages.set(p.meta.id, p); }
const featurePages = new Map<string, { meta: any; body: string }>();
for (const f of listFiles(resolve(DATA, "features"), ".md")) { const p = parseFrontmatter(readFileSync(resolve(DATA, "features", f), "utf8")); featurePages.set(p.meta.slug, p); }
const report = (name: string) => { const p = resolve(DATA, "reports", `${name}.md`); return existsSync(p) ? parseFrontmatter(readFileSync(p, "utf8")) : null; };
const totalMin = fmtMinutes(airtime.total_video_seconds);
const write = (path: string, html: string) => { const f = resolve(DIST, path, "index.html"); mkdirSync(resolve(DIST, path), { recursive: true }); writeFileSync(f, html); };
const page = (opts: Parameters<typeof layout>[1]) => layout(ctx, opts);
const bodyAttr = `data-base="${base}"`;
const withBase = (html: string) => html.replace("<body>", `<body ${bodyAttr}>`);
const missingVideos = videos.filter((v: any) => !videoPages.has(v.id));

// ---------- reset dist
rmSync(DIST, { recursive: true, force: true });
mkdirSync(resolve(DIST, "assets"), { recursive: true });
cpSync(resolve(ROOT, "site", "assets"), resolve(DIST, "assets"), { recursive: true });
cpSync(resolve(ROOT, "node_modules", "d3", "dist", "d3.min.js"), resolve(DIST, "assets", "d3.min.js"));
writeFileSync(resolve(DIST, "assets", "tokens.css"), tokensCss());
cpSync(resolve(ROOT, "design", "BusinessCentral_2048.png"), resolve(DIST, "assets", "bc-icon.png"));
cpSync(resolve(ROOT, "node_modules", "minisearch", "dist", "umd", "index.js"), resolve(DIST, "assets", "minisearch.min.js"));
mkdirSync(resolve(DIST, "data", "index"), { recursive: true });
for (const f of ["features.json", "airtime.json", "gap-analysis.json", "wordcount.json", "timelines.json", "search.json"]) if (existsSync(resolve(DATA, "index", f))) cpSync(resolve(DATA, "index", f), resolve(DIST, "data", "index", f));
cpSync(resolve(DATA, "videos.json"), resolve(DIST, "data", "videos.json"));
for (const f of ["llms.txt", "llms-full.txt"]) if (existsSync(resolve(ROOT, f))) cpSync(resolve(ROOT, f), resolve(DIST, f));
writeFileSync(resolve(DIST, ".nojekyll"), "");
writeFileSync(resolve(DIST, "assets", "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="#0b7a8c"/><path d="M16 2v14l13-6.5z" fill="#065a69"/><path d="M16 16v14l13-7.5V9.5z" fill="#35b3c6"/></svg>`);

// ---------- home / map
const copilotMin = Math.round(airtime.copilot_and_agents.video_seconds / 60);
const devArea = airtime.areas.find((a: any) => a.slug === "developer-tools");
const expArea = airtime.areas.find((a: any) => a.slug === "expense-agent");
const agenticCount = wc.totals["agentic"] ?? 0;
const hm = (secs: number) => `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}`;
const hl = { total: hm(airtime.total_video_seconds), dev: devArea ? Math.floor(devArea.video_seconds / 60) : 0, exp: expArea ? Math.floor(expArea.video_seconds / 60) : 0, agentic: agenticCount };
const hlSentence = `<b>${hl.dev} min</b> developer tools. <b>${hl.exp} min</b> Expense Agent. <b>${hl.agentic}&times;</b> the word agentic.`;
// GA covers stated and implied: a feature is GA unless the presenters said otherwise (launch event rule). The map keeps the paler shape for implied.
const statusPills = [
  { key: "ga", label: "GA", title: "Generally available: the launch event default unless the presenters said otherwise (see the status note at the bottom of the page)" },
  { key: "preview", label: "Preview", title: "Preview, stated or implied by the video title" },
  { key: "announced", label: "Announced", title: "Announced, not shipping yet" },
];
const pillCount = (k: string) => features.filter((f) => f.status === k).length;
const homeBody = `
<h1 class="sr-only">The ${esc(waveDef.name)} launch event, as a map</h1>
<section class="wm" id="wm" data-level="wave" aria-label="Map of the wave">
  <aside class="wm-left">
    <div class="wm-headline"><p class="wm-display">${hl.total}<span> of video.</span></p><p class="wm-hl-sub">${hlSentence}</p></div>
    <div class="wm-legend" data-show="wave"><p class="wm-eyebrow">Areas, by airtime</p><div id="wm-area-rows"></div></div>
    <div class="wm-videos" data-show="area"><p class="wm-eyebrow" id="wm-videos-title">Videos</p><ol id="wm-video-rows"></ol></div>
    <p class="wm-foot">Size is airtime. Hatch is preview. A pale shape is GA by the launch event rule: nobody on stage said otherwise. The dark outer tick marks high developer relevance.</p>
  </aside>
  <div class="wm-main">
    <p class="wm-strip"><b>${hl.total}</b> of video. ${hlSentence}</p>
    <div class="wm-bar"><nav class="wm-crumbs" id="wm-crumbs" aria-label="Breadcrumb"></nav><button type="button" class="wm-watch" id="wm-watch" data-watch="scope" hidden></button></div>
    <form class="wm-filters" id="wm-filters" aria-label="Map filters" onsubmit="return false">
      <div class="wm-pills" role="group" aria-label="Status">${statusPills.map((p) => `<button type="button" class="wm-pill" data-status="${p.key}" aria-pressed="false" title="${attr(p.title)}"><i class="wm-glyph" data-glyph="${p.key}"></i>${esc(p.label)} <span class="wm-pill__n">${pillCount(p.key)}</span></button>`).join("")}</div>
      <span class="wm-divider" aria-hidden="true"></span>
      <div class="wm-pills" role="group" aria-label="Developer relevance">${["high", "medium", "low"].map((d) => `<button type="button" class="wm-pill wm-pill--mono" data-dev="${d}" aria-pressed="false">dev: ${d}</button>`).join("")}</div>
      <label class="wm-search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg><input type="search" name="q" placeholder="Search features" aria-label="Search features"></label>
      <div class="wm-area-chips" id="wm-area-chips" role="group" aria-label="Area"></div>
      <span class="wm-count" id="wm-count" aria-live="polite"></span>
    </form>
    <section class="wm-player" id="wm-player" aria-label="Video player" hidden></section>
    <div class="wm-stage" id="wm-stage">
      <div class="wm-mapbox" id="wm-mapbox" aria-busy="true"></div>
    </div>
    <div class="wm-mobile" id="wm-mobile"></div>
  </div>
  <aside class="wm-panel" id="wm-panel" aria-label="Feature detail" hidden></aside>
</section>
<script type="application/json" id="wm-config">${JSON.stringify({ ...mapConfig(), icon: `${base}assets/bc-icon.png`, wave: wave, waveLabel: `Wave ${wave}` }).replace(/</g, "\\u003c")}</script>
<h2>Where to go from here</h2>
<div class="grid">
  <a class="card" href="${base}digests/"><h3>Digests</h3><p class="meta">The ${report("dev-digest")?.meta.minutes ?? "?"} minutes that matter if you write AL, as a playlist of deep links. The same for ${audiences.filter((a) => a.slug !== "developers").map((a) => a.name.toLowerCase()).join(", ")}.</p></a>
  <a class="card" href="${base}what-they-didnt-say/"><h3>What they didn't say</h3><p class="meta">${gaps.counts.documented_not_shown} documented features never made it on stage; ${gaps.counts.shown_not_documented} things on stage are not in the docs.</p></a>
  <a class="card" href="${base}airtime/"><h3>Airtime</h3><p class="meta">Minutes per area, preview versus GA, who the videos are for.</p></a>
  <a class="card" href="${base}ask/"><h3>Ask the event</h3><p class="meta">Full-text search over every ${pub ? "summary and quote" : "transcript passage"}, with a timestamp per hit.</p></a>
  <a class="card" href="${base}bingo/"><h3>Buzzword bingo</h3><p class="meta">"${esc(wc.top[0]?.term ?? "agent")}" was said ${wc.top[0]?.count ?? 0} times. Print the card.</p></a>
  <a class="card" href="${ctx.repoUrl}"><h3>For agents</h3><p class="meta">The same data as frontmatter markdown and JSON, with an AGENTS.md and an llms.txt. Point your LLM at the repo.</p></a>
</div>`;
write("", withBase(page({ title: "Release map", description: `Zoomable, unofficial map of the Business Central ${waveDef.name} launch event: ${features.length} features from ${videos.length} videos, every one deep-linked to the moment it is said.`, path: "", body: homeBody, scripts: ["d3.min.js", "map.js"], head: `<link rel="stylesheet" href="${base}assets/map.css">`, wide: true })));

// ---------- videos
const videoCards = videos.sort((a: any, b: any) => b.duration_seconds - a.duration_seconds).map((v: any) => {
  const vp = videoPages.get(v.id); const tl = tlById.get(v.id);
  if (!vp) return `<div class="card" style="opacity:.55;border-style:dashed"><img class="thumb" loading="lazy" src="${ytThumb(v.id)}" alt="" width="480" height="360"><h3>${esc(v.title)}</h3><p class="meta">${esc(v.length)} · no transcript yet · <a href="${ytUrl(v.id)}" target="_blank" rel="noopener">watch on YouTube</a></p></div>`;
  return `<a class="card" href="${base}videos/${v.id}/"><img class="thumb" loading="lazy" src="${ytThumb(v.id)}" alt="" width="480" height="360"><h3>${esc(v.title)}</h3><p class="meta">${esc(v.length)} · ${areaDot(vp.meta.area)}${esc(areaName(vp.meta.area))} · ${vp.meta.features.length} features</p>${tl ? timelineSvg(tl, { compact: true }) : ""}</a>`;
}).join("");
write("videos", page({ title: "Videos", description: `All ${videos.length} videos of the Business Central ${waveDef.name} launch event with timeline strips, chapters, features and quotes.`, path: "videos/", og: "videos", body: `<h1>Videos</h1><p class="lead">${videos.length} videos, ${totalMin}. Each strip shows chapters (blocks), demo ranges (teal band), feature mentions (dots) and "preview, subject to change" moments (orange ticks). Click a strip segment to open the video right there.</p><div class="grid">${videoCards}</div>` }));

for (const v of videos) {
  const vp = videoPages.get(v.id); if (!vp) continue;
  const tl = tlById.get(v.id);
  const m = vp.meta;
  let transcriptHtml = "";
  const trPath = resolve(DATA, "transcripts", "full", `${v.id}.md`);
  if (!pub && existsSync(trPath)) {
    const body = parseFrontmatter(readFileSync(trPath, "utf8")).body.replace(/^# .*\n/, "");
    transcriptHtml = `<details class="transcript"><summary>Cleaned transcript (auto-captions, ${m.duration_seconds ? fmtTime(m.duration_seconds) : ""})</summary>${renderMarkdown(body, ctx)}</details>`;
  }
  const html = `<p class="meta"><a href="${base}videos/">Videos</a> › ${areaDot(m.area)}<a href="${base}areas/${m.area}/">${esc(areaName(m.area))}</a></p>
<h1>${esc(m.title)}</h1>
<p class="meta">${fmtTime(m.duration_seconds)} · audience: ${esc((m.audience ?? []).join(", ") || "not stated")} · presenters as heard: ${esc((m.presenters ?? []).join(", ") || "not introduced")} · <a href="${ytUrl(v.id)}" target="_blank" rel="noopener">watch on YouTube</a></p>
<div class="two"><div>
<a href="${ytUrl(v.id)}" target="_blank" rel="noopener"><img class="thumb" src="${ytThumb(v.id)}" alt="Video thumbnail of ${attr(m.title)}" width="480" height="360" style="aspect-ratio:16/9;object-fit:cover;width:100%;border-radius:12px"></a>
<h2>Timeline</h2>${tl ? timelineSvg(tl) : ""}
<p class="meta">Blocks are chapters, the teal band is a demo, dots are feature mentions, orange ticks are "preview, subject to change" moments. Everything is clickable and opens YouTube at that second.</p>
<div class="prose">${renderMarkdown(vp.body.replace(/^# .*\n/, "").replace(/\n## Transcript[\s\S]*$/, ""), ctx)}</div>
${transcriptHtml}
</div><aside>
<div class="card"><h3>Features in this video</h3><p class="meta"><a href="${base}#/v/${v.id}">On the map</a></p><ul style="padding-left:1.1rem;margin:0">${m.features.map((s: string) => { const f = features.find((x) => x.slug === s); return f ? `<li><a href="${base}features/${s}/">${esc(f.name)}</a> ${statusOf(f)}</li>` : ""; }).join("")}</ul></div>
<div class="card" style="margin-top:12px"><h3>Status mentions</h3><p class="meta">${Object.entries(m.status_mentions ?? {}).map(([k, n]) => `${esc(STATUS_LABEL[k] ?? k)}: ${n}`).join(" · ")}</p><p class="meta">${m.docs_matched} of ${m.features.length} features matched a documented item.</p></div>
</aside></div>`;
  write(`videos/${v.id}`, page({ title: m.title, description: vp.body.match(/^> (.*)$/m)?.[1]?.slice(0, 200) ?? m.title, path: `videos/${v.id}/`, og: "videos", body: html }));
}

// ---------- features
const featRows = features.map((f) => `<tr data-row data-area="${f.area}" data-status="${f.status}" data-said="${f.status_source}" data-dev="${f.dev_relevance}" data-match="${f.release_plan.matched ? "yes" : "no"}" data-q="${attr((f.name + " " + f.tags.join(" ") + " " + f.summary).toLowerCase())}"><td><a href="${base}features/${f.slug}/">${esc(f.name)}</a></td><td>${areaDot(f.area)}${esc(areaName(f.area))}</td><td data-v="${f.status}-${f.status_source}">${statusOf(f)}</td><td class="num" data-v="${f.airtime_seconds}">${fmtMinutes(f.airtime_seconds)}</td><td data-v="${f.dev_relevance}">${esc(f.dev_relevance)}</td><td data-v="${f.release_plan.confidence}">${f.release_plan.matched ? `<a href="${attr(f.release_plan.url)}" target="_blank" rel="noopener">${esc(f.release_plan.title)}</a> ${confBadge(f.release_plan.confidence)}` : `<span class="meta">not in the docs</span>`}</td><td class="num" data-v="${f.videos.length}">${f.videos.length}</td></tr>`).join("");
write("features", page({ title: "Features", description: `${features.length} features extracted from the Business Central ${waveDef.name} launch event, filterable by area, status, developer relevance and docs match.`, path: "features/", og: "features", body: `<h1>Features</h1><p class="lead">${features.length} features merged across ${videos.length} videos. A feature shows as GA unless the presenters said otherwise, which is how Microsoft runs the launch event; "said on stage" filters on whether they actually said it. The last column shows the match with Microsoft's documented features.</p>
<form class="filters" data-target="#ftable" onsubmit="return false"><label>area <select data-filter="area"><option value="">all</option>${cfg.areas.map((a) => `<option value="${a.slug}">${esc(a.name)}</option>`).join("")}</select></label><label>status <select data-filter="status"><option value="">all</option><option value="ga">GA</option><option value="preview">preview</option><option value="announced">announced</option></select></label><label>said on stage <select data-filter="said"><option value="">all</option><option value="stated">yes, with a quote</option><option value="implied">no, launch event rule</option></select></label><label>dev relevance <select data-filter="dev"><option value="">all</option><option>high</option><option>medium</option><option>low</option></select></label><label>in the docs <select data-filter="match"><option value="">all</option><option value="yes">matched</option><option value="no">not matched</option></select></label><label>search <input type="search" data-filter="q" aria-label="Filter features by text"></label><span class="count meta">${features.length} shown</span></form>
<div class="table-wrap"><table class="sortable" id="ftable"><thead><tr><th>Feature</th><th>Area</th><th>Status</th><th class="num">Airtime</th><th>Dev</th><th>Documented as</th><th class="num">Videos</th></tr></thead><tbody>${featRows}</tbody></table></div>` }));

for (const f of features) {
  const fp = featurePages.get(f.slug); if (!fp) continue;
  const related = features.filter((x) => x.slug !== f.slug && (x.area === f.area || x.tags.some((t: string) => f.tags.includes(t)))).map((x) => ({ x, s: x.tags.filter((t: string) => f.tags.includes(t)).length + (x.area === f.area ? 1 : 0) })).sort((a, b) => b.s - a.s).slice(0, 6);
  const html = `<p class="meta"><a href="${base}features/">Features</a> › ${areaDot(f.area)}<a href="${base}areas/${f.area}/">${esc(areaName(f.area))}</a></p>
<h1>${esc(f.name)}</h1>
<p class="meta">${statusOf(f)} · ${fmtMinutes(f.airtime_seconds)} in ${f.videos.length} video${f.videos.length === 1 ? "" : "s"} · dev relevance ${esc(f.dev_relevance)} · ${f.release_plan.matched ? `documented as <a href="${attr(f.release_plan.url)}" target="_blank" rel="noopener">${esc(f.release_plan.title)}</a> ${confBadge(f.release_plan.confidence)}` : f.release_plan.learn?.documented === "yes" ? `no what's new item of its own, but documented in the <a href="${attr(f.release_plan.learn.url)}" target="_blank" rel="noopener">product docs</a> (checked ${esc(f.release_plan.learn.checked_at ?? docsChecked)})` : `not in the documented features baseline (docs checked ${esc(docsChecked)})`}</p>
<div class="two"><div class="prose">${renderMarkdown(fp.body.replace(/^# .*\n/, ""), ctx)}</div>
<aside>${f.videos.map((v: any) => { const tl = tlById.get(v.id); return `<div class="card"><a href="${base}videos/${v.id}/"><img class="thumb" loading="lazy" src="${ytThumb(v.id)}" alt="" width="480" height="360"></a><h3><a href="${base}videos/${v.id}/">${esc(v.title)}</a></h3><p class="meta">${tChip(v.id, v.t_start, v.title)} to ${fmtTime(v.t_end)}${v.demo ? ` · demo ${tChip(v.id, v.demo.t_start, v.title)}` : ""}</p>${tl ? timelineSvg(tl, { compact: true }) : ""}</div>`; }).join("")}
${related.length ? `<div class="card" style="margin-top:12px"><h3>Related</h3><ul style="padding-left:1.1rem;margin:0">${related.map(({ x }) => `<li><a href="${base}features/${x.slug}/">${esc(x.name)}</a> ${statusOf(x)}</li>`).join("")}</ul></div>` : ""}
<p class="meta" style="margin-top:12px"><a href="${ctx.repoUrl}/blob/main/data/features/${f.slug}.md">This page as markdown</a></p></aside></div>`;
  write(`features/${f.slug}`, page({ title: f.name, description: f.summary.slice(0, 200), path: `features/${f.slug}/`, og: `area-${f.area}`, body: html }));
}

// ---------- areas
for (const a of cfg.areas) {
  const fs = features.filter((f) => f.area === a.slug).sort((x, y) => y.airtime_seconds - x.airtime_seconds);
  const at = airtime.areas.find((x: any) => x.slug === a.slug);
  const vids = videos.filter((v: any) => videoPages.get(v.id)?.meta.area === a.slug);
  const notShown = gaps.documented_not_shown.filter((d: any) => d.area === a.slug);
  const html = `<p class="meta"><a href="${base}#/a/${a.slug}">On the map</a></p><h1>${areaDot(a.slug)}${esc(a.name)}</h1>
<div class="stats"><div class="stat"><b>${fs.length}</b><span>features</span></div><div class="stat"><b>${fmtMinutes(at?.video_seconds ?? 0)}</b><span>of video (${vids.length} video${vids.length === 1 ? "" : "s"})</span></div><div class="stat"><b>${fs.filter((f) => f.status === "preview").length}</b><span>called preview</span></div><div class="stat"><b>${fs.filter((f) => f.release_plan.matched).length}</b><span>matched in the docs</span></div></div>
${fs.length ? barsSvg(fs.slice(0, 20).map((f) => ({ label: f.name, href: `${base}features/${f.slug}/`, segments: [{ value: Math.round(f.airtime_seconds / 60 * 10) / 10, cls: f.status, title: `${f.name}: ${fmtMinutes(f.airtime_seconds)}, ${STATUS_LABEL[f.status]}` }] })), { unit: (v) => `${v} min` }) : "<p class='notice'>No features were extracted for this area.</p>"}
<h2>Features</h2><ul>${fs.map((f) => `<li><a href="${base}features/${f.slug}/">${esc(f.name)}</a> ${statusOf(f)} <span class="meta">${fmtMinutes(f.airtime_seconds)} · dev ${f.dev_relevance}${f.release_plan.matched ? "" : " · not in the docs"}</span></li>`).join("")}</ul>
<h2>Videos</h2><div class="grid">${vids.map((v: any) => `<a class="card" href="${base}videos/${v.id}/"><img class="thumb" loading="lazy" src="${ytThumb(v.id)}" alt="" width="480" height="360"><h3>${esc(v.title)}</h3><p class="meta">${esc(v.length)}</p></a>`).join("") || "<p class='meta'>No video has this as its primary area.</p>"}</div>
${notShown.length ? `<h2>Documented but not shown</h2><ul>${notShown.map((d: any) => `<li><a href="${attr(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a> <span class="meta">docs: ${esc(d.availability ?? d.doc_status)}</span></li>`).join("")}</ul>` : ""}`;
  write(`areas/${a.slug}`, page({ title: a.name, description: `${a.name} in the Business Central ${waveDef.name} launch event: ${fs.length} features, ${fmtMinutes(at?.video_seconds ?? 0)} of video.`, path: `areas/${a.slug}/`, og: `area-${a.slug}`, body: html }));
}

// ---------- airtime
const stMin = (o: Record<string, number>) => ["ga", "preview", "announced", "unclear"].map((s) => ({ value: Math.round((o[s] ?? 0) / 60), cls: s, title: `${STATUS_LABEL[s]}: ${Math.round((o[s] ?? 0) / 60)} min` }));
const airBody = `<h1>Airtime</h1><p class="lead">Minutes are derived from chapters and per-feature time ranges, not from counting videos. Feature minutes can overlap inside a video (a demo covers several features), so they do not add up to the footage.</p>
<div class="stats"><div class="stat"><b>${totalMin}</b><span>of video, ${videos.length} videos</span></div><div class="stat"><b>${Math.round(airtime.copilot_and_agents.video_share * 100)}%</b><span>of footage is Copilot or agents (${copilotMin} min of videos in those areas)</span></div><div class="stat"><b>${Math.round(airtime.copilot_and_agents.feature_share * 100)}%</b><span>of feature airtime touches Copilot, agents, MCP or AI</span></div><div class="stat"><b>${Math.round((airtime.by_status.preview ?? 0) / 60)} min</b><span>of features in preview, ${Math.round((airtime.by_status.ga ?? 0) / 60)} min GA, ${Math.round((airtime.by_status.announced ?? 0) / 60)} min announced for later</span></div></div>
<h2>Footage per area</h2>${barsSvg(airtime.areas.filter((a: any) => a.video_seconds > 0 || a.feature_seconds > 0).map((a: any) => ({ label: a.name, href: `${base}areas/${a.slug}/`, segments: [{ value: Math.round(a.video_seconds / 60), cls: "plain", title: `${a.name}: ${Math.round(a.video_seconds / 60)} min in ${a.videos} videos` }] })), { unit: (v) => `${v} min` })}
<h2>Feature airtime per area, preview versus GA</h2>${barsSvg(airtime.areas.filter((a: any) => a.feature_seconds > 0).map((a: any) => ({ label: a.name, href: `${base}areas/${a.slug}/`, segments: stMin(a.by_status) })), { unit: (v) => `${v} min` })}
<p class="legend"><span><i class="sw" style="background:var(--accent)"></i>GA</span><span><i class="sw" style="background:var(--status-preview)"></i>preview</span><span><i class="sw" style="background:var(--status-announced)"></i>announced</span><span><i class="sw" style="background:var(--status-unclear);opacity:.6"></i>not stated</span></p>
<h2>Top 15 features by minutes</h2>${barsSvg(airtime.top_features.map((f: any) => ({ label: f.name, href: `${base}features/${f.slug}/`, segments: [{ value: Math.round(f.seconds / 60 * 10) / 10, cls: f.status, title: `${f.name}: ${fmtMinutes(f.seconds)}, ${STATUS_LABEL[f.status]}` }] })), { unit: (v) => `${v} min` })}
<h2>Who the videos are for</h2>${barsSvg(Object.entries(airtime.by_audience).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => ({ label: `${k} (${airtime.by_audience_videos[k]} videos)`, segments: [{ value: Math.round(v / 60), cls: "plain", title: `${k}: ${Math.round(v / 60)} min` }] })), { unit: (v) => `${v} min` })}
<p class="meta">A video counts for every audience it targets, so these overlap.</p>
<h2>Developer relevance</h2>${barsSvg(["high", "medium", "low"].map((k) => ({ label: `${k} relevance`, segments: [{ value: Math.round((airtime.by_dev_relevance[k] ?? 0) / 60), cls: "plain" }] })), { unit: (v) => `${v} min` })}
<h2>How much of each video got a feature label</h2><div class="table-wrap"><table class="sortable"><thead><tr><th>Video</th><th class="num">Length</th><th class="num">Covered</th><th class="num">Features</th></tr></thead><tbody>${airtime.coverage.sort((a: any, b: any) => b.duration_seconds - a.duration_seconds).map((c: any) => `<tr><td><a href="${base}videos/${c.id}/">${esc(c.title)}</a></td><td class="num" data-v="${c.duration_seconds}">${fmtTime(c.duration_seconds)}</td><td class="num" data-v="${c.coverage}">${Math.round(c.coverage * 100)}%</td><td class="num">${c.features}</td></tr>`).join("")}</tbody></table></div>`;
write("airtime", page({ title: "Airtime", description: `Minutes per area, preview versus GA, audience split and the Copilot share of the Business Central ${waveDef.name} launch event.`, path: "airtime/", og: "airtime", body: airBody }));

// ---------- digests, one per audience (config/audiences.json, rendered by pipeline step 06)
const digests = audiences.map((a) => ({ a, r: report(a.report)! })).filter((x) => x.r);
for (const { a, r } of digests) {
  const others = digests.filter((x) => x.a.slug !== a.slug).map((x) => `<a href="${base}digests/${x.a.slug}/">${esc(x.a.name.toLowerCase())}</a>`).join(" · ");
  write(`digests/${a.slug}`, page({ title: `${a.name} digest`, description: `If ${a.who}: the ${r.meta.minutes} minutes of the ${waveDef.name} launch event that matter, as deep links.`, path: `digests/${a.slug}/`, og: `digest-${a.slug}`, body: `<p class="meta"><a href="${base}digests/">Digests</a> › ${esc(a.name)} · also for ${others}</p><div class="prose">${renderMarkdown(r.body, ctx)}</div><p class="meta"><a href="${ctx.repoUrl}/blob/main/data/reports/${a.report}.md">This page as markdown</a> · <a href="${ctx.repoUrl}/blob/main/config/audiences.json">the selection rules</a></p>` }));
}
write("digests", page({ title: "Digests", description: `The ${waveDef.name} launch event cut down per audience: ${audiences.map((a) => a.name.toLowerCase()).join(", ")}, every item deep-linked.`, path: "digests/", og: "digests", body: `<h1>Digests</h1><p class="lead">${totalMin} of launch event video is a lot. Each digest keeps the features that matter for one audience, grouped by area and deep-linked to the second where they explain it, with the rest as "also worth a look".</p>
<div class="grid">${digests.map(({ a, r }) => `<a class="card" href="${base}digests/${a.slug}/"><h3>${esc(a.name)}</h3><p class="meta">If ${esc(a.who)}.</p><p class="meta"><b>${r.meta.minutes} min</b> to watch · ${r.meta.playlist_features} features in the playlist · ${r.meta.also_features} more worth a look</p></a>`).join("")}</div>
<h2>How the lists are made</h2><ul>${digests.map(({ a }) => `<li><b>${esc(a.name)}:</b> ${esc(a.rule)}</li>`).join("")}</ul>
<p class="meta">The rules live in <a href="${ctx.repoUrl}/blob/main/config/audiences.json">config/audiences.json</a>. The developer rating comes from the extraction model; the other three are plain rules over area, tags, demo and airtime. Blunt by design: change the file, rebuild, and the digests follow.</p>` }));
// the developer digest used to live at /dev-digest/; keep that address working
write("dev-digest", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved: Developer digest</title><meta http-equiv="refresh" content="0; url=${base}digests/developers/"><link rel="canonical" href="${origin}${base}digests/developers/"><meta name="robots" content="noindex"></head><body><p>The developer digest moved to <a href="${base}digests/developers/">${origin}${base}digests/developers/</a>.</p></body></html>
`);
const gp = report("what-they-didnt-say");
if (gp) write("what-they-didnt-say", page({ title: "What they didn't say", description: `${gaps.counts.documented_not_shown} documented features not shown, ${gaps.counts.shown_not_documented} shown but not documented, ${gaps.counts.status_conflicts} status conflicts.`, path: "what-they-didnt-say/", og: "gaps", body: `<div class="prose">${renderMarkdown(gp.body, ctx).replace(/\(([a-z]+) confidence/g, (_m, c) => `(${confBadge(c)}`)}</div><p class="meta"><a href="${ctx.repoUrl}/blob/main/data/reports/what-they-didnt-say.md">This page as markdown</a> · corrections go in <a href="${ctx.repoUrl}/blob/main/data/release-plan/overrides.json">data/release-plan/overrides.json</a></p>` }));

// ---------- bingo
const heatTerms = wc.top.filter((t: any) => t.count > 0).slice(0, 14).map((t: any) => t.term);
const maxPer = Math.max(1, ...wc.videos.flatMap((v: any) => heatTerms.map((t: string) => v.per_1000_words[t] ?? 0)));
const heat = `<div class="table-wrap"><table class="heat sortable"><thead><tr><th>Video</th>${heatTerms.map((t: string) => `<th class="num">${esc(t)}</th>`).join("")}</tr></thead><tbody>${wc.videos.map((v: any) => `<tr><td><a href="${base}videos/${v.id}/">${esc(v.title.replace(/^What's new( in|:)? /, ""))}</a></td>${heatTerms.map((t: string) => { const n = v.counts[t]; const p = v.per_1000_words[t] ?? 0; const a = Math.min(1, p / maxPer); return `<td data-v="${n}" class="${a > .5 ? "h" : ""}" style="background:rgba(11,122,140,${a.toFixed(2)})" title="${attr(`${t}: ${n} times, ${p} per 1000 words`)}">${n || ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
const bingoBody = `<h1>Buzzword bingo</h1><p class="lead">${wc.total_words.toLocaleString("en-US")} words of auto-captions. "${esc(wc.top[0]?.term ?? "agent")}" wins with ${wc.top[0]?.count ?? 0} mentions. Counts include plurals and the caption spellings ("co-pilot").</p>
<div class="stats">${wc.top.slice(0, 6).map((t: any) => `<div class="stat"><b>${t.count}</b><span>${esc(t.term)}</span></div>`).join("")}</div>
<h2>Your card</h2><p class="meta no-print">24 of the most said terms, shuffled. <button class="btn secondary" id="shuffle" type="button">Shuffle</button> <button class="btn" id="print" type="button">Print</button></p>
<div class="bingo" id="card" data-terms="${attr(JSON.stringify(wc.top.filter((t: any) => t.count > 0).slice(0, 30).map((t: any) => t.term)))}"></div>
<h2>All terms</h2><div class="table-wrap"><table class="sortable"><thead><tr><th>Term</th><th class="num">Count</th><th class="num">Per 1000 words</th><th class="num">Videos</th><th>Source</th></tr></thead><tbody>${wc.top.map((t: any) => `<tr><td>${esc(t.term)}</td><td class="num" data-v="${t.count}">${t.count}</td><td class="num" data-v="${(t.count / wc.total_words * 1000).toFixed(2)}">${(t.count / wc.total_words * 1000).toFixed(2)}</td><td class="num">${wc.videos.filter((v: any) => v.counts[t.term] > 0).length}</td><td class="meta">${wc.base_terms.includes(t.term) ? "brief" : "proposed by Claude"}</td></tr>`).join("")}</tbody></table></div>
<h2>Per video heatmap</h2><p class="meta">Shade = mentions per 1000 words, number = raw count. Top ${heatTerms.length} terms.</p>${heat}
<h2>New words this wave</h2>${wc.new_words.status === "ok" ? `<p>Words said in ${esc(wave)} but in none of the ${wc.new_words.previous_videos} ${esc(wc.new_words.compared_with)} launch videos:</p><p>${wc.new_words.words.map((w: any) => `<span class="chip">${esc(w.word)} ${w.count}</span>`).join(" ")}</p>` : `<p class="notice">Not available yet: ${esc(wc.new_words.reason)}.</p>`}`;
write("bingo", page({ title: "Buzzword bingo", description: `Buzzword counts of the Business Central ${waveDef.name} launch event, a per-video heatmap and a printable bingo card.`, path: "bingo/", og: "bingo", body: bingoBody, scripts: ["bingo.js"] }));

// ---------- ask
write("ask", withBase(page({ title: "Ask the event", description: `Full-text search over the Business Central ${waveDef.name} launch event transcripts, with a YouTube timestamp per hit.`, path: "ask/", og: "ask", body: `<h1>Ask the event</h1><p class="lead">Search ${pub ? "the summaries, chapters, quotes and features" : "every transcript passage"} of the ${videos.length} videos. Each hit opens YouTube at that second. Nothing leaves your browser unless you use your own API key below.</p>
<div class="tip no-print"><p><b>Tip: let an agent do the reading.</b> Everything on this site is also in a public repository as markdown and JSON, with an <a href="${ctx.repoUrl}/blob/main/AGENTS.md">AGENTS.md</a> that tells an agent how to navigate and cite it. Point Claude Code, GitHub Copilot or any agent that can read GitHub at <a href="${ctx.repoUrl}">${ctx.repoUrl}</a> and ask your questions about the new release there. For example:</p><pre id="agent-prompt">Read ${ctx.repoUrl} (start with AGENTS.md) and answer from that repository only, citing the video title and timestamp for every claim: what changed for page scripting in Business Central ${esc(waveDef.name)}?</pre><p><button class="btn secondary" type="button" data-copy="#agent-prompt">Copy the prompt</button></p></div>
<form class="search-box" role="search" onsubmit="return false"><label class="sr-only" for="q">Search</label><input id="q" type="search" placeholder="what changed for page scripting" autocomplete="off"></form>
<p id="search-status" class="meta"></p>
<div id="results" aria-live="polite"></div>
<details class="no-print"><summary>Explain with your own Anthropic API key (optional)</summary><p class="meta">The key is stored in this browser's localStorage only and sent straight to api.anthropic.com from your browser, never to this site (there is no server). The answer uses the top search hits as context and cites them; without a key, search still works.</p><p><input id="api-key" type="password" placeholder="sk-ant-…" style="width:100%;max-width:420px;font:inherit;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"> <button class="btn" id="ask-llm" type="button">Answer with citations</button></p><div class="answer" id="answer" aria-live="polite"></div></details>`, scripts: ["minisearch.min.js", "search.js"] })));

// ---------- about
const notice = readFileSync(resolve(ROOT, "CONTENT-NOTICE.md"), "utf8");
write("about", page({ title: "About", description: "What this unofficial map of the Business Central launch event is, how it was built, and its limitations.", path: "about/", og: "home", body: `<h1>About</h1><div class="prose">
<p>This is an unofficial map of the <strong>${esc(waveDef.event)}</strong>: ${videos.length} videos Microsoft published on ${esc(waveDef.event_date)} on the <a href="${esc(waveDef.channel)}" rel="noopener">Dynamics 365 Business Central YouTube channel</a>. It was built by <a href="https://www.waldo.be" rel="noopener">waldo</a> (Eric Wauters, Business Central MVP) because seven hours of launch video is a lot, and because a release should be navigable by humans and by LLM agents alike.</p>
<h2>How it was built</h2><p>The YouTube auto-captions were cleaned into timestamped segments. Claude extracted, per video, a summary, chapters, features with the sentence that proves their status, quotes (validated against the transcript, dropped when not found), and disclaimer moments. Features were merged across videos, matched against Microsoft's documented features for the wave, and everything was rendered as markdown with frontmatter and as this site. The whole pipeline, the cache that makes it reproducible, and the data are in the <a href="${ctx.repoUrl}">repository</a>. Point an LLM at its <code>AGENTS.md</code>.</p>
<h2>Limitations</h2><ul><li>Auto-captions: names of presenters and products are sometimes wrong (the captions write "co-pilot", "EL query", "shop a fight").</li><li>Status follows the launch event rule: a feature shows as GA unless the presenters said otherwise. Where nothing was said, the feature page says so and the docs column tells you what Microsoft wrote; the data keeps the distinction as <code>status_source</code>.</li><li>Feature boundaries and airtime come from a language model reading the transcript; they are approximations, not measurements.</li><li>The docs matching is done by a language model with keyword candidates and reviewed by hand over time, see <code>data/release-plan/overrides.json</code>.</li><li>Docs checked on <strong>${esc(docsChecked)}</strong>. "Not documented" means not on Microsoft's what's new pages for the wave on that date. Microsoft keeps filling the documentation after the launch event, and a feature can be described in the product documentation without its own what's new item, so these conclusions age. The date is <code>release_plan.fetched_at</code> in the data.</li>${missingVideos.length ? `<li>${missingVideos.length} video(s) have no transcript yet: ${missingVideos.map((v: any) => esc(v.title)).join(", ")}.</li>` : ""}</ul>
<h2>Privacy</h2><p>No cookies, no analytics, no external requests except YouTube links and thumbnails. The optional API key on the Ask page stays in your browser.</p>
${renderMarkdown(notice.replace(/^# .*\n/, "## Content notice\n"), ctx)}
</div>` }));

// ---------- 404
writeFileSync(resolve(DIST, "404.html"), page({ title: "Not found", description: "Page not found", path: "404", body: `<h1>Not here</h1><p>Nothing at this address. Try the <a href="${base}">map</a>, the <a href="${base}features/">features</a> or <a href="${base}ask/">search</a>.</p>` }));

// ---------- og images
const ogDir = resolve(DIST, "og");
const ogs: [string, { title: string; number: string; line: string }][] = [
  ["home", { title: "The launch event, as a map", number: totalMin, line: `${videos.length} videos · ${features.length} features · every claim deep-linked` }],
  ["videos", { title: "All the videos, with timelines", number: String(videos.length), line: `${totalMin} of launch event footage` }],
  ["features", { title: "Features, merged across videos", number: String(features.length), line: `${fj.counts.by_status.preview ?? 0} called preview · ${fj.counts.by_status.ga ?? 0} called GA` }],
  ["airtime", { title: "Airtime per area and status", number: `${Math.round(airtime.copilot_and_agents.video_share * 100)}%`, line: "of the footage is Copilot or agents" }],
  ["digests", { title: "Digests per audience", number: String(digests.length), line: digests.map(({ a, r }) => `${a.name} ${r.meta.minutes} min`).join(" · ") }],
  ...digests.map(({ a, r }) => [`digest-${a.slug}`, { title: `${a.name} digest`, number: `${r.meta.minutes} min`, line: `the part a BC ${a.name.toLowerCase().replace(/s$/, "")} needs to watch` }] as [string, any]),
  ["gaps", { title: "What they didn't say", number: String(gaps.counts.documented_not_shown), line: `documented features that never got stage time · ${gaps.counts.shown_not_documented} shown but not documented` }],
  ["bingo", { title: "Buzzword bingo", number: `${wc.top[0]?.count ?? 0}×`, line: `"${wc.top[0]?.term ?? ""}" · printable card inside` }],
  ["ask", { title: "Ask the event", number: "7h+", line: "of transcript, searchable, every hit with a timestamp" }],
  ...cfg.areas.map((a) => [`area-${a.slug}`, { title: a.name, number: fmtMinutes(airtime.areas.find((x: any) => x.slug === a.slug)?.video_seconds ?? 0), line: `${features.filter((f) => f.area === a.slug).length} features in this area` }] as [string, any]),
];
let ogKind = "png";
for (const [name, o] of ogs) ogKind = await writeOg(ogDir, name, ogSvg({ ...o, wave: waveDef.name }));
if (ogKind !== "png") console.warn("site: resvg unavailable, og images written as SVG");
const pageCount = listFiles(DIST).length;
console.log(`site: built ${videoPages.size} video pages, ${features.length} feature pages, ${cfg.areas.length} area pages and ${ogs.length} og images into site/dist (base ${base}${pub ? ", public mode" : ""})`);
void pageCount;
