export type Row = Record<string, unknown>;
export interface Db {
  kind: "pglite" | "sqljs";
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  tx<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T>;
}
const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS books(id SERIAL PRIMARY KEY, isbn TEXT UNIQUE NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0), stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0), deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders(id SERIAL PRIMARY KEY, user_id INT NOT NULL, total NUMERIC(10,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS order_items(id SERIAL PRIMARY KEY, order_id INT NOT NULL, book_id INT NOT NULL, qty INT NOT NULL CHECK (qty > 0), price NUMERIC(10,2) NOT NULL);`;
const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY AUTOINCREMENT, isbn TEXT UNIQUE NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, book_id INTEGER NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL);`;

function camel(r: Row): Row { const o: Row = {}; for (const k in r) o[k.replace(/_([a-z])/g, (s) => s[1].toUpperCase())] = r[k]; return o; }
let db: Db | null = null;
let dp: Promise<Db> | null = null;

async function initPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  let pg: InstanceType<typeof PGlite>;
  try { const { idb } = await import("@electric-sql/pglite/idb"); pg = new PGlite("yunshuge", { idb }); }
  catch { pg = new PGlite("yunshuge"); }
  await pg.waitReady;
  await pg.exec(SCHEMA_PG);
  const q = async (sql: string, p: unknown[] = []) => (await pg.query<Row>(sql, p as never)).rows.map(camel);
  return {
    kind: "pglite",
    query: q,
    async tx(fn) { await pg.exec("BEGIN"); try { const r = await fn(q); await pg.exec("COMMIT"); return r; } catch (e) { await pg.exec("ROLLBACK"); throw e; } },
  };
}
async function initSqljs(): Promise<Db> {
  const { initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs();
  const s = localStorage.getItem("yunshuge-sqljs");
  const sdb = s ? new SQL.Database(b64ToU8(s)) : new SQL.Database();
  sdb.run(SCHEMA_SQLITE);
  const persist = () => { try { localStorage.setItem("yunshuge-sqljs", u8Tob64(sdb.export())); } catch { /* */ } };
  const q = async (sql: string, p: unknown[] = []) => { const st = sdb.prepare(sql); st.bind(p as never); const rows: Row[] = []; while (st.step()) rows.push(camel(st.getAsObject() as Row)); st.free(); return rows; };
  return {
    kind: "sqljs",
    query: q,
    async tx(fn) { sdb.run("BEGIN"); try { const r = await fn(q); sdb.run("COMMIT"); persist(); return r; } catch (e) { sdb.run("ROLLBACK"); throw e; } },
  };
}
function b64ToU8(b: string) { const bn = atob(b); const u = new Uint8Array(bn.length); for (let i = 0; i < bn.length; i++) u[i] = bn.charCodeAt(i); return u; }
function u8Tob64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (dp) return dp;
  dp = (async () => {
    try { db = await initPglite(); (globalThis as any).__dbKind = "pglite"; return db; }
    catch (e) { (globalThis as any).__dbFallback = "PGlite load failed: " + (e instanceof Error ? e.message : String(e)); db = await initSqljs(); (globalThis as any).__dbKind = "sqljs"; return db; }
  })();
  return dp;
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomSalt(): string { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }

const USERS: Array<[string, string, string]> = [["admin", "admin123", "admin"], ["staff", "staff123", "staff"]];
const BOOKS: Array<[string, string, string, string, number, number]> = [
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

export async function seedIfEmpty(db: Db): Promise<void> {
  const q = db.query.bind(db);
  const uc = await q("SELECT COUNT(*) AS c FROM users");
  if (Number(uc[0].c) === 0) for (const [un, pw, role] of USERS) { const salt = randomSalt(); await q("INSERT INTO users (username,pass_hash,salt,role) VALUES ($1,$2,$3,$4)", [un, await hashPassword(pw, salt), salt, role]); }
  const bc = await q("SELECT COUNT(*) AS c FROM books");
  if (Number(bc[0].c) === 0) for (const [isbn, title, author, cat, price, stock] of BOOKS) await q("INSERT INTO books (isbn,title,author,category,price,stock) VALUES ($1,$2,$3,$4,$5,$6)", [isbn, title, author, cat, price, stock]);
  const oc = await q("SELECT COUNT(*) AS c FROM orders");
  if (Number(oc[0].c) === 0) {
    const now = Date.now(), day = 86400000;
    const samples = [{ d: 0, items: [[4, 2], [1, 1]], st: "paid" }, { d: 1, items: [[8, 1]], st: "shipped" }, { d: 2, items: [[10, 3]], st: "paid" }, { d: 3, items: [[5, 1], [6, 2]], st: "shipped" }, { d: 5, items: [[12, 1]], st: "paid" }];
    for (const s of samples) {
      const when = new Date(now - s.d * day).toISOString();
      let total = 0; const lines: number[][] = [];
      for (const [bid, qty] of s.items) { const b = await q("SELECT price FROM books WHERE id=$1", [bid]); const p = Number(b[0].price); total += p * qty; lines.push([bid, qty, p]); }
      const oi = await q("INSERT INTO orders (user_id,total,status,created_at) VALUES ($1,$2,$3,$4) RETURNING id", [1, total, s.st, when]);
      const oid = Number(oi[0].id);
      for (const [bid, qty, p] of lines) await q("INSERT INTO order_items (order_id,book_id,qty,price) VALUES ($1,$2,$3,$4)", [oid, bid, qty, p]);
    }
  }
}