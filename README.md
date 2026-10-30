# GESPLearner · GESP 考试学习备赛系统

面向 **CCF GESP C++ 等级认证**（1~8 级）的在线备考系统：抓取[官网历年真题](https://gesp.ccf.org.cn/101/1010/index.html)，支持客观题练习、限时模拟考试、编程题在线评测，并由大模型针对学生的错误逐题讲解。

## 功能

| 模块 | 说明 |
| --- | --- |
| 真题库 | 官网「认证资料 → 真题及解析」的 C++ 试卷，按考试场次与级别组织；题干、选项、公式、代码完整还原（Markdown + KaTeX + 代码高亮） |
| 逐题练习 | 客观题即时判分、显示正确答案；编程题进入在线 IDE |
| 模拟考试 | 按真实时长（120 分钟）限时作答，倒计时结束自动交卷，交卷后生成成绩报告与逐题回顾 |
| 在线评测 | Monaco 编辑器 + Judge0：自测运行（自定义输入）与提交评测（样例 + 隐藏测试点），返回每个测试点的判定、用时与差异 |
| AI 讲解 | 结合学生的作答/代码/评测结果讲解错因，可继续追问；编程题默认只给诊断与提示，不直接给出完整答案 |
| 错题本 / 学习报告 | 自动收录错题（重做答对后标记已掌握）、各级别正确率、模拟考试成绩趋势 |
| 账号体系 | 用户名 + 密码注册登录（学生多半没有邮箱），scrypt 加盐哈希、服务端会话、失败锁定；每份试卷的成绩按用户存储 |
| 金币 | 交卷后可把得分按比例兑换成金币（默认每 1 分 = 0.3 枚，管理员可改），每份试卷限兑一次；兑换奖励后可扣除金币，全部记入可追溯的流水 |

## 技术栈

- **Next.js 16**（App Router、Cache Components、Partial Prefetching）+ React 19 + TypeScript
- **Tailwind CSS v4** + **shadcn/ui**（Base UI）+ Framer Motion 动效 + next-themes 深色模式
- **Supabase**：Postgres（+ pgvector）。账号为应用自建，不使用 Supabase Auth
- **Drizzle ORM** + drizzle-kit 迁移
- **Vercel AI SDK**（`useChat` 流式 UI）+ **LangChain**（`@ai-sdk/langchain` 适配器接入任意 OpenAI 兼容模型）
- **Judge0** 代码评测（本地开发可用本机编译器）
- **Bun** 作为包管理与脚本运行时

## 快速开始

```bash
bun install
cp .env.example .env.local   # 按下文填写
bun run db:migrate           # 建表（需要 DATABASE_DIRECT_URL）
bun run crawl                # 抓取官网真题 PDF → data/pdf/ 与 data/sources.json
bun run parse                # 视觉模型解析 PDF → data/papers/*.json
bun run seed                 # 导入数据库并发布
bun run dev
```

仓库已内置 2026 年 9 月 C++ 一级、三级两套真题（`data/papers/`），只跑 `db:migrate` + `seed` 即可先看到效果。

> **演示模式**：未配置 Supabase Auth 或数据库时，应用直接读取 `data/papers/*.json`，题目、判分、评测、AI 讲解都可用，只是不保存任何记录。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 应用连接串。Supabase 用 **Transaction pooler（6543）** |
| `DATABASE_DIRECT_URL` | 迁移用直连（5432） |
| `ZAI_BASE_URL` / `ZAI_API_KEY` | 任意 OpenAI 兼容大模型接口（如智谱 `https://open.bigmodel.cn/api/paas/v4`） |
| `AI_MODEL` / `AI_VISION_MODEL` / `AI_EMBEDDING_MODEL` | 讲解模型 / 解析试卷的视觉模型 / 向量模型（默认 `glm-4.6`、`glm-4.5v`、`embedding-3`） |
| `JUDGE0_URL`（+ `JUDGE0_RAPIDAPI_KEY` 或 `JUDGE0_AUTH_TOKEN`） | 代码评测服务 |
| `JUDGE_PROVIDER=local` | 仅本地开发：直接用本机 `g++` 编译运行（**无沙箱，禁止用于公网部署**） |

本地开发也可以用 Docker 起一套依赖：

```bash
docker run -d --name gesp-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 pgvector/pgvector:pg17
docker run -d --name judge0 -p 2358:2358 judge0/judge0:1.13.1   # 或参考 Judge0 官方 compose
```

## 数据流水线

| 命令 | 作用 |
| --- | --- |
| `bun run crawl` | 解析官网真题列表（含分页），下载全部 C++ 试卷 PDF，写入 `data/sources.json` |
| `bun run parse [paperId...] [--level N] [--force]` | 用视觉模型把 PDF 转成结构化 JSON。PDF 的公式是矢量图形，文字层会丢失，因此同时送入**页面文字层**（保证代码与文字准确）和**页面图片**（补全公式、答案表格、版面） |
| `bun run seed [paperId...] [--draft]` | 幂等导入数据库；`--draft` 只导入不发布 |
| `bun run gen-tests <paperId...> | --all` | 让模型为编程题写数据生成器，用官方参考程序产出隐藏测试点（先校验参考程序能复现官方样例，否则跳过该题） |
| `bun run embed [--force]` | 生成题目向量（pgvector），用于相似题推荐与 AI 讲解的 RAG |
| `bun run render-pdf <file.pdf> <outDir>` | 调试：导出 PDF 每页的图片与阅读顺序文字 |

`parse` 的结果建议人工抽查后再 `seed` 发布——公式和样例空格最容易出错。

## 账号与金币

账号不走 Supabase Auth：GESP 的学生多是中小学生，常常没有邮箱，因此系统自建**用户名 + 密码**账号。

- 密码用 `node:crypto` 的 **scrypt**（N=32768）加随机盐哈希，参数随哈希一起存储，日后可提高强度而不作废旧密码；验证用 `timingSafeEqual`。
- 会话存在服务端 `sessions` 表，Cookie 里只放随机令牌，库中只存它的 SHA-256，因此即使数据库泄露也拿不到可用会话。Cookie 为 HttpOnly + SameSite=Lax，生产环境加 Secure。
- 连续 8 次密码错误锁定 15 分钟；用户名不存在时也会走一次等长的哈希计算，避免用响应时间探测用户是否存在。
- **系统中注册的第一个账号自动成为管理员**，可在 `/admin` 修改金币兑换比例。

金币采用**流水账**（`coin_transactions`）而非存一个余额字段：余额始终是流水求和，既可追溯又不会因并发写丢失更新。

- 兑换：`floor(试卷得分 × 比例)`，默认比例 0.3。**每份试卷只能兑换一次**，由局部唯一索引
  `coin_tx_one_earn_per_attempt` 在数据库层保证，并发重复提交也只会成功一次。
- 扣除：在事务中对用户行加锁后校验余额，余额不足直接拒绝，不会出现负数。

## 安全设计

- **答案与测试数据不出服务端**：`question_keys`、`test_cases` 只在服务端读取；返回给浏览器的题目类型（`src/lib/types.ts`）不含答案字段。
- **判分一律在服务端**：客观题走 `/api/answers/check`，模拟考试交卷走 `/api/attempts/finish`，编程题得分取该次考试的最佳提交，前端无法伪造成绩。
- **数据库直连 + RLS 兜底**：应用以表属主身份通过 Drizzle 访问；所有表都启用了 RLS 且不建策略，因此 Supabase 的公开 REST/GraphQL 接口读不到任何数据。
- **会话校验贴近数据**：`proxy.ts` 只负责刷新会话 Cookie，真正的鉴权在每个 Route Handler 内完成。

## 部署注意事项

两点是在生产环境踩出来的，换环境时同样适用：

1. **函数要和数据库同区。** `vercel.json` 里固定了 `regions: ["hnd1"]`（东京）。
   默认区域在美东，每次查询跨太平洋往返，页面要并发多条查询时极易触发函数超时；
   同区之后单条查询从 2 秒以上降到 3 毫秒。
2. **Server Component 里按用户读数据库要顺序执行。** 用 `Promise.all` 并发时，
   带会话的页面会卡在骨架屏（Suspense 边界不解析，最终 300 秒函数超时），而同样的
   查询在 Route Handler 里只要几毫秒。页面与 `src/lib/stats.ts` 因此都改为逐条 await；
   同区后每条仅几毫秒，顺序执行没有可感知的代价。

## 项目结构

```
src/
  app/                  页面与 Route Handlers（/api/run、/api/submit、/api/tutor …）
  components/           UI（question/ 题目与 IDE、paper/ 考试与成绩、tutor/ AI 讲解）
  db/                   Drizzle schema 与连接
  lib/
    ai/                 模型接入（LangChain）与讲解提示词
    judge/              评测：judge0（生产）/ local（开发）
    content.ts          题库读取（公开接口不含答案）+ pgvector 相似题
    schema/paper.ts     试卷 JSON 的 zod schema
scripts/                crawl / parse / seed / gen-tests / embed
drizzle/                迁移
data/                   sources.json、pdf/、papers/、tests/
```

## 已部署的环境

| 平台 | 资源 | 说明 |
| --- | --- | --- |
| Supabase | 项目 `GESPLearner`（ref `wylhizzgkoodtqmkewdk`） | 区域 **ap-northeast-1 / Tokyo**（国内访问延迟优于默认的孟买）；已建表、已导入 2 套真题 |
| Vercel | 项目 `gesp-learner`（团队 `goodluck22`） | 通过 Git 集成关联 `DrWeiZhou/GESPLearner`，推送 `main` 自动部署 |

Supabase 侧的安全设置：建项目时关闭了「Automatically expose new tables」、开启「Enable automatic RLS」；
加上迁移 `0002_rls.sql` 给所有表启用 RLS 且不建策略，因此用 publishable key 直接请求 Data API
（`/rest/v1/questions` 等）会返回 **401 insufficient privileges**，答案表与测试数据不会外泄。

Vercel 已配置的环境变量（Production + Preview）：`DATABASE_URL`（Transaction pooler，6543）、
`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。

**上线前仍需补充：**

1. `ZAI_BASE_URL` / `ZAI_API_KEY` —— 否则 AI 讲解接口返回「大模型未配置」。
2. `JUDGE0_URL` —— 否则编程题评测返回「未配置代码评测服务」。
   切勿在 Vercel 上设置 `JUDGE_PROVIDER=local`：那会在无沙箱的环境里编译运行任意代码。
3. Supabase Auth → URL Configuration 里把 Site URL 设为线上域名，否则注册确认邮件里的链接会指回 localhost。

### MCP

仓库内 `.mcp.json` 已注册两个官方 MCP server：

- `supabase` —— 限定到本项目 ref，可查库、查日志、读文档
- `vercel` —— 查项目、部署与构建日志

两者都走 OAuth。首次使用需在**交互式终端**里运行 `claude`，执行 `/mcp` 分别批准并完成授权
（非交互会话无法走授权流程）。

## 版权

真题版权归 **CCF GESP** 所有，来源：<https://gesp.ccf.org.cn/101/1010/index.html>。本项目仅供学习交流使用。
