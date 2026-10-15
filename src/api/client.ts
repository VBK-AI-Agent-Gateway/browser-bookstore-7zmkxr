const TOKEN_KEY = "yunshuge-token", USER_KEY = "yunshuge-user";
let memToken: string | null = null;
let memUser: { id: number; username: string; role: string } | null = null;
export function getToken(): string | null { if (memToken) return memToken; try { memToken = sessionStorage.getItem(TOKEN_KEY); } catch { /* */ } return memToken; }
export function getUser(): { id: number; username: string; role: string } | null { if (memUser) return memUser; try { const s = sessionStorage.getItem(USER_KEY); if (s) memUser = JSON.parse(s); } catch { /* */ } return memUser; }
export function setSession(token: string, user: { id: number; username: string; role: string }): void { memToken = token; memUser = user; try { sessionStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* */ } }
export function clearSession(): void { memToken = null; memUser = null; try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch { /* */ } }
export class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tk = getToken(); if (tk) headers["Authorization"] = "Bearer " + tk;
  let res: Response;
  try { res = await fetch(path, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) || {}) }, method: init?.method || "GET", body: init?.body }); }
  catch (e) { throw new ApiError(0, "网络/Service Worker 请求失败：" + (e instanceof Error ? e.message : String(e))); }
  let data: any = null; try { data = await res.json(); } catch { /* */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || "HTTP " + res.status);
  return data as T;
}
export const getJson = <T,>(p: string) => api<T>(p);
export const postJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "POST", body: JSON.stringify(b) });
export const putJson = <T,>(p: string, b: unknown) => api<T>(p, { method: "PUT", body: JSON.stringify(b) });
export const delJson = <T,>(p: string) => api<T>(p, { method: "DELETE" });