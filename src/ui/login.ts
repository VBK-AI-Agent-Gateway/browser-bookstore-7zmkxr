import { login } from "../auth/auth";
export function renderLogin(root: HTMLElement, onOk: () => void): void {
  root.innerHTML = `<div class="login"><h1>云书阁</h1><div class="sub">纯浏览器全栈图书零售后台 · 登录</div>
    <div id="login-err" class="err-banner" hidden></div>
    <label>用户名</label><input id="lu" type="text" autocomplete="username" placeholder="admin 或 staff" />
    <label>密码</label><input id="lp" type="password" autocomplete="current-password" placeholder="密码" />
    <button class="btn primary" id="lbtn">登 录</button>
    <div class="demo">演示账号：<code>admin / admin123</code>（管理员）<br><code>staff / staff123</code>（店员）</div></div>`;
  const err = root.querySelector<HTMLElement>("#login-err")!;
  const btn = root.querySelector<HTMLButtonElement>("#lbtn")!;
  const doLogin = async () => {
    const u = root.querySelector<HTMLInputElement>("#lu")!.value.trim(), p = root.querySelector<HTMLInputElement>("#lp")!.value;
    if (!u || !p) { err.hidden = false; err.textContent = "请输入用户名和密码"; return; }
    btn.disabled = true; btn.textContent = "登录中…";
    try { await login(u, p); onOk(); }
    catch (e) { err.hidden = false; err.textContent = (e as Error).message || "登录失败"; btn.disabled = false; btn.textContent = "登 录"; }
  };
  btn.addEventListener("click", () => { void doLogin(); });
  root.querySelector("#lp")!.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void doLogin(); });
}