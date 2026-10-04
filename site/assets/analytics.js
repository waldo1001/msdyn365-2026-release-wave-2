/* GoatCounter events, loaded only when the site is built with GOATCOUNTER_CODE.
   Page views are counted by count.js itself; this adds searches on the Ask page and clicks on YouTube links. */
(function () {
  function count(path, title) { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: path, title: title, event: true }); }
  // YouTube links (timestamp chips, thumbnails): one event per video, the link title says where
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href*="youtube.com/watch"]'); if (!a) return;
    var id = (a.href.match(/[?&]v=([A-Za-z0-9_-]+)/) || [])[1]; if (!id) return;
    count("youtube/" + id, a.getAttribute("title") || a.textContent.trim() || id);
  });
  // Ask page: count a query once the visitor stops typing, not every keystroke
  var q = document.getElementById("q"); if (!q) return;
  var timer, sent = {};
  function send() { var v = q.value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80); if (v.length < 3 || sent[v]) return; sent[v] = 1; count("search/" + v, "Search: " + v); }
  q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(send, 2000); });
  q.addEventListener("change", send);
})();
