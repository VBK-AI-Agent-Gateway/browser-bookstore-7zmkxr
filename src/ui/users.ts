import { getJson } from "../api/client";
import { escapeHtml } from "./books";
type U = { id: number; username: string; role: string; created_at: string };
export function renderUsers(host: HTMLElement): void {
  host.innerHTML = `<div class="card"><h2><span class="dot"></span>用户管理</h2>
    <p class="desc">仅 admin 可访问；staff 访问此接口返回 403。密码以 SHA-256(salt+pwd) 哈希存储，不展示。</p>
    <div id="uerr" class="err-banner" hidden></div>
    <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>创建时间</th></tr></thead>
    <tbody id="utbody"><tr><td colspan="4" class="empty">加载中…</td></tr></tbody></table></div></div>`;
  const err = host.querySelector<HTMLElement>("#uerr")!, tb = host.querySelector<HTMLElement>("#utbody")!;
  getJson<U[]>("/api/users").then((rows) => {
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="4" class="empty">暂无用户</td></tr>`; return; }
    tb.innerHTML = rows.map((u) => `<tr><td>${u.id}</td><td>${escapeHtml(u.username)}</td><td><span class="tag ${u.role === "admin" ? "paid" : "pending"}">${u.role}</span></td><td>${u.created_at ? new Date(u.created_at).toLocaleString("zh-CN") : "-"}</td></tr>`).join("");
  }).catch((e) => { err.hidden = false; err.textContent = (e as Error).message; tb.innerHTML = `<tr><td colspan="4" class="empty">无权限或加载失败</td></tr>`; });
}