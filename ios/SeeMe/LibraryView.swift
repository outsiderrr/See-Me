import SwiftUI

struct LibraryView: View {
    @EnvironmentObject var api: APIClient
    @State private var notes: [NoteDTO] = []
    @State private var tags: [TagDTO] = []
    @State private var activeTag: String?
    @State private var showCompose = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("全部", active: activeTag == nil) { activeTag = nil; Task { await load() } }
                        ForEach(tags) { t in
                            chip(t.name, active: activeTag == t.id) { activeTag = t.id; Task { await load() } }
                        }
                    }
                    .padding(.horizontal).padding(.vertical, 8)
                }
                Divider()
                List(notes) { n in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(n.body).font(.body)
                        HStack(spacing: 6) {
                            Text(shortDate(n.createdAt)).font(.caption).foregroundStyle(.secondary)
                            ForEach(n.tags) { t in
                                Text(t.name).font(.caption2)
                                    .padding(.horizontal, 8).padding(.vertical, 2)
                                    .background(Color.secondary.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.plain)
                .overlay {
                    if notes.isEmpty { Text("还没有内容,右上角写第一条。").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("我的库")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("退出") { Task { await api.logout() } }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showCompose = true } label: { Image(systemName: "square.and.pencil") }
                }
            }
            .sheet(isPresented: $showCompose) {
                ComposeView { Task { await load() } }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    func chip(_ label: String, active: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(active ? Color.primary : Color.secondary.opacity(0.12))
                .foregroundStyle(active ? Color(uiColor: .systemBackground) : Color.primary)
                .clipShape(Capsule())
        }
    }

    func load() async {
        do {
            async let n = api.listNotes(tagId: activeTag)
            async let t = api.listTags()
            notes = try await n
            tags = try await t
        } catch {}
    }
}

struct ComposeView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let onSaved: () -> Void

    @State private var bodyText = ""
    @State private var tags: [TagDTO] = []
    @State private var selected: Set<String> = []
    @State private var newTag = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("内容") {
                    TextEditor(text: $bodyText).frame(minHeight: 160)
                }
                Section("标签") {
                    ForEach(tags) { t in
                        Button {
                            if selected.contains(t.id) { selected.remove(t.id) } else { selected.insert(t.id) }
                        } label: {
                            HStack {
                                Text(t.name)
                                Spacer()
                                if selected.contains(t.id) { Image(systemName: "checkmark") }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                    HStack {
                        TextField("新建标签", text: $newTag)
                        Button("加") { Task { await addTag() } }
                            .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle("新建笔记")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") { Task { await save() } }
                        .disabled(bodyText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task { await loadTags() }
        }
    }

    func loadTags() async { tags = (try? await api.listTags()) ?? [] }

    func addTag() async {
        let name = newTag.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        if let t = try? await api.createTag(name: name) {
            selected.insert(t.id)
            newTag = ""
            await loadTags()
        }
    }

    func save() async {
        if (try? await api.createNote(body: bodyText, tagIds: Array(selected))) != nil {
            onSaved()
            dismiss()
        }
    }
}
