import SwiftUI
import UIKit

/// "2026-06-21T…" -> "6月21日"
private func cardDay(_ iso: String) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let d = f.date(from: iso) ?? {
        let g = ISO8601DateFormatter(); g.formatOptions = [.withInternetDateTime]
        return g.date(from: iso)
    }()
    guard let d else { return shortDate(iso) }
    let out = DateFormatter()
    out.locale = Locale(identifier: "zh_CN")
    out.dateFormat = "M月d日"
    return out.string(from: d)
}

struct CardsView: View {
    @EnvironmentObject var api: APIClient
    @State private var cards: [CardDTO] = []
    @State private var showNew = CardsView.debugShowNew
    @State private var path: [String] = []

    private static var debugShowNew: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--show-newcard")
        #else
        false
        #endif
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("我发出的卡")
                        .font(.system(size: 12.5, weight: .semibold)).tracking(1.5).foregroundStyle(Theme.soft)
                        .padding(.bottom, 4)

                    if cards.isEmpty {
                        Text("还没有卡。下面新建一张：挑几个标签，出一个邀请码。")
                            .font(Theme.serif(16)).foregroundStyle(Theme.soft)
                            .padding(.vertical, 22)
                    }

                    ForEach(cards) { c in
                        NavigationLink(value: c.id) { cardRow(c) }
                            .buttonStyle(.plain)
                            .overlay(alignment: .bottom) { Hairline() }
                    }

                    Button { showNew = true } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "plus").font(.system(size: 14, weight: .light))
                            Text("新建一张卡").font(Theme.serif(17))
                        }
                        .foregroundStyle(Theme.soft).padding(.top, 24)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Theme.hPad)
                .padding(.top, 8)
                .padding(.bottom, 60)
            }
            .paperBackground()
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                CardDetailView(cardId: id) { await load() }
            }
            .sheet(isPresented: $showNew) { NewCardView { await load() } }
            .task {
                await load()
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--card-detail-first"),
                   let first = cards.first {
                    path = [first.id]
                }
                #endif
            }
            .refreshable { await load() }
        }
    }

    private func cardRow(_ c: CardDTO) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(c.title).font(Theme.serif(20, .medium)).foregroundStyle(Theme.ink)
            HStack(spacing: 10) {
                Text(c.inviteCode)
                    .font(.system(size: 13, weight: .medium, design: .monospaced)).tracking(2).foregroundStyle(Theme.clay)
                Text("·").foregroundStyle(Theme.faint)
                Text("\(c.shares.count) 个分享").font(.system(size: 13)).foregroundStyle(Theme.soft)
            }
            if !c.shares.isEmpty { ClayTags(names: c.shares.map { $0.name }) }
        }
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    func load() async { cards = (try? await api.listCards()) ?? [] }
}

// MARK: - New card (quick by default, advanced on demand)

struct NewCardView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let onSaved: () async -> Void

    enum Mode { case quick, advanced }
    @State private var mode: Mode = NewCardView.debugAdvanced ? .advanced : .quick
    @State private var title = ""
    @State private var allTags: [TagDTO] = []
    // quick: each picked tag becomes one share whose display name is the tag name
    @State private var picked: Set<String> = []
    @State private var autoUpdate = false
    // advanced
    @State private var drafts: [ShareDraft] = []
    @State private var saving = false
    @State private var errMsg = ""

    private static var debugAdvanced: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--newcard-advanced")
        #else
        false
        #endif
    }

    private var canSave: Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        switch mode {
        case .quick: return !picked.isEmpty
        case .advanced: return !drafts.isEmpty && drafts.allSatisfy { !$0.include.isEmpty }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // card name
                    sectionLabel("卡名（给谁看）")
                    TextField("比如：给老朋友", text: $title)
                        .font(Theme.serif(20))
                        .foregroundStyle(Theme.ink)
                        .padding(.vertical, 10)
                    Hairline()

                    if mode == .quick { quickBody } else { advancedBody }

                    if !errMsg.isEmpty {
                        Text(errMsg).font(.system(size: 12.5)).foregroundStyle(Theme.brick).padding(.top, 16)
                    }

                    // mode switch
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) { switchMode() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: mode == .quick ? "slider.horizontal.3" : "chevron.left")
                                .font(.system(size: 12, weight: .light))
                            Text(mode == .quick ? "高级：合并、排除、单独命名" : "回到快速模式")
                                .font(.system(size: 13.5))
                        }
                        .foregroundStyle(Theme.clay)
                        .padding(.top, 28)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Theme.hPad)
                .padding(.top, 18)
                .padding(.bottom, 50)
            }
            .paperBackground()
            .navigationTitle("新建一张卡")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }.foregroundStyle(Theme.soft)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("生成") { Task { await save() } }
                        .fontWeight(.semibold)
                        .foregroundStyle(canSave ? Theme.clay : Theme.faint)
                        .disabled(!canSave || saving)
                }
            }
            .task {
                allTags = (try? await api.listTags()) ?? []
                if mode == .advanced && drafts.isEmpty { drafts = [ShareDraft()] }
            }
        }
    }

    // MARK: quick — 1 tag = 1 share (display name defaults to the tag name)

    @ViewBuilder
    private var quickBody: some View {
        sectionLabel("分享哪些标签").padding(.top, 28)
        Text("勾选的每个标签，会成为读者看到的一个分类；分类名就是标签名。")
            .font(.system(size: 12)).foregroundStyle(Theme.faint).padding(.top, 4)

        if allTags.isEmpty {
            Text("还没有标签，先去库里写几条带 #标签 的笔记。")
                .font(Theme.serif(15)).foregroundStyle(Theme.soft).padding(.vertical, 18)
        }
        VStack(spacing: 0) {
            ForEach(allTags) { tag in
                Button { toggle(tag) } label: {
                    HStack(spacing: 12) {
                        Text(tag.icon?.isEmpty == false ? tag.icon! : "·").font(.system(size: 15)).frame(width: 22)
                        Text(tag.name).font(Theme.serif(17)).foregroundStyle(Theme.ink)
                        Spacer()
                        Text("\(tag.noteCount)").font(.system(size: 13)).monospacedDigit().foregroundStyle(Theme.faint)
                        Image(systemName: picked.contains(tag.id) ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 17, weight: .light))
                            .foregroundStyle(picked.contains(tag.id) ? Theme.clay : Theme.faint)
                    }
                    .frame(height: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Hairline(inset: 34) }
            }
        }
        .padding(.top, 8)

        Toggle(isOn: $autoUpdate) {
            VStack(alignment: .leading, spacing: 3) {
                Text("新内容自动可见").font(Theme.serif(16)).foregroundStyle(Theme.ink)
                Text("关闭时，读者只能看到此刻之前的内容；之后可随时“推进时间”放行新内容。")
                    .font(.system(size: 11.5)).foregroundStyle(Theme.faint)
            }
        }
        .tint(Theme.clay)
        .padding(.top, 26)
    }

    private func toggle(_ tag: TagDTO) {
        if picked.contains(tag.id) { picked.remove(tag.id) } else { picked.insert(tag.id) }
    }

    // MARK: advanced — full share drafts (intersection + exclusion)

    @ViewBuilder
    private var advancedBody: some View {
        sectionLabel("分享（读者看到的分类）").padding(.top, 28)
        Text("每个分享 = 必含标签的交集，再减去排除标签。分类名可以单独起。")
            .font(.system(size: 12)).foregroundStyle(Theme.faint).padding(.top, 4)

        ForEach($drafts) { $draft in
            ShareDraftEditor(draft: $draft, allTags: allTags) {
                drafts.removeAll { $0.id == draft.id }
            }
            .padding(.top, 18)
        }

        Button {
            drafts.append(ShareDraft())
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 13, weight: .light))
                Text("再加一个分享").font(Theme.serif(16))
            }
            .foregroundStyle(Theme.soft).padding(.top, 22)
        }
        .buttonStyle(.plain)
    }

    private func switchMode() {
        if mode == .quick {
            // carry the quick picks into advanced drafts
            drafts = picked.compactMap { id in
                guard let tag = allTags.first(where: { $0.id == id }) else { return nil }
                var d = ShareDraft(); d.name = tag.name; d.autoUpdate = autoUpdate; d.include = [tag]
                return d
            }
            if drafts.isEmpty { drafts = [ShareDraft()] }
            mode = .advanced
        } else {
            mode = .quick
        }
    }

    private func sectionLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .semibold)).tracking(1.5).foregroundStyle(Theme.soft)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let shares: [[String: Any]]
        switch mode {
        case .quick:
            shares = allTags.filter { picked.contains($0.id) }.map { tag in
                ["name": tag.name, "autoUpdate": autoUpdate, "include": [tag.id], "exclude": [String]()]
            }
        case .advanced:
            shares = drafts.map { $0.payload() }
        }
        do {
            _ = try await api.createCard(title: title.trimmingCharacters(in: .whitespaces), shares: shares)
            await onSaved()
            dismiss()
        } catch {
            errMsg = "生成失败：每个分享至少要有一个「必含」标签。"
        }
    }
}

// MARK: - Advanced share editor

struct ShareDraftEditor: View {
    @Binding var draft: ShareDraft
    let allTags: [TagDTO]
    let onDelete: () -> Void

    enum PickKind: Int, Identifiable { case include, exclude; var id: Int { rawValue } }
    @State private var picking: PickKind?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                TextField("分类名（读者看到这个）", text: $draft.name)
                    .font(Theme.serif(17, .medium))
                    .foregroundStyle(Theme.ink)
                Button(action: onDelete) {
                    Image(systemName: "trash").font(.system(size: 13, weight: .light)).foregroundStyle(Theme.brick)
                }
                .buttonStyle(.plain)
            }
            tagLine("必含", tags: draft.include, empty: "选择标签（都要有）") { picking = .include }
            tagLine("排除", tags: draft.exclude, empty: "无") { picking = .exclude }
            Toggle(isOn: $draft.autoUpdate) {
                Text("新内容自动可见").font(.system(size: 13.5)).foregroundStyle(Theme.soft)
            }
            .tint(Theme.clay)
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.rule, lineWidth: 1))
        .sheet(item: $picking) { kind in
            TagMultiPicker(
                title: kind == .include ? "必含标签" : "排除标签",
                allTags: allTags,
                selected: kind == .include ? $draft.include : $draft.exclude
            )
        }
    }

    private func tagLine(_ label: String, tags: [TagDTO], empty: String, edit: @escaping () -> Void) -> some View {
        Button(action: edit) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(label).font(.system(size: 12.5)).foregroundStyle(Theme.soft).frame(width: 34, alignment: .leading)
                if tags.isEmpty {
                    Text(empty).font(.system(size: 13.5)).foregroundStyle(Theme.faint)
                } else {
                    ClayTags(names: tags.map { $0.name })
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .light)).foregroundStyle(Theme.faint)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct TagMultiPicker: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let allTags: [TagDTO]
    @Binding var selected: [TagDTO]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(allTags) { tag in
                        Button { toggle(tag) } label: {
                            HStack(spacing: 12) {
                                Text(tag.icon?.isEmpty == false ? tag.icon! : "·").font(.system(size: 15)).frame(width: 22)
                                Text(tag.name).font(Theme.serif(17)).foregroundStyle(Theme.ink)
                                Spacer()
                                if isSelected(tag) {
                                    Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.clay)
                                }
                            }
                            .frame(height: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .bottom) { Hairline(inset: 34) }
                    }
                    if allTags.isEmpty {
                        Text("还没有标签，先去库里建。").font(Theme.serif(15)).foregroundStyle(Theme.soft).padding(.top, 60)
                    }
                }
                .padding(.horizontal, Theme.hPad)
            }
            .paperBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }.fontWeight(.semibold).foregroundStyle(Theme.clay)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    func isSelected(_ t: TagDTO) -> Bool { selected.contains { $0.id == t.id } }
    func toggle(_ t: TagDTO) {
        if let i = selected.firstIndex(where: { $0.id == t.id }) { selected.remove(at: i) }
        else { selected.append(t) }
    }
}

// MARK: - Card detail (maintain)

struct CardDetailView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let cardId: String
    let onChange: () async -> Void

    @State private var card: CardDTO?
    @State private var showPreview = CardDetailView.debugShowPreview
    @State private var copied = false
    @State private var confirmRotate = false
    @State private var confirmAdvance = false
    @State private var revokingShare: ShareDTO?

    private static var debugShowPreview: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--show-preview")
        #else
        false
        #endif
    }

    var body: some View {
        Group {
            if let card {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // invite code block
                        sectionLabel("邀请码（发给想给看的人）")
                        Text(card.inviteCode)
                            .font(.system(size: 32, weight: .semibold, design: .monospaced)).tracking(4)
                            .foregroundStyle(Theme.ink)
                            .padding(.top, 10)
                        HStack(spacing: 22) {
                            Button {
                                UIPasteboard.general.string = card.inviteCode
                                copied = true
                                Task { try? await Task.sleep(nanoseconds: 1_600_000_000); copied = false }
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                        .font(.system(size: 12, weight: .light))
                                    Text(copied ? "已复制" : "复制").font(.system(size: 13.5))
                                }
                                .foregroundStyle(Theme.clay)
                            }
                            .buttonStyle(.plain)

                            ShareLink(item: "我在 See Me 上给你留了一张邀请卡，邀请码：\(card.inviteCode)") {
                                HStack(spacing: 5) {
                                    Image(systemName: "square.and.arrow.up").font(.system(size: 12, weight: .light))
                                    Text("发给 TA").font(.system(size: 13.5))
                                }
                                .foregroundStyle(Theme.clay)
                            }

                            Button { confirmRotate = true } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 12, weight: .light))
                                    Text("轮换").font(.system(size: 13.5))
                                }
                                .foregroundStyle(Theme.brick)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.top, 14)
                        Hairline().padding(.top, 22)

                        // shares
                        sectionLabel("分享的分类（读者看到这些名字）").padding(.top, 26)
                        VStack(spacing: 0) {
                            ForEach(card.shares) { s in
                                shareRow(s)
                                    .overlay(alignment: .bottom) { Hairline() }
                            }
                        }
                        .padding(.top, 6)
                        if card.shares.isEmpty {
                            Text("已没有任何分享，读者看不到内容。")
                                .font(Theme.serif(15)).foregroundStyle(Theme.soft).padding(.vertical, 16)
                        }

                        // maintain
                        sectionLabel("维护").padding(.top, 26)
                        maintainRow(icon: "clock.arrow.circlepath", title: "推进时间到现在",
                                    caption: "冻结的分类会把此刻之前的新内容放给读者。") { confirmAdvance = true }
                        maintainRow(icon: "eye", title: "以读者视角预览",
                                    caption: "看读者此刻实际能看到什么。") { showPreview = true }
                    }
                    .padding(.horizontal, Theme.hPad)
                    .padding(.top, 10)
                    .padding(.bottom, 60)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .paperBackground()
        .navigationTitle(card?.title ?? "卡")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPreview) { PreviewView(cardId: cardId) }
        .confirmationDialog("轮换邀请码？", isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("轮换（旧码立即失效）", role: .destructive) { Task { await rotate() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("已兑换过的读者不受影响；还没输码的人需要新码。")
        }
        .confirmationDialog("推进时间到现在？", isPresented: $confirmAdvance, titleVisibility: .visible) {
            Button("推进") { Task { await advance() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("冻结分类的可见范围会扩大到此刻，之后的新内容仍然不可见。")
        }
        .confirmationDialog(
            "收回「\(revokingShare?.name ?? "")」？",
            isPresented: Binding(get: { revokingShare != nil }, set: { if !$0 { revokingShare = nil } }),
            titleVisibility: .visible
        ) {
            Button("收回这个分类", role: .destructive) {
                guard let s = revokingShare else { return }
                Task { await removeShare(s) }
                revokingShare = nil
            }
            Button("取消", role: .cancel) { revokingShare = nil }
        } message: {
            Text("读者将立刻看不到这个分类和其中的内容，不会收到任何提示。")
        }
        .task { await load() }
    }

    private func sectionLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .semibold)).tracking(1.5).foregroundStyle(Theme.soft)
    }

    private func shareRow(_ s: ShareDTO) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(s.name).font(Theme.serif(17, .medium)).foregroundStyle(Theme.ink)
                    if s.isAutoUpdate {
                        Text("自动").font(.system(size: 10.5)).foregroundStyle(Theme.clay)
                            .padding(.horizontal, 5).padding(.vertical, 1.5)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.clay.opacity(0.45), lineWidth: 1))
                    }
                }
                Text(shareSummary(s)).font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
            Spacer()
            Button { revokingShare = s } label: {
                Image(systemName: "minus.circle").font(.system(size: 15, weight: .light)).foregroundStyle(Theme.brick)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 13)
    }

    private func maintainRow(icon: String, title: String, caption: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 15, weight: .light)).foregroundStyle(Theme.clay).frame(width: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Theme.serif(16.5)).foregroundStyle(Theme.ink)
                    Text(caption).font(.system(size: 11.5)).foregroundStyle(Theme.faint)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .light)).foregroundStyle(Theme.faint)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Hairline() }
    }

    func shareSummary(_ s: ShareDTO) -> String {
        var t = "必含 " + s.include.map { $0.name }.joined(separator: " ∩ ")
        if !s.exclude.isEmpty { t += " · 排除 " + s.exclude.map { $0.name }.joined(separator: "、") }
        return t
    }
    func load() async { card = try? await api.cardDetail(id: cardId) }
    func rotate() async { _ = try? await api.rotateCode(cardId: cardId); await load(); await onChange() }
    func advance() async { try? await api.advanceTime(cardId: cardId); await load() }
    func removeShare(_ s: ShareDTO) async {
        try? await api.removeShare(cardId: cardId, shareId: s.id)
        await load(); await onChange()
    }
}

// MARK: - Owner preview (what the reader sees right now)

struct PreviewView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let cardId: String
    @State private var preview: PreviewResponse?

    var body: some View {
        NavigationStack {
            Group {
                if let p = preview {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("读者打开这张卡，此刻看到的是：")
                                .font(.system(size: 12.5)).foregroundStyle(Theme.soft)
                                .padding(.bottom, 20)
                            if p.notes.isEmpty {
                                Text("读者现在看不到任何内容。")
                                    .font(Theme.serif(16)).foregroundStyle(Theme.soft)
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, 70)
                            }
                            ForEach(Array(p.notes.enumerated()), id: \.element.id) { i, n in
                                JournalEntry(
                                    time: cardDay(n.createdAt),
                                    text: n.body,
                                    tagNames: n.shares.map(\.name),
                                    imagePaths: []
                                )
                                if i < p.notes.count - 1 { Hairline().padding(.vertical, 20) }
                            }
                        }
                        .padding(.horizontal, Theme.hPad)
                        .padding(.top, 14)
                        .padding(.bottom, 50)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .paperBackground()
            .navigationTitle("读者会看到")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("关闭") { dismiss() }.foregroundStyle(Theme.clay)
                }
            }
            .task { preview = try? await api.ownerPreview(cardId: cardId) }
        }
    }
}
