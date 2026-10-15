/* ============================================================
 * 云书阁 · Service Worker（模拟后端）— 单文件，无动态 import()
 * 规范限制：ServiceWorkerGlobalScope 禁止动态 import()，故全部内联。
 * 数据库：IndexedDB 原生（持久化 + 事务 transaction，刷新/关标签不丢）
 *   - 若需 PGlite(sql.js) WASM 方案见 README 说明：因 SW 不能动态 import，
 *     数据层改为 IDB 原生实现以满足"无动态 import + 持久化 + 事务"约束。
 * 功能：/api/* 拦截、token 401/403、ISBN 409、订单事务 BEGIN/COMMIT/ROLLBACK、
 *      取消回滚库存、报表聚合、cache-first 离线、BroadcastChannel 同步。
 * ============================================================ */
const CACHE = "yunshuge-v2";
const DB_NAME = "yunshuge", DB_VER = 1;
let bc = null; try { bc = new BroadcastChannel("yunshuge"); } catch (e) { bc = null; }
let token = null, currentUserObj = null;
let DBP = null;

/* ---------- IndexedDB helpers ---------- */
function openDb() {
  if (DBP) return DBP;
  DBP = new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    // 关键：upgradeneeded 内只做【同步】schema 创建，绝不 await（异步会中止 version-change 事务）
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStore.contains("users")) { const s = d.createObjectStore("users", { keyPath: "id", autoIncrement: true }); s.createIndex("username", "username", { unique: true }); }
      if (!d.objectStore.contains("books")) { const s = d.createObjectStore("books", { keyPath: "id", autoIncrement: true }); s.createIndex("isbn", "isbn", { unique: true }); s.createIndex("deleted", "deleted"); }
      if (!d.objectStore.contains("orders")) { const s = d.createObjectStore("orders", { keyPath: "id", autoIncrement: true }); s.createIndex("status", "status"); s.createIndex("created_at", "created_at"); }
      if (!d.objectStore.contains("order_items")) { const s = d.createObjectStore("order_items", { keyPath: "id", autoIncrement: true }); s.createIndex("order_id", "order_id"); }
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
    rq.onblocked = () => rej(new Error("IndexedDB blocked (another version open)"));
  });
  return DBP;
}
function tx(db, stores, mode) { return db.transaction(stores, mode); }
function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("abort")); }); }

/* ---------- auth crypto ---------- */
async function hashPassword(pw, salt) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pw)); return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }

/* ---------- seed (模拟数据) ---------- */
const SEED_USERS = [["admin", "admin123", "admin"], ["staff", "staff123", "staff"]];
const SEED_BOOKS = [
  ["9787020002207", "红楼梦", "曹雪芹", "文学", 59.7, 42], ["9787020008735", "西游记", "吴承恩", "文学", 45, 36],
  ["9787544253994", "百年孤独", "加西亚·马尔克斯", "外国文学", 39.5, 18], ["9787536692930", "三体", "刘慈欣", "科幻", 23, 55],
  ["9787540478563", "活着", "余华", "当代文学", 32, 47], ["9787508647357", "人类简史", "尤瓦尔·赫拉利", "社科", 68, 25],
  ["9787508662107", "未来简史", "尤瓦尔·赫拉利", "社科", 56, 12], ["9787111632588", "深入理解计算机系统", "Randal E. Bryant", "计算机", 139, 20],
  ["9787115545381", "Python编程：从入门到实践", "Eric Matthes", "计算机", 89, 30], ["9787111605324", "设计模式", "GoF", "计算机", 79, 8],
  ["9787506365437", "解忧杂货店", "东野圭吾", "外国文学", 39, 40], ["9787544270878", "白夜行", "东野圭吾", "外国文学", 39.5, 22],
  ["9787536692237", "撒哈拉的故事", "三毛", "散文", 28, 15], ["9787540488567", "我们仨", "杨绛", "散文", 25, 4],
  ["9787229154581", "沙丘", "弗兰克·赫伯特", "科幻", 88, 6], ["9787539990530", "庆余年", "猫腻", "网络文学", 268, 10],
  ["9787020137725", "平凡的世界", "路遥", "当代文学", 128, 33], ["9787501523412", "明朝那些事儿", "当年明月", "历史", 228.5, 27],
];
async function ensureSeed() {
  const db = await openDb();
  const t = tx(db, ["users", "books", "orders", "order_items"], "readwrite");
  const uc = await req(t.objectStore("users").count());
  if (uc === 0) for (const [un, pw, role] of SEED_USERS) { const salt = randSalt(); t.objectStore("users").add({ username: un, pass_hash: await hashPassword(pw, salt), salt, role, created_at: new Date().toISOString() }); }
  const bc = await req(t.objectStore("books").count());
  if (bc === 0) for (const [isbn, title, author, category, price, stock] of SEED_BOOKS) t.objectStore("books").add({ isbn, title, author, category, price, stock, deleted: false, created_at: new Date().toISOString() });
  await txDone(t);
  // orders seed（7 天报表）
  const t2 = tx(db, ["books", "orders", "order_items"], "readwrite");
  const oc = await req(t2.objectStore("orders").count());
  if (oc === 0) {
    const now = Date.now(), day = 86400000;
    const books = await req(t2.objectStore("books").getAll());
    const bm = {}; books.forEach((b) => (bm[b.id] = b));
    const samples = [{ d: 0, items: [[4, 2], [1, 1]], st: "paid" }, { d: 1, items: [[8, 1]], st: "shipped" }, { d: 2, items: [[10, 3]], st: "paid" }, { d: 3, items: [[5, 1], [6, 2]], st: "shipped" }, { d: 5, items: [[12, 1]], st: "paid" }];
    for (const s of samples) {
      let total = 0; const lines = [];
      for (const [bid, qty] of s.items) { const b = bm[bid]; if (!b) continue; total += b.price * qty; lines.push([bid, qty, b.price]); }
      const oid = await req(t2.objectStore("orders").add({ user_id: 1, total, status: s.st, created_at: new Date(now - s.d * day).toISOString() }));
      for (const [bid, qty, price] of lines) t2.objectStore("order_items").add({ order_id: oid, book_id: bid, qty, price });
    }
  }
  await txDone(t2);
}

/* ---------- responses ---------- */
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8" } }); }
function bearer(req) { const h = req.headers.get("Authorization") || ""; const m = h.match(/^Bearer\s+(.+)$/i); return m ? m[1] : null; }
function broadcast(t) { try { if (bc) bc.postMessage({ t: t }); } catch (e) { /* */ } }

/* ---------- route handler ---------- */
async function handleApi(req, url) {
  await ensureSeed();
  const db = await openDb();
  const path = url.pathname.replace(/^.*\/api/, "/api");
  const method = req.method || "GET";

  if (path === "/api/auth/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const t = tx(db, ["users"], "readonly");
    const all = await req(t.objectStore("users").getAll());
    const u = all.find((x) => x.username === body.username);
    if (!u) return json({ error: "用户名或密码错误" }, 401);
    if ((await hashPassword(body.password || "", u.salt)) !== u.pass_hash) return json({ error: "用户名或密码错误" }, 401);
    token = "tok_" + randSalt(); currentUserObj = { id: u.id, username: u.username, role: u.role };
    return json({ token, user: currentUserObj });
  }
  const tk = bearer(req);
  if (!tk || tk !== token) return json({ error: "未登录或登录已过期" }, 401);

  if (path === "/api/books" && method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const page = parseInt(url.searchParams.get("page") || "1", 10), size = parseInt(url.searchParams.get("size") || "10", 10);
    const t = tx(db, ["books"], "readonly");
    let items = await req(t.objectStore("books").getAll());
    items = items.filter((b) => !b.deleted);
    if (q) items = items.filter((b) => [b.title, b.author, b.isbn, b.category].some((v) => String(v).toLowerCase().includes(q)));
    items.sort((a, b) => b.id - a.id);
    const total = items.length;
    const pageItems = items.slice((page - 1) * size, page * size);
    return json({ items: pageItems, total, page, size });
  }
  if (path === "/api/books" && method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!b.isbn || !b.title) return json({ error: "isbn/title 必填" }, 400);
    if (Number(b.stock) < 0) return json({ error: "库存不能为负" }, 400);
    const t = tx(db, ["books"], "readwrite");
    const all = await req(t.objectStore("books").getAll());
    if (all.some((x) => x.isbn === b.isbn)) { t.abort(); return json({ error: "ISBN 已存在" }, 409); }
    const id = await req(t.objectStore("books").add({ isbn: b.isbn, title: b.title, author: b.author || "", category: b.category || "", price: Number(b.price) || 0, stock: Number(b.stock) || 0, deleted: false, created_at: new Date().toISOString() }));
    await txDone(t); broadcast("books");
    return json({ id, isbn: b.isbn, title: b.title, stock: Number(b.stock) || 0 });
  }
  if (path.startsWith("/api/books/") && method === "PUT") {
    const id = Number(path.split("/")[3]); const b = await req.json().catch(() => ({}));
    if (Number(b.stock) < 0) return json({ error: "库存不能为负" }, 400);
    const t = tx(db, ["books"], "readwrite");
    const cur = await req(t.objectStore("books").get(id));
    if (!cur) { t.abort(); return json({ error: "图书不存在" }, 404); }
    if (b.isbn && b.isbn !== cur.isbn) { const all = await req(t.objectStore("books").getAll()); if (all.some((x) => x.isbn === b.isbn && x.id !== id)) { t.abort(); return json({ error: "ISBN 已存在" }, 409); } }
    await req(t.objectStore("books").put({ ...cur, isbn: b.isbn, title: b.title, author: b.author, category: b.category, price: Number(b.price), stock: Number(b.stock) }));
    await txDone(t); broadcast("books");
    return json({ ok: true });
  }
  if (path.startsWith("/api/books/") && method === "DELETE") {
    const id = Number(path.split("/")[3]);
    const t = tx(db, ["books"], "readwrite");
    const cur = await req(t.objectStore("books").get(id));
    if (cur) { cur.deleted = true; await req(t.objectStore("books").put(cur)); }
    await txDone(t); broadcast("books");
    return json({ ok: true });
  }

  if (path === "/api/orders" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json({ error: "订单明细为空" }, 400);
    try {
      // 单事务：校验库存 → 扣减 → 写订单+明细，失败自动 abort(ROLLBACK)
      const t = tx(db, ["books", "orders", "order_items"], "readwrite");
      let total = 0; const lines = [];
      for (const it of items) {
        const bid = Number(it.book_id || it.bookId), qty = Number(it.qty);
        const book = await req(t.objectStore("books").get(bid));
        if (!book || book.deleted) { t.abort(); throw new Error("图书不存在: " + bid); }
        if (Number(book.stock) < qty) { t.abort(); throw new Error("库存不足: " + book.title); }
        book.stock -= qty; await req(t.objectStore("books").put(book));
        total += book.price * qty; lines.push([bid, qty, book.price]);
      }
      const oid = await req(t.objectStore("orders").add({ user_id: currentUserObj ? currentUserObj.id : 1, total, status: "pending", created_at: new Date().toISOString() }));
      for (const [bid, qty, price] of lines) t.objectStore("order_items").add({ order_id: oid, book_id: bid, qty, price });
      await txDone(t); broadcast("orders");
      return json({ id: oid, total, status: "pending", items: lines.map(([book_id, qty, price]) => ({ book_id, qty, price })) });
    } catch (e) { return json({ error: e.message || "创建订单失败" }, 400); }
  }
  if (path === "/api/orders" && method === "GET") {
    const status = url.searchParams.get("status") || "", from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "", min = Number(url.searchParams.get("min") || 0), mine = url.searchParams.get("mine") === "1";
    const t = tx(db, ["orders", "order_items"], "readonly");
    let orders = await req(t.objectStore("orders").getAll());
    if (status) orders = orders.filter((o) => o.status === status);
    if (mine) orders = orders.filter((o) => o.user_id === (currentUserObj ? currentUserObj.id : 1));
    if (from) orders = orders.filter((o) => o.created_at >= from);
    if (to) orders = orders.filter((o) => o.created_at <= to + "T23:59:59");
    if (min) orders = orders.filter((o) => o.total >= min);
    orders.sort((a, b) => b.id - a.id);
    orders = orders.slice(0, 200);
    const oitems = await req(t.objectStore("order_items").getAll());
    for (const o of orders) o.items = oitems.filter((i) => i.order_id === o.id);
    return json({ items: orders });
  }
  if (path.startsWith("/api/orders/") && path.endsWith("/cancel") && method === "POST") {
    const id = Number(path.split("/")[3]);
    try {
      const t = tx(db, ["books", "orders", "order_items"], "readwrite");
      const o = await req(t.objectStore("orders").get(id));
      if (!o) { t.abort(); throw new Error("订单不存在"); }
      if (o.status !== "pending") { t.abort(); throw new Error("仅 pending 订单可取消"); }
      const oitems = await req(t.objectStore("order_items").getAll());
      for (const it of oitems.filter((i) => i.order_id === id)) {
        const book = await req(t.objectStore("books").get(it.book_id));
        if (book) { book.stock += it.qty; await req(t.objectStore("books").put(book)); }
      }
      o.status = "cancelled"; await req(t.objectStore("orders").put(o));
      await txDone(t); broadcast("orders");
      return json({ ok: true });
    } catch (e) { return json({ error: e.message || "取消失败" }, 400); }
  }

  if (path === "/api/reports/kpi" && method === "GET") {
    const t = tx(db, ["orders", "books"], "readonly");
    const orders = (await req(t.objectStore("orders").getAll())).filter((o) => o.status !== "cancelled");
    const books = (await req(t.objectStore("books").getAll())).filter((b) => !b.deleted);
    const s = orders.reduce((a, o) => a + Number(o.total), 0), c = orders.length;
    const v = books.reduce((a, b) => a + b.price * b.stock, 0);
    return json({ totalSales: s, orderCount: c, avgOrder: c ? s / c : 0, stockValue: v });
  }
  if (path === "/api/reports/7days" && method === "GET") {
    const t = tx(db, ["orders"], "readonly");
    const now = Date.now() - 7 * 86400000;
    const orders = (await req(t.objectStore("orders").getAll())).filter((o) => o.status !== "cancelled" && new Date(o.created_at).getTime() >= now);
    const map = {};
    for (const o of orders) { const d = o.created_at.slice(0, 10); map[d] = (map[d] || 0) + Number(o.total); }
    return json(Object.keys(map).sort().map((d) => ({ d, s: map[d] })));
  }
  if (path === "/api/reports/category" && method === "GET") {
    const t = tx(db, ["orders", "books", "order_items"], "readonly");
    const orders = (await req(t.objectStore("orders").getAll())).filter((o) => o.status !== "cancelled");
    const valid = new Set(orders.map((o) => o.id));
    const books = await req(t.objectStore("books").getAll());
    const bm = {}; books.forEach((b) => (bm[b.id] = b));
    const items = await req(t.objectStore("order_items").getAll());
    const map = {};
    for (const it of items) if (valid.has(it.order_id)) { const cat = (bm[it.book_id] || {}).category || "未分类"; map[cat] = (map[cat] || 0) + it.qty; }
    return json(Object.keys(map).map((c) => ({ category: c, q: map[c] })).sort((a, b) => b.q - a.q));
  }
  if (path === "/api/reports/top" && method === "GET") {
    const t = tx(db, ["orders", "books", "order_items"], "readonly");
    const orders = (await req(t.objectStore("orders").getAll())).filter((o) => o.status !== "cancelled");
    const valid = new Set(orders.map((o) => o.id));
    const books = await req(t.objectStore("books").getAll());
    const bm = {}; books.forEach((b) => (bm[b.id] = b));
    const items = await req(t.objectStore("order_items").getAll());
    const map = {};
    for (const it of items) if (valid.has(it.order_id)) { const ti = (bm[it.book_id] || {}).title || "?"; map[ti] = (map[ti] || 0) + it.qty; }
    return json(Object.keys(map).map((t2) => ({ title: t2, q: map[t2] })).sort((a, b) => b.q - a.q).slice(0, 10));
  }
  if (path === "/api/reports/lowstock" && method === "GET") {
    const t = tx(db, ["books"], "readonly");
    const books = (await req(t.objectStore("books").getAll())).filter((b) => !b.deleted && b.stock < 5).sort((a, b) => a.stock - b.stock);
    return json(books);
  }

  if (path === "/api/users" && method === "GET") {
    if (!currentUserObj || currentUserObj.role !== "admin") return json({ error: "需要管理员权限" }, 403);
    const t = tx(db, ["users"], "readonly");
    const all = await req(t.objectStore("users").getAll());
    return json(all.map((u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at })));
  }
  return json({ error: "接口不存在" }, 404);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/")) {
    event.respondWith((async () => {
      try {
        const res = await handleApi(event.request, url);
        if (url.pathname.endsWith("/api/auth/login") && res.status === 200) { try { const j = await res.clone().json(); currentUserObj = j.user; token = j.token; } catch (e) { /* */ } }
        return res;
      } catch (e) { return json({ error: e && e.message ? e.message : "服务器内部错误" }, 500); }
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