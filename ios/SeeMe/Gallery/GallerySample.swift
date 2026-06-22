#if DEBUG
import SwiftUI

/// Shared, network-free sample content for the UI-direction gallery.
/// All three visual directions render from THIS single dataset, built on the
/// real DTO types — so the directions differ only in presentation, never in
/// data shape or business logic.
enum Sample {
    // MARK: Author (A) identity
    static let maskedPhone = "+86····9001"
    static let displayName = "林之"
    static let noteCount = 7
    static let tagCount = 7
    static let daysUsed = 96

    // MARK: Tags (with icon / pin / counts, like the live library)
    // icon left nil (matches the live library's common case; the iOS-26.3
    // simulator renders color emoji as .notdef boxes, so each direction shows
    // its own clean tag marker instead).
    static let tagValues = TagDTO(id: "t-val", name: "价值观", icon: nil, isPinned: true, lastUsedAt: nil, noteCount: 2, shareCount: 2)
    static let tagShareable = TagDTO(id: "t-share", name: "可分享", icon: nil, isPinned: true, lastUsedAt: nil, noteCount: 2, shareCount: 3)
    static let tagDaily = TagDTO(id: "t-daily", name: "日常", icon: nil, isPinned: false, lastUsedAt: nil, noteCount: 3, shareCount: 0)
    static let tagIdeas = TagDTO(id: "t-idea", name: "想法", icon: nil, isPinned: false, lastUsedAt: nil, noteCount: 2, shareCount: 1)
    static let tagReading = TagDTO(id: "t-read", name: "读书", icon: nil, isPinned: false, lastUsedAt: nil, noteCount: 1, shareCount: 0)
    static let tagPrivate = TagDTO(id: "t-priv", name: "私密", icon: nil, isPinned: false, lastUsedAt: nil, noteCount: 1, shareCount: 0)
    static let tagChild = TagDTO(id: "t-child", name: "童年", icon: nil, isPinned: false, lastUsedAt: nil, noteCount: 2, shareCount: 1)

    static var allTags: [TagDTO] {
        [tagValues, tagShareable, tagDaily, tagIdeas, tagReading, tagPrivate, tagChild]
    }
    static var pinnedTags: [TagDTO] { allTags.filter { $0.isPinned == true } }

    private static func tagRef(_ t: TagDTO) -> TagRef { TagRef(id: t.id, name: t.name) }

    // MARK: Own notes (the author's private library)
    static let notes: [NoteDTO] = [
        NoteDTO(id: "n1", body: "今天散步四十分钟，什么也没想，挺好。",
                createdAt: "2026-06-21T17:11:00.000Z",
                tags: [tagRef(tagDaily)], images: []),
        NoteDTO(id: "n2", body: "重读《被讨厌的勇气》：课题分离不是冷漠，是把别人怎么想，还给别人。",
                createdAt: "2026-06-21T16:02:00.000Z",
                tags: [tagRef(tagReading), tagRef(tagIdeas)], images: []),
        NoteDTO(id: "n3", body: "记录这件事本身，就是一种温柔的自我对待。",
                createdAt: "2026-06-20T22:40:00.000Z",
                tags: [tagRef(tagIdeas)], images: []),
        NoteDTO(id: "n4", body: "上周末回了趟老家，院子里那棵石榴树又开花了。小时候总嫌它挡光，现在只想多看两眼。",
                createdAt: "2026-06-19T09:18:00.000Z",
                tags: [tagRef(tagDaily)],
                images: [NoteImageRef(id: "img-a"), NoteImageRef(id: "img-b"), NoteImageRef(id: "img-c")]),
        NoteDTO(id: "n5", body: "（一段还没准备好给任何人看的童年记录。）",
                createdAt: "2026-06-18T23:55:00.000Z",
                tags: [tagRef(tagChild), tagRef(tagPrivate)], images: []),
        NoteDTO(id: "n6", body: "关于钱，我的底线很简单：不为它做让自己羞耻的事，也不因为缺它，就轻看自己。",
                createdAt: "2026-06-17T15:29:00.000Z",
                tags: [tagRef(tagValues), tagRef(tagShareable)], images: []),
        NoteDTO(id: "n7", body: "我一直觉得，被理解比被认同更重要。认同是站在你这边，理解是愿意走进你那一边。",
                createdAt: "2026-06-15T15:29:00.000Z",
                tags: [tagRef(tagValues), tagRef(tagShareable)], images: []),
    ]

    // MARK: Reader side — a card someone shared with me (B view)
    static let readerCardTitle = "给老朋友"
    static let readerOwner = "林之"
    static let readerTabs: [ShareRef] = [
        ShareRef(id: "s-val", name: "我的价值观"),
        ShareRef(id: "s-child", name: "我们的童年"),
    ]
    static let readerNotes: [ReaderNoteDTO] = [
        ReaderNoteDTO(id: "r1", body: "关于钱，我的底线很简单：不为它做让自己羞耻的事，也不因为缺它，就轻看自己。",
                      createdAt: "2026-06-17T15:29:00.000Z",
                      shares: [ShareRef(id: "s-val", name: "我的价值观")], images: []),
        ReaderNoteDTO(id: "r2", body: "我一直觉得，被理解比被认同更重要。认同是站在你这边，理解是愿意走进你那一边。",
                      createdAt: "2026-06-15T15:29:00.000Z",
                      shares: [ShareRef(id: "s-val", name: "我的价值观")], images: []),
        ReaderNoteDTO(id: "r3", body: "小时候父亲很少表达情感，但他每天五点起床给我做早饭。很多年后我才明白，那就是他的方式。",
                      createdAt: "2026-06-12T08:05:00.000Z",
                      shares: [ShareRef(id: "s-child", name: "我们的童年")], images: []),
    ]

    // MARK: Received cards (cards others shared with me). [0] = most recently
    // read/loaded — the one shown when the sidebar list is collapsed.
    static let receivedCards: [ReceivedCardDTO] = [
        ReceivedCardDTO(id: "rc1", title: "给老朋友", ownerName: "林之"),
        ReceivedCardDTO(id: "rc2", title: "写给在意的人", ownerName: "苏晓"),
        ReceivedCardDTO(id: "rc3", title: "我的近况", ownerName: "陈默"),
    ]

    // MARK: Own issued cards (A's "卡" management list)
    static let ownCards: [CardDTO] = [
        CardDTO(id: "c1", title: "给老朋友", inviteCode: "K7M2PQR9",
                visibleUntil: "2026-06-21T00:00:00.000Z", createdAt: "2026-04-02T00:00:00.000Z",
                shares: [
                    ShareDTO(id: "s-val", name: "我的价值观", isAutoUpdate: true,
                             include: [tagRef(tagValues), tagRef(tagShareable)], exclude: [tagRef(tagPrivate)]),
                    ShareDTO(id: "s-child", name: "我们的童年", isAutoUpdate: false,
                             include: [tagRef(tagChild)], exclude: [tagRef(tagPrivate)]),
                ]),
        CardDTO(id: "c2", title: "家人", inviteCode: "T4XB8N6H",
                visibleUntil: "2026-06-20T00:00:00.000Z", createdAt: "2026-05-11T00:00:00.000Z",
                shares: [
                    ShareDTO(id: "s-fam", name: "日常碎片", isAutoUpdate: true,
                             include: [tagRef(tagDaily)], exclude: []),
                ]),
        CardDTO(id: "c3", title: "想更了解我的人", inviteCode: "W9HJ3FZ2",
                visibleUntil: "2026-06-18T00:00:00.000Z", createdAt: "2026-06-01T00:00:00.000Z",
                shares: [
                    ShareDTO(id: "s-think", name: "一些想法", isAutoUpdate: true,
                             include: [tagRef(tagIdeas)], exclude: []),
                    ShareDTO(id: "s-read", name: "在读的书", isAutoUpdate: true,
                             include: [tagRef(tagReading)], exclude: []),
                    ShareDTO(id: "s-val2", name: "价值观", isAutoUpdate: false,
                             include: [tagRef(tagValues)], exclude: [tagRef(tagPrivate)]),
                ]),
    ]

    // MARK: Compose sample states
    static let composeOpenText = "重读《被讨厌的勇气》：课题分离不是冷漠，是把别人怎么想，还给别人。"
    static let composeTagDraft = "重读《被讨厌的勇气》，关于课题分离的一点想法。\n#想"
    static let composeTagQuery = "想"
}

// MARK: - Date formatting (each direction picks the voice it wants)

enum SampleDate {
    private static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? {
            let g = ISO8601DateFormatter(); g.formatOptions = [.withInternetDateTime]
            return g.date(from: iso)
        }()
    }
    private static func fmt(_ iso: String, _ pattern: String) -> String {
        guard let d = parse(iso) else { return shortDate(iso) }
        let out = DateFormatter()
        out.locale = Locale(identifier: "zh_CN")
        out.dateFormat = pattern
        return out.string(from: d)
    }
    /// "6月21日"
    static func dayLabel(_ iso: String) -> String { fmt(iso, "M月d日") }
    /// "17:11"
    static func clock(_ iso: String) -> String { fmt(iso, "HH:mm") }
    /// "6月21日 周六"
    static func dayWithWeekday(_ iso: String) -> String { fmt(iso, "M月d日 EEEE") }
    /// "2026.06.21"
    static func dotted(_ iso: String) -> String { fmt(iso, "yyyy.MM.dd") }
    /// "2026 / 06 / 21  17:11"
    static func editorial(_ iso: String) -> String { fmt(iso, "yyyy / MM / dd  HH:mm") }
}

/// Local, network-free placeholder for image notes so layout reads correctly
/// without hitting the backend's protected image endpoint.
struct SamplePhoto: View {
    let seed: Int
    private var pair: (Color, Color) {
        let palettes: [(Color, Color)] = [
            (Color(red: 0.86, green: 0.78, blue: 0.62), Color(red: 0.74, green: 0.62, blue: 0.45)),
            (Color(red: 0.78, green: 0.82, blue: 0.74), Color(red: 0.56, green: 0.64, blue: 0.55)),
            (Color(red: 0.84, green: 0.74, blue: 0.70), Color(red: 0.66, green: 0.52, blue: 0.50)),
        ]
        return palettes[seed % palettes.count]
    }
    var body: some View {
        LinearGradient(colors: [pair.0, pair.1], startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(
                Image(systemName: ["leaf", "camera.macro", "tree"][seed % 3])
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(.white.opacity(0.55))
            )
    }
}
#endif
