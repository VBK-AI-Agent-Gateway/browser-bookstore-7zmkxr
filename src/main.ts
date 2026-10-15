import "./style.css";
import { isLogin, currentUser, logout, requireAdmin } from "./auth/auth";
import { renderLogin } from "./ui/login";
import { renderBooks } from "./ui/books";
import { renderOrders } from "./ui/orders";
import { renderReports } from "./ui/reports";
import { renderUsers } from "./ui/users";
import { getJson } from "./api/client";

const app = document.getElementById("app")!;
const bootErr = document.getElementById("boot-error")!;
const THEME_KEY = "yunshuge-theme";
type Route = "dashboard" | "books" | "orders" | "reports" | "users";
let route: Route = "dashboard";

function setTheme(t: "light" | "dark"): void { document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem(THEME_KEY, t); } catch { /* */ } }
function initTheme(): void { let t = "light"; try { const s = localStorage.getItem(THEME_KEY); if (s === "dark" || s === "light") t = s; else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) t = "dark"; } catch { /* */ } setTheme(t as "light" | "dark"); }
function toggleTheme(): void { const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; setTheme(cur); if (route === "reports") renderPage(); }

async function registerSW(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try { const base = import.meta.env.BASE_URL || "./"; const url = new URL("sw.js", new URL(base, location.href)).href; await navigator.serviceWorker.register(url, { scope: "./" }); }
  catch (e) { showBanner("Service Worker 注册失败：" + (e instanceof Error ? e.message : String(e))); }
}
let banner: HTMLElement | null = null;
function showBanner(msg: string): void { if (!banner) { banner = document.createElement("div"); banner.className = "err-banner"; banner.style.marginTop = "8px"; app.prepend(banner); } banner.hidden = false; banner.textContent = msg; setTimeout(() => { if (banner) banner.hidden = true; }, 5000); }

function tabs(): string {
  const u = currentUser(); const active = (r: Route) => (route === r ? "active" : "");
  return `<nav class="tabs"><a data-r="dashboard" class="${active("dashboard")}">Dashboard</a><a data-r="books" class="${active("books")}">Books</a><a data-r="orders" class="${active("orders")}">Orders</a><a data-r="reports" class="${active("reports")}">Reports</a>${u && u.role === "admin" ? `<a data-r="users" class="${active("users")}">Users</a>` : ""}</nav>`;
}
function renderHeader(host: HTMLElement): void {
  const u = currentUser();
  host.innerHTML = `<div class="hdr"><div class="brand"><div class="logo">云</div><div><h1>云书阁</h1><div class="sub">纯浏览器全栈图书零售后台 · 模拟数据</div></div></div>
    <div class="hdr-actions"><span class="tag ${u?.role === "admin" ? "paid" : "pending"}">${u ? u.username + " · " + u.role : ""}</span><button class="btn sm" id="themeBtn">🌓 主题</button><button class="btn sm" id="logoutBtn">退出</button></div></div>
    ${tabs()}<div class="meta" id="vmeta">version: 加载中…</div><div id="page-err" class="err-banner" hidden></div><div id="page"></div>`;
  host.querySelector("#themeBtn")!.addEventListener("click", toggleTheme);
  host.querySelector("#logoutBtn")!.addEventListener("click", () => { logout(); render(); });
  host.querySelectorAll<HTMLElement>("nav.tabs a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); route = (a.dataset.r as Route) || "dashboard"; renderPage(); }));
  void loadVersion(host.querySelector<HTMLElement>("#vmeta")!);
}
async function loadVersion(el: HTMLElement): Promise<void> {
  try {
    const base = import.meta.env.BASE_URL || "./";
    const res = await fetch(new URL("version.json", new URL(base, location.href)).href, { cache: "no-store" });
    const j = await res.json();
    el.innerHTML = `version: <b>commit ${String(j.commit || "unknown").slice(0, 8)}</b> · build ${j.buildTime || "-"} · DB: <b id="dbkind">…</b>`;
    setTimeout(() => { const k = document.getElementById("dbkind"); const g = globalThis as { __dbKind?: string; __dbFallback?: string }; if (k && g.__dbKind) k.textContent = g.__dbKind + (g.__dbFallback ? " (降级)" : ""); }, 1200);
  } catch { el.innerHTML = `version: <b>local</b>`; }
}
function renderPage(): void {
  const page = document.getElementById("page"), errBox = document.getElementById("page-err");
  if (!page) return; if (errBox) errBox.hidden = true;
  try {
    if (route === "dashboard") void renderDashboard(page);
    else if (route === "books") renderBooks(page);
    else if (route === "orders") renderOrders(page);
    else if (route === "reports") renderReports(page);
    else if (route === "users") { if (!requireAdmin()) { page.innerHTML = ""; if (errBox) { errBox.hidden = false; errBox.textContent = "403 · 需要管理员权限（staff 不可访问用户管理）"; } } else renderUsers(page); }
  } catch (e) { if (errBox) { errBox.hidden = false; errBox.textContent = "页面渲染失败：" + (e as Error).message; } page.innerHTML = `<div class="empty">出错了，请重试或刷新。</div>`; }
}
async function renderDashboard(host: HTMLElement): Promise<void> {
  host.innerHTML = `<div class="card"><h2><span class="dot"></span>Dashboard</h2><div class="empty">加载中…</div></div>`;
  try {
    const k = await getJson<{ totalSales: number; orderCount: number; avgOrder: number; stockValue: number }>("/api/reports/kpi");
    const low = await getJson<Array<{ title: string; stock: number }>>("/api/reports/lowstock");
    host.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-lb">总销售额</div><div class="k-v">¥${Number(k.totalSales).toFixed(2)}</div></div>
      <div class="kpi"><div class="k-lb">订单数</div><div class="k-v">${k.orderCount}</div></div>
      <div class="kpi"><div class="k-lb">平均客单价</div><div class="k-v">¥${Number(k.avgOrder).toFixed(2)}</div></div>
      <div class="kpi"><div class="k-lb">库存总值</div><div class="k-v">¥${Number(k.stockValue).toFixed(2)}</div></div></div>
    <div class="grid"><div class="card"><h2><span class="dot"></span>低库存预警</h2><p class="desc">stock &lt; 5 需补货</p>
      <div class="tbl-wrap"><table><thead><tr><th>书名</th><th>库存</th></tr></thead><tbody>${low.length ? low.map((r) => `<tr><td>${r.title}</td><td class="num"><b>${r.stock}</b></td></tr>`).join("") : `<tr><td colspan="2" class="empty">无</td></tr>`}</tbody></table></div></div>
      <div class="card"><h2><span class="dot"></span>快速入口</h2><p class="desc">常用操作</p>
        <div class="toolbar"><button class="btn" data-go="books">📚 图书管理</button><button class="btn" data-go="orders">🧾 订单管理</button><button class="btn" data-go="reports">📈 销售报表</button></div>
        <div class="sub" style="margin-top:14px">数据保存在浏览器 WASM 数据库(PGlite/sql.js)，持久化到 IndexedDB/OPFS，刷新/关闭不丢；断网仍可打开已加载页面。</div></div></div>`;
    host.querySelectorAll<HTMLElement>("[data-go]").forEach((b) => b.addEventListener("click", () => { route = b.dataset.go as Route; renderPage(); }));
  } catch (e) { host.innerHTML = `<div class="card"><div class="err-banner">Dashboard 加载失败：${(e as Error).message}</div></div>`; }
}
function render(): void {
  bootErr.hidden = true;
  if (!isLogin()) { app.innerHTML = `<div id="boot-error" class="boot-error" hidden></div>`; renderLogin(app, () => render()); return; }
  app.innerHTML = `<div id="boot-error" class="boot-error" hidden></div>`;
  renderHeader(app); renderPage();
}
function setupBroadcast(): void { try { const bc = new BroadcastChannel("yunshuge"); bc.onmessage = (e) => { const t = e.data && e.data.t; if (t === "books" || t === "orders") showBanner("其他标签页已更新数据：" + t); renderPage(); }; } catch { /* */ } }
// 全局错误兜底：任何未捕获异常/被拒 Promise 都显示到 #boot-error，绝不白屏
function showFatal(msg: string): void { try { const el = document.getElementById("boot-error") || document.getElementById("app"); if (el) { el.hidden = false; el.textContent = "页面错误（已捕获）：" + msg; } } catch { /* */ } }
window.addEventListener("error", (e) => { showFatal(e.message || "未知错误"); });
window.addEventListener("unhandledrejection", (e) => { showFatal(String((e && (e as PromiseRejectionEvent).reason) || "Promise 被拒绝")); });
(async () => { try { initTheme(); await registerSW(); setupBroadcast(); render(); } catch (e) { bootErr.hidden = false; bootErr.textContent = "初始化失败：" + (e instanceof Error ? e.message : String(e)); } })();