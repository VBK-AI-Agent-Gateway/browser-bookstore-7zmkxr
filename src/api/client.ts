const TOKEN_KEY = "yunshuge-token", USER_KEY = "yunshuge-user";
let memToken: string | null = null;
let memUser: { id: number; username: string; role: string } | null = null;
export function getToken(): string | null { if (memToken) return memToken; try { memToken = sessionStorage.getItem(TOKEN_KEY); } catch { /* */ } return memToken; }
export function getUser(): { id: number; username: string; role: string } | null { if (memUser) return memUser; try { const s = sessionStorage.getItem(USER_KEY); if (s) memUser = JSON.parse(s); } catch { /* */ } return memUser; }
export function setSession(token: string, user: { id: number; username: string; role: string }): void { memToken = token; memUser = user; try { sessionStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* */ } }
export function clearSession(): void { memToken = null; memUser = null; try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch { /* */ } }
export class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }

// ---- 主线程直连 WASM 数据库（PGlite，Vite 拆成 auto-*.js chunk），经 routes.handle 走真 SQL ----
import { getDb, hashPassword, seedIfEmpty } from "../db/db";
import { handle } from "./routes";
let dbReady: Promise<void> | null = null;
function ensureDb(): Promise<void> { if (!dbReady) dbReady = (async () => { const d = await getDb(); await seedIfEmpty(d); })(); return dbReady; }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init && init.method) || "GET";
  let body: any = {};
  if (init && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = {}; } }
  try {
    await ensureDb();
    const d = await getDb();
    const user = getUser();
    const tokenValid = !!getToken();
    const r = await handle(d, method, path, body, user, tokenValid, hashPassword);
    if (r.status >= 400) throw new ApiError(r.status, ((r.data as any) && (r.data as any).error) || "HTTP " + r.status);
    return r.data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "数据库请求失败：" + (e instanceof Error ? e.message : String(e)));
  }
}
export const getJson = <T,>(p: string) => api<T>(p);
export const postJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "POST", body: JSON.stringify(b) });
export const putJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "PUT", body: JSON.stringify(b) });
export const delJson = <T,>(p: string) => api<T>(p, { method: "DELETE" });