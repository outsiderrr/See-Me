#if DEBUG
import SwiftUI

// MARK: - Direction C · 亲密关系档案
// Two consistent "rooms": MY library (pine-toned, mine) and a RECEIVED card
// (a warm, framed dossier where the person's NAME leads and share categories
// read like folder tabs). Same record component & radii across both rooms, so
// it reads as one product with a clear emotional boundary between them.

enum C {
    static let bgMine  = dyn(Color(red: 0.945, green: 0.937, blue: 0.922), Color(red: 0.075, green: 0.078, blue: 0.086))
    static let bgRead  = dyn(Color(red: 0.929, green: 0.910, blue: 0.886), Color(red: 0.090, green: 0.082, blue: 0.071))
    static let card    = dyn(Color(red: 0.992, green: 0.988, blue: 0.980), Color(red: 0.129, green: 0.133, blue: 0.145))
    static let ink     = dyn(Color(red: 0.129, green: 0.125, blue: 0.110), Color(red: 0.925, green: 0.918, blue: 0.902))
    static let soft    = dyn(Color(red: 0.431, green: 0.416, blue: 0.384), Color(red: 0.600, green: 0.584, blue: 0.549))
    static let faint   = dyn(Color(red: 0.612, green: 0.596, blue: 0.561), Color(red: 0.443, green: 0.427, blue: 0.396))
    static let pine    = dyn(Color(red: 0.200, green: 0.314, blue: 0.243), Color(red: 0.494, green: 0.682, blue: 0.557))
    static let clay    = dyn(Color(red: 0.659, green: 0.412, blue: 0.290), Color(red: 0.820, green: 0.580, blue: 0.451))
    static let danger  = dyn(Color(red: 0.643, green: 0.302, blue: 0.255), Color(red: 0.831, green: 0.471, blue: 0.420))
    static let hairline = dyn(Color(red: 0.129, green: 0.125, blue: 0.110).opacity(0.09), Color.white.opacity(0.09))
    static let cover   = dyn(Color(red: 0.231, green: 0.180, blue: 0.149), Color(red: 0.165, green: 0.129, blue: 0.106))
    static let cream   = Color(red: 0.953, green: 0.937, blue: 0.910)
}

enum DirectionC {
    @ViewBuilder
    static func screen(_ key: String) -> some View {
        switch key {
        case "library":     C_Library()
        case "sidebar":     C_Sidebar()
        case "compose":     C_Compose(state: .collapsed)
        case "composeopen": C_Compose(state: .expanded)
        case "composetags": C_Compose(state: .tags)
        case "reader":      C_Reader()
        case "cards":       C_Cards()
        default:            C_Library()
        }
    }
}

// MARK: Shared pieces

private struct C_DateRail: View {
    let iso: String
    let accent: Color
    var body: some View {
        VStack(spacing: 5) {
            Text(SampleDate.dayLabel(iso).replacingOccurrences(of: "日", with: ""))
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
                .multilineTextAlignment(.center)
            Rectangle().fill(accent.opacity(0.30)).frame(width: 1, height: 26)
        }
        .frame(width: 36)
    }
}

private struct C_Label: View {
    let text: String
    let accent: Color
    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 7, height: 7)
            Text(text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(C.soft)
        }
    }
}

private struct C_Record<Content: View>: View {
    let iso: String
    let accent: Color
    @ViewBuilder let content: Content
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            C_DateRail(iso: iso, accent: accent)
            VStack(alignment: .leading, spacing: 10) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)
        }
    }
}

private struct C_Toggle: View {
    let active: String
    var body: some View {
        HStack(spacing: 6) {
            seg("库"); seg("卡")
        }
    }
    private func seg(_ t: String) -> some View {
        Text(t)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active == t ? C.cream : C.soft)
            .padding(.horizontal, 16).padding(.vertical, 7)
            .background(Capsule().fill(active == t ? C.pine : .clear))
    }
}

// MARK: Library (MY room)

private struct C_Library: View {
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "line.horizontal.3").font(.system(size: 17, weight: .medium)).foregroundStyle(C.soft).frame(width: 30, alignment: .leading)
                    Spacer()
                    C_Toggle(active: "库")
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 14)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // my header
                        VStack(alignment: .leading, spacing: 6) {
                            Text("我的库").font(.system(size: 27, weight: .bold)).foregroundStyle(C.ink)
                            Text("\(Sample.noteCount) 条记录 · 只有我自己看得到")
                                .font(.system(size: 13)).foregroundStyle(C.soft)
                        }
                        .padding(.bottom, 22)

                        VStack(spacing: 0) {
                            ForEach(Array(Sample.notes.enumerated()), id: \.element.id) { i, note in
                                C_Record(iso: note.createdAt, accent: C.pine) {
                                    Text(note.body).font(.system(size: 16)).foregroundStyle(C.ink).lineSpacing(6)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if !note.images.isEmpty {
                                        HStack(spacing: 6) {
                                            ForEach(Array(note.images.enumerated()), id: \.offset) { j, _ in
                                                SamplePhoto(seed: j).frame(width: 84, height: 84)
                                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                            }
                                        }
                                    }
                                    if !note.tags.isEmpty {
                                        HStack(spacing: 14) { ForEach(note.tags) { C_Label(text: $0.name, accent: C.pine) } }
                                    }
                                }
                                if i < Sample.notes.count - 1 {
                                    Rectangle().fill(C.hairline).frame(height: 1).padding(.leading, 48).padding(.vertical, 16)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 2).padding(.bottom, 110)
                }
            }
            Button {} label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 19, weight: .medium)).foregroundStyle(C.cream)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(C.pine))
                    .shadow(color: C.pine.opacity(0.35), radius: 10, y: 4)
            }
            .padding(.trailing, 22).padding(.bottom, 28)
        }
        .galleryBackground(C.bgMine)
    }
}

// MARK: Sidebar

private struct C_Sidebar: View {
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 14) {
                        Circle().fill(C.pine).frame(width: 52, height: 52)
                            .overlay(Text(String(Sample.displayName.prefix(1))).font(.system(size: 22, weight: .semibold)).foregroundStyle(C.cream))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(Sample.displayName).font(.system(size: 20, weight: .bold)).foregroundStyle(C.ink)
                            Text(Sample.maskedPhone).font(.system(size: 12.5)).foregroundStyle(C.faint)
                        }
                        Spacer()
                    }
                    .padding(.top, 8)

                    HStack(spacing: 24) {
                        stat("\(Sample.noteCount)", "笔记"); stat("\(Sample.tagCount)", "标签"); stat("\(Sample.daysUsed)", "天")
                    }
                    .padding(.top, 20)

                    navRow("全部笔记", active: true).padding(.top, 20)

                    header("收到的邀请卡", accent: C.clay).padding(.top, 26)
                    searchField.padding(.top, 12)
                    receivedRow.padding(.top, 10)

                    header("我的标签", accent: C.pine).padding(.top, 26)
                    VStack(spacing: 0) { ForEach(Sample.allTags) { tagRow($0) } }.padding(.top, 4)
                }
                .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 24)
            }
            Rectangle().fill(C.hairline).frame(height: 1)
            HStack {
                Label("当前登录 · \(Sample.maskedPhone)", systemImage: "person.crop.circle")
                    .font(.system(size: 12)).foregroundStyle(C.faint)
                Spacer()
                Text("退出登录").font(.system(size: 13, weight: .medium)).foregroundStyle(C.danger)
            }
            .padding(.horizontal, 22).padding(.vertical, 16)
        }
        .galleryBackground(C.bgMine)
    }
    private func stat(_ n: String, _ t: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(n).font(.system(size: 23, weight: .bold)).foregroundStyle(C.ink)
            Text(t).font(.system(size: 11.5)).foregroundStyle(C.faint)
        }
    }
    private func header(_ t: String, accent: Color) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 3, height: 14)
            Text(t).font(.system(size: 13, weight: .semibold)).tracking(0.5).foregroundStyle(C.soft)
        }
    }
    private func navRow(_ t: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "tray.full").font(.system(size: 15, weight: .medium)).foregroundStyle(C.cream).frame(width: 22)
            Text(t).font(.system(size: 16, weight: .semibold)).foregroundStyle(C.cream)
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(C.cream.opacity(0.7))
        }
        .padding(.horizontal, 16).frame(height: 52)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(active ? C.pine : C.faint))
    }
    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(C.faint)
            Text("搜索卡名，或输入 8 位邀请码").font(.system(size: 13.5)).foregroundStyle(C.faint)
            Spacer()
        }
        .padding(.horizontal, 14).frame(height: 42)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(C.card))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(C.hairline, lineWidth: 1))
    }
    private var receivedRow: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 9, style: .continuous).fill(C.clay.opacity(0.16))
                .frame(width: 40, height: 40)
                .overlay(Image(systemName: "doc.text").font(.system(size: 16)).foregroundStyle(C.clay))
            VStack(alignment: .leading, spacing: 2) {
                Text(Sample.readerCardTitle).font(.system(size: 15, weight: .semibold)).foregroundStyle(C.ink)
                Text("\(Sample.readerOwner) 分享给你").font(.system(size: 12)).foregroundStyle(C.clay)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(C.faint)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(C.card))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(C.clay.opacity(0.25), lineWidth: 1))
    }
    private func tagRow(_ tag: TagDTO) -> some View {
        HStack(spacing: 12) {
            Text(tag.icon?.isEmpty == false ? tag.icon! : "#").font(.system(size: 15)).foregroundStyle(C.soft).frame(width: 22)
            Text(tag.name).font(.system(size: 15.5)).foregroundStyle(C.ink)
            if tag.isPinned == true { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(C.pine) }
            Spacer()
            Text("\(tag.noteCount)").font(.system(size: 13)).foregroundStyle(C.faint)
            Image(systemName: "ellipsis").font(.system(size: 14)).foregroundStyle(C.faint).padding(.leading, 8)
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(C.hairline).frame(height: 1) }
    }
}

// MARK: Compose

private struct C_Compose: View {
    enum State { case collapsed, expanded, tags }
    let state: State
    var body: some View {
        ZStack(alignment: .bottom) {
            C_Library().disabled(true)
            Color.black.opacity(0.20).ignoresSafeArea()
            panel
        }
    }
    private var panel: some View {
        VStack(spacing: 0) {
            Capsule().fill(C.faint.opacity(0.5)).frame(width: 36, height: 5).padding(.top, 10).padding(.bottom, 12)
            if state == .tags { suggestions; Rectangle().fill(C.hairline).frame(height: 1) }
            VStack(alignment: .leading, spacing: 8) {
                switch state {
                case .collapsed: Text("写给未来某个人，或只给自己…").font(.system(size: 16)).foregroundStyle(C.faint)
                case .expanded:
                    Text(Sample.composeOpenText).font(.system(size: 16)).foregroundStyle(C.ink).lineSpacing(6)
                case .tags:
                    (Text("重读《被讨厌的勇气》，关于课题分离的一点想法。\n").font(.system(size: 16)).foregroundColor(C.ink)
                     + Text("#想").font(.system(size: 16, weight: .semibold)).foregroundColor(C.pine)).lineSpacing(6)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: state == .collapsed ? 86 : (state == .tags ? 76 : 220))
            .padding(.horizontal, 22).padding(.top, 4)
            Rectangle().fill(C.hairline).frame(height: 1)
            toolbar
        }
        .background(C.card)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(C.hairline, lineWidth: 1))
        .padding(.horizontal, 7).padding(.bottom, 7)
    }
    private var suggestions: some View {
        VStack(spacing: 0) {
            ForEach([Sample.tagIdeas, Sample.tagReading]) { tag in
                HStack {
                    C_Label(text: tag.name, accent: C.pine)
                    Spacer()
                    Text("\(tag.noteCount) 条").font(.system(size: 12)).foregroundStyle(C.faint)
                }
                .padding(.horizontal, 22).frame(height: 46)
            }
            HStack {
                Image(systemName: "plus.circle").font(.system(size: 14)).foregroundStyle(C.soft)
                Text("新建标签「想」").font(.system(size: 15)).foregroundStyle(C.soft)
                Spacer()
            }.padding(.horizontal, 22).frame(height: 44)
        }
    }
    private var toolbar: some View {
        HStack(spacing: 24) {
            Image(systemName: "number").font(.system(size: 18, weight: .medium)).foregroundStyle(C.soft)
            Image(systemName: "photo").font(.system(size: 17, weight: .medium)).foregroundStyle(C.soft)
            Spacer()
            Image(systemName: "arrow.up")
                .font(.system(size: 16, weight: .bold)).foregroundStyle(C.cream)
                .frame(width: 46, height: 38)
                .background(Capsule().fill(state == .collapsed ? C.faint : C.pine))
        }
        .padding(.horizontal, 22).frame(height: 58)
    }
}

// MARK: Reader (the RECEIVED room — the dossier)

private struct C_Reader: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold)).foregroundStyle(C.soft).frame(width: 30, alignment: .leading)
                Spacer()
                Text("收到的邀请卡").font(.system(size: 13, weight: .medium)).foregroundStyle(C.soft)
                Spacer()
                Color.clear.frame(width: 30, height: 30)
            }
            .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    cover.padding(.bottom, 26)
                    VStack(spacing: 0) {
                        ForEach(Array(Sample.readerNotes.enumerated()), id: \.element.id) { i, note in
                            C_Record(iso: note.createdAt, accent: C.clay) {
                                Text(note.body).font(.system(size: 16.5)).foregroundStyle(C.ink).lineSpacing(7)
                                    .fixedSize(horizontal: false, vertical: true)
                                HStack(spacing: 14) { ForEach(note.shares) { C_Label(text: $0.name, accent: C.clay) } }
                            }
                            if i < Sample.readerNotes.count - 1 {
                                Rectangle().fill(C.hairline).frame(height: 1).padding(.leading, 48).padding(.vertical, 16)
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 2).padding(.bottom, 60)
            }
        }
        .galleryBackground(C.bgRead)
    }

    private var cover: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                Text("林之 允许你看到的部分")
                    .font(.system(size: 12.5, weight: .medium)).tracking(1).foregroundStyle(C.cream.opacity(0.65))
                Text(Sample.readerOwner)
                    .font(.system(size: 32, weight: .bold)).foregroundStyle(C.cream)
                Text("《\(Sample.readerCardTitle)》")
                    .font(.system(size: 15)).foregroundStyle(C.cream.opacity(0.8))
            }
            .padding(20)
            // folder tabs along the bottom edge of the cover
            HStack(spacing: 8) {
                coverTab("最近更新", active: true)
                ForEach(Sample.readerTabs) { coverTab($0.name, active: false) }
                Spacer()
            }
            .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(C.cover)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: C.cover.opacity(0.30), radius: 14, y: 6)
    }
    private func coverTab(_ t: String, active: Bool) -> some View {
        Text(t)
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(active ? C.cover : C.cream)
            .padding(.horizontal, 13).padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(active ? C.cream : C.cream.opacity(0.14))
            )
    }
}

// MARK: Cards (own issued — "档案卡")

private struct C_Cards: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Color.clear.frame(width: 30, height: 30)
                Spacer()
                C_Toggle(active: "卡")
            }
            .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("我发出的卡").font(.system(size: 25, weight: .bold)).foregroundStyle(C.ink)
                        Text("每张卡，是你允许某个人看到的那一部分自己")
                            .font(.system(size: 13)).foregroundStyle(C.soft)
                    }
                    .padding(.bottom, 4)

                    ForEach(Sample.ownCards) { card in
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(card.title).font(.system(size: 18, weight: .semibold)).foregroundStyle(C.ink)
                                    Text("\(card.shares.count) 个分享分类").font(.system(size: 12.5)).foregroundStyle(C.faint)
                                }
                                Spacer()
                                Text(card.inviteCode)
                                    .font(.system(size: 13.5, weight: .semibold, design: .monospaced)).tracking(1.5).foregroundStyle(C.clay)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(C.clay.opacity(0.12)))
                            }
                            Rectangle().fill(C.hairline).frame(height: 1)
                            HStack(spacing: 14) { ForEach(card.shares) { C_Label(text: $0.name, accent: C.pine) } }
                        }
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(C.card))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(C.hairline, lineWidth: 1))
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 18)).foregroundStyle(C.pine)
                        Text("新建一张卡").font(.system(size: 15, weight: .medium)).foregroundStyle(C.pine)
                        Spacer()
                    }
                    .padding(.vertical, 8).padding(.top, 4)
                }
                .padding(.horizontal, 20).padding(.top, 2).padding(.bottom, 60)
            }
        }
        .galleryBackground(C.bgMine)
    }
}
#endif
