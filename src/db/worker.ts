// 数据库 Worker：在独立 Web Worker 内运行 WASM 数据库（PGlite，降级 sql.js）
// Service Worker 只做静态缓存、不碰 DB（规避 SW 禁止动态 import）；本 Worker 通过 postMessage 提供 SQL/API 能力。
import { getDb, hashPassword, randomSalt, seedIfEmpty, type Db, type Row } from "./db";

let dbp: Promise<Db> | null = null;
async function db(): Promise<Db> { if (!dbp) dbp = (async () => { const d = await getDb(); await seedIfEmpty(d); return d; })(); return dbp; }

type ApiResult = { status: number; data: unknown };
function json(status: number, data: unknown): ApiResult { return { status, data }; }

async function handle(method: string, path: string, body: any, tokenValid: boolean): Promise<ApiResult> {
  const d = await db();

  // ---- 登录（唯一无需 token 的接口）----
  if (path === "/api/auth/login" && method === "POST") {
    const rows = await d.q("SELECT * FROM users WHERE username = $1", [body.username]);
    const u = (rows as Row[])[0];
    if (!u) return json(401, { error: "用户名或密码错误" });
    if ((await hashPassword(body.password || "", String(u.salt))) !== String(u.pass_hash)) return json(401, { error: "用户名或密码错误" });
    return json(200, { token: "tok_" + randomSalt(), user: { id: Number(u.id), username: String(u.username), role: String(u.role) } });
  }
  if (!tokenValid) return json(401, { error: "未登录或登录已过期" });

  // ---- 图书 CRUD（SQL UNIQUE/409、CHECK 非负）----
  if (path === "/api/books" && method === "GET") {
    let items = (await d.q("SELECT * FROM books WHERE deleted = FALSE ORDER BY id DESC")) as Row[];
    return json(200, { items, total: items.length, page: 1, size: items.length });
  }
  if (path === "/api/books" && method === "POST") {
    if (Number(body.stock) < 0) return json(400, { error: "库存不能为负" });
    try {
      const rows = await d.q("INSERT INTO books(isbn,title,author,category,price,stock,deleted) VALUES($1,$2,$3,$4,$5,$6,FALSE) RETURNING id,isbn,title,stock", [body.isbn, body.title, body.author || "", body.category || "", Number(body.price) || 0, Number(body.stock) || 0]);
      return json(200, (rows as Row[])[0]);
    } catch (e) { if (/duplicate|unique/i.test(String(e))) return json(409, { error: "ISBN 已存在" }); return json(400, { error: String(e) }); }
  }
  if (path.startsWith("/api/books/") && method === "PUT") {
    const id = Number(path.split("/")[3]);
    if (Number(body.stock) < 0) return json(400, { error: "库存不能为负" });
    try {
      await d.q("UPDATE books SET isbn=$1,title=$2,author=$3,category=$4,price=$5,stock=$6 WHERE id=$7", [body.isbn, body.title, body.author, body.category, Number(body.price), Number(body.stock), id]);
      return json(200, { ok: true });
    } catch (e) { if (/duplicate|unique/i.test(String(e))) return json(409, { error: "ISBN 已存在" }); return json(400, { error: String(e) }); }
  }
  if (path.startsWith("/api/books/") && method === "DELETE") {
    const id = Number(path.split("/")[3]);
    await d.q("UPDATE books SET deleted = TRUE WHERE id = $1", [id]);
    return json(200, { ok: true });
  }

  // ---- 下单：单事务 BEGIN/COMMIT/ROLLBACK（校验库存→扣减→写单+明细，任一失败回滚）----
  if (path === "/api/orders" && method === "POST") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(400, { error: "订单明细为空" });
    try {
      const r = await d.tx(async (q) => {
        let total = 0; const lines: any[] = [];
        for (const it of items) {
          const bid = Number(it.book_id || it.bookId), qty = Number(it.qty);
          const bk = (await q("SELECT id,title,price,stock FROM books WHERE id=$1 AND deleted=FALSE FOR UPDATE", [bid])) as Row[];
          if (!bk.length) throw new Error("图书不存在: " + bid);
          if (Number(bk[0].stock) < qty) throw new Error("库存不足: " + bk[0].title);
          await q("UPDATE books SET stock = stock - $1 WHERE id=$2", [qty, bid]);
          total += Number(bk[0].price) * qty; lines.push([bid, qty, Number(bk[0].price)]);
        }
        const o = (await q("INSERT INTO orders(user_id,total,status) VALUES($1,$2,'pending') RETURNING id", [1, total])) as Row[];
        const oid = Number(o[0].id);
        for (const [bid, qty, price] of lines) await q("INSERT INTO order_items(order_id,book_id,qty,price) VALUES($1,$2,$3,$4)", [oid, bid, qty, price]);
        return { id: oid, total, status: "pending", items: lines.map(([book_id, qty, price]) => ({ book_id, qty, price })) };
      });
      return json(200, r);
    } catch (e) { return json(400, { error: String(e && (e as Error).message ? (e as Error).message : e) }); }
  }
  if (path === "/api/orders" && method === "GET") {
    const status = body && body.status ? body.status : "";
    let rows = (await d.q("SELECT * FROM orders ORDER BY id DESC LIMIT 200")) as Row[];
    if (status) rows = rows.filter((o) => o.status === status);
    return json(200, { items: rows });
  }
  // ---- 取消：仅 pending，事务内回滚库存 ----
  if (path.startsWith("/api/orders/") && path.endsWith("/cancel") && method === "POST") {
    const id = Number(path.split("/")[3]);
    try {
      await d.tx(async (q) => {
        const o = (await q("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])) as Row[];
        if (!o.length) throw new Error("订单不存在");
        if (String(o[0].status) !== "pending") throw new Error("仅 pending 订单可取消");
        await q("UPDATE order_items oi SET qty=qty WHERE oi.order_id=$1", [id]);
        await q("UPDATE books SET stock = stock + (SELECT qty FROM order_items WHERE order_id=$1 AND book_id=books.id) WHERE id IN (SELECT book_id FROM order_items WHERE order_id=$1)", [id]);
        await q("UPDATE orders SET status='cancelled' WHERE id=$1", [id]);
      });
      return json(200, { ok: true });
    } catch (e) { return json(400, { error: String(e && (e as Error).message ? (e as Error).message : e) }); }
  }

  // ---- 报表聚合（SQL AVG/COUNT/SUM）----
  if (path === "/api/reports/kpi" && method === "GET") {
    const s = (await d.q("SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS cnt, COALESCE(AVG(total),0) AS avg FROM orders WHERE status <> 'cancelled'"))[0] as Row;
    const v = (await d.q("SELECT COALESCE(SUM(price*stock),0) AS sv FROM books WHERE deleted=FALSE"))[0] as Row;
    return json(200, { totalSales: Number(s.sales), orderCount: Number(s.cnt), avgOrder: Number(s.avg), stockValue: Number(v.sv) });
  }
  if (path === "/api/reports/7days" && method === "GET") {
    const rows = await d.q("SELECT to_char(created_at,'YYYY-MM-DD') AS d, SUM(total) AS s FROM orders WHERE status<>'cancelled' AND created_at >= now() - interval '7 days' GROUP BY 1 ORDER BY 1");
    return json(200, rows);
  }
  if (path === "/api/reports/category" && method === "GET") {
    const rows = await d.q("SELECT COALESCE(b.category,'未分类') AS category, SUM(oi.qty) AS q FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN books b ON b.id=oi.book_id WHERE o.status<>'cancelled' GROUP BY 1 ORDER BY 2 DESC");
    return json(200, rows);
  }
  if (path === "/api/reports/top" && method === "GET") {
    const rows = await d.q("SELECT b.title, SUM(oi.qty) AS q FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN books b ON b.id=oi.book_id WHERE o.status<>'cancelled' GROUP BY b.title ORDER BY 2 DESC LIMIT 10");
    return json(200, rows);
  }
  if (path === "/api/reports/lowstock" && method === "GET") {
    const rows = await d.q("SELECT title, stock FROM books WHERE deleted=FALSE AND stock < 5 ORDER BY stock ASC");
    return json(200, rows);
  }

  // ---- 用户管理（仅 admin，否则 403）----
  if (path === "/api/users" && method === "GET") {
    const cur = body && body.__user;
    if (!cur || cur.role !== "admin") return json(403, { error: "需要管理员权限" });
    const rows = await d.q("SELECT id,username,role,created_at FROM users ORDER BY id");
    return json(200, rows);
  }
  return json(404, { error: "接口不存在" });
}

// ---- 消息协议：主线程 client <-> DB Worker ----
let token: string | null = null;
self.onmessage = async (ev: MessageEvent) => {
  const { id, method, path, body, tok } = ev.data || {};
  try {
    const tokenValid = !!tok && tok === token;
    const r = await handle(method || "GET", path || "", body || {}, tokenValid);
    if (path === "/api/auth/login" && r.status === 200) token = (r.data as any).token;
    (self as unknown as Worker).postMessage({ id, ...r });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, status: 500, data: { error: String(e && (e as Error).message ? (e as Error).message : e) } });
  }
};