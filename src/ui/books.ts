import { getJson, postJson, putJson, delJson } from "../api/client";
import { currentUser } from "../auth/auth";
type Book = { id: number; isbn: string; title: string; author: string; category: string; price: number; stock: number };
let q = "", page = 1; const size = 10;
export function escapeHtml(s: string): string { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string); }

export function renderBooks(host: HTMLElement): void {
  const admin = currentUser()?.role === "admin";
  host.innerHTML = `<div class="card"><h2><span class="dot"></span>图书管理</h2>
    <p class="desc">列表 / 搜索 / 分页 / ${admin ? "新增 / 编辑 / 软删除" : "只读（staff）"} · ISBN 唯一、库存非负</p>
    <div class="toolbar"><input type="search" id="bq" placeholder="搜索书名 / 作者 / ISBN / 分类" value="${q}" />
      <button class="btn" id="bsearch">搜索</button>
      ${admin ? `<button class="btn primary" id="bnew">＋ 新增图书</button>` : ""}</div>
    <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>ISBN</th><th>书名</th><th>作者</th><th>分类</th><th>价格</th><th>库存</th>${admin ? "<th>操作</th>" : ""}</tr></thead>
    <tbody id="btbody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table></div>
    <div class="toolbar" style="margin-top:12px;justify-content:space-between"><span class="sub" id="bpinfo"></span>
      <span><button class="btn sm" id="bprev">‹ 上一页</button> <button class="btn sm" id="bnext">下一页 ›</button></span></div>
    <div id="berr" class="err-banner" hidden></div></div>`;
  const tb = host.querySelector<HTMLElement>("#btbody")!, errBox = host.querySelector<HTMLElement>("#berr")!, pinfo = host.querySelector<HTMLElement>("#bpinfo")!;
  const showErr = (m: string) => { errBox.hidden = false; errBox.textContent = m; setTimeout(() => (errBox.hidden = true), 5000); };
  const load = async () => {
    try {
      const data = await getJson<{ items: Book[]; total: number }>(`/api/books?q=${encodeURIComponent(q)}&page=${page}&size=${size}`);
      const items = data.items || [];
      if (!items.length) tb.innerHTML = `<tr><td colspan="8" class="empty">暂无数据</td></tr>`;
      else tb.innerHTML = items.map((b) => `<tr><td>${b.id}</td><td>${b.isbn}</td><td>${escapeHtml(b.title)}</td><td>${escapeHtml(b.author)}</td><td>${escapeHtml(b.category)}</td><td class="num">¥${Number(b.price).toFixed(2)}</td><td class="num">${b.stock}</td>${admin ? `<td><button class="btn sm" data-edit="${b.id}">编辑</button> <button class="btn sm danger" data-del="${b.id}">删除</button></td>` : ""}</tr>`).join("");
      pinfo.textContent = `共 ${data.total} 条 · 第 ${page} 页`;
      if (admin) {
        host.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((el) => el.addEventListener("click", () => { const b = items.find((x) => x.id === Number(el.dataset.edit)); if (b) openBookModal(host, b, () => void load()); }));
        host.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((el) => el.addEventListener("click", async () => { try { await delJson(`/api/books/${el.dataset.del}`); void load(); } catch (e) { showErr((e as Error).message); } }));
      }
    } catch (e) { tb.innerHTML = `<tr><td colspan="8" class="empty">加载失败：${escapeHtml((e as Error).message)}</td></tr>`; }
  };
  host.querySelector("#bsearch")!.addEventListener("click", () => { q = host.querySelector<HTMLInputElement>("#bq")!.value.trim(); page = 1; void load(); });
  host.querySelector("#bprev")!.addEventListener("click", () => { if (page > 1) { page--; void load(); } });
  host.querySelector("#bnext")!.addEventListener("click", () => { page++; void load(); });
  const nb = host.querySelector<HTMLButtonElement>("#bnew"); if (nb) nb.addEventListener("click", () => openBookModal(host, null, () => void load()));
  void load();
}
function openBookModal(host: HTMLElement, b: Book | null, done: () => void): void {
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="box"><h3>${b ? "编辑图书" : "新增图书"}</h3><div class="err-banner" id="merr" hidden></div>
    <div class="form-row"><label>ISBN<input id="m_isbn" value="${b ? b.isbn : ""}" /></label><label>书名<input id="m_title" value="${b ? escapeHtml(b.title) : ""}" /></label></div>
    <div class="form-row"><label>作者<input id="m_author" value="${b ? escapeHtml(b.author) : ""}" /></label><label>分类<input id="m_cat" value="${b ? escapeHtml(b.category) : ""}" /></label></div>
    <div class="form-row"><label>价格<input id="m_price" type="number" min="0" step="0.01" value="${b ? b.price : ""}" /></label><label>库存<input id="m_stock" type="number" min="0" value="${b ? b.stock : ""}" /></label></div>
    <div class="foot"><button class="btn" id="mcancel">取消</button><button class="btn primary" id="msave">保存</button></div></div>`;
  document.body.appendChild(m);
  const err = m.querySelector<HTMLElement>("#merr")!;
  m.querySelector("#mcancel")!.addEventListener("click", () => m.remove());
  m.querySelector("#msave")!.addEventListener("click", async () => {
    const payload = { isbn: m.querySelector<HTMLInputElement>("#m_isbn")!.value.trim(), title: m.querySelector<HTMLInputElement>("#m_title")!.value.trim(), author: m.querySelector<HTMLInputElement>("#m_author")!.value.trim(), category: m.querySelector<HTMLInputElement>("#m_cat")!.value.trim(), price: Number(m.querySelector<HTMLInputElement>("#m_price")!.value || 0), stock: Number(m.querySelector<HTMLInputElement>("#m_stock")!.value || 0) };
    try { if (b) await putJson(`/api/books/${b.id}`, payload); else await postJson("/api/books", payload); m.remove(); done(); }
    catch (e) { err.hidden = false; err.textContent = (e as Error).message; }
  });
}