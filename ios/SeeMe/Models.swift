import Foundation

// Mirrors the backend JSON DTOs.

struct AuthResponse: Codable { let ok: Bool; let token: String?; let user: APIUser? }
struct APIUser: Codable, Identifiable {
    let id: String
    let phone: String
    let displayName: String?
    let createdAt: String?
    let noteCount: Int?
    let tagCount: Int?
}

struct TagRef: Codable, Identifiable, Hashable { let id: String; let name: String }

struct TagDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let icon: String?
    let isPinned: Bool?
    let lastUsedAt: String?
    let noteCount: Int
    let shareCount: Int
}

struct NoteImageRef: Codable, Identifiable, Hashable { let id: String }

struct NoteDTO: Codable, Identifiable {
    let id: String
    let body: String
    let createdAt: String
    let tags: [TagRef]
    let images: [NoteImageRef]
}

struct ShareDTO: Codable, Identifiable {
    let id: String
    let name: String
    let isAutoUpdate: Bool
    let include: [TagRef]
    let exclude: [TagRef]
}

struct CardDTO: Codable, Identifiable {
    let id: String
    let title: String
    let inviteCode: String
    let visibleUntil: String
    let createdAt: String
    let shares: [ShareDTO]
}

struct ShareRef: Codable, Identifiable, Hashable { let id: String; let name: String }

struct ReaderNoteDTO: Codable, Identifiable {
    let id: String
    let body: String
    let createdAt: String
    let shares: [ShareRef]
    let images: [NoteImageRef]
}

struct PreviewResponse: Codable {
    let title: String
    let tabs: [ShareRef]
    let notes: [ReaderNoteDTO]
}

struct RotateResponse: Codable { let inviteCode: String }
struct MeResponse: Codable { let user: APIUser }
struct ReceivedCardDTO: Codable, Identifiable {
    let id: String
    let title: String
    let ownerName: String
}
struct ReceivedCardsResponse: Codable { let cards: [ReceivedCardDTO] }
struct ReaderHeaderResponse: Codable { let title: String; let tabs: [ShareRef] }
struct ReaderNotesResponse: Codable {
    let notes: [ReaderNoteDTO]
    let nextCursor: String?
}
struct RedeemResponse: Codable { let ok: Bool; let cardId: String }

/// Local UI model while A is composing a share inside the card builder.
struct ShareDraft: Identifiable {
    let id = UUID()
    var name: String = ""
    var autoUpdate: Bool = false
    var include: [TagDTO] = []
    var exclude: [TagDTO] = []

    /// Serialize to the backend share-input shape (name optional -> auto-named server-side).
    func payload() -> [String: Any] {
        var p: [String: Any] = [
            "autoUpdate": autoUpdate,
            "include": include.map { $0.id },
            "exclude": exclude.map { $0.id },
        ]
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { p["name"] = trimmed }
        return p
    }
}

// Response envelopes
struct TagsResponse: Codable { let tags: [TagDTO] }
struct TagResponse: Codable { let tag: TagDTO }
struct NotesResponse: Codable { let notes: [NoteDTO] }
struct NoteResponse: Codable { let note: NoteDTO }
struct CardsResponse: Codable { let cards: [CardDTO] }
struct CardResponse: Codable { let card: CardDTO }

/// "2026-06-21T06:50:24.390Z" -> "2026.06.21"
func shortDate(_ iso: String) -> String {
    String(iso.prefix(10)).replacingOccurrences(of: "-", with: ".")
}
