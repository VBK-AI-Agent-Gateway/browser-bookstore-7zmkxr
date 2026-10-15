# 云书阁 · 纯浏览器全栈图书零售后台

**在"只允许浏览器"的环境下，模拟带前端、后端、数据库的完整业务应用**，静态托管到 GitHub Pages 公开访问。

> 数据为**模拟数据**（seed 生成），不含真实手机号/邮箱/身份证/银行卡。

## 架构

```
浏览器（GitHub Pages 静态托管）
├─ index.html  (Vite + 原生 TypeScript SPA)
│   ├─ src/ui/     Dashboard / Books / Orders / Reports / Users / Login
│   ├─ src/api/    fetch 封装 → fetch('/api/*')，自动带 Bearer token
│   ├─ src/auth/   登录、token（内存 + sessionStorage）、角色权限
│   └─ src/db/     PGlite(PostgreSQL WASM) 实例 ← 持久化 IndexedDB/OPFS
│
└─ public/sw.js  Service Worker（模拟"后端"）
    ├─ install: skipWaiting()   activate: clients.claim()
    ├─ fetch 拦截 /api/*：login 校验 SHA-256(salt+pwd) → 签发 token
    │   → 其余校验 Bearer token：401 未登录 / 403 越权 / 409 ISBN 重复
    │   → 路由到 db 层 SQL（图书 CRUD / 库存 / 订单事务 / 报表聚合）
    ├─ 订单事务：BEGIN → 校验库存 → 扣减 → 写订单+明细 → COMMIT（失败 ROLLBACK）
    ├─ BroadcastChannel('yunshuge') 多标签同步
    └─ 静态资源 cache-first → 断网可打开、浏览已加载数据
```

- **DB 方案**：首选 **PGlite（PostgreSQL WASM）**（完整事务 + UNIQUE/CHECK 约束）；加载失败**降级 sql.js** 并在页面/README 说明。
- **持久化**：数据目录落 IndexedDB/OPFS，刷新、关闭标签页不丢。
- **子路径**：`vite.config.ts` 设 `base:"./"`，SW 用 `import.meta.env.BASE_URL` 注册，避免 Pages 404。

## 本地启动

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 构建到 dist/
npm run preview
```

## 演示账号

| 用户名 | 密码 | 角色 | 权限 |
|---|---|---|---|
| `admin` | `admin123` | admin | 管理图书、报表、订单、用户 |
| `staff` | `staff123` | staff | 查看图书、创建订单、查看自己的订单 |

> 密码以 `SHA-256(salt + password)` 哈希入库；明文仅用于演示登录。staff 访问管理员接口返回 **403**，未登录返回 **401**。

## GitHub Pages URL

`https://vbk-ai-agent-gateway.github.io/browser-bookstore-<随机6位>/`

（准确链接以仓库 Pages API 返回的 `html_url` 为准，push 后确认 200 再给。）

## 仓库 URL

`https://github.com/VBK-AI-Agent-Gateway/browser-bookstore-<随机6位>`

## 业务功能

- **认证与权限**：登录页、token（内存+sessionStorage）、401/403、admin/staff 分权
- **图书管理**：列表、搜索、分页、新增、编辑、软删除；ISBN 唯一(409)、库存非负
- **订单管理（事务）**：创建订单单事务校验库存→扣减→写单+明细，失败 ROLLBACK；取消回滚库存且仅 `pending`；按状态/日期/金额筛选；状态 `pending/paid/shipped/cancelled`
- **销售报表**：KPI（总销售额/订单数/平均客单价/库存总值）、近 7 天折线、分类饼图、畅销 Top10、低库存预警(stock<5)（Chart.js）
- **离线与容错**：断网可打开、API 失败显示错误不白屏、SW skipWaiting+claim、BroadcastChannel 多标签同步
- **页面**：顶部导航 Dashboard/Books/Orders/Reports/Users(admin)、暗亮主题(localStorage)、移动端、version.json(commit SHA + build time)

## 目录结构

```
browser-bookstore-<6位>/
├─ .github/workflows/deploy.yml
├─ public/sw.js / version.json
├─ src/{main.ts,api/client.ts,auth/auth.ts,db/{db,seed}.ts,ui/*.ts,style.css}
├─ tools/seed.mjs
├─ index.html package.json vite.config.ts tsconfig.json .gitignore README.md
```

## 安全与合规

- `.gitignore` 排除 `node_modules/`、`dist/`、`.env*`、`secrets/`、`_raw_data/`
- 公开页面**不暴露**内部表结构或调试接口；密码哈希存储
- 不打印、不提交、不泄露 `GITHUB_TOKEN` / 任何 secret（`credential.helper` 读文件，配置只有 `cat` 命令）
- 不提交 `node_modules` / `dist` / `.env`；≥5 次规范 git 提交