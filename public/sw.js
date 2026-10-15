const CACHE = "yunshuge-v1";
let bc = null; try { bc = new BroadcastChannel("yunshuge"); } catch (e) { bc = null; }
let DB = null, DB_ERR = null;
let token = null, currentUserObj = null;

async function ensureDb() {
  if (DB) return DB;
  try {
    const mod = await import(new URL("./db.js", self.location.href).href);
    DB = await mod.getDb();
    const seed = await import(new URL("./seed.js", self.location.href).href);
    await seed.seedIfEmpty(DB);
  } catch (e) { DB_ERR = e && e.message ? e.message : String(e); console.error("SW db init failed", e); throw e; }
  return DB;
}
function json(_r, obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8" } }); }
function bearer(req) { const h = req.headers.get("Authorization") || ""; const m = h.match(/^Bearer\s+(.+)$/i); return m ? m[1] : null; }
async function hashPassword(pw, salt) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pw)); return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function broadcast(t) { try { if (bc) bc.postMessage({ t: t }); } catch (e) { /* */ } }

async function handleApi(req, url) {
  const db = await ensureDb();
  const path = url.pathname.replace(/^.*\/api/, "/api");
  const method = req.method || "GET";

  if (path === "/api/auth/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const rows = await db.query("SELECT * FROM users WHERE username=$1", [body.username]);
    const u = rows[0];
    if (!u) return json(null, { error: "用户名或密码错误" }, 401);
    if ((await hashPassword(body.password || "", u.salt)) !== u.pass_hash) return json(null, { error: "用户名或密码错误" }, 401);
    token = "tok_" + randSalt(); currentUserObj = { id: u.id, username: u.username, role: u.role };
    return json(null, { token, user: currentUserObj });
  }

  const tk = bearer(req);
  if (!tk || tk !== token) return json(null, { error: "未登录或登录已过期" }, 401);
  const requireAdmin = () => json(null, { error: "需要管理员权限" }, 403);

  if (path === "/api/books" && method === "GET") {
    const q = url.searchParams.get("q") || "", page = parseInt(url.searchParams.get("page") || "1", 10), size = parseInt(url.searchParams.get("size") || "10", 10), offset = (page - 1) * size;
    const like = "%" + q + "%";
    const cond = "(title ILIKE $1 OR author ILIKE $1 OR isbn ILIKE $1 OR category ILIKE $1)";
    const tr = await db.query("SELECT COUNT(*) AS c FROM books WHERE deleted=false AND " + cond, [like]);
    const items = await db.query("SELECT * FROM books WHERE deleted=false AND " + cond + " ORDER BY id DESC LIMIT " + size + " OFFSET " + offset, [like]);
    return json(null, { items, total: Number(tr[0].c), page, size });
  }
  if (path === "/api/books" && method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!b.isbn || !b.title) return json(null, { error: "isbn/title 必填" }, 400);
    if (Number(b.stock) < 0) return json(null, { error: "库存不能为负" }, 400);
    const dup = await db.query("SELECT id FROM books WHERE isbn=$1", [b.isbn]);
    if (dup.length) return json(null, { error: "ISBN 已存在" }, 409);
    const r = await db.query("INSERT INTO books (isbn,title,author,category,price,stock) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [b.isbn, b.title, b.author || "", b.category || "", Number(b.price) || 0, Number(b.stock) || 0]);
    broadcast("books"); return json(null, r[0]);
  }
  if (path.startsWith("/api/books/") && method === "PUT") {
    const id = Number(path.split("/")[3]); const b = await req.json().catch(() => ({}));
    if (Number(b.stock) < 0) return json(null, { error: "库存不能为负" }, 400);
    if (b.isbn) { const dup = await db.query("SELECT id FROM books WHERE isbn=$1 AND id<>$2", [b.isbn, id]); if (dup.length) return json(null, { error: "ISBN 已存在" }, 409); }
    const r = await db.query("UPDATE books SET isbn=$1,title=$2,author=$3,category=$4,price=$5,stock=$6 WHERE id=$7 RETURNING *", [b.isbn, b.title, b.author, b.category, Number(b.price), Number(b.stock), id]);
    broadcast("books"); return json(null, r[0]);
  }
  if (path.startsWith("/api/books/") && method === "DELETE") {
    const id = Number(path.split("/")[3]);
    await db.query("UPDATE books SET deleted=true WHERE id=$1", [id]);
    broadcast("books"); return json(null, { ok: true });
  }

  if (path === "/api/orders" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(null, { error: "订单明细为空" }, 400);
    try {
      const order = await db.tx(async (q) => {
        let total = 0; const lines = [];
        for (const it of items) {
          const bid = Number(it.book_id || it.bookId), qty = Number(it.qty);
          const br = await q("SELECT * FROM books WHERE id=$1 AND deleted=false FOR UPDATE", [bid]);
          const book = br[0];
          if (!book) throw new Error("图书不存在: " + bid);
          if (Number(book.stock) < qty) throw new Error("库存不足: " + book.title);
          await q("UPDATE books SET stock=stock-$1 WHERE id=$2", [qty, bid]);
          total += Number(book.price) * qty; lines.push([bid, qty, Number(book.price)]);
        }
        const or = await q("INSERT INTO orders (user_id,total,status) VALUES ($1,$2,'pending') RETURNING *", [currentUserObj ? currentUserObj.id : 1, total]);
        const oid = or[0].id;
        for (const [bid, qty, price] of lines) await q("INSERT INTO order_items (order_id,book_id,qty,price) VALUES ($1,$2,$3,$4)", [oid, bid, qty, price]);
        return { ...or[0], items: lines.map(([book_id, qty, price]) => ({ book_id, qty, price })) };
      });
      broadcast("orders"); return json(null, order);
    } catch (e) { return json(null, { error: e.message || "创建订单失败" }, 400); }
  }
  if (path === "/api/orders" && method === "GET") {
    const status = url.searchParams.get("status") || "", from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "", min = url.searchParams.get("min") || "", mine = url.searchParams.get("mine") === "1";
    let sql = "SELECT * FROM orders WHERE 1=1"; const p = [];
    if (status) { p.push(status); sql += " AND status=$" + p.length; }
    if (from) { p.push(from); sql += " AND created_at>=$" + p.length; }
    if (to) { p.push(to); sql += " AND created_at<=$" + p.length + "||'T23:59:59'"; }
    if (min) { p.push(Number(min)); sql += " AND total>=$" + p.length; }
    if (mine) { p.push(currentUserObj ? currentUserObj.id : 1); sql += " AND user_id=$" + p.length; }
    sql += " ORDER BY id DESC LIMIT 200";
    const orders = await db.query(sql, p);
    for (const o of orders) o.items = await db.query("SELECT * FROM order_items WHERE order_id=$1", [o.id]);
    return json(null, { items: orders });
  }
  if (path.startsWith("/api/orders/") && path.endsWith("/cancel") && method === "POST") {
    const id = Number(path.split("/")[3]);
    try {
      await db.tx(async (q) => {
        const or = await q("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id]); const o = or[0];
        if (!o) throw new Error("订单不存在");
        if (o.status !== "pending") throw new Error("仅 pending 订单可取消");
        const its = await q("SELECT * FROM order_items WHERE order_id=$1", [id]);
        for (const it of its) await q("UPDATE books SET stock=stock+$1 WHERE id=$2", [it.qty, it.book_id]);
        await q("UPDATE orders SET status='cancelled' WHERE id=$1", [id]);
      });
      broadcast("orders"); return json(null, { ok: true });
    } catch (e) { return json(null, { error: e.message || "取消失败" }, 400); }
  }

  if (path === "/api/reports/kpi" && method === "GET") {
    const sales = await db.query("SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS c FROM orders WHERE status<>'cancelled'");
    const stock = await db.query("SELECT COALESCE(SUM(price*stock),0) AS v FROM books WHERE deleted=false");
    const s = Number(sales[0].s), c = Number(sales[0].c);
    return json(null, { totalSales: s, orderCount: c, avgOrder: c ? s / c : 0, stockValue: Number(stock[0].v) });
  }
  if (path === "/api/reports/7days" && method === "GET") return json(null, await db.query("SELECT to_char(created_at,'YYYY-MM-DD') AS d, COALESCE(SUM(total),0) AS s FROM orders WHERE status<>'cancelled' AND created_at>=now()-interval '7 days' GROUP BY 1 ORDER BY 1"));
  if (path === "/api/reports/category" && method === "GET") return json(null, await db.query("SELECT b.category AS category, SUM(oi.qty) AS q FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN books b ON b.id=oi.book_id WHERE o.status<>'cancelled' GROUP BY b.category ORDER BY q DESC"));
  if (path === "/api/reports/top" && method === "GET") return json(null, await db.query("SELECT b.title AS title, SUM(oi.qty) AS q FROM order_items oi JOIN books b ON b.id=oi.book_id JOIN orders o ON o.id=oi.order_id WHERE o.status<>'cancelled' GROUP BY b.title ORDER BY q DESC LIMIT 10"));
  if (path === "/api/reports/lowstock" && method === "GET") return json(null, await db.query("SELECT id,title,isbn,stock FROM books WHERE deleted=false AND stock<5 ORDER BY stock ASC"));

  if (path === "/api/users" && method === "GET") {
    if (!currentUserObj || currentUserObj.role !== "admin") return requireAdmin();
    return json(null, await db.query("SELECT id, username, role, created_at FROM users ORDER BY id"));
  }
  return json(null, { error: "接口不存在" }, 404);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/")) {
    event.respondWith((async () => {
      try {
        if (url.pathname.endsWith("/api/auth/login")) {
          const res = await handleApi(event.request, url);
          if (res.status === 200) { try { const j = await res.clone().json(); currentUserObj = j.user; token = j.token; } catch (e) { /* */ } }
          return res;
        }
        return await handleApi(event.request, url);
      } catch (e) { return json(null, { error: e && e.message ? e.message : "服务器内部错误", fallback: DB_ERR || null }, 500); }
    })());
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const fp = fetch(event.request).then((r) => { if (r && r.status === 200) cache.put(event.request, r.clone()); return r; }).catch(() => cached);
    return cached || fp;
  }));
});
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });