# See Me — A 端 (SwiftUI iOS app)

写作者 A 的原生 app:写库、打标签、建卡(交集+排除分享)、维护卡。读者 B 用网页,不在这里。

## 在 Xcode 里建工程

我没法生成 `.xcodeproj`(需要 Xcode 本体),所以:

1. Xcode → **File ▸ New ▸ Project ▸ iOS ▸ App**。
   - Product Name: `SeeMe`，Interface: **SwiftUI**，Language: **Swift**，最低 iOS 16。
2. 把本目录 `SeeMe/` 下的 `.swift` 文件拖进工程(替换默认的 `ContentView.swift` / `SeeMeApp.swift`)。
3. **允许本地 http(开发期连 localhost 后端)**:工程 ▸ Target ▸ Info，加 `App Transport Security Settings ▸ Allow Local Networking = YES`（或开发期临时 `Allow Arbitrary Loads = YES`）。
4. 改 `APIClient.swift` 里的 `baseURL`：
   - **模拟器**连本机后端：`http://localhost:3000`
   - **真机**：用电脑局域网 IP（如 `http://192.168.x.x:3000`），手机和电脑同一 WiFi；后端 `npm run dev`。
   - 上线后改成东京 ECS 的 https 域名。

## 跑起来

后端先起：`cd backend && npm run dev`（验证码会打到后端终端）。
然后 Xcode ▶ 跑模拟器：手机号登录 → 在后端终端看验证码 → 进库写笔记、打标签。

## 现状 / 下一步

- 已写:登录(手机号 OTP)、库(笔记列表/新建/按标签筛)、API 客户端、数据模型。
- 下一步(待这套在你 Xcode 里跑通后再迭代):**建卡界面**——把标签拖进「分享」、设交集必含/排除、自动更新开关、出邀请码、读者视角预览。

编译有报错就把报错贴给我,一起改。
