# GESP 备考助手 · 桌面版设计说明

`desktop` 分支把线上 Web 应用（Next.js + Supabase Postgres）改造成可以离线安装运行的桌面程序：
Windows 安装包（`.exe`）与 macOS 磁盘映像（`.dmg`）。程序仍然是 TypeScript，数据库改为本机 SQLite。
使用说明见 [README](README.md)。

## 总体规划

| # | 模块 | 做法 |
| --- | --- | --- |
| 1 | 外壳 | **Electron**：主进程用 `utilityProcess` 启动 Next.js 的 standalone 服务（只监听 `127.0.0.1`），窗口加载本地地址。单实例、启动画面、中文菜单、外链交给系统浏览器 |
| 2 | 数据库 | Postgres → **SQLite**。Drizzle 的 `sqlite-core` 重写 schema，迁移由 drizzle-kit 生成、启动时自动执行。驱动用运行时自带的 `node:sqlite`（Electron 45 / Node 24），Bun 脚本里用 `bun:sqlite`——**没有任何原生数据库模块**，因此可以在 macOS 上直接交叉打包 Windows 版 |
| 3 | 事务 | SQLite 单连接，把事务改成同步执行（`better-sqlite3` 风格），事务内部没有 `await`，并发请求不会交错进同一个事务；`SELECT … FOR UPDATE` 换成 `BEGIN IMMEDIATE` |
| 4 | 题库 | 106 份真题 JSON 与一至八级大纲随程序发布；首次启动（或升级后题库内容变化时）自动导入用户数据库。「一键更新题库」「考试大纲」照常可用（需要联网和大模型） |
| 5 | 相似题 | pgvector → 向量以 `Float32` BLOB 存进 SQLite，余弦相似度在内存里算（不到 3000 题，毫秒级）。后台新增「相似题向量」卡片（原来只有命令行 `bun run embed`） |
| 6 | 代码评测 | 默认本机编译器：**Windows 安装包自带 w64devkit（GCC 16）**；macOS 依次查找 Homebrew `g++-N`、Xcode 命令行工具的 `clang++`（自带 `bits/stdc++.h` 兼容头）。后台新增「代码评测」卡片：自动检测 / 指定编译器路径 / 改用 Judge0，可一键测试 |
| 7 | 账号与安全 | 账号、会话、金币、错题本、AI 讲解全部保留。`SETTINGS_SECRET` 首次启动自动生成并保存在数据目录；本地 http 下会话 Cookie 不加 `Secure` |
| 8 | 编辑器 | Monaco 原本从 jsDelivr CDN 加载，改为随程序打包的本地副本，离线可用 |
| 9 | 备份 | `pg_dump` 改为 `VACUUM INTO`：每天首次启动自动备份（保留 30 份），后台可「立即备份」「下载」「从备份恢复」 |
| 10 | 打包发布 | `bun run desktop:build`：建构建用数据库 → `next build`（standalone）→ 组装服务目录 → esbuild 编译主进程 → electron-builder 产出 `dmg`（arm64 / x64）与 NSIS `exe`（x64）→ GitHub Releases |

## 运行时结构

```
GESPLearner(.exe / .app)            Electron 主进程（desktop/main.ts → app.asar 里的 main.cjs）
 ├─ 启动画面 → 等 /api/health 就绪 → 主窗口 http://127.0.0.1:47831
 └─ utilityProcess: resources/server/server.js   Next.js standalone 服务
      ├─ node:sqlite ──> <数据目录>/gesp.db        启动时迁移 + 导入内置题库 + 每日自动备份
      └─ 本机编译器 ──> resources/toolchain/w64devkit/bin/g++.exe（Windows）
                       /opt/homebrew/bin/g++-N 或 /usr/bin/clang++（macOS）
```

- **端口固定为 47831**（被占用时才随机）：代码草稿存在 `localStorage`，它按「协议 + 主机 + 端口」隔离，端口一变草稿就看不到了。
- 传给服务进程的环境变量是白名单：开发者 shell 里的 `DATABASE_URL`、`SETTINGS_SECRET`、`CXX` 等不会漏进去。
- 服务进程意外退出时弹窗提供「重新启动 / 打开日志」；日志在 `<数据目录>/logs/server.log`。
- 程序目录可能只读（`Program Files`、签过名的 `.app`），所以关掉了 Next 的 ISR 落盘（`experimental.isrFlushToDisk: false`），
  重新生成的页面只留在内存里；所有可写的东西都在用户数据目录。

## 数据库层

- `src/db/sqlite.ts`：在 `node:sqlite` / `bun:sqlite` 上包一层 better-sqlite3 风格的接口（`prepare` / `run` / `all` / `get` / `raw` / `transaction`），
  直接复用 Drizzle 的 better-sqlite3 会话类；两个模块都用 `process.getBuiltinModule` 加载，打包器不会去解析 `bun:sqlite`。
- `src/db/index.ts`：打开数据库（WAL、`foreign_keys = ON`、`busy_timeout`），执行 `drizzle/` 里的迁移，然后 `bootstrapContent()` 导入内置题库，
  最后按需做每日备份；进程退出时关闭连接，把 WAL 合并回 `gesp.db`。
- `src/db/bootstrap.ts`：题库版本 = `data/papers`、`data/syllabus`、`data/tests` 文件内容的哈希，存在 `app_settings.content_version`。
  版本没变时启动只多一次查询；变了（程序升级带来新题）就幂等地重新导入，答题记录挂在不变的题目 id 上，不受影响。
- 事务一律同步：`seedPaper`、`seedSyllabus`、`rewardQuestions`、`spendCoins` 与交卷都写成 `db.transaction((tx) => { … .run() … })`，
  回调返回 Promise 会直接报错，从根上杜绝「另一个请求的语句落进这个事务」。
- 时间戳存毫秒整数（`timestamp_ms`），比较「未过期的会话」用数据库时钟 `strftime('%s','now') * 1000`（Cache Components 预渲染时不允许读 `new Date()`）。

## 跨平台注意

同一份服务端 bundle 在 macOS 上构建、发给 Windows 用，所以**判断平台必须在运行时**：Turbopack 会把应用代码里的
`process.platform` 替换成构建机器的值（`"darwin"`），`process.platform === "win32"` 的分支在 Windows 包里就整个没了。
统一用 `src/lib/platform.ts` 的 `isWindows()`（内部是 `os.platform()`）；构建脚本会检查 Windows 分支是否还在 bundle 里。

## 打包流程（`scripts/desktop/build.ts`）

1. `scripts/desktop/prepare-db.ts` 建一个带内置题库的构建用数据库，`next build` 预渲染页面时读它。
2. `next build` 输出到 `.next-desktop/`（独立的 `distDir`，不和正在运行的 `next dev` 抢 `.next`）。
   `outputFileTracingExcludes` 与 `turbopackIgnore` 注释保证 `data/`（本地数据库、备份、PDF）不会被文件追踪拷进安装包。
3. 组装 `dist-desktop/server/`：standalone + `static` + `public`（含 Monaco）+ `data/papers|syllabus` + `drizzle/`；
   符号链接解引用（NSIS 存不了链接），去掉 `sharp`（不用 `next/image`）和各平台的 canvas 二进制，最后检查没有 `.env`、`.db`、`secret.key` 混进来。
4. `dist-desktop/native/<平台>-<架构>/`：用 `npm pack`（校验 registry 的完整性哈希）取对应平台的 `@napi-rs/canvas-*`，
   electron-builder 按 `${arch}` 放进各自的安装包——这是唯一的原生模块，只在「更新题库」渲染 PDF 时用到。
5. Windows 编译器：下载固定版本的 w64devkit（校验 SHA-256），解压后只保留 C/C++ 编译所需（去掉 Fortran、32 位库、cmake、gdb、vim、
   busybox、源码和用不到的大型导入库），解压后约 290 MB；含编译器的 Windows 安装包约 200 MB。
6. esbuild 把 `desktop/main.ts` 打成 `dist-desktop/app/main.cjs`，配一个**没有依赖**的 `package.json`。
7. electron-builder（`desktop/electron-builder.cjs`）以 `dist-desktop/app` 为项目目录运行，否则它会把仓库的整个 `node_modules` 当依赖打进 asar；
   每个平台单独跑一次（`--arm64/--x64` 对同一次运行的所有平台生效）。macOS 没有开发者证书，`afterPack` 里做 ad-hoc 签名
   （Apple 芯片要求可执行文件至少有 ad-hoc 签名）；Windows 的图标与版本信息由 electron-builder 用纯 JS 写入，不需要 Wine。

产物：`dist-desktop/release/GESPLearner-<版本>-mac-arm64.dmg`、`…-mac-x64.dmg`、`…-win-x64-setup.exe`。

## 验证

- `desktop/smoke.cjs`：用安装好的程序自带的 Electron（`ELECTRON_RUN_AS_NODE=1`）跑——服务启动与题库导入、各页面、编译器检测、
  C++ 运行（`bits/stdc++.h` + 一百万层递归，验证 Windows 上的 256 MB 栈）、编译错误、提交参考程序得 AC、客观题判分与金币、
  手动与每日自动备份、GUI 程序自行拉起服务。数据目录与临时目录的路径都带中文。
- `.github/workflows/desktop-smoke.yml`：在 GitHub 的 Windows 机器上下载发布里的安装包，静默安装到 `C:\测试\GESP备考助手`，再跑上面的冒烟测试。
  推送 `v*` 标签时自动运行，也可手动指定版本。

## 已知限制

- 没有代码签名证书：Windows 首次运行会有 SmartScreen 提示，macOS 需要在「隐私与安全性」里允许一次（README 有说明）。
- 本机评测按墙钟时间计时、不限制内存，是真实评测机的近似；需要严格评测时在「代码评测」里改用 Judge0。
- 程序不自动更新，新版本到 Releases 下载覆盖安装即可，数据目录不受影响。
