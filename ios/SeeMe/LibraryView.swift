import SwiftUI
import UIKit

extension Color {
    static let seeGreen = Color(red: 0.18, green: 0.58, blue: 0.37)
    static let seeBlue = Color(red: 0.12, green: 0.52, blue: 0.88)
    static let memoBackground = Color(uiColor: .systemGroupedBackground)
    static let memoCard = Color(uiColor: .secondarySystemGroupedBackground)
}

func memoTime(_ iso: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: iso) ?? {
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: iso)
    }()
    guard let date else { return shortDate(iso) }
    let output = DateFormatter()
    output.dateFormat = "yyyy-MM-dd HH:mm"
    return output.string(from: date)
}

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
    @State private var showCompose = LibraryView.debugShowCompose

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.memoBackground.ignoresSafeArea()

            ScrollView {
                LazyVStack(spacing: 12) {
                    contextHeader
                    if store.selectedCardId == nil {
                        ownNotes
                    } else {
                        receivedNotes
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 96)
            }
            .refreshable { await store.loadAll(api) }

            if store.selectedCardId == nil {
                Button { showCompose = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 62, height: 62)
                        .background(Color.seeGreen)
                        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                        .shadow(color: .black.opacity(0.2), radius: 10, y: 4)
                }
                .padding(.bottom, 18)
            }
        }
        .sheet(isPresented: $showCompose) {
            ComposeView {
                await store.reloadOwn(api)
            }
            .presentationDetents([.height(285), .large])
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private var contextHeader: some View {
        if let card = store.selectedCard, let header = store.readerHeader {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(header.title).font(.headline)
                        Text("\(card.ownerName) 分享给你")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await store.showAllNotes(api) }
                    } label: {
                        Label("回到我的库", systemImage: "xmark.circle.fill")
                            .font(.caption)
                    }
                }
                shareTabs(header.tabs)
            }
            .padding(14)
            .background(Color.memoCard)
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        } else if let active = store.tags.first(where: { $0.id == store.activeOwnTagId }) {
            HStack {
                Text("\(active.icon ?? "#") \(active.name)")
                    .font(.headline)
                Spacer()
                Button("查看全部") {
                    Task { await store.showAllNotes(api) }
                }
                .font(.caption)
            }
            .padding(.horizontal, 4)
        }
    }

    private func shareTabs(_ tabs: [ShareRef]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                shareChip("最近更新", id: nil)
                ForEach(tabs) { tab in shareChip(tab.name, id: tab.id) }
            }
        }
    }

    private func shareChip(_ title: String, id: String?) -> some View {
        let selected = store.activeShareId == id
        return Button {
            Task { await store.showShare(id, api: api) }
        } label: {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(selected ? Color.white : Color.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(selected ? Color.seeGreen : Color(uiColor: .tertiarySystemFill))
                .clipShape(Capsule())
        }
    }

    @ViewBuilder
    private var ownNotes: some View {
        if store.notes.isEmpty {
            emptyState("还没有内容，点下方的 + 写第一条。")
        }
        ForEach(store.notes) { note in
            OwnMemoCard(note: note)
        }
    }

    @ViewBuilder
    private var receivedNotes: some View {
        if store.readerNotes.isEmpty {
            emptyState("这个分享分类里还没有内容。")
        }
        ForEach(store.readerNotes) { note in
            ReaderMemoCard(note: note, cardId: store.selectedCardId ?? "")
        }
    }

    private func emptyState(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
    }
}

struct OwnMemoCard: View {
    let note: NoteDTO

    var body: some View {
        MemoCardShell(
            time: memoTime(note.createdAt),
            content: note.body,
            chips: note.tags.map { "#\($0.name)" },
            imagePaths: note.images.map { "/api/notes/images/\($0.id)" }
        )
    }
}

struct ReaderMemoCard: View {
    let note: ReaderNoteDTO
    let cardId: String

    var body: some View {
        MemoCardShell(
            time: memoTime(note.createdAt),
            content: note.body,
            chips: note.shares.map(\.name),
            imagePaths: note.images.map { "/api/read/\(cardId)/images/\($0.id)" }
        )
    }
}

struct MemoCardShell: View {
    let time: String
    let content: String
    let chips: [String]
    let imagePaths: [String]

    var bodyView: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Text(time)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            if !chips.isEmpty {
                FlexibleChipText(chips: chips)
            }
            if !content.isEmpty {
                Text(content)
                    .font(.system(size: 16))
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !imagePaths.isEmpty {
                ProtectedImageGrid(paths: imagePaths)
            }
        }
    }

    var body: some View {
        bodyView
            .padding(16)
            .background(Color.memoCard)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.primary.opacity(0.035), lineWidth: 1)
            }
    }
}

struct FlexibleChipText: View {
    let chips: [String]

    var body: some View {
        Text(chips.joined(separator: "  "))
            .font(.callout)
            .foregroundStyle(Color.seeBlue)
            .fixedSize(horizontal: false, vertical: true)
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
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }
}

struct ProtectedImage: View {
    @EnvironmentObject private var api: APIClient
    let path: String
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.secondary.opacity(0.1)
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
