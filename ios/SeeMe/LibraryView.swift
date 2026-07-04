import SwiftUI
import UIKit

// MARK: - Date helpers (zh_CN)

private func parseISO(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? {
        let g = ISO8601DateFormatter(); g.formatOptions = [.withInternetDateTime]
        return g.date(from: iso)
    }()
}
private func fmt(_ iso: String, _ pattern: String) -> String {
    guard let d = parseISO(iso) else { return shortDate(iso) }
    let out = DateFormatter()
    out.locale = Locale(identifier: "zh_CN")
    out.dateFormat = pattern
    return out.string(from: d)
}
private func memoClock(_ iso: String) -> String { fmt(iso, "HH:mm") }
private func memoDay(_ iso: String) -> String { fmt(iso, "M月d日") }
private func memoDayWeekday(_ iso: String) -> String { fmt(iso, "M月d日 EEEE") }
private func memoDayKey(_ iso: String) -> String { fmt(iso, "yyyy-MM-dd") }

struct LibraryView: View {
    private static var debugShowCompose: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--show-compose")
        #else
        false
        #endif
    }

    @EnvironmentObject private var api: APIClient
    @ObservedObject var store: LibraryStore
    @Binding var searchOpen: Bool
    @State private var showCompose = LibraryView.debugShowCompose
    @State private var editingNote: NoteDTO?
    @State private var deletingNote: NoteDTO?
    @State private var query = ""
    @FocusState private var searchFocused: Bool

    private var ownGroups: [(String, [NoteDTO])] {
        var order: [String] = []; var map: [String: [NoteDTO]] = [:]
        for n in store.notes {
            let k = memoDayKey(n.createdAt)
            if map[k] == nil { order.append(k) }
            map[k, default: []].append(n)
        }
        return order.map { (memoDayWeekday(map[$0]!.first!.createdAt), map[$0]!) }
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 0) {
                if searchOpen && store.selectedCardId == nil { searchBar }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        contextHeader
                        if store.selectedCardId == nil {
                            ownStream
                        } else {
                            readerStream
                        }
                    }
                    .padding(.horizontal, Theme.hPad)
                    .padding(.top, 6)
                    .padding(.bottom, 112)
                }
                .refreshable { await store.loadAll(api) }
            }

            if store.selectedCardId == nil {
                Button { showCompose = true } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(Theme.paper)
                        .frame(width: 54, height: 54)
                        .background(Circle().fill(Theme.ink))
                }
                .padding(.trailing, 24)
                .padding(.bottom, 28)
            }
        }
        .paperBackground()
        .sheet(isPresented: $showCompose) {
            ComposeView {
                await store.reloadOwn(api)
            }
            .presentationDetents([.height(300), .large])
            .presentationDragIndicator(.visible)
            .composerSheetShape()
        }
        .sheet(item: $editingNote) { note in
            ComposeView(editing: note) {
                await store.reloadOwn(api)
            }
            .presentationDetents([.height(300), .large])
            .presentationDragIndicator(.visible)
            .composerSheetShape()
        }
        .confirmationDialog(
            "删除这条笔记？",
            isPresented: Binding(get: { deletingNote != nil }, set: { if !$0 { deletingNote = nil } }),
            titleVisibility: .visible
        ) {
            Button("删除", role: .destructive) {
                guard let note = deletingNote else { return }
                Task { await store.deleteNote(note, api: api) }
                deletingNote = nil
            }
            Button("取消", role: .cancel) { deletingNote = nil }
        } message: {
            Text("这条笔记和它的图片会一起删除，发出的卡里也不再显示。")
        }
        .onChange(of: searchOpen) { open in
            if open {
                searchFocused = true
            } else {
                query = ""
                Task { await store.searchOwn("", api: api) }
            }
        }
        .task(id: query) {
            // Debounced live search while typing.
            guard searchOpen, query != store.searchQuery else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await store.searchOwn(query, api: api)
        }
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.arguments.contains("--search-demo") {
                searchOpen = true
                query = "勇气"
            }
            if ProcessInfo.processInfo.arguments.contains("--edit-first") {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                editingNote = store.notes.first
            }
        }
        #endif
    }

    private var searchBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .light)).foregroundStyle(Theme.faint)
                TextField("搜索我的笔记", text: $query)
                    .font(Theme.serif(16))
                    .foregroundStyle(Theme.ink)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .onSubmit { Task { await store.searchOwn(query, api: api) } }
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(Theme.faint)
                    }
                }
                Button { withAnimation(.easeOut(duration: 0.15)) { searchOpen = false } } label: {
                    Text("取消").font(.system(size: 13)).foregroundStyle(Theme.clay)
                }
            }
            Hairline()
        }
        .padding(.horizontal, Theme.hPad)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }

    // MARK: Context header

    @ViewBuilder
    private var contextHeader: some View {
        if let card = store.selectedCard, let header = store.readerHeader {
            // Reader letterhead — who shared is primary; the card name secondary.
            // No tab row: category filtering lives in the left index (sidebar).
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(card.ownerName).font(Theme.serif(27, .semibold)).foregroundStyle(Theme.ink)
                    Text("分享给你 ·《\(header.title)》").font(.system(size: 13)).foregroundStyle(Theme.soft)
                    if let active = header.tabs.first(where: { $0.id == store.activeShareId }) {
                        Text("正在看 · \(active.name)").font(.system(size: 12)).foregroundStyle(Theme.clay).padding(.top, 2)
                    }
                }
                Spacer()
                Button { Task { await store.showAllNotes(api) } } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "chevron.left").font(.system(size: 10, weight: .semibold))
                        Text("我的库").font(.system(size: 12.5))
                    }
                    .foregroundStyle(Theme.clay)
                }
            }
            Hairline().padding(.top, 16).padding(.bottom, 22)
        } else if let active = store.tags.first(where: { $0.id == store.activeOwnTagId }) {
            HStack {
                Text(active.icon?.isEmpty == false ? "\(active.icon!) \(active.name)" : active.name)
                    .font(Theme.serif(22, .semibold)).foregroundStyle(Theme.ink)
                Spacer()
                Button { Task { await store.showAllNotes(api) } } label: {
                    Text("全部笔记").font(.system(size: 12.5)).foregroundStyle(Theme.clay)
                }
            }
            Hairline().padding(.top, 14).padding(.bottom, 20)
        }
    }

    // MARK: Streams

    @ViewBuilder
    private var ownStream: some View {
        if store.notes.isEmpty {
            emptyState(store.searchQuery.isEmpty ? "还没有内容，点右下角写第一条。" : "没有找到匹配的笔记。")
        } else {
            ForEach(Array(ownGroups.enumerated()), id: \.offset) { gi, group in
                dayHeader(group.0).padding(.top, gi == 0 ? 2 : 30).padding(.bottom, 16)
                ForEach(Array(group.1.enumerated()), id: \.element.id) { i, note in
                    JournalEntry(
                        time: memoClock(note.createdAt),
                        text: note.body,
                        tagNames: note.tags.map { $0.name },
                        imagePaths: note.images.map { "/api/notes/images/\($0.id)" }
                    )
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button { editingNote = note } label: { Label("编辑", systemImage: "pencil") }
                        Button(role: .destructive) { deletingNote = note } label: { Label("删除", systemImage: "trash") }
                    }
                    if i < group.1.count - 1 { Hairline().padding(.vertical, 20) }
                }
            }
        }
    }

    @ViewBuilder
    private var readerStream: some View {
        if store.readerNotes.isEmpty {
            emptyState("这个分类里还没有内容。")
        } else {
            ForEach(Array(store.readerNotes.enumerated()), id: \.element.id) { i, note in
                JournalEntry(
                    time: memoDay(note.createdAt),
                    text: note.body,
                    tagNames: note.shares.map(\.name),
                    imagePaths: note.images.map { "/api/read/\(store.selectedCardId ?? "")/images/\($0.id)" }
                )
                if i < store.readerNotes.count - 1 { Hairline().padding(.vertical, 22) }
            }
        }
    }

    private func dayHeader(_ label: String) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.clay).frame(width: 4, height: 4)
            Text(label).font(.system(size: 12.5, weight: .semibold)).tracking(1).foregroundStyle(Theme.soft)
        }
    }

    private func emptyState(_ text: String) -> some View {
        Text(text)
            .font(Theme.serif(16))
            .foregroundStyle(Theme.soft)
            .frame(maxWidth: .infinity)
            .padding(.top, 90)
    }
}

// MARK: - Journal entry (shared by own + reader)

struct JournalEntry: View {
    let time: String
    let text: String
    let tagNames: [String]
    let imagePaths: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 8) {
                Text(time).font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(Theme.faint)
                Spacer()
                if !tagNames.isEmpty { ClayTags(names: tagNames) }
            }
            if !text.isEmpty {
                NoteBody(markdown: text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !imagePaths.isEmpty {
                ProtectedImageGrid(paths: imagePaths)
            }
        }
    }
}

struct ClayTags: View {
    let names: [String]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, n in
                if i > 0 { Text("·").foregroundStyle(Theme.faint).padding(.horizontal, 6) }
                Text(n).font(.system(size: 12.5)).tracking(0.5).foregroundStyle(Theme.clay)
            }
        }
    }
}

struct ProtectedImageGrid: View {
    let paths: [String]
    private let columns = [
        GridItem(.flexible(), spacing: 6),
        GridItem(.flexible(), spacing: 6),
        GridItem(.flexible(), spacing: 6),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 6) {
            ForEach(paths, id: \.self) { path in
                ProtectedImage(path: path)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .padding(.top, 2)
    }
}

struct ProtectedImage: View {
    @EnvironmentObject private var api: APIClient
    let path: String
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.rule
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .clipped()
        .task(id: path) {
            if let data = try? await api.imageData(path: path) {
                image = UIImage(data: data)
            }
        }
    }
}
