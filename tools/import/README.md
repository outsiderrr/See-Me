# tools/import —— P4 导入器

纯 `.mjs` 零构建零依赖（node ≥ 18）。管线（设计权威见
`docs/superpowers/specs/2026-07-26-see-me-v2-web-pipeline.md` 与状态文档 §2）：

```
原始/ ──[用户把 PROMPT.md 交给自己的 agentic AI]──▶ 库/*.md
      ──[import.mjs check（Mac，全量校验）]──▶
      ──[upload.sh：scp 上服务器 → server-ingest.sh 在服务器对 localhost 入库]──▶
      控制台收件箱（无标签笔记队列）等审校打标签
```

## 文件

| 文件 | 跑在哪 | 干什么 |
|---|---|---|
| `import.mjs check` | Mac | 全量校验（要读湖里 `原始/` 做逐字比对），不碰网络 |
| `import.mjs ingest` | 服务器（app 容器内） | 结构校验 + state 判重 + POST localhost 入库 |
| `upload.sh` | Mac（**用户跑**，Claude 到服务器 SSH 不通） | 一键：check → scp → ssh 入库 → state 拷回湖 |
| `server-ingest.sh` | 服务器 | dev OTP 自动捞码换 token → 容器内跑 ingest |
| `parse.mjs` | Mac | 解析原始素材，只给 check 的逐字比对用 |
| `PROMPT.md` | —— | 正式版提炼提示词，交给用户自己的 AI |

## 一次导入的完整流程

```bash
# 0)（仅首次）把服务器地址和手机号放湖里——刻意不进公开仓库：
#    ~/通用空间/潜心/.import-config.json
#    {"server": "admin@<服务器IP>", "phone": "+86..."}

# 1) 提炼：把 PROMPT.md 交给你的 AI，产出 库/2026-Wnn.md（AI 会自跑 check）

# 2) 一键上传入库（会先在本地重跑 check，不过不上传）：
tools/import/upload.sh                # 默认取 库/ 里最新的 .md
```

上传刻意走 `scp + 服务器对 localhost`：服务器还是明文 HTTP，
私人笔记不从本机 POST 裸奔穿公网（P1 上了 HTTPS 也不亏，少一条路径暴露）。

## 入库的笔记长什么样

```markdown
> 录音 2026-07-06 · 语音备忘录/2026-W27/raw/01-北京路.md

**一句话标题**

正文。
```

- 首行 blockquote = 溯源（决策 8：原始日期进首行；§2.3 决议：溯源走首行**不打标签**，
  `#录音` 标签会让笔记永远进不了收件箱）
- 标题用加粗不用 `##`：流式阅读里 h2 太重
- `created_at` = 入库时刻，**绝不回填** `dated`（决策 8 红线：回填会让冻结卡权限被动扩大）
- `suggest` 本轮不上传（没有存它的列）
- 改这个形态去 `import.mjs` 的 `renderNoteBody`——它决定所有后续导入笔记的样子

## 幂等语义（state 文件是唯一的"导过"记忆）

state 在湖里：`~/通用空间/潜心/.import-state.json`（`source+标题+正文` 的指纹）。

- 重跑：已导过的直接跳过
- **控制台里删掉的笔记不会复活**——这正是用 state 而不是查服务器判重的原因
- state 丢了：兜底比对服务器现存正文，不重复入库，自动补记 state
- 库文件里某条改了内容：跳过并提示（旧版已导过；更新去控制台改，导入器不覆盖）

## 校验都查什么

字段完整（source/kind/dated/标题/正文）、kind 与 source 目录一致、方括号残留、
原始素材里的不确定段混入、成段照抄（连抄 120 字=错误；整条是原句时只警告——
原话足够凝练就没问题）、链接/图片语法（红线）、suggest 词表、条目重复、
被引用周里没出笔记的素材（提示，防漏）。

## 排错

- OTP 限流：请求 5 次/10 分钟，稍等再跑
- 切了 aliyun 短信驱动后 `server-ingest.sh` 捞不到码：把捞 CODE 那两行换成 `read` 手输
- `upload.sh` 半途失败：state 已尽量拷回，修好直接重跑（幂等，不会重复入库）
