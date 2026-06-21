# See Me — MVP 技术设计 (v4,分享模型 = 交集+排除)

> 状态:设计已与用户确认 + 权限模型经 4 路对抗式审查加固;后端 + B 网页已实现并验证
> 日期:2026-06-21
> v4 变更(分享模型重做):卡的授权单位从「标签并集」改为「**分享(Share)**」。一个分享 =
>   `必含标签(AND) + 排除标签(NOT)` + 显示名 + 是否自动更新;一条 note 经某分享授权 ⟺
>   含该分享全部必含标签 ∧ 不含任何排除标签 ∧(分享自动更新 或 note ≤ 截止点)。卡 = 各分享的并集。
>   读者看到的 tab/chip 是**分享显示名**,构成它的标签永不外泄。原「并集模型」= 每个分享只有 1 个必含标签。
>   数据层 `CardTag` → `Share` + `ShareTag`。并入实现期对抗式审查的修订(游标 µs 精度、畸形游标不崩、
>   兑换多层限流 per-user+per-IP+global、兑换不暴露卡存在性、限流计数钳制、邀请码空间实为 31^4≈923K)。
> v2 变更:并入 16 条审查修订(详见 §3–§6 红线)。两处产品语义经用户拍板:
> (1) 标签 tab/chip 按「经由该标签授权」显示(非全局 V 过滤);
> (2) 持卡人信息数据层保留、MVP 产品层 A 不可见。
> v3 变更:平台形态定稿 = A 端 SwiftUI 原生 iOS + B 端 vanilla JS 网页 + 后端 Hono(Node/TS)+ Postgres(东京 ECS)。
> 产品/数据/权限语义(§2–§9)与端无关,全部不变;仅 §1 技术栈、§10 构建顺序按新架构改写。
> 方法论:按产品功能直接推进(用户指定,不走 TDD/多 agent 评审仪式;权限引擎保留针对性测试)。

## 0. 核心假设(产品成败全看它)

人愿不愿意把「想被了解」从"推送给别人、索取反馈"换成"放在那里、等人主动来看、不要任何回应"。MVP 唯一目的是验证它,不追求功能完整。

一句话定位:一个**没有压力的、可分组授权的朋友圈**。A 把想被了解的那部分自己写进个人文本库,用标签控制谁能看哪些内容;B 在自己好奇时主动来看——不推送、不通知、无点赞评论、读者无回应义务。

## 1. 技术栈与架构(三块)

延续用户已验证的「Swift 原生前端 + JS 后端 + 原生 DOM 网页」模式:

- **A 端(写作者)= SwiftUI 原生 iOS**:纯 Swift,标准 Xcode 工程,无 JS 桥接。拖拽建卡用 SwiftUI `.draggable`/`.dropDestination`。MVP 先 iOS-only(写作者人少);Android 留待以后。
- **B 端(读者)= vanilla JS 网页**:原生 DOM、无框架,零安装,手机浏览器打开即读。由后端直接托管静态页。
- **后端 = Node + Hono(TypeScript)+ PostgreSQL**:承载 A app 与 B web 共用的 JSON API(数据模型、权限引擎、登录、邀请码)+ 托管 B 阅读页。
  - **部署**:东京阿里云 ECS(8G),Docker Compose(app + postgres)+ Nginx 反代 + Let's Encrypt HTTPS。免 ICP 备案;东京↔大陆 ~30–80ms;保留海外推广空间。
  - **本地开发**:`embedded-postgres`(真 PG、免 Docker、不动系统);生产用 Docker。
- **短信发送 = 可插拔接口**:`dev` 驱动(码打日志,开发不阻塞)/ `aliyun` 驱动(真实)。
- **客户端无共享代码**(Swift vs JS),只共享 JSON API 契约;后端是唯一真相源,权限只在后端算。

### 1.1 短信与备案(澄清)

1. **网站放东京服务器 → 不需要 ICP 备案。**
2. **发短信验证码 → 阿里云「短信服务」API 调用,与服务器位置无关。**
3. 阿里云短信有自己的「签名+模板」审核(≠ 网站备案)。个人实名账号:「网站」签名来源要求 ICP 备案(冲突);「**公众号/小程序名称**」来源不要求。**推荐绕法**:注册个人微信订阅号作签名来源。
   - 用户侧并行待办(不阻塞开发):订阅号 + 阿里云短信签名/模板审核 → 拿 AccessKey 切 `aliyun` 驱动。

> 置信度:1–3 点大框架把握高;个人签名审核具体材料阿里云时有微调,以申请时控制台为准。

## 2. 数据模型

| 实体 | 关键字段 | 说明 |
|---|---|---|
| **User** | id, phone(唯一), display_name?, created_at | A 与 B 同表,靠是否拥有 Note/Card 区分角色 |
| **Note** | id, user_id(作者=A), body, created_at(**TIMESTAMPTZ**), updated_at | `created_at`=录入时刻,可见性时间判断用它;编辑改 updated_at 不改 created_at |
| **Tag** | id, user_id, name, unique(user_id,name) | |
| **NoteTag** | note_id, tag_id, PK(note_id,tag_id);**FK→Tag ON DELETE RESTRICT** | 多对多 |
| **Card** | id, user_id(主人=A), title, visible_until(**TIMESTAMPTZ**,默认=created_at), invite_code(唯一,归一化大写存储), created_at | 含一组 Share |
| **Share** | id, card_id, name(读者可见的显示名), is_auto_update(默认 false), created_at | 卡里的一条「分享规则」;读者把它看作一个 tab |
| **ShareTag** | share_id, tag_id, exclude(false=必含/AND,true=排除/NOT), PK(share_id,tag_id);**FK→Tag ON DELETE RESTRICT** | 分享的标签;一个分享需 ≥1 个必含标签 |
| **CardHolder** | id, card_id, user_id(读者 B), redeemed_at, unique(card_id,user_id) | B 输码后的绑定。**数据保留**(含经 User 关联的手机号),供未来取证;**MVP 任何面向 A 的响应都不暴露**(见 §4 红线 #7) |
| **PhoneOtp** | **phone(PK)**, code_hash, expires_at, attempts, consumed | 单条有效 OTP/手机号;单次使用 |
| **Session** | id, user_id, expires_at, revoked | **服务端可吊销**;不用无状态不可吊销 JWT |
| **RedeemAttempt** | 见 §5 | 兑换限流,**跨进程原子存储**(DB 行级或 Redis),禁内存计数器 |

### 2.1 时间语义

- `created_at` = 录入(粘贴/新建)时刻;粘进来的旧日记默认拿"今天"时间戳 → cutoff 在昨天的卡不会立刻显示它,除非 A 推进时间或该标签开自动更新。**这是预期行为**。内容回填历史日期留作未来选项,MVP 不做。
- **`created_at` 与 `visible_until` 一律 `TIMESTAMPTZ`,统一存 UTC**;推进时间用**数据库 `now()` 作唯一时钟源,每请求只取一次**。
- 可见性边界 `created_at <= visible_until`,**含等于即可见**(故意)。测试:相等→可见;`visible_until + 1µs`→隐藏。
- 编辑 Note 改 `updated_at` 不改 `created_at`,不影响已算的可见范围;`updated_at` **绝不进读者 payload**(见 §4 红线 #6)。

## 3. 权限模型 —— 核心可见性(实现绝不能搞错)

### 3.0 每次读者请求的前置(IDOR 红线,见 §4 #5)

1. 由 `:cardId` 从 Card 表查出 `cardOwnerId = Card.user_id`,**绝不接受客户端传入的 ownerId**。卡不存在 → 404。
2. 校验存在 `CardHolder(card_id=:cardId, user_id=当前会话用户)`,**否则 403/404**(不泄漏卡是否存在)。
3. `:visibleUntil = Card.visible_until`,**每请求从库实时读取**。
4. **禁止跨请求缓存/记忆化 V、visible_until 或池子**;若为性能引入缓存,移标签/改 visible_until 须同事务立即失效,失效失败按未命中回源。

### 3.1 授权谓词(分享语义,全局一致)

> Note n 经**分享 S** 授权 ⟺ n 含 S 的全部必含标签 ∧ n 不含 S 的任何排除标签 ∧(**S 自动更新** 或 **n.created_at ≤ visible_until**)。
> Note n 可见(进入 V)⟺ 卡内存在任一分享 S 对 n 授权。
> 读者看到的 chip / tab = **授权该 note 的分享显示名**集合;构成分享的标签名(必含、排除)绝不外泄。

### 3.2 查询契约(强制)

对卡内每个分享 S(必含集 I 非空、排除集 E、自动 a),求其授权的 (note, S) 对:

```sql
SELECT n.id AS note_id, :shareId::text AS share_id,
       to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_raw
FROM notes n
WHERE n.user_id = :cardOwnerId
  AND (:auto OR n.created_at <= :visibleUntil)
  AND (SELECT count(DISTINCT nt.tag_id) FROM note_tags nt
       WHERE nt.note_id = n.id AND nt.tag_id IN (:includeTags)) = :includeCount
  AND NOT EXISTS (SELECT 1 FROM note_tags nx          -- 仅当 E 非空
                  WHERE nx.note_id = n.id AND nx.tag_id IN (:excludeTags));
```

各分享 `UNION ALL` → 全部授权对。然后:
- **可见集 V** = 授权对里去重的 note;**最近更新** = V 按 `(created_at, id)` 倒序;**分享 tab S** = 被 S 授权的 note。
- **chip** = 每条 note 被授权的分享显示名集合(只显示分享名)。
- **分页**:`created_at_raw` 是 µs 全精度文本(规避 JS Date 毫秒截断丢数据);游标 = `created_at_raw + "_" + id`,按精确串比较切片;**畸形游标一律回首页,绝不崩**(配 `app.onError` 兜底)。
- **读者 Note DTO 列白名单**:`{ id, body, created_at, 授权分享[] }` —— 不含 `updated_at`、不含任何标签名,池外/排除标签结构上不过网络边界。

**读者 Note DTO 列白名单:`{ id, body, created_at, 授权标签[] }`。结构上不含 updated_at、不含池外标签——池外标签绝不过网络边界。**

### 3.3 两个 tab 的语义

- **「最近更新」tab**(默认)= STEP 1 全集(V),按 `created_at DESC, id DESC`,keyset 分页,首屏 20 条。**是 V 之内的最新,绝不是 A 全库最新。**
- **标签 tab T** = STEP 1 加 `AND ct.tag_id = :tabTagId`,即**只显示经由 T 授权的 note**(按 T 自己的 auto_update/cutoff 判断),**而非"全局 V 含 T"**。同样 keyset 分页,不可无上限返回。
  - 结论:一条今天的 note 经自动标签 T1 可见 → 出现在「最近更新」和 T1 tab,**不出现在冻结标签 T2 的 tab**、也不挂 T2 chip。
- **tab/标签名列表只来源于当前 CardTag 池**(标签仍在池中才命名);加固「移出即静默消失」。

### 3.4 三种动态更新由上述谓词自动满足

- **推进时间** = `visible_until := now()`。
- **增/减标签** = 改 CardTag 行;移出后实时重算,相关 note 自动消失、零痕迹。
- **自动更新** = 该 CardTag `is_auto_update=true`,新内容绕过时间判断。

## 4. 防泄漏红线(实现必须遵守)

1. **标签渲染按「经由该标签授权」**:渲染某 Note 的标签,只显示满足 `T∈卡池子 且 该 Note 经由 T 授权`(`ct_T.is_auto_update=TRUE OR n.created_at<=visible_until`)的标签。池中但未对该 Note 授权的标签,不显示在该 Note 上。池外标签更不显示。
2. 可见性查询**一律服务端实时计算**;前端只拿结果,绝不下发 A 全量数据再前端过滤。
3. 读者侧**不写任何阅读信号回传**(无已读/停留/进度);A 端无此读取面。
4. "曾经可见、现在不可见"的内容,接口不返回、不留痕。**每一页分页都服务端重跑完整实时 V 谓词**,客户端 cursor 仅作位置,绝不据 cursor 绕过 V 重算;已不在 V 内的 cursor 目标重新夹取/丢弃。
5. **IDOR 红线**:见 §3.0(服务端反查 owner + 校验 CardHolder + 每查保留 `n.user_id=:cardOwnerId`)。无 CardHolder 一律 403/404。
6. **读者 payload 列白名单**:只含 `id, body, created_at, 授权标签`;不含 `updated_at`;所有读者侧排序/标注用 `created_at`,绝不用 `updated_at`(否则今天编辑旧文会泄露截止点后的活动)。
7. **持卡人零回传(MVP)**:A 的建卡/管理 API 与 UI **不暴露 CardHolder**——无人数、无身份、无 redeemed_at。作废/轮换 操作于 码/卡 本身,不基于 A 可查看的持有人列表。(数据层保留 CardHolder+redeemed_at+手机号,为未来"A 取证查询"留能力,但 MVP 无任何 A 面接口读取。)
8. **无反向查询**:系统任何地方都没有 per-note「这条现在谁能看到 / 哪些卡暴露了它」的查询或 UI;可见性只在 卡→Note 方向、读取时计算。此省略刻意,不得当便利功能加回。

## 5. 邀请码

- **形式**:4 位,字符集**定死 `[2-9A-HJ-NP-Z]`**(剔除易混淆 0 O 1 I L),空间 ~32⁴ ≈ **105 万**。
- **归一化**:去空白 → ASCII 大写(**locale-invariant,不用区域 toUpperCase**)→ 按精确字符集校验,集外字符直接拒绝,不做静默映射。生成碰撞重试上限 5 次,超限则报错(或临时扩 5 位);作废/轮换码进 tombstone,MVP 内不复用。
- 一张卡一个码;可被多名受众输入兑换,每次生成一条 CardHolder(`unique(card_id,user_id)` 防重复绑定)。
- **拒绝自兑换**:`Card.user_id == 当前用户` → 兑换接口直接拒绝,不建 CardHolder(改用 §7 的 owner-preview)。
- **安全(单因子,B 只输码)**:
  - 兑换限流存储**跨进程原子**(DB 行级原子 UPSERT 或 Redis INCR/Lua),**禁纯进程内内存计数器**。
  - 多层:(a) 同账号/同 IP 连续输错指数退避锁定;(b) **每码失败预算**;(c) **平台级滚动窗口失败总预算**,触发后全局降速/captcha/告警(阈值与动作写入实现)。
  - **已接受风险声明**:用户选定 4 位(对标百度网盘),为单因子 ~105 万空间。审查建议加长到 6 位或"链接+码",**用户决定保留 4 位**,以上限流为补偿;转公开/上规模时再加长或改两因子。

## 6. 鉴权与会话

- **OTP 无密码**:注册与登录都用「手机号 + 短信验证码」,不做密码。
- **OTP 强约束**:验证码 6 位数字、有效期 5 分钟;**单次使用**(校验成功立即标记 consumed/删除,禁重放);`attempts` **原子自增**,达 5 次锁定该 phone 的 OTP 至过期;哈希**常量时间比较**;每 phone 同时仅一条有效 OTP(upsert),resend 受发送限流且**不重置已累计 attempts**;PhoneOtp 以 phone 为主键。`dev` 驱动可写日志,**生产/aliyun 驱动严禁记录明文码**。
- **会话服务端可吊销**(Session 表或带服务端校验的 token),支持登出与强制失效;长效 Cookie(30–90 天)只决定"免登多久",**卡访问由每请求实时校验 CardHolder 是否仍存在决定**(§3.0/§4 #5),独立于会话时长——作废/轮换码或删 CardHolder 后,对应读者对该卡访问立即失效。

## 7. 用户流程

### 7.1 写作端 A(SwiftUI iOS app)

1. 手机号注册/登录(OTP)。
2. 新建或粘贴 Note。
3. 给 Note 打一个或多个标签。
4. 浏览/搜索/筛选自己的库:按标签筛 + **文本搜索 `ILIKE` 必须参数化**(`body ILIKE :pattern`,pattern 应用层构造 `%`+escape(q)+`%`,转义 `% _ \\`,严禁拼接 SQL)+ **强制 `WHERE user_id=:currentUserId`**(纯作者端,与读者侧无关;测试:B 搜不到 A 的 note)。中文全文检索留待以后。
5. 建卡:选若干标签入池 → 生成 4 位码/分享入口。
6. 维护卡:推进时间 / 增减标签 / 给标签开自动更新 / 作废轮换码。
7. **预览本卡(owner-preview)**:专用 owner-only 端点,以 `cardOwnerId=self` + 卡当前 `visible_until` 跑 §3.2 两步计算,**不建 CardHolder 行**,结果与读者实际视图一致。
8. (Phase 2)AI 帮整理库、建议标签。

### 7.2 读者端 B(vanilla JS 网页)

1. 手机号注册/登录(OTP)。
2. 无任何卡 → 提示输入邀请码 → 载入对应卡。
3. 已有 N 张卡 → "邀请卡列表页";底部"添加新的邀请卡" → 悬浮框输码 → 载入。
4. 单张卡详情页:顶部一行 tab,第一个固定「最近更新」(默认),其余 = A 在此卡开放的标签(来源于当前 CardTag 池)。
5. 阅读页**零压力**:无点赞、无评论框、无已读回执、无"请回复"引导。

## 8. AI(Phase 2,brief §三)

- **只帮 A 整理库,不碰读者侧。** 把新粘零散 Note 聚类成主题/时间线,提示"这几条像在讲同一件事,要不要打同一个标签"。
- 用 **Claude API**(实现时读 `claude-api` 技能确认模型 id/用法)。
- **明确不做**:读者侧 AI 摘要/问答、人格分析/诊断/匹配评分等任何"解读用户"功能。单独接,不阻塞 Phase 1。

## 9. MVP 明确不做(brief §六)

读者侧 AI 摘要/问答;人格分析/诊断/关系匹配;给读者的通知/消息流/"卡有更新"提醒(默认静默);逐条审阅/发送前审核;公开卡免注册查看;社交广场/推荐/陌生人匹配/复杂多层级权限/增长裂变/会员;第三方平台自动同步导入;**per-note 反向可见性查询**(§4 #8);**A 端持卡人可见面**(§4 #7,数据保留、面后做)。

## 10. 构建顺序(按功能,非 TDD 仪式)

- **M0 地基**:后端骨架(Hono)+ 本地 embedded-postgres + 8 张表 + 健康路由。A app 与 B web 共用的"大脑"。
- **M1 登录**:后端发码/验码/会话 API(可插拔短信,dev 驱动打码到终端);A app(SwiftUI)与 B web(vanilla JS)各接登录。
- **M2 A 写库**:A app 写/粘 Note、打标签、浏览/筛选/搜索自己的库;后端 Note/Tag CRUD(限本人)。
- **M3 A 建卡 + 维护**:A app 拖标签进/出卡池、生成 4 位码、推进时间、开自动更新、作废/轮换、读者视角预览;后端 Card/CardTag/邀请码/owner-preview。
- **M4 B 读**:后端两步权限查询 + §4 全部红线 + 兑换(限流、拒绝自兑换);B web 输码兑换 → 卡列表 → 卡详情(最近更新 + 标签 tab)、零压力阅读。
- **M5 收尾**:短信切阿里云、部署东京 ECS、A app 打包(模拟器→真机→TestFlight)。
- **Phase 2(AI)**:后端接 Claude API,A app 用,帮整理库/建议标签。
- **并行(用户 ops)**:订阅号 + 阿里云短信签名/模板审核 → 切 `aliyun`;买域名指向东京 ECS + HTTPS;Apple 开发者账号(A app 上架/TestFlight)。

> 方法论:按产品功能/效果直接推进(用户指定,不走 TDD/多 agent 评审仪式)。例外:权限引擎(防泄漏)保留针对性测试,因为静默泄露隐私是产品唯一输不起的失败。

## 11. 仍开放/留待实现微调

- 限流具体阈值与窗口(DB 原子计数实现细节)。
- 标签 tab 内是否做时间线样式(MVP 先简单倒序列表)。
- 长效会话具体时长与"记住此设备"。
- display_name 是否必填、读者看到的"卡来自谁"如何呈现。

## 附:本轮对抗式审查并入的 16 条修订(可追溯)

A1 两步查询契约(池外标签不过网络边界,critical)·A2 标签按授权显示(用户拍板)·A3 canonical 查询·A4 IDOR/CardHolder 前置·A5 禁跨请求缓存 V·A6 限流跨进程原子+全局上限·A7 ILIKE 参数化+自我作用域·A8 持卡人零回传(数据保留、MVP 不开面,用户拍板)·A9 TIMESTAMPTZ/单一 now()/边界含等·A10 OTP 单次/锁定/常量时间·A11 标签删除 RESTRICT·A12 updated_at 不进读者 payload·A13 拒绝自兑换+owner-preview·A14 确定性排序+keyset 分页·A15 分页每页重跑 V+tab 名来自当前池·A16 会话服务端可吊销+每请求查 CardHolder·A17 邀请码字符集定死+归一化·A18 文档化"无反向查询"。
