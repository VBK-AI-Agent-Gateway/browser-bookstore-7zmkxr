import { postJson, setSession, clearSession, getToken, getUser } from "../api/client";
export type Role = "admin" | "staff";
export type User = { id: number; username: string; role: Role };
export async function login(username: string, password: string): Promise<User> {
  const res = await postJson<{ token: string; user: User }>("/api/auth/login", { username, password });
  setSession(res.token, res.user);
  return res.user;
}
export function logout(): void { clearSession(); }
export function isLogin(): boolean { return !!getToken(); }
export function currentUser(): User | null { return getUser() as User | null; }
export function requireAdmin(): boolean { const u = currentUser(); return !!u && u.role === "admin"; }