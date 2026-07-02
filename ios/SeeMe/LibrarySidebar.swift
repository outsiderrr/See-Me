import SwiftUI

struct LibrarySidebar: View {
    @EnvironmentObject private var api: APIClient
    @ObservedObject var store: LibraryStore
    let close: () -> Void

    @State private var cardQuery = ""
    @State private var editingTag: TagDTO?
    @State private var deletingTag: TagDTO?
    @State private var cardsExpanded = LibrarySidebar.debugExpandCards

    private static var debugExpandCards: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--expand-cards")
        #else
        false
        #endif
    }

    private var reading: Bool { store.selectedCardId != nil }
    private var atRoot: Bool { store.selectedCardId == nil && store.activeOwnTagId == nil }

    private var filteredCards: [ReceivedCardDTO] {
        let q = cardQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return store.receivedCards }
        return store.receivedCards.filter {
            $0.title.localizedCaseInsensitiveContains(q) ||
            $0.ownerName.localizedCaseInsensitiveContains(q)
        }
    }

    /// The single card shown when the list is collapsed: the one being read, or
    /// else the most recently loaded.
    private var collapsedCard: ReceivedCardDTO? {
        store.selectedCard ?? store.receivedCards.first
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    profileHeader
                    Hairline().padding(.vertical, 22)
                    navRow("全部笔记", active: atRoot) {
                        Task { await store.showAllNotes(api); close() }
                    }
                    receivedSection.padding(.top, 26)
                    if reading { categoriesSection } else { tagsSection }
                }
                .padding(.horizontal, Theme.hPad)
                .padding(.top, 14)
                .padding(.bottom, 24)
            }
            Hairline()
            accountFooter
        }
        .paperBackground()
        .sheet(item: $editingTag) { tag in
            TagEditSheet(tag: tag) { name, icon in
                await store.editTag(tag, name: name, icon: icon, api: api)
            }
        }
        .confirmationDialog(
            "删除 #\(deletingTag?.name ?? "")？",
            isPresented: Binding(get: { deletingTag != nil }, set: { if !$0 { deletingTag = nil } }),
            titleVisibility: .visible
        ) {
            Button("删除此标签下的所有笔记", role: .destructive) {
                guard let tag = deletingTag else { return }
                Task { await store.deleteTag(tag, deleteNotes: true, api: api) }
                deletingTag = nil
            }
            Button("从笔记中移除此标签", role: .destructive) {
                guard let tag = deletingTag else { return }
                Task { await store.deleteTag(tag, deleteNotes: false, api: api) }
                deletingTag = nil
            }
            Button("取消", role: .cancel) { deletingTag = nil }
        } message: {
            Text("两种方式都会同步收回邀请卡中依赖这个标签的分享权限。")
        }
        .alert(
            "提示",
            isPresented: Binding(get: { !store.message.isEmpty }, set: { if !$0 { store.message = "" } })
        ) {
            Button("好") { store.message = "" }
        } message: {
            Text(store.message)
        }
    }

    // MARK: Profile

    private var profileHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(displayName).font(Theme.serif(28, .semibold)).foregroundStyle(Theme.ink)
                .padding(.top, 8)
            Text(maskedPhone).font(.system(size: 13)).foregroundStyle(Theme.faint).padding(.top, 4)
            HStack(spacing: 0) {
                stat(store.me?.noteCount ?? store.notes.count, "笔记")
                statDivider
                stat(store.me?.tagCount ?? store.tags.count, "标签")
                statDivider
                stat(daysUsed, "天")
            }
            .padding(.top, 22)
        }
    }
    private var statDivider: some View { Rectangle().fill(Theme.rule).frame(width: 1, height: 30).padding(.horizontal, 22) }
    private func stat(_ n: Int, _ t: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(n)").font(Theme.serif(24, .semibold)).foregroundStyle(Theme.ink)
            Text(t).font(.system(size: 11)).foregroundStyle(Theme.faint)
        }
    }

    private func navRow(_ t: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Rectangle().fill(active ? Theme.clay : .clear).frame(width: 2, height: 18)
                Text(t).font(Theme.serif(18, active ? .semibold : .regular)).foregroundStyle(active ? Theme.ink : Theme.soft)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Received cards (collapse / expand)

    private var receivedSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                sectionTitle("收到的邀请卡")
                Spacer()
                if !store.receivedCards.isEmpty { expandControl }
            }

            if store.receivedCards.isEmpty {
                searchField.padding(.top, 14)
                Text("还没有收到邀请卡。可在上面输入 8 位邀请码。")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint).padding(.top, 10)
            } else if cardsExpanded {
                searchField.padding(.top, 14)
                VStack(spacing: 10) {
                    ForEach(filteredCards) { card in
                        receivedRow(card: card, selected: store.selectedCardId == card.id) {
                            Task { await store.toggleReceivedCard(card, api: api); close() }
                        }
                    }
                    if filteredCards.isEmpty {
                        Text("没有匹配的邀请卡；若这是邀请码，按键盘上的“前往”。")
                            .font(.system(size: 12)).foregroundStyle(Theme.faint)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                    }
                }
                .padding(.top, 14)
            } else if let card = collapsedCard {
                receivedRow(card: card, selected: store.selectedCardId == card.id) {
                    Task { await store.toggleReceivedCard(card, api: api); close() }
                }
                .padding(.top, 14)
            }
        }
    }

    private var expandControl: some View {
        Button { withAnimation(.easeOut(duration: 0.18)) { cardsExpanded.toggle() } } label: {
            HStack(spacing: 4) {
                Text(cardsExpanded ? "收起" : (store.receivedCards.count > 1 ? "全部 \(store.receivedCards.count) 张" : "管理"))
                    .font(.system(size: 12.5))
                Image(systemName: cardsExpanded ? "chevron.up" : "chevron.down").font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(Theme.clay)
        }
        .buttonStyle(.plain)
    }

    private func receivedRow(card: ReceivedCardDTO, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "envelope.open" : "envelope")
                    .font(.system(size: 15, weight: .light)).foregroundStyle(Theme.clay).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.ownerName).font(Theme.serif(17, .medium)).foregroundStyle(Theme.ink)
                    Text("分享 ·《\(card.title)》").font(.system(size: 11.5)).foregroundStyle(Theme.faint)
                }
                Spacer()
                Image(systemName: selected ? "checkmark" : "chevron.right")
                    .font(.system(size: 11, weight: selected ? .semibold : .light)).foregroundStyle(Theme.clay)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? Theme.clay.opacity(0.10) : .clear))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(selected ? Theme.clay.opacity(0.35) : Theme.rule, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Categories (when reading a card) — Share display names, not raw tags

    @ViewBuilder
    private var categoriesSection: some View {
        sectionTitle("这张卡里的分类").padding(.top, 28)
        categoryRow("最近更新", active: store.activeShareId == nil) {
            Task { await store.showShare(nil, api: api); close() }
        }
        if let header = store.readerHeader {
            ForEach(header.tabs) { tab in
                categoryRow(tab.name, active: store.activeShareId == tab.id) {
                    Task { await store.showShare(tab.id, api: api); close() }
                }
            }
        }
    }

    private func categoryRow(_ name: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Rectangle().fill(active ? Theme.clay : Theme.faint.opacity(0.5)).frame(width: 2, height: 16)
                Text(name).font(Theme.serif(17, active ? .semibold : .regular)).foregroundStyle(active ? Theme.ink : Theme.soft)
                Spacer()
            }
            .frame(height: 46)
            .overlay(alignment: .bottom) { Hairline() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Tags (own library)

    @ViewBuilder
    private var tagsSection: some View {
        if !store.pinnedTags.isEmpty {
            sectionTitle("置顶标签").padding(.top, 28)
            ForEach(store.pinnedTags) { tagRow($0) }
        }
        sectionTitle("全部标签").padding(.top, 28)
        ForEach(store.tags) { tagRow($0) }
    }

    private func tagRow(_ tag: TagDTO) -> some View {
        HStack(spacing: 12) {
            Button {
                Task { await store.showOwnTag(tag.id, api: api); close() }
            } label: {
                HStack(spacing: 12) {
                    Text(tag.icon?.isEmpty == false ? tag.icon! : "·").font(.system(size: 15)).frame(width: 22)
                    Text(tag.name).font(Theme.serif(17)).foregroundStyle(store.activeOwnTagId == tag.id ? Theme.clay : Theme.ink)
                    if tag.isPinned == true { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(Theme.clay) }
                    Spacer()
                    Text("\(tag.noteCount)").font(.system(size: 13)).monospacedDigit().foregroundStyle(Theme.faint)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Menu {
                Button {
                    Task { await store.setPinned(tag, pinned: tag.isPinned != true, api: api) }
                } label: {
                    Label(tag.isPinned == true ? "取消置顶" : "置顶", systemImage: tag.isPinned == true ? "pin.slash" : "pin")
                }
                Button { editingTag = tag } label: { Label("编辑名称和图标", systemImage: "pencil") }
                Button(role: .destructive) { deletingTag = tag } label: { Label("删除标签", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 13)).foregroundStyle(Theme.faint).frame(width: 30, height: 36)
            }
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) { Hairline() }
    }

    // MARK: Search + footer + helpers

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .semibold)).tracking(1.5).foregroundStyle(Theme.soft)
    }

    private var searchField: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .light)).foregroundStyle(Theme.faint)
                TextField("搜索卡名，或输入 8 位邀请码", text: $cardQuery)
                    .font(.system(size: 14))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { submitCardField() }
                if !cardQuery.isEmpty {
                    Button { cardQuery = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(Theme.faint)
                    }
                }
            }
            Hairline()
        }
    }

    private var accountFooter: some View {
        HStack {
            Label("当前登录 · \(maskedPhone)", systemImage: "person")
                .font(.system(size: 12)).foregroundStyle(Theme.faint)
            Spacer()
            Button { Task { await api.logout() } } label: {
                Text("退出").font(.system(size: 13)).foregroundStyle(Theme.brick)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Theme.hPad).padding(.vertical, 16)
    }

    private func submitCardField() {
        let code = cardQuery.components(separatedBy: .whitespacesAndNewlines).joined().uppercased()
        let allowed = CharacterSet(charactersIn: "23456789ABCDEFGHJKMNPQRSTUVWXYZ")
        guard code.count == 8, code.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return }
        Task {
            await store.redeem(code, api: api)
            if store.selectedCardId != nil { cardQuery = ""; close() }
        }
    }

    private var maskedPhone: String {
        guard let phone = store.me?.phone else { return "See Me" }
        guard phone.count >= 7 else { return phone }
        return String(phone.prefix(3)) + "••••" + String(phone.suffix(4))
    }
    private var displayName: String {
        if let name = store.me?.displayName, !name.isEmpty { return name }
        return maskedPhone
    }
    private var daysUsed: Int {
        guard let iso = store.me?.createdAt else { return 1 }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: iso) else { return 1 }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: date)
        let today = calendar.startOfDay(for: Date())
        return max(1, (calendar.dateComponents([.day], from: start, to: today).day ?? 0) + 1)
    }
}

struct TagEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    let tag: TagDTO
    let onSave: (String, String) async -> Void

    @State private var name: String
    @State private var icon: String

    init(tag: TagDTO, onSave: @escaping (String, String) async -> Void) {
        self.tag = tag
        self.onSave = onSave
        _name = State(initialValue: tag.name)
        _icon = State(initialValue: tag.icon ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("名称") { TextField("标签名称", text: $name) }
                Section("图标（可选 Emoji）") { TextField("例如 🌱", text: $icon) }
            }
            .navigationTitle("编辑标签")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        Task {
                            await onSave(name.trimmingCharacters(in: .whitespacesAndNewlines), icon.trimmingCharacters(in: .whitespacesAndNewlines))
                            dismiss()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
