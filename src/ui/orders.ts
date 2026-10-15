import { getJson, postJson } from "../api/client";
import { currentUser } from "../auth/auth";
import { escapeHtml } from "./books";
type Book = { id: number; title: string; price: number; stock: number };
type Order = { id: number; user_id: number; total: number; status: string; created_at: string; items: Array<{ book_id: number; qty: number; price: number }> };
const statusLabel: Record<string, string> = { pending: "待付款", paid: "已付款", shipped: "已发货", cancelled: "已取消" };

export function renderOrders(host: HTMLElement): void {
  host.innerHTML = `<div class="card"><h2><span class="dot"></span>订单管理</h2>
    <p class="desc">创建订单在单事务内完成：校验库存 → 扣减 → 写入订单+明细，失败自动 ROLLBACK；取消仅 pending 允许并回滚库存。</p>
    <div class="toolbar"><button class="btn primary" id="onew">＋ 创建订单</button>
      <select id="ostatus"><option value="">全部状态</option><option value="pending">待付款</option><option value="paid">已付款</option><option value="shipped">已发货</option><option value="cancelled">已取消</option></select>
      <input type="date" id="ofrom" /> <input type="date" id="oto" />
      <input type="number" id="omin" min="0" placeholder="金额≥" style="width:100px" />
      <button class="btn" id="ofilter">筛选</button></div>
    <div id="oerr" class="err-banner" hidden></div><div id="olist"></div></div>`;
  const list = host.querySelector<HTMLElement>("#olist")!, errBox = host.querySelector<HTMLElement>("#oerr")!;
  const showErr = (m: string) => { errBox.hidden = false; errBox.textContent = m; setTimeout(() => (errBox.hidden = true), 5000); };
  const admin = currentUser()?.role === "admin";
  const load = async () => {
    const status = host.querySelector<HTMLSelectElement>("#ostatus")!.value, from = host.querySelector<HTMLInputElement>("#ofrom")!.value, to = host.querySelector<HTMLInputElement>("#oto")!.value, min = host.querySelector<HTMLInputElement>("#omin")!.value;
    const mine = admin ? "" : "&mine=1";
    try {
      const data = await getJson<{ items: Order[] }>(`/api/orders?status=${status}&from=${from}&to=${to}&min=${min}${mine}`);
      const items = data.items || [];
      if (!items.length) { list.innerHTML = `<div class="empty">暂无订单</div>`; return; }
      list.innerHTML = items.map((o) => {
        const qty = (o.items || []).reduce((a, i) => a + Number(i.qty), 0);
        return `<div class="order"><div class="o-top"><b>#${o.id}</b> <span class="tag ${o.status}">${statusLabel[o.status] || o.status}</span><span class="sub">${new Date(o.created_at).toLocaleString("zh-CN")}</span></div>
        <div class="o-items">共 ${qty} 件 · 合计 <b>¥${Number(o.total).toFixed(2)}</b></div>
        <div class="o-foot"><span class="sub">${(o.items || []).map((i) => `#${i.book_id}×${i.qty}`).join("、") || "-"}</span>${o.status === "pending" ? `<button class="btn sm danger" data-cancel="${o.id}">取消订单</button>` : ""}</div></div>`;
      }).join("");
      list.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach((el) => el.addEventListener("click", async () => { try { await postJson(`/api/orders/${el.dataset.cancel}/cancel`, {}); void load(); } catch (e) { showErr((e as Error).message); } }));
    } catch (e) { list.innerHTML = `<div class="empty">加载失败：${escapeHtml((e as Error).message)}</div>`; }
  };
  host.querySelector("#ofilter")!.addEventListener("click", () => void load());
  host.querySelector("#onew")!.addEventListener("click", () => openCreateModal(host, () => void load(), showErr));
  void load();
}
function openCreateModal(host: HTMLElement, done: () => void, showErr: (m: string) => void): void {
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="box"><h3>创建订单（单事务）</h3><div class="err-banner" id="merr" hidden></div>
    <div class="form-row"><label>图书<select id="mb"></select></label><label>数量<input id="mq" type="number" min="1" value="1" /></label><button class="btn" id="madd" type="button">加入</button></div>
    <div id="mlines" class="sub">未添加商品</div>
    <div class="foot"><button class="btn" id="mcancel">关闭</button><button class="btn primary" id="msubmit">提交订单</button></div></div>`;
  document.body.appendChild(m);
  const err = m.querySelector<HTMLElement>("#merr")!;
  const lines: Array<{ book_id: number; qty: number }> = [];
  getJson<{ items: Book[] }>("/api/books?page=1&size=200").then((d) => {
    const books = d.items || [];
    const sel = m.querySelector<HTMLSelectElement>("#mb")!;
    sel.innerHTML = books.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}（¥${Number(b.price).toFixed(2)}，库存 ${b.stock}）</option>`).join("");
    const renderLines = () => { const el = m.querySelector<HTMLElement>("#mlines")!; if (!lines.length) { el.textContent = "未添加商品"; return; } el.innerHTML = lines.map((l, i) => `#${i + 1} ${escapeHtml(books.find((x) => x.id === l.book_id)?.title || "#" + l.book_id)} × ${l.qty} <a data-rm="${i}">移除</a>`).join("<br>"); el.querySelectorAll<HTMLElement>("[data-rm]").forEach((a) => a.addEventListener("click", () => { lines.splice(Number(a.dataset.rm), 1); renderLines(); })); };
    m.querySelector("#madd")!.addEventListener("click", () => { const bid = Number(sel.value), qty = Math.max(1, Number(m.querySelector<HTMLInputElement>("#mq")!.value || 1)); const ex = lines.find((l) => l.book_id === bid); if (ex) ex.qty += qty; else lines.push({ book_id: bid, qty }); renderLines(); });
    m.querySelector("#msubmit")!.addEventListener("click", async () => { if (!lines.length) { err.hidden = false; err.textContent = "请先添加商品"; return; } try { await postJson("/api/orders", { items: lines }); m.remove(); done(); } catch (e) { err.hidden = false; err.textContent = "创建失败（已回滚）：" + (e as Error).message; showErr((e as Error).message); } });
    renderLines();
  }).catch((e) => { err.hidden = false; err.textContent = (e as Error).message; });
  m.querySelector("#mcancel")!.addEventListener("click", () => m.remove());
}