import SwiftUI

struct CardsView: View {
    @EnvironmentObject var api: APIClient
    @State private var cards: [CardDTO] = []
    @State private var showNew = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("我发出的卡")
                        .font(.system(size: 12.5, weight: .semibold)).tracking(1.5).foregroundStyle(Theme.soft)
                        .padding(.bottom, 4)

                    if cards.isEmpty {
                        Text("还没有卡。下面新建一张：选标签、设交集 / 排除，出邀请码。")
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
            .task { await load() }
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

// MARK: - New card builder

struct NewCardView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let onSaved: () async -> Void

    @State private var title = ""
    @State private var shares: [ShareDraft] = [ShareDraft()]
    @State private var allTags: [TagDTO] = []
    @State private var saving = false
    @State private var errMsg = ""

    var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && shares.allSatisfy { !$0.include.isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("卡名(给谁看)") { TextField("如:给老朋友", text: $title) }

                ForEach($shares) { $share in
                    Section {
                        ShareDraftEditor(share: $share, allTags: allTags)
                    } header: {
                        HStack {
                            Text("分享 \((shares.firstIndex { $0.id == share.id } ?? 0) + 1)")
                            Spacer()
                            if shares.count > 1 {
                                Button(role: .destructive) {
                                    shares.removeAll { $0.id == share.id }
                                } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                }

                Section {
                    Button { shares.append(ShareDraft()) } label: { Label("再加一个分享", systemImage: "plus") }
                }
                if !errMsg.isEmpty { Text(errMsg).foregroundStyle(.red).font(.footnote) }
            }
            .navigationTitle("新建卡")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("生成") { Task { await save() } }.disabled(!canSave || saving)
                }
            }
            .task { allTags = (try? await api.listTags()) ?? [] }
        }
    }

    func save() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await api.createCard(
                title: title.trimmingCharacters(in: .whitespaces),
                shares: shares.map { $0.payload() }
            )
            await onSaved()
            dismiss()
        } catch {
            errMsg = "生成失败:每个分享至少要选一个「必含」标签。"
        }
    }
}

struct ShareDraftEditor: View {
    @Binding var share: ShareDraft
    let allTags: [TagDTO]

    enum PickKind: Int, Identifiable { case include, exclude; var id: Int { rawValue } }
    @State private var picking: PickKind?

    var body: some View {
        TextField("分享名(读者看到这个;留空自动取)", text: $share.name)
        Toggle("自动更新(新内容自动可见)", isOn: $share.autoUpdate)
        tagRow("必含(都要有 = 交集)", tags: share.include) { picking = .include }
        tagRow("排除(不能有)", tags: share.exclude) { picking = .exclude }
            .sheet(item: $picking) { kind in
                TagMultiPicker(
                    title: kind == .include ? "必含标签" : "排除标签",
                    allTags: allTags,
                    selected: kind == .include ? $share.include : $share.exclude
                )
            }
    }

    @ViewBuilder
    func tagRow(_ title: String, tags: [TagDTO], _ edit: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.subheadline)
                Spacer()
                Button("选择", action: edit).font(.subheadline)
            }
            if tags.isEmpty {
                Text("—").foregroundStyle(.secondary).font(.caption)
            } else {
                FlowChips(names: tags.map { $0.name })
            }
        }
        .padding(.vertical, 2)
    }
}

struct TagMultiPicker: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let allTags: [TagDTO]
    @Binding var selected: [TagDTO]

    var body: some View {
        NavigationStack {
            List(allTags) { t in
                Button { toggle(t) } label: {
                    HStack {
                        Text(t.name)
                        Spacer()
                        if isSelected(t) { Image(systemName: "checkmark").foregroundStyle(.blue) }
                    }
                }
                .foregroundStyle(.primary)
            }
            .overlay { if allTags.isEmpty { Text("还没有标签,先去库里建。").foregroundStyle(.secondary) } }
            .navigationTitle(title)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("完成") { dismiss() } } }
        }
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
    let cardId: String
    let onChange: () async -> Void

    @State private var card: CardDTO?
    @State private var showPreview = false

    var body: some View {
        Group {
            if let card {
                List {
                    Section("邀请码(发给想给看的人)") {
                        Text(card.inviteCode).font(.system(size: 34, weight: .bold, design: .monospaced))
                        Button("轮换邀请码(旧码立即失效)") { Task { await rotate() } }
                    }
                    Section("分享(左滑删除 = 静默收回)") {
                        ForEach(card.shares) { s in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(s.name).font(.headline)
                                    if s.isAutoUpdate {
                                        Text("自动").font(.caption2)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Color.secondary.opacity(0.15)).clipShape(Capsule())
                                    }
                                }
                                Text(shareSummary(s)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .onDelete { idx in Task { await deleteShares(idx) } }
                    }
                    Section {
                        Button("推进时间到现在") { Task { await advance() } }
                        Button("以读者视角预览") { showPreview = true }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(card?.title ?? "卡")
        .sheet(isPresented: $showPreview) { PreviewView(cardId: cardId) }
        .task { await load() }
    }

    func shareSummary(_ s: ShareDTO) -> String {
        var t = "必含 " + s.include.map { $0.name }.joined(separator: "∩")
        if !s.exclude.isEmpty { t += " · 排除 " + s.exclude.map { $0.name }.joined(separator: ",") }
        return t
    }
    func load() async { card = try? await api.cardDetail(id: cardId) }
    func rotate() async { _ = try? await api.rotateCode(cardId: cardId); await load(); await onChange() }
    func advance() async { try? await api.advanceTime(cardId: cardId); await load() }
    func deleteShares(_ idx: IndexSet) async {
        guard let c = card else { return }
        for i in idx { try? await api.removeShare(cardId: cardId, shareId: c.shares[i].id) }
        await load(); await onChange()
    }
}

struct PreviewView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let cardId: String
    @State private var preview: PreviewResponse?

    var body: some View {
        NavigationStack {
            Group {
                if let p = preview {
                    List(p.notes) { n in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(n.body)
                            HStack(spacing: 6) {
                                Text(shortDate(n.createdAt)).font(.caption).foregroundStyle(.secondary)
                                ForEach(n.shares) { s in
                                    Text(s.name).font(.caption2)
                                        .padding(.horizontal, 8).padding(.vertical, 2)
                                        .background(Color.secondary.opacity(0.12)).clipShape(Capsule())
                                }
                            }
                        }
                    }
                    .overlay { if p.notes.isEmpty { Text("读者现在看不到任何内容。").foregroundStyle(.secondary) } }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("读者会看到")
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("关闭") { dismiss() } } }
            .task { preview = try? await api.ownerPreview(cardId: cardId) }
        }
    }
}

struct FlowChips: View {
    let names: [String]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(names, id: \.self) { n in
                    Text(n).font(.caption)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.12)).clipShape(Capsule())
                }
            }
        }
    }
}
