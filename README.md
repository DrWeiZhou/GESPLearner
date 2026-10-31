# GESPLearner · GESP 考试学习备赛系统（桌面版）

面向 **CCF GESP C++ 等级认证**（1~8 级）的备考软件：内置[官网历年真题](https://gesp.ccf.org.cn/101/1010/index.html)与[官方考试大纲](https://gesp.ccf.org.cn/101/1008/10012.html)，支持客观题练习、限时模拟考试、编程题在本机编译评测，并由大模型针对学生的错误逐题讲解、把错题按大纲知识点归类。

这是 `desktop` 分支：把原来的网站（Next.js + Supabase，在 `main` 分支）做成**安装在自己电脑上的程序**，所有数据保存在本机的 SQLite 数据库里，不需要服务器，不联网也能刷题、模拟考试和评测代码。设计与实现见 [DESKTOP.md](DESKTOP.md)。

## 下载安装

到 [Releases](https://github.com/DrWeiZhou/GESPLearner/releases) 下载：

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10/11（64 位） | `GESPLearner-<版本>-win-x64-setup.exe` | 安装包**自带 C++ 编译器（GCC）**，装好就能评测编程题 |
| macOS（Apple 芯片 M1~M4） | `GESPLearner-<版本>-mac-arm64.dmg` | |
| macOS（Intel 芯片） | `GESPLearner-<版本>-mac-x64.dmg` | |

**首次打开时的系统提示**（程序没有购买代码签名证书，属正常现象）：

- **Windows**：如出现「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。
- **macOS**：把 `GESPLearner` 拖进「应用程序」后，第一次打开如提示「无法验证开发者」或「已损坏」，到「系统设置 → 隐私与安全性」底部点「仍要打开」；
  或在「终端」执行 `xattr -dr com.apple.quarantine /Applications/GESPLearner.app` 后再打开。
- **macOS 评测编程题需要 C++ 编译器**：在「终端」执行 `xcode-select --install` 安装苹果命令行工具（只需一次）；装了 Homebrew 的 `gcc` 会优先使用。

**第一次使用**：打开后点右上角「登录 → 注册」。**第一个注册的账号是管理员**（家长 / 老师），之后学生各自注册。
管理员在「系统设置」里可以填写大模型接口（启用 AI 讲解）、调整金币比例、查看编译器、备份数据。

数据保存在 `%APPDATA%\GESPLearner\`（Windows）或 `~/Library/Application Support/GESPLearner/`（macOS），
卸载程序不会删除；菜单「文件 → 打开数据文件夹」可直接打开。

## 功能

| 模块 | 说明 |
| --- | --- |
| 真题库 | 内置官网「认证资料 → 真题及解析」的 106 套 C++ 试卷（2023 年 3 月 ~ 2026 年 9 月，一至八级），按考试场次与级别组织；题干、选项、公式、代码完整还原（Markdown + KaTeX + 代码高亮） |
| 一键更新题库 | 管理员在「系统设置」一键检查官网是否有新的考试，自动下载 PDF、用视觉模型解析、校验后发布（需联网与大模型，见下文「更新题库」） |
| 逐题练习 | 客观题即时判分、显示正确答案；编程题进入 IDE |
| 模拟考试 | 按真实时长（120 分钟）限时作答，倒计时结束自动交卷，交卷后生成成绩报告与逐题回顾 |
| 代码评测 | Monaco 编辑器（随程序内置，离线可用）+ **本机编译器**：自测运行（自定义输入）与提交评测（样例 + 隐藏测试点），返回每个测试点的判定、用时与差异；也可改用 Judge0 |
| AI 讲解 | 结合学生的作答/代码/评测结果讲解错因，可继续追问；编程题默认只给诊断与提示，不直接给出完整答案（需配置大模型） |
| 考试大纲 | 一至八级官方《编程能力等级认证标准》整理成「知识块 / 知识点」清单，并链接官方原版 PDF |
| 错题本 / 学习报告 | 错题自动收录并由大模型判定考查的大纲知识点，**按知识点分组**展示（错得最多的排在最前）、重做答对后标记已掌握、各级别正确率、模拟考试成绩趋势 |
| 账号体系 | 用户名 + 密码注册登录（学生多半没有邮箱），scrypt 加盐哈希、服务端会话、失败锁定；每个学生的成绩分开保存 |
| 金币 | 每做对一道新题立刻按得分发金币（默认每 1 分 = 0.3 枚，管理员可改，金币可带小数），一道题只发一次；兑换奖励后可扣除金币，全部记入可追溯的流水 |
| 数据备份 | 每天首次启动自动备份（保留 30 份），可随时下载备份、从备份恢复，换电脑时带走全部记录 |

## 技术栈

- **Electron 45** 外壳：主进程用 `utilityProcess` 启动内置的 Next.js 服务（只监听 `127.0.0.1`），窗口加载本地页面
- **Next.js 16**（App Router、Cache Components、standalone 输出）+ React 19 + TypeScript
- **SQLite**：Electron / Node 自带的 `node:sqlite`（Bun 脚本里用 `bun:sqlite`），**不含任何原生数据库模块**；Drizzle ORM + drizzle-kit 迁移，启动时自动迁移
- **Tailwind CSS v4** + **shadcn/ui**（Base UI）+ Framer Motion 动效 + next-themes 深色模式
- **Vercel AI SDK**（`useChat` 流式 UI）+ **LangChain**（`@ai-sdk/langchain` 适配器接入任意 OpenAI 兼容模型）
- 代码评测：本机 g++ / clang++（Windows 安装包内置 [w64devkit](https://github.com/skeeto/w64devkit) GCC），可选 Judge0
- **electron-builder** 打包 NSIS 安装包与 DMG；**Bun** 作为包管理与脚本运行时

## 开发与打包

```bash
bun install
bun run dev                    # 浏览器里开发：数据库 data/gesp.db，首次访问自动建表并导入内置题库
bun run desktop:dev            # next build 后用 Electron 打开（不打包）
bun run desktop:build          # 打包当前平台
bun run desktop:build --mac --win   # 在 macOS 上同时打包 macOS（arm64 + x64）与 Windows（x64）
```

产物在 `dist-desktop/release/`。打包流程、目录结构与各种取舍见 [DESKTOP.md](DESKTOP.md)。
在 macOS 上打 Windows 包需要 7-Zip 解压编译器（`brew install sevenzip`），不需要 Wine。

开发时可选的环境变量（写进 `.env.local`）：

| 变量 | 用途 |
| --- | --- |
| `GESP_DB_PATH` | 数据库文件，默认 `data/gesp.db` |
| `SETTINGS_SECRET` | 加密后台保存的 API key；不设则在数据库旁自动生成 `secret.key` |
| `ZAI_BASE_URL` / `ZAI_API_KEY`、`AI_MODEL` / `AI_VISION_MODEL` / `AI_EMBEDDING_MODEL` | 未在后台配置大模型时使用的 OpenAI 兼容接口与模型 |
| `JUDGE_PROVIDER=local\|judge0`、`JUDGE0_URL`（+ `JUDGE0_RAPIDAPI_KEY` / `JUDGE0_AUTH_TOKEN`）、`CXX` | 代码评测；后台「代码评测」的设置优先 |

## 更新题库

「系统设置 → 更新题库」的**一键更新**会抓取官网真题列表，与数据库比对，然后逐份导入：

- **新考试**指比题库中最新一场更晚的考试；默认导入题库已有的级别（题库为空时导入最新一场的全部级别）。
  往期缺失的试卷列在折叠区里，可勾选后「导入所选」。也可以只点「只检查」先看看。
- 每份试卷一次请求（约 1 分钟）：下载 PDF → 渲染页面 → 视觉模型转录 → 校验 → 写库 → 生成向量，
  页面逐份调用并显示进度，因此需要保持页面打开。需要联网，并在「大模型设置」里配好**视觉模型**。
- **答案不只靠模型**：单选答案直接从 PDF 文字层的答案表读取；判断题的 √/× 是矢量图形，
  会单独裁出答案表的高清图让模型只读这 10 个符号。两者都会覆盖模型在整页转录时给出的答案
  （用历年 106 份试卷验证：除官网链接放错文件的 1 份外，与人工录入的答案逐题一致）。
- **校验**：不是「15 单选 + 10 判断 + 2 编程、共 100 分」或题号重复的试卷只存为草稿，学生看不到；
  草稿可在卡片里「重新解析」或确认后「发布」。已发布的试卷不会被覆盖。
- 程序里导入的试卷只写进本机数据库，随「数据备份」一起保存。想把新试卷也存进仓库、随下一个版本发布，
  在开发环境运行 `bun run update`，它会同时写 `data/sources.json`、`data/pdf/` 与 `data/papers/`。
- 新导入的编程题只有样例测试点，隐藏测试点仍需 `bun run gen-tests <paperId>`。

## 考试大纲与知识点

官网「认证资料 → 认证大纲」只有一份 PDF（C++ & Python，一至八级）。`bun run syllabus` 或
「系统设置 → 考试大纲」会把它变成按级别组织的知识点清单：

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

真题库每个级别下附有该级的大纲摘要，`/syllabus/<N>` 是完整清单（登录后还会显示每个知识点上有几道自己的错题）。

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

GESP 的学生多是中小学生，常常没有邮箱，因此系统使用**用户名 + 密码**账号；一台电脑上可以有多个学生各自注册。

- 密码用 `node:crypto` 的 **scrypt**（N=32768）加随机盐哈希，参数随哈希一起存储，日后可提高强度而不作废旧密码；验证用 `timingSafeEqual`。
- 会话存在服务端 `sessions` 表，Cookie 里只放随机令牌，库中只存它的 SHA-256，因此即使数据库泄露也拿不到可用会话。Cookie 为 HttpOnly + SameSite=Lax（桌面版只在本机 http 上服务，不加 Secure）。
- 连续 8 次密码错误锁定 15 分钟；用户名不存在时也会走一次等长的哈希计算，避免用响应时间探测用户是否存在。
- **系统中注册的第一个账号自动成为管理员**，可在「系统设置」修改金币兑换比例、配置大模型与代码评测、备份数据、重置学生密码。

### 大模型设置

「系统设置 → 大模型设置」可填写接口地址、API key 与讲解 / 视觉 / 向量三个模型名，保存后立即生效。AI 讲解、错题知识点归类、更新题库与相似题向量都用这份配置；**不配置时其余功能照常可用**。

- 优先级：后台配置 → 环境变量 `ZAI_BASE_URL` / `ZAI_API_KEY`（开发时）。
- 模型名要填服务商的模型 ID：智谱是 `glm-4.5v`，SiliconFlow 则是 `zai-org/GLM-4.5V`。填错时「更新题库」会报 `Model does not exist`。
- 智谱与 SiliconFlow 会自动关闭模型的思考模式（讲解更快；解析一份试卷从约 2.5 分钟降到 1 分钟）。
- API key 用 AES-256-GCM 加密后存进 `app_settings`。密钥不在数据库里：每台电脑首次启动时随机生成，保存在数据目录的 `secret.key`
  （开发时可用环境变量 `SETTINGS_SECRET`），单独拿到 `gesp.db` 解不出 key；页面与接口只返回末 4 位。
- 「测试连接」用表单里的值发一次极短的请求，key 留空则用当前生效的 key。

金币采用**流水账**（`coin_transactions`）而非存一个余额字段：余额始终是流水求和，可追溯每一笔变化。

- 发放：**按题结算**，一道题判分的那一刻就按 `得分 × 比例`（默认 0.3）发放。客观题在提交答案时结算，
  编程题按**第一次提交评测**的得分结算，模拟考试里的客观题在交卷时一起结算。
- **一道题只结算一次**：判分时写入 `question_rewards`（答错也写，分数记 0），复合主键
  `(user_id, question_id)` 在数据库层保证重做 —— 包括从错题本点进去再做一遍 —— 都不会再发金币。
- **金额可带小数**（精确到 0.001）：2 分的客观题按 0.3 就是 0.6 枚，一分不少地直接入账，
  不取整也不留零头，所以每做对一道题余额和明细都会立刻变化。
- 每次结算、扣除都是一个**同步的 SQLite 事务**（`BEGIN` 与 `COMMIT` 之间没有 `await`），
  其他请求的语句不可能插进来；扣除用 `BEGIN IMMEDIATE` 先拿写锁再校验余额，余额不足直接拒绝，不会出现负数。

## 备份与恢复

题库随程序发布（`data/papers/*.json`），数据库丢了重新导入即可；但账号、作答记录、成绩、错题、金币流水、AI 对话和后台设置
**只存在这台电脑的 `gesp.db` 里**，所以程序自己做备份：

- **自动**：每天第一次启动时备份到数据目录的 `backups/`，保留最近 30 份。
- **手动**：「系统设置 → 数据备份」可「立即备份」、下载任意一份备份、「从文件恢复」或恢复列表里的某一份。
  恢复前会先把当前数据再备份一份（类型「恢复前」），所以恢复本身也可以撤销；较旧版本的备份恢复后会自动升级表结构。
- 备份用 SQLite 的 `VACUUM INTO`，程序运行中也能得到一致的副本。

换电脑：在旧电脑下载一份备份，新电脑安装后注册任意账号进入「系统设置 → 数据备份 → 从文件恢复」，然后用原来的账号登录。
后台保存的大模型 API key 是用旧电脑的 `secret.key` 加密的，换电脑后需要重新填写一次（或把 `secret.key` 一起复制到新电脑的数据目录）。

备份里含账号密码哈希与学生记录，不要上传到公开位置。

## 安全设计

- **答案与测试数据不出服务端**：`question_keys`、`test_cases` 只在服务端读取；返回给页面的题目类型（`src/lib/types.ts`）不含答案字段。
- **判分一律在服务端**：客观题走 `/api/answers/check`，模拟考试交卷走 `/api/attempts/finish`，编程题得分取该次考试的最佳提交，前端无法伪造成绩。
- **只在本机提供服务**：内置服务只监听 `127.0.0.1`，同一局域网的其他电脑访问不到；本机评测不加沙箱运行学生自己的代码，
  这正是本机评测的用途，但也因此不能把这个服务暴露到网络上（需要多人共用时改用 Judge0）。
- **鉴权在每个 Route Handler 内完成**，窗口里打开的外部链接（官网、PDF）一律交给系统浏览器。

## 项目结构

```
desktop/                Electron 主进程（main.ts）、打包配置、图标、冒烟测试
src/
  app/                  页面与 Route Handlers（/api/run、/api/submit、/api/tutor …）
  components/           UI（question/ 题目与 IDE、paper/ 考试与成绩、tutor/ AI 讲解、admin/ 系统设置）
  db/                   Drizzle schema、SQLite 驱动适配、启动时的迁移与题库导入、备份文件
  lib/
    ai/                 模型接入（LangChain）与讲解提示词
    judge/              评测：本机编译器（自动检测）/ Judge0，评测设置
    backup.ts           备份、下载与恢复
    content.ts          题库读取（公开接口不含答案）+ 相似题
    papers/             官网抓取、PDF 渲染、视觉模型解析、导入（脚本与「更新题库」共用）
    syllabus/           官方考试大纲：抓取、按级别切分、解析知识点、导入与读取
    knowledge/classify  判定一道题考查哪个大纲知识点（错题本分组用）
    schema/             试卷与考试大纲 JSON 的 zod schema
scripts/                crawl / parse / seed / syllabus / update / gen-tests / embed / backup
scripts/desktop/        打包：build.ts、prepare-db.ts、copy-monaco.mjs、make-icon.ts
drizzle/                SQLite 迁移
data/                   sources.json、papers/、syllabus/（随程序发布）
```

## Web 版

原来部署在 Vercel + Supabase 上的网站版本在 `main` 分支，两者功能相同；本分支把数据库换成了 SQLite，并去掉了 Supabase 相关的配置。

## 数据流水线（开发者）

这些命令在仓库里运行（`GESP_DB_PATH` 指定数据库，默认 `data/gesp.db`），用于维护随程序发布的题库。

| 命令 | 作用 |
| --- | --- |
| `bun run crawl` | 解析官网真题列表（含分页），下载全部 C++ 试卷 PDF，写入 `data/sources.json` |
| `bun run parse [paperId...] [--level N] [--force]` | 用视觉模型把 PDF 转成结构化 JSON。PDF 的公式是矢量图形，文字层会丢失，因此同时送入**页面文字层**（保证代码与文字准确）和**页面图片**（补全公式、答案表格、版面） |
| `bun run seed [paperId...] [--draft]` | 幂等导入数据库；`--draft` 只导入不发布（程序启动时会自动导入内置题库，一般不需要手动运行） |
| `bun run update [--level N] [--all-missing] [--draft] [--dry-run]` | 命令行版「一键更新题库」：检查官网新考试 → 下载 PDF → 解析 → 写 `data/papers/` → 导入发布 |
| `bun run gen-tests <paperId...> | --all` | 让模型为编程题写数据生成器，用官方参考程序产出隐藏测试点（先校验参考程序能复现官方样例，否则跳过该题） |
| `bun run syllabus [N...] [--reuse] [--no-seed]` | 下载官方认证大纲 PDF，按「C++ 编程N级标准」切分章节，逐级整理知识点 → `data/syllabus/l<N>.json` 并入库；`--reuse` 直接用仓库里的 JSON 重新入库（不调模型），`--no-seed` 只写文件 |
| `bun run embed [--force]` | 生成题目向量，用于 AI 讲解时参考相似题（程序里是「系统设置 → 相似题向量」） |
| `bun run render-pdf <file.pdf> <outDir>` | 调试：导出 PDF 每页的图片与阅读顺序文字 |
| `bun run backup` | 备份数据库（`VACUUM INTO`，见下文「备份与恢复」） |
| `bun run db:prepare <file.db>` | 新建数据库：执行迁移并导入内置题库与大纲 |

`parse` 的结果建议人工抽查后再 `seed` 发布——公式和样例空格最容易出错。

## 版权

真题版权归 **CCF GESP** 所有，来源：<https://gesp.ccf.org.cn/101/1010/index.html>。本项目仅供学习交流使用。
