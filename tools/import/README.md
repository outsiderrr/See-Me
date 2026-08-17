# tools/import —— P4 导入器

纯 `.mjs` 零构建零依赖（node ≥ 18）。管线（设计权威见
`docs/superpowers/specs/2026-07-26-see-me-v2-web-pipeline.md` 与状态文档 §2）：

```
原始/ ──[用户把 PROMPT.md 交给自己的 agentic AI]──▶ 库/*.md（主题笔记）
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
| `raw.mjs check` | Mac | **原始材料层**：从 `周报/<week>/<week>-标签.json` 回溯 `原始/` 正文、拦红线/假日期/路径逃逸、产自足 payload |
| `raw.mjs ingest` | 服务器（app 容器内） | POST /api/raw/import（幂等 upsert，重传=刷新） |
| `raw-upload.sh` | Mac（**用户跑**） | 一键：check → scp → ssh 入库；payload 走临时目录、trap 清场 |
| `raw-server-ingest.sh` | 服务器 | 同 server-ingest.sh 的 OTP 姿势 → 容器内跑 raw.mjs ingest；无 state 回拷 |

### 第二条管线：原始材料层

展示层管线（上面）把 AI 提炼的**笔记**送上服务器；原始材料管线把**原始单元本身 +
标签**送上服务器做备份与索引（服务端 `raw_units` 表，结构上进不了任何分享）。区别：

- 幂等锚是 `source`（相对 `原始/` 的路径 + `#第N条` / `#任务轮次N` 判别符），重传=刷新，
  **没有 state 文件**——备份镜像语义，也不存在"删过的不复活"问题（控制台不能删原始单元）。
- 服务端硬拒 `发布-*` 与「可分享」标签，一个坏单元整批打回；标签名先 NFKC 归一再判红线。
- 标注口径见 `docs/标签口径.md`（暂行）。

```sh
tools/import/raw-upload.sh                              # 取 周报/ 里最新的 <week>-标签.json
tools/import/raw-upload.sh ~/通用空间/潜心/周报/2026-W31/2026-W31-标签.json
```

## 一次导入的完整流程

```bash
# 0)（仅首次）把服务器地址、登录邮箱、suggest 词表放湖里——刻意不进公开仓库
#    （词表 = 作者内部标签名，属红线信息）：
#    ~/通用空间/潜心/.import-config.json
#    {"server": "admin@<服务器IP>", "email": "你@邮箱（小写）", "tags": ["标签1", "标签2"]}

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

`topic` 作为结构化字段单独入库，不重复塞进正文。阅读端按它聚合同一话题；
历史笔记没有 `topic` 时，会从上面的溯源路径自动归到同一原始素材名下。

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
- state 丢了：兜底比对服务器现存正文，不重复入库，自动补记 state。**兜底只认逐字
  未改的笔记**：控制台里改过正文的，state 丢失后重跑会再导一条原版（新旧并存）；
  删过的会复活。所以湖里的 state 要跟着湖一起备份
- 库文件里某条改了**正文**：跳过并提示（旧版已导过；更新去控制台改，导入器不覆盖）；
  改了**标题**：会被当成新记录再导一条——所以已导批次的文件别回头改（PROMPT 同款红线）

## 校验都查什么

字段完整（source/kind/dated/标题/正文）、kind 与 source 目录一致、方括号残留、
原始素材里的不确定段混入、成段照抄（连抄 120 字=错误；整条是原句时只警告——
原话足够凝练就没问题）、链接/图片语法（红线）、suggest 词表、条目重复、
被引用周里没出笔记的素材（提示，防漏）。

## 服务器上留下什么

尽量什么都不留：库文件固定传成 `~/fathom-import/upload.md`（每次覆盖，ingest 完
即删）；state 拷回湖后也从服务器删掉（里面的标题就是笔记内容）；容器内 /tmp 副本
每次清场；token 用 trap 保证任何退出路径都 logout。原始材料管线同理：payload 固定传成
`~/fathom-import/raw-upload.json`，`raw-server-ingest.sh` 的 trap 在**任何**退出路径
（含 OTP 限流早退）都删掉它并清容器副本。宿主上长期存在的只有 `~/fathom-import/` 下的
四个脚本：import.mjs、server-ingest.sh、raw.mjs、raw-server-ingest.sh。

## 排错

- OTP 限流：同一邮箱 5 次/10 分钟（另有 IP 与全局桶），稍等再跑
- 配了真发信后 `server-ingest.sh` / `raw-server-ingest.sh` 捞不到码，会提示你从邮箱里读出来手输
- 切了 aliyun 短信驱动后捞不到码：把捞 CODE 那两行换成 `read` 手输
- `upload.sh` 半途失败：state 已尽量拷回，修好直接重跑（幂等，不会重复入库）
- `raw-upload.sh` 半途失败：直接重跑（幂等，重传=刷新）；`check` 报错时 0 个单元上传
