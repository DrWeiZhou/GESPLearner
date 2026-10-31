# GESPLearner · GESP 考试学习备赛系统

面向 **CCF GESP C++ 等级认证**（1~8 级）的在线备考系统：抓取[官网历年真题](https://gesp.ccf.org.cn/101/1010/index.html)与[官方考试大纲](https://gesp.ccf.org.cn/101/1008/10012.html)，支持客观题练习、限时模拟考试、编程题在线评测，并由大模型针对学生的错误逐题讲解、把错题按大纲知识点归类。

## 功能

| 模块 | 说明 |
| --- | --- |
| 真题库 | 官网「认证资料 → 真题及解析」的 C++ 试卷，按考试场次与级别组织；题干、选项、公式、代码完整还原（Markdown + KaTeX + 代码高亮） |
| 一键更新题库 | 管理员在 `/admin` 一键检查官网是否有新的考试，自动下载 PDF、用视觉模型解析、校验后发布（见下文「更新题库」） |
| 逐题练习 | 客观题即时判分、显示正确答案；编程题进入在线 IDE |
| 模拟考试 | 按真实时长（120 分钟）限时作答，倒计时结束自动交卷，交卷后生成成绩报告与逐题回顾 |
| 在线评测 | Monaco 编辑器 + Judge0：自测运行（自定义输入）与提交评测（样例 + 隐藏测试点），返回每个测试点的判定、用时与差异 |
| AI 讲解 | 结合学生的作答/代码/评测结果讲解错因，可继续追问；编程题默认只给诊断与提示，不直接给出完整答案 |
| 考试大纲 | 每个级别附官方《编程能力等级认证标准》：大模型解析大纲 PDF，整理成「知识块 / 知识点」清单，并链接官方原版 PDF |
| 错题本 / 学习报告 | 错题自动收录并由大模型判定考查的大纲知识点，**按知识点分组**展示（错得最多的排在最前）、重做答对后标记已掌握、各级别正确率、模拟考试成绩趋势 |
| 账号体系 | 用户名 + 密码注册登录（学生多半没有邮箱），scrypt 加盐哈希、服务端会话、失败锁定；每份试卷的成绩按用户存储 |
| 金币 | 每做对一道新题立刻按得分发金币（默认每 1 分 = 0.3 枚，管理员可改，金币可带小数），一道题只发一次；兑换奖励后可扣除金币，全部记入可追溯的流水 |

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
bun run syllabus             # 解析官方考试大纲 → data/syllabus/*.json 并入库
bun run dev
```

仓库已内置 C++ 三级全部 14 套真题（2023 年 6 月 ~ 2026 年 9 月）与 2026 年 9 月一级（`data/papers/`），以及一至八级的考试大纲知识点（`data/syllabus/`），只跑 `db:migrate` + `seed` + `syllabus --reuse` 即可先看到效果。

> **演示模式**：未配置 Supabase Auth 或数据库时，应用直接读取 `data/papers/*.json`，题目、判分、评测、AI 讲解都可用，只是不保存任何记录。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 应用连接串。Supabase 用 **Transaction pooler（6543）** |
| `DATABASE_DIRECT_URL` | 迁移用直连（5432） |
| `ZAI_BASE_URL` / `ZAI_API_KEY` | 任意 OpenAI 兼容大模型接口（如智谱 `https://open.bigmodel.cn/api/paas/v4`）。也可以不设，改在 `/admin →「大模型设置」`填写，后台配置优先 |
| `SETTINGS_SECRET` | 加密后台保存的 API key（至少 16 位，`openssl rand -base64 32` 生成）。未设置时后台不能保存大模型配置；更换后已保存的 key 需重新填写 |
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
| `bun run update [--level N] [--all-missing] [--draft] [--dry-run]` | 命令行版「一键更新题库」：检查官网新考试 → 下载 PDF → 解析 → 写 `data/papers/` → 导入发布 |
| `bun run gen-tests <paperId...> | --all` | 让模型为编程题写数据生成器，用官方参考程序产出隐藏测试点（先校验参考程序能复现官方样例，否则跳过该题） |
| `bun run syllabus [N...] [--reuse] [--no-seed]` | 下载官方认证大纲 PDF，按「C++ 编程N级标准」切分章节，逐级整理知识点 → `data/syllabus/l<N>.json` 并入库；`--reuse` 直接用仓库里的 JSON 重新入库（不调模型），`--no-seed` 只写文件 |
| `bun run embed [--force]` | 生成题目向量（pgvector），用于相似题推荐与 AI 讲解的 RAG |
| `bun run render-pdf <file.pdf> <outDir>` | 调试：导出 PDF 每页的图片与阅读顺序文字 |
| `bun run backup [--keep N]` | 备份数据库到 `data/backups/`（见下文「备份与恢复」） |

`parse` 的结果建议人工抽查后再 `seed` 发布——公式和样例空格最容易出错。

## 更新题库

`/admin →「更新题库」`的**一键更新**会抓取官网真题列表，与数据库比对，然后逐份导入：

- **新考试**指比题库中最新一场更晚的考试；默认导入题库已有的级别（题库为空时导入最新一场的全部级别）。
  往期缺失的试卷列在折叠区里，可勾选后「导入所选」。也可以只点「只检查」先看看。
- 每份试卷一次请求（约 1 分钟，函数上限 300 秒）：下载 PDF → 渲染页面 → 视觉模型转录 → 校验 → 写库 → 生成向量，
  浏览器逐份调用并显示进度，因此需要保持页面打开。
- **答案不只靠模型**：单选答案直接从 PDF 文字层的答案表读取；判断题的 √/× 是矢量图形，
  会单独裁出答案表的高清图让模型只读这 10 个符号。两者都会覆盖模型在整页转录时给出的答案
  （用历年 106 份试卷验证：除官网链接放错文件的 1 份外，与人工录入的答案逐题一致）。
- **校验**：不是「15 单选 + 10 判断 + 2 编程、共 100 分」或题号重复的试卷只存为草稿，学生看不到；
  草稿可在卡片里「重新解析」或确认后「发布」。已发布的试卷不会被覆盖。
- 网页导入只写数据库（Vercel 上没有可写的文件系统），随数据库备份。想把新试卷也存进仓库，
  在本地运行 `bun run update`，它会同时写 `data/sources.json`、`data/pdf/` 与 `data/papers/`。
- 新导入的编程题只有样例测试点，隐藏测试点仍需 `bun run gen-tests <paperId>`。

## 考试大纲与知识点

官网「认证资料 → 认证大纲」只有一份 PDF（C++ & Python，一至八级）。`bun run syllabus` 或
`/admin →「考试大纲」`会把它变成按级别组织的知识点清单：

- **切分**：按页面标题「C++ 编程N级标准」/「C++&Python 编程N级标准」把 31 页切成每级一段
  （一、二级的 Python 段落会被跳过），再逐级送进模型，一级一次请求。
- **不需要视觉模型**：大纲是纯文字和表格，PDF 文字层就是全部内容（唯一的图是「知识块」示意图，
  它和旁边表格的知识块列重复）。这点和真题相反——真题的公式是矢量图形，必须看图。
- **粒度**：以大纲「（四）知识点描述」表格的「知识块 / 知识点」为主干，一个知识点大致相当于
  「一次课能讲完的一个主题」：`二进制、八进制、十进制、十六进制` 合并成「进制转换」，
  但 `顺序结构、分支结构、循环结构` 拆成三条。一至八级共约 90 个知识点。
- 结果写入 `data/syllabus/l<N>.json` 并入库；知识点 id 由 **级别 + 名称的哈希** 得到
  （`kp-l3-xxxxxxxx`），所以重新解析大纲时没有改名的知识点会保留 id，挂在上面的错题判定不会丢。
  被删掉的知识点会级联清除其错题判定，这些题目下次做错时重新判定。

真题库每个级别后面附有该级的大纲摘要，`/syllabus/<N>` 是完整清单（登录后还会显示每个知识点上有几道自己的错题）。

## 错题本按知识点归类

学生做错一道题时，大模型判定它考查哪个大纲知识点，错题本据此分组，错得最多的知识点排在最前面。

- **判定属于题目、不属于学生**：结论存在 `question_knowledge`（一题一行），第一个做错这道题的学生
  触发判定，之后所有人复用，不会每人每题再问一次模型。
- **不挡判分**：判定在响应之后用 `after()` 执行（`/api/answers/check`、`/api/attempts/finish`），
  学生看成绩不等模型。后台任务被中断时，打开错题本会补判剩下的（`/api/wrong-book/classify`，每次最多 12 道）。
- **候选范围是本级及以下**：GESP 的级别是累积的，五级的题经常考三级的基础，所以候选知识点包含
  低级别的。实测三级真题的错题会落到二级的「ASCII 编码」、一级的「逻辑运算」上。
- 模型只能从候选清单里抄编号，抄不出来（或返回了不存在的编号）就记为「未能归入大纲知识点」，
  宁可不归类也不错归；这类题目单独成组展示。

## 账号与金币

账号不走 Supabase Auth：GESP 的学生多是中小学生，常常没有邮箱，因此系统自建**用户名 + 密码**账号。

- 密码用 `node:crypto` 的 **scrypt**（N=32768）加随机盐哈希，参数随哈希一起存储，日后可提高强度而不作废旧密码；验证用 `timingSafeEqual`。
- 会话存在服务端 `sessions` 表，Cookie 里只放随机令牌，库中只存它的 SHA-256，因此即使数据库泄露也拿不到可用会话。Cookie 为 HttpOnly + SameSite=Lax，生产环境加 Secure。
- 连续 8 次密码错误锁定 15 分钟；用户名不存在时也会走一次等长的哈希计算，避免用响应时间探测用户是否存在。
- **系统中注册的第一个账号自动成为管理员**，可在 `/admin` 修改金币兑换比例、配置大模型接口。

### 大模型设置

`/admin` 的「大模型设置」可填写接口地址、API key 与讲解 / 视觉 / 向量三个模型名，保存后立即生效，`parse`、`embed`、`gen-tests` 脚本也读同一份配置（需要 `.env.local` 里有 `DATABASE_URL` 和同一个 `SETTINGS_SECRET`）。

- 优先级：后台配置 → 环境变量 → 本地 `.z-ai-config`（仅开发环境）。「清除后台配置」即回退到环境变量。
- 模型名要填服务商的模型 ID：智谱是 `glm-4.5v`，SiliconFlow 则是 `zai-org/GLM-4.5V`。填错时「更新题库」会报 `Model does not exist`。
- 智谱与 SiliconFlow 会自动关闭模型的思考模式（讲解更快；解析一份试卷从约 2.5 分钟降到 1 分钟）。
- API key 用 AES-256-GCM 加密后存进 `app_settings`，密钥 `SETTINGS_SECRET` 只在环境变量里，单独泄露数据库拿不到 key；页面与接口只返回末 4 位。
- 「测试连接」用表单里的值发一次极短的请求，key 留空则用当前生效的 key。

金币采用**流水账**（`coin_transactions`）而非存一个余额字段：余额始终是流水求和，既可追溯又不会因并发写丢失更新。

- 发放：**按题结算**，一道题判分的那一刻就按 `得分 × 比例`（默认 0.3）发放。客观题在提交答案时结算，
  编程题按**第一次提交评测**的得分结算，模拟考试里的客观题在交卷时一起结算。
- **一道题只结算一次**：判分时写入 `question_rewards`（答错也写，分数记 0），复合主键
  `(user_id, question_id)` 在数据库层保证重做 —— 包括从错题本点进去再做一遍 —— 都不会再发金币。
- **金额可带小数**（`numeric(12,3)`）：2 分的客观题按 0.3 就是 0.6 枚，一分不少地直接入账，
  不取整也不留零头，所以每做对一道题余额和明细都会立刻变化。
- 发放不需要加锁：没有任何「读-改-写」，新题由复合主键判定，流水行只是追加。
- 扣除：在事务中对用户行加锁后校验余额（这一步确实是读-改-写），余额不足直接拒绝，
  不会出现负数；扣除金额同样可带小数。
- 旧的「整卷兑换」（`coin_transactions.type = 'earn'`）已下线，历史流水保留原样。迁移
  `0005_per_question_coins` 会把切换前做过的题标记为「已结算、0 枚」；
  `0007_fractional_coins` 把流水金额改成小数、把残留零头并入余额后删掉 `users.coin_carry`。

## 备份与恢复

题库的源头是仓库里的 `data/papers/*.json`，数据库丢失后 `db:migrate` + `seed` 即可完整重建。
账号、作答记录、成绩、错题、金币流水、AI 对话和后台设置**只存在数据库里**，而 Supabase 免费版没有可下载的自动备份
（项目 7 天无访问会被暂停，暂停期间可在控制台恢复），因此需要自己定期备份：

```bash
bun run backup            # → data/backups/gesp-<时间>.dump，默认保留最近 30 份
```

- 用 `pg_dump` 导出 `public`（全部业务表）、`drizzle`（迁移记录）与 pgvector 扩展，压缩的 custom 格式；需要本机 `pg_dump` 主版本 ≥ 服务器（Supabase 为 17，`brew install postgresql@17`）。
- 连接用 `DATABASE_DIRECT_URL`（5432）；事务池 6543 端口不支持 `pg_dump`。
- 备份含账号密码哈希与学生记录，`data/backups/` 已被 `.gitignore` 排除，不要上传到公开位置。

恢复到一个空数据库（如新建的 Supabase 项目）：

```bash
pg_restore --no-owner --no-privileges -d "<新库的 DATABASE_DIRECT_URL>" data/backups/gesp-<时间>.dump
```

唯一的报错 `schema "public" already exists` 是正常的。之后把 `.env.local` 与 Vercel 的连接串换成新库；
后台保存的大模型 API key 依赖同一个 `SETTINGS_SECRET` 才能解密。

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
    papers/             官网抓取、PDF 渲染、视觉模型解析、导入（脚本与「更新题库」共用）
    syllabus/           官方考试大纲：抓取、按级别切分、解析知识点、导入与读取
    knowledge/classify  判定一道题考查哪个大纲知识点（错题本分组用）
    schema/paper.ts     试卷 JSON 的 zod schema
    schema/syllabus.ts  考试大纲 JSON 的 zod schema 与知识点 id
scripts/                crawl / parse / seed / syllabus / update / gen-tests / embed
drizzle/                迁移
data/                   sources.json、pdf/、papers/、tests/、syllabus/
```

## 已部署的环境

| 平台 | 资源 | 说明 |
| --- | --- | --- |
| Supabase | 项目 `GESPLearner`（ref `wylhizzgkoodtqmkewdk`） | 区域 **ap-northeast-1 / Tokyo**（国内访问延迟优于默认的孟买）；已建表、已导入 15 套真题（三级 14 套 + 一级 1 套） |
| Vercel | 项目 `gesp-learner`（团队 `goodluck22`） | 通过 Git 集成关联 `DrWeiZhou/GESPLearner`，推送 `main` 自动部署 |

Supabase 侧的安全设置：建项目时关闭了「Automatically expose new tables」、开启「Enable automatic RLS」；
加上迁移 `0002_rls.sql` 给所有表启用 RLS 且不建策略，因此用 publishable key 直接请求 Data API
（`/rest/v1/questions` 等）会返回 **401 insufficient privileges**，答案表与测试数据不会外泄。

Vercel 已配置的环境变量（Production + Preview）：`DATABASE_URL`（Transaction pooler，6543）、
`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。

**上线前仍需补充：**

1. 大模型：设置 `SETTINGS_SECRET` 后在 `/admin` 填写，或直接设 `ZAI_BASE_URL` / `ZAI_API_KEY` —— 否则 AI 讲解接口返回「大模型未配置」。
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
