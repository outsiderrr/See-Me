import SwiftUI

struct LibrarySidebar: View {
    @EnvironmentObject private var api: APIClient
    @ObservedObject var store: LibraryStore
    let close: () -> Void

    @State private var cardQuery = ""
    @State private var editingTag: TagDTO?
    @State private var deletingTag: TagDTO?

    private var filteredCards: [ReceivedCardDTO] {
        let q = cardQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return store.receivedCards }
        return store.receivedCards.filter {
            $0.title.localizedCaseInsensitiveContains(q) ||
            $0.ownerName.localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    profileHeader
                    allNotesButton
                    receivedCardsModule
                    if !store.pinnedTags.isEmpty {
                        tagSection("置顶标签", tags: store.pinnedTags)
                    }
                    tagSection("全部标签", tags: store.tags)
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 26)
            }

            Divider()
            accountFooter
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .sheet(item: $editingTag) { tag in
            TagEditSheet(tag: tag) { name, icon in
                await store.editTag(tag, name: name, icon: icon, api: api)
            }
        }
        .confirmationDialog(
            "删除 #\(deletingTag?.name ?? "")？",
            isPresented: Binding(
                get: { deletingTag != nil },
                set: { if !$0 { deletingTag = nil } }
            ),
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
            isPresented: Binding(
                get: { !store.message.isEmpty },
                set: { if !$0 { store.message = "" } }
            )
        ) {
            Button("好") { store.message = "" }
        } message: {
            Text(store.message)
        }
    }

    private var profileHeader: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(displayName)
                .font(.title2.weight(.semibold))

            HStack(spacing: 34) {
                stat(store.me?.noteCount ?? store.notes.count, "笔记")
                stat(store.me?.tagCount ?? store.tags.count, "标签")
                stat(daysUsed, "天")
            }
        }
    }

    private func stat(_ number: Int, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(number)")
                .font(.system(size: 27, weight: .semibold, design: .rounded))
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var allNotesButton: some View {
        Button {
            Task {
                await store.showAllNotes(api)
                close()
            }
        } label: {
            HStack {
                Image(systemName: "square.grid.2x2.fill")
                Text("全部笔记").fontWeight(.semibold)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(store.selectedCardId == nil && store.activeOwnTagId == nil ? Color.seeGreen : Color.secondary.opacity(0.55))
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
    }

    private var receivedCardsModule: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("收到的邀请卡")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            HStack(spacing: 9) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("搜索卡名，或输入 8 位邀请码", text: $cardQuery)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { submitCardField() }
                if !cardQuery.isEmpty {
                    Button {
                        cardQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(Color(uiColor: .secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            if filteredCards.isEmpty {
                Text(cardQuery.isEmpty ? "还没有收到邀请卡。" : "没有匹配的邀请卡；若这是邀请码，按键盘上的“前往”。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 8) {
                    ForEach(filteredCards) { card in
                        receivedCardRow(card)
                    }
                }
            }

            if store.selectedCardId != nil, let header = store.readerHeader {
                VStack(alignment: .leading, spacing: 5) {
                    shareSidebarRow("最近更新", id: nil)
                    ForEach(header.tabs) { tab in
                        shareSidebarRow(tab.name, id: tab.id)
                    }
                }
                .padding(.leading, 12)
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func receivedCardRow(_ card: ReceivedCardDTO) -> some View {
        let selected = store.selectedCardId == card.id
        return Button {
            Task {
                await store.toggleReceivedCard(card, api: api)
                close()
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "envelope.open.fill")
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.title)
                        .font(.subheadline.weight(.semibold))
                    Text(card.ownerName)
                        .font(.caption2)
                        .opacity(0.8)
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                } else {
                    Image(systemName: "chevron.right").font(.caption)
                }
            }
            .foregroundStyle(selected ? Color.white : Color.primary)
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .background(selected ? Color.seeGreen : Color(uiColor: .tertiarySystemFill))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func shareSidebarRow(_ title: String, id: String?) -> some View {
        let selected = store.activeShareId == id
        return Button {
            Task {
                await store.showShare(id, api: api)
                close()
            }
        } label: {
            HStack {
                Image(systemName: "number")
                Text(title).lineLimit(1)
                Spacer()
            }
            .font(.caption)
            .foregroundStyle(selected ? Color.seeBlue : Color.secondary)
            .padding(.vertical, 6)
        }
    }

    private func tagSection(_ title: String, tags: [TagDTO]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 5)
            ForEach(tags) { tag in
                tagRow(tag)
            }
        }
    }

    private func tagRow(_ tag: TagDTO) -> some View {
        HStack(spacing: 10) {
            Button {
                Task {
                    await store.showOwnTag(tag.id, api: api)
                    close()
                }
            } label: {
                HStack(spacing: 10) {
                    Text(tag.icon?.isEmpty == false ? tag.icon! : "#")
                        .font(.title3.weight(.semibold))
                        .frame(width: 26)
                    Text(tag.name)
                        .font(.body)
                        .lineLimit(1)
                    Spacer()
                    Text("\(tag.noteCount)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .foregroundStyle(store.activeOwnTagId == tag.id ? Color.seeGreen : Color.primary)
                .contentShape(Rectangle())
            }

            Menu {
                Button {
                    Task { await store.setPinned(tag, pinned: tag.isPinned != true, api: api) }
                } label: {
                    Label(tag.isPinned == true ? "取消置顶" : "置顶", systemImage: tag.isPinned == true ? "pin.slash" : "pin")
                }
                Button {
                    editingTag = tag
                } label: {
                    Label("编辑名称和图标", systemImage: "pencil")
                }
                Button(role: .destructive) {
                    deletingTag = tag
                } label: {
                    Label("删除标签", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 36)
            }
        }
        .frame(minHeight: 44)
    }

    private var accountFooter: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("当前登录：\(displayName)", systemImage: "person.crop.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button(role: .destructive) {
                Task { await api.logout() }
            } label: {
                Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.subheadline)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }

    private func submitCardField() {
        let code = cardQuery.components(separatedBy: .whitespacesAndNewlines).joined().uppercased()
        let allowed = CharacterSet(charactersIn: "23456789ABCDEFGHJKMNPQRSTUVWXYZ")
        guard code.count == 8, code.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return }
        Task {
            await store.redeem(code, api: api)
            if store.selectedCardId != nil {
                cardQuery = ""
                close()
            }
        }
    }

    private var displayName: String {
        if let name = store.me?.displayName, !name.isEmpty { return name }
        guard let phone = store.me?.phone else { return "See Me" }
        guard phone.count >= 7 else { return phone }
        return String(phone.prefix(3)) + "••••" + String(phone.suffix(4))
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
                Section("名称") {
                    TextField("标签名称", text: $name)
                }
                Section("图标（可选 Emoji）") {
                    TextField("例如 🌱", text: $icon)
                }
            }
            .navigationTitle("编辑标签")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
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
