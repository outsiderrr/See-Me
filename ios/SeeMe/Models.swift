import Foundation

// Mirrors the backend JSON DTOs.

struct AuthResponse: Codable { let ok: Bool; let token: String?; let user: APIUser? }
struct APIUser: Codable, Identifiable { let id: String; let phone: String; let displayName: String? }

struct TagRef: Codable, Identifiable, Hashable { let id: String; let name: String }

struct TagDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let noteCount: Int
    let shareCount: Int
}

struct NoteDTO: Codable, Identifiable {
    let id: String
    let body: String
    let createdAt: String
    let tags: [TagRef]
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
