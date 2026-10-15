const TOKEN_KEY = "yunshuge-token", USER_KEY = "yunshuge-user";
let memToken: string | null = null;
let memUser: { id: number; username: string; role: string } | null = null;
export function getToken(): string | null { if (memToken) return memToken; try { memToken = sessionStorage.getItem(TOKEN_KEY); } catch { /* */ } return memToken; }
export function getUser(): { id: number; username: string; role: string } | null { if (memUser) return memUser; try { const s = sessionStorage.getItem(USER_KEY); if (s) memUser = JSON.parse(s); } catch { /* */ } return memUser; }
export function setSession(token: string, user: { id: number; username: string; role: string }): void { memToken = token; memUser = user; try { sessionStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* */ } }
export function clearSession(): void { memToken = null; memUser = null; try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch { /* */ } }
export class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }

// ---- DB Worker 通信（WASM 数据库 PGlite 在独立 Worker 内，替代 fetch /api）----
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../db/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent) => {
    const { id, status, data } = ev.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (status >= 400) p.reject(new ApiError(status, (data && data.error) || "HTTP " + status));
    else p.resolve(data);
  };
  worker.onerror = (e) => { for (const [, p] of pending) p.reject(new ApiError(0, "DB Worker 错误: " + e.message)); pending.clear(); };
  return worker;
}
function callWorker(method: string, path: string, body: unknown): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const w = getWorker();
    // 若带用户上下文（/api/users 需 admin 判定），附上当前 user
    let payloadBody: any = body;
    if (path === "/api/users") payloadBody = { ...(typeof body === "object" && body ? body : {}), __user: getUser() };
    w.postMessage({ id, method, path, body: payloadBody, tok: getToken() });
  });
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init && init.method) || "GET";
  let body: any = {};
  if (init && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = {}; } }
  try { return (await callWorker(method, path, body)) as T; }
  catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "数据库 Worker 请求失败：" + (e instanceof Error ? e.message : String(e)));
  }
}
export const getJson = <T,>(p: string) => api<T>(p);
export const postJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "POST", body: JSON.stringify(b) });
export const putJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "PUT", body: JSON.stringify(b) });
export const delJson = <T,>(p: string) => api<T>(p, { method: "DELETE" });