import { getJson } from "../api/client";
import { escapeHtml } from "./books";
type Kpi = { totalSales: number; orderCount: number; avgOrder: number; stockValue: number };
type DayRow = { d: string; s: number };
type CatRow = { category: string; q: number };
type TopRow = { title: string; q: number };
type LowRow = { id: number; title: string; isbn: string; stock: number };

export function renderReports(host: HTMLElement): void {
  host.innerHTML = `<div class="kpis" id="rkpis"></div>
    <div class="grid">
      <div class="card"><h2><span class="dot"></span>近 7 天销售额</h2><p class="desc">折线图（模拟订单数据）</p><div class="chart-box"><canvas id="c7"></canvas></div></div>
      <div class="card"><h2><span class="dot"></span>分类销量占比</h2><p class="desc">饼图</p><div class="chart-box"><canvas id="ccat"></canvas></div></div>
      <div class="card"><h2><span class="dot"></span>畅销图书 Top 10</h2><p class="desc">横向条形图</p><div class="chart-box"><canvas id="ctop"></canvas></div></div>
      <div class="card"><h2><span class="dot"></span>低库存预警</h2><p class="desc">库存 &lt; 5</p>
        <div class="tbl-wrap"><table><thead><tr><th>书名</th><th>ISBN</th><th>库存</th></tr></thead><tbody id="rtbody"><tr><td colspan="3" class="empty">加载中…</td></tr></tbody></table></div></div>
    </div><div id="rerr" class="err-banner" hidden></div>`;
  const errBox = host.querySelector<HTMLElement>("#rerr")!;
  const money = (n: number) => "¥" + Number(n).toFixed(2);
  Promise.all([getJson<Kpi>("/api/reports/kpi"), getJson<DayRow[]>("/api/reports/7days"), getJson<CatRow[]>("/api/reports/category"), getJson<TopRow[]>("/api/reports/top"), getJson<LowRow[]>("/api/reports/lowstock")])
    .then(async ([kpi, days, cats, tops, lows]) => {
      host.querySelector<HTMLElement>("#rkpis")!.innerHTML = `
        <div class="kpi"><div class="k-lb">总销售额</div><div class="k-v">${money(kpi.totalSales)}</div></div>
        <div class="kpi"><div class="k-lb">订单数</div><div class="k-v">${kpi.orderCount}</div></div>
        <div class="kpi"><div class="k-lb">平均客单价</div><div class="k-v">${money(kpi.avgOrder)}</div></div>
        <div class="kpi"><div class="k-lb">库存总值</div><div class="k-v">${money(kpi.stockValue)}</div></div>`;
      const tb = host.querySelector<HTMLElement>("#rtbody")!;
      tb.innerHTML = lows.length ? lows.map((r) => `<tr><td>${escapeHtml(r.title)}</td><td>${r.isbn}</td><td class="num"><b>${r.stock}</b></td></tr>`).join("") : `<tr><td colspan="3" class="empty">无低库存图书</td></tr>`;
      const { Chart } = await import("chart.js/auto");
      const css = getComputedStyle(document.documentElement);
      const fg = css.getPropertyValue("--fg").trim() || "#888", accent = css.getPropertyValue("--accent").trim() || "#4f8cff", accent2 = css.getPropertyValue("--accent2").trim() || "#22d3ee";
      const destroy = (id: string) => { const old = Chart.getChart(id as unknown as HTMLCanvasElement); if (old) old.destroy(); };
      destroy("c7"); destroy("ccat"); destroy("ctop");
      new Chart(document.getElementById("c7") as HTMLCanvasElement, { type: "line", data: { labels: days.map((r) => r.d.slice(5)), datasets: [{ label: "销售额(¥)", data: days.map((r) => Number(r.s)), borderColor: accent, backgroundColor: "rgba(79,140,255,.25)", fill: true, tension: 0.35 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: fg } } } } });
      new Chart(document.getElementById("ccat") as HTMLCanvasElement, { type: "pie", data: { labels: cats.map((c) => c.category || "未分类"), datasets: [{ data: cats.map((c) => Number(c.q)), backgroundColor: [accent, accent2, "#2ee6a6", "#ffc53d", "#ff5d73", "#a78bfa", "#38bdf8", "#fb923c"] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: fg } } } } });
      new Chart(document.getElementById("ctop") as HTMLCanvasElement, { type: "bar", data: { labels: tops.map((t) => t.title), datasets: [{ label: "销量", data: tops.map((t) => Number(t.q)), backgroundColor: accent2 }] }, options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: fg }, grid: { color: "rgba(128,128,128,.2)" } }, y: { ticks: { color: fg } } } } });
    })
    .catch((e) => { errBox.hidden = false; errBox.textContent = "报表加载失败：" + (e as Error).message; });
}