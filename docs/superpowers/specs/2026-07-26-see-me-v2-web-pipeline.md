# See Me v2 — 管线化改造开发方案（交接版）

> **改名（2026-07-26 晚）：产品已更名 `Fathom`（中文名「潜心」），域名方向 `fathomlog.com`。**
> 本文档与 v1 spec 的**文件名保留旧名不改**——它们是带日期的历史档案，且长期记忆按路径引用。
> 正文中的「See Me」一律读作 Fathom。刻意未改名的还有：数据库名 `see_me` / 用户 `seeme`
> （改名要在生产库 dump-restore，收益为零）、本地 `~/.seeme-pgdata`（三周真实种子数据在里面）、
> iOS bundle id `com.outsiderrr.seeme`（App 已冻结）、服务器路径 `/opt/see-me`（见 compose 里
> 钉死 project name 的原因）。

> 状态：设计已与用户逐项确认，待开发。本文档为**新会话交接文档**，自足可开工。
> 日期：2026-07-26
> 前置：`2026-06-21-see-me-mvp-design.md`（v1 spec）——其中**数据模型（§2）、权限语义（§3）、防泄漏红线（§4）、邀请码（§5）、鉴权（§6）全部继续有效**；本文只描述 v2 的形态变更与增量。
> 长期记忆：`~/.claude/projects/-Users-outsider-Desktop-see-me/memory/`（架构/环境坑/用户风格）与本文互为补充。

## 0. v2 一句话定位

See Me = 用户全部思考残留物（语音随想、AI 对话、随手记）之上的**选择性发布层**：
Mac 端采集提炼 → 网页控制台审校打标签（打标签 = 发布决策）→ 两种邀请卡对外 → 读者零压力来看。

核心价值不变：「我允许你更了解我，但你没有义务现在了解，也没有义务回应。」
刻意没有的东西不变：无推送、无点赞、无评论、无已读、无阅读统计、无社交广场。

## 1. 已拍板的决策清单（v1 → v2）

| # | 决策 | 内容与理由 |
|---|---|---|
| 1 | **iOS App 冻结** | 采集已外移（语音备忘录+ChatGPT），A 剩下的是批量审校=桌面活。`ios/` 代码保留不删（Direction A 纸页设计可复活），TestFlight 流程作废，不交 $99 年费。 |
| 2 | **A 端 = 网页控制台** | vanilla JS（用户强项），同一 Hono 服务托管在 `/console`，纸页设计系统，响应式（手机浏览器可凑合用）。 |
| 3 | **卡分两型** | **免登录卡**（open）：`https://域名/c/<14位slug>` 有链接就能看，无 CardHolder，彻底无读者记录；**登录卡**（现有）：手机 OTP + 8 位码，CardHolder 保留。 |
| 4 | **录音只转文字** | whisper.cpp 本地转写，原始音频不上传（音频笔记功能明确搁置）。 |
| 5 | **ChatGPT 记录走 Codex 扒取** | 用户自有 Codex 流程产出 markdown（格式契约见 §5），官方导出被否（全量导出不好用）。管线从文件开始接手，与扒取解耦。 |
| 6 | **AI 提炼成原子笔记** | 全文不进库（会压垮 flomo 式阅读流）；Claude API 提炼 1~N 条原子笔记入库，原文留本地湖。 |
| 7 | **无标签 = 私有收件箱** | 导入的笔记不带权限标签入库（分享必须有必含标签 ⇒ 无标签笔记任何卡都看不到，天然安全）。控制台「收件箱」= 无标签笔记队列，打标签才可能被看到。溯源用 `#录音` `#对话` 标签。 |
| 8 | **created_at = 录入时刻** | 沿 v1 spec §2.1 既定语义；回填历史日期会导致冻结卡权限被动扩大，禁止。录音原始日期写进笔记首行。 |
| 9 | **数据湖在 Mac 本地** | `~/SeeMeLake/`（**必须在 iCloud 同步范围之外**），纯文件夹：`voice/` `chats/` `distilled/`。涌现分析将来直接读湖；服务器是纯发布层。**不做 export 回流**（backlog），灾备靠 pg_dump。 |
| 10 | **涌现分析暂不做** | 语料先积累；已用真实三周数据试跑过一次分析验证价值（见对话记录），格式契约由此确认。 |
| 11 | **仓库已公开** | github.com/outsiderrr/See-Me；绝不入库：`.env`、服务器 IP+密钥组合、任何真实密钥。 |
| 12 | Markdown 轻结构已落地 | 正文存 markdown；iOS 用 MarkdownUI（冻结前已做）、B web 用 markdown-it（html:false 防 XSS、**image 语法禁用**——防作者借外链图片收集读者访问信号，红线延伸）。控制台复用同配置。 |

## 2. 现状盘点（截至 2026-07-26，main = 7bfdc7c）

**已完成且可运行**：
- 后端 M0–M4：Hono + Prisma 6 + Postgres；OTP 登录、笔记/标签 CRUD（含编辑/删除/搜索）、卡+Share 交集排除权限引擎（带针对性测试 ✅）、兑换限流、owner-preview。
- B 端阅读网页（vanilla JS，markdown-it 渲染）。
- iOS App v0.01（**冻结态**）：纸页 Direction A 全套 UI、快速建卡、收件卡侧栏等，模拟器验证过；bundle id `com.outsiderrr.seeme`；未上 TestFlight。
- 部署栈（已合并，**未实测 Docker 构建**——本机无 Docker）：`docker-compose.yml`（postgres:18 + app）、`backend/Dockerfile`、`DEPLOY.md`（服务器手册）、`backend/src/main.ts` 生产入口（修了 `npm start` 静默不启动 bug）。
- 本地开发：`npm run dev`（embedded-postgres，数据目录经 `PGDATA_DIR=~/.seeme-pgdata` 放 iCloud 外）。

**进行中（用户侧 ops）**：
- 东京轻量应用服务器（8G 内存/70G 盘）**尚未部署**——用户照 `DEPLOY.md` 操作；仓库已公开，clone 不再需要 token。
- 域名未买（免登录卡链接的前置）；阿里云短信签名未办（登录卡对陌生人可用的前置，绕法见 v1 spec §1.1：个人微信订阅号做签名来源）。

**明确不做/冻结**：iOS 继续开发、TestFlight、原音频上传、涌现分析（暂）、export 回流（backlog）、读者侧任何 AI、per-note 反向可见性查询。

## 3. 红线（全文继承 v1 spec §4，此处重申要点 + v2 增量）

1. 读者只见 **Share 显示名**；作者内部标签名（必含/排除）绝不外泄。
2. 可见性只在后端实时算；读者 DTO 列白名单（无 updated_at、无标签名）。
3. 无阅读信号回传；A 端无读者可见面（免登录卡更进一步：连数据层都没有读者记录）。
4. 图片与正文同一套实时权限校验；**markdown 的 image 语法在所有渲染端禁用**（防外链追踪泄露阅读信号）。
5. 标签删除 ⇒ 引用它的 Share 整条删除；权限只收紧。
6. **免登录路由只认 `kind='open'` 的卡**；登录卡走不到免登录路径（IDOR 红线在新路径同样成立）。
7. 权限引擎改动必须带针对性测试（本项目唯一强制测试区）。

## 4. 目标架构

```
手机快捷指令录音（语音备忘录） ──AirDrop 周批──▶ ~/SeeMeLake/voice/
ChatGPT ──用户的 Codex 扒取──▶ ~/SeeMeLake/chats/      （格式见 §5）
                                    │
                          tools/import CLI（P4）
                          whisper.cpp 转写 + Claude API 提炼
                          提炼稿副本 → ~/SeeMeLake/distilled/
                                    │ POST /api/notes（无标签）
                                    ▼
                东京服务器 Docker：Hono + Postgres
                ├── /console   A 控制台（P3，vanilla JS）
                ├── /          B 登录阅读（现有）
                ├── /c/<slug>  B 免登录阅读（P2）
                └── /api/*     JSON API
                                    │
涌现分析（将来）：Claude Code/Codex 直接读 ~/SeeMeLake/，不经服务器
```

湖只进不出；服务器灾备 = `docker compose exec db pg_dump -U seeme see_me`。

## 5. 导入格式契约（依据 Codex 实测产出，样本见 `/Users/outsider/Desktop/实验室/记录汇总/`）

**对话（chats/）**：一会话一 `.md`。头部列表含：项目、项目内顺序、网页显示时间、对话链接、可选附件/说明行；正文按 `## 第 N 条可见消息` / `## 第 N 轮` 分节，节内 `### 用户` / `### AI` 区分角色。
**录音（voice/）**：一录音一 `.md`。头部含：录音日期、时长、源文件路径、转写方式；正文 `## 自动转写正文`；可选 `## 识别说明`（不确定处用方括号标注）。
**周报**（`2026-Wnn.md`）：索引+摘要+未解决事项。

**导入器约定**：
- 解析宽松（字段缺失不崩，按文件名/mtime 兜底）；
- 提炼：优先整会话/整录音 → 1~N 条原子笔记；方括号不确定段**不得进入提炼产物**；
- 对话中「用户」消息是本人表达、「AI」消息是外部内容——提炼以用户表达为主，AI 观点仅在用户明确认可时以「认可了……」形式引用；
- 幂等：湖内已导记录用 state 文件（`~/SeeMeLake/.import-state.json`）记录指纹，重复运行不重复入库。

## 6. 分阶段计划（每阶段附验收）

**P1 · 服务器 + 域名 + HTTPS**（用户 ops 为主）
用户按 `DEPLOY.md` 起栈；买域名解析；compose 加 Caddy 服务（80/443，自动证书），app 不再直接暴露 80。
✓ 验收：`https://域名/` 打开 B 端登录页；`curl` 注册登录链路通（验证码看 `docker compose logs app`）。

**P2 · 免登录卡**（纯本地可开发，**建议首个动工**）
- 迁移：`Card.kind`（'private' 默认 | 'open'）+ `Card.public_slug`（14 位、字符集同邀请码 `[2-9A-HJ-NP-Z]`、唯一、仅 open 卡有值）；
- `POST /api/cards` 接受 kind；轮换端点同时轮换 slug；
- 新路由：`GET /public/:slug`（header）、`/public/:slug/notes`（keyset 分页同 §3.2 契约）、`/public/:slug/images/:id`——无鉴权、按 IP 限流（复用 rateLimit）、`X-Robots-Tag: noindex`；
- B web：`#/c/<slug>` 免登录阅读路由（复用卡渲染）；
- 权限测试扩展：open 卡可匿名读、private 卡 slug 查询 404、读者 DTO 白名单在公开路径同样成立。
✓ 验收：测试全绿；无痕浏览器开链接能读；轮换后旧链接 404。

**P3 · A 控制台 `/console`**（核心工作量）
vanilla JS + 纸页 CSS（tokens 见 §7）。功能清单（对齐冻结 App 的全集）：
OTP 登录（配 `tools/see-me-otp` ssh 捞码脚本）／库流（markdown、日期分组）／写·编辑·删除·搜索／**收件箱**（无标签笔记队列，逐条打标签-合并-删除）／标签管理（置顶/改名/双模式删除）／卡管理（快速建卡默认「1 标签=1 分享·分享名=标签名」、免登录/登录选型、高级交集排除、详情/轮换/推进/收回/预览）／**邀请图片生成**（canvas 纸页风格：卡名+链接二维码或 8 位码，下载 PNG 发社交媒体；QR 用 vendored MIT 小库）。
✓ 验收：headless 浏览器全流程走查 + 截图；权限语义与 App 版一致。

**P4 · 导入 CLI `tools/import/`**（node）
`see-me import voice <dir>`：.m4a → whisper.cpp（文档写明模型安装）→ 提炼 → 无标签入库（`#录音`）＋湖内留档；
`see-me import chat <dir>`：按 §5 契约解析 → 提炼 → 无标签入库（`#对话`）；
提炼用 Claude API（**实现时先读 claude-api skill 确认当前模型 id**）；幂等；失败单条跳过并汇报。
✓ 验收：用 `实验室/记录汇总` 的真实三周数据全量跑通，收件箱可审校。

**P5 · 收尾与 backlog**
阿里云短信签名（用户 ops）→ `aliyun` 驱动；pg_dump 定时备份；backlog：export 回流、涌现分析、See Me MCP server、音频权限流。

## 7. 纸页设计系统 tokens（控制台用，源自 `ios/SeeMe/Theme.swift` 与 `backend/public/style.css`）

| token | light | dark | 用途 |
|---|---|---|---|
| paper | #FBF6EE | #171511 | 页面底 |
| raised | #FEFBF5 | #232019 | 浮起面（编辑器/弹层） |
| ink | #282320 | #ECE6DC | 主文字 |
| soft | #7B7267 | #9C9485 | 次级文字 |
| faint | #AEA69A | #6F6960 | 弱文字/占位 |
| clay | #9A6040 | #CA8F68 | 品牌/标签/链接 |
| brick | #9A4A3C | #CD7D6B | 危险操作 |
| rule | ink @ 12% | ink @ 14% | 细分隔线 |

正文衬线（Georgia/Songti SC），meta 用系统无衬线；结构靠细线+留白，不堆卡片不堆胶囊；圆角小（8-12px）；几乎无阴影。

## 8. 环境与操作事实（新会话必读）

- 仓库：`/Users/outsider/Desktop/see me`（main）。**在 iCloud Desktop 内**——「优化 Mac 储存空间」已关闭（2026-07-02 曾发生大规模文件驱逐事故，已全量修复）；**数据库/大二进制绝不放仓库内**。
- 本地后端：`cd backend && npm run dev`（embedded-postgres 数据在 `~/.seeme-pgdata`，经 `.env` 的 `PGDATA_DIR`；Hono :3000；OTP 打终端）。sandbox 会挡 Prisma 引擎下载与 PG 启动，用 dangerouslyDisableSandbox。
- 本机 curl 一律 `--noproxy '*'`（系统代理会劫持 localhost；代理开关状态随用户网络变化）。
- git 备份 bundle：`~/seeme-git-backup.bundle`，大改后 `git bundle create ~/seeme-git-backup.bundle --all` 刷新。
- 测试账号：A `+8613500009001`（林之）、B `+8613500009002`、C `+8613500009003`（苏晓）；本地库已有三周真实种子数据。
- 用户风格：不要 TDD/仪式（权限引擎除外）、feature-driven、完成即 commit、收尾走 PR + `gh pr merge` 自动合并、vanilla JS/Swift 强项。

## 9. 明确不做（v2）

iOS 继续开发；原音频上传与音频权限流；涌现分析（本期）；export 回流；官方 ChatGPT 导出；读者侧 AI；per-note 反向查询；A 端持卡人可见面；公开卡的阅读统计（连免登录 PV 都不做——零信号是产品哲学，不是技术欠账）。
