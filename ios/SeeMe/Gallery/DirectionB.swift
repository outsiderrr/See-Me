#if DEBUG
import SwiftUI

// MARK: - Direction B · 安静的现代编辑空间
// Cool low-saturation neutrals, a two-column editorial grid (meta gutter +
// content column), monospaced timestamps & codes, flat bordered surfaces,
// a precise sliding segmented control. No shadows, no bright pills.

enum B {
    static let bg      = dyn(Color(red: 0.961, green: 0.965, blue: 0.969), Color(red: 0.078, green: 0.082, blue: 0.090))
    static let surface = dyn(.white, Color(red: 0.118, green: 0.125, blue: 0.137))
    static let sunken  = dyn(Color(red: 0.929, green: 0.937, blue: 0.945), Color(red: 0.157, green: 0.165, blue: 0.180))
    static let ink     = dyn(Color(red: 0.102, green: 0.110, blue: 0.122), Color(red: 0.910, green: 0.918, blue: 0.929))
    static let soft    = dyn(Color(red: 0.380, green: 0.404, blue: 0.435), Color(red: 0.576, green: 0.604, blue: 0.639))
    static let faint   = dyn(Color(red: 0.604, green: 0.627, blue: 0.659), Color(red: 0.435, green: 0.459, blue: 0.494))
    static let steel   = dyn(Color(red: 0.220, green: 0.380, blue: 0.560), Color(red: 0.478, green: 0.624, blue: 0.808))
    static let danger  = dyn(Color(red: 0.694, green: 0.290, blue: 0.290), Color(red: 0.831, green: 0.467, blue: 0.467))
    static let border  = dyn(Color(red: 0.102, green: 0.110, blue: 0.122).opacity(0.10), Color.white.opacity(0.10))
    static let radius: CGFloat = 11
}

private extension View {
    func bCard() -> some View {
        background(B.surface)
            .clipShape(RoundedRectangle(cornerRadius: B.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: B.radius, style: .continuous).stroke(B.border, lineWidth: 1))
    }
}

enum DirectionB {
    @ViewBuilder
    static func screen(_ key: String) -> some View {
        switch key {
        case "library":     B_Library()
        case "sidebar":     B_Sidebar()
        case "compose":     B_Compose(state: .collapsed)
        case "composeopen": B_Compose(state: .expanded)
        case "composetags": B_Compose(state: .tags)
        case "reader":      B_Reader()
        case "cards":       B_Cards()
        default:            B_Library()
        }
    }
}

// MARK: Chrome

private struct B_Segmented: View {
    let active: String
    var body: some View {
        HStack(spacing: 2) {
            seg("库"); seg("卡")
        }
        .padding(3)
        .background(B.sunken)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
    private func seg(_ t: String) -> some View {
        Text(t)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active == t ? B.ink : B.faint)
            .frame(width: 46, height: 30)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(active == t ? B.surface : .clear)
                    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(active == t ? B.border : .clear, lineWidth: 1))
            )
    }
}

private struct B_Header: View {
    let title: String
    var active: String = "库"
    var leadingBack: Bool = false
    var body: some View {
        HStack {
            if leadingBack {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .medium)).foregroundStyle(B.soft)
                    .frame(width: 30, alignment: .leading)
            }
            Text(title).font(.system(size: 26, weight: .bold)).foregroundStyle(B.ink)
            Spacer()
            B_Segmented(active: active)
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }
}

private struct B_Chip: View {
    let text: String
    var emphasized: Bool = false
    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(emphasized ? B.steel : B.soft)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(emphasized ? B.steel.opacity(0.4) : B.border, lineWidth: 1)
            )
    }
}

private struct B_MetaGutter: View {
    let iso: String
    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(SampleDate.clock(iso)).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(B.soft)
            Text(SampleDate.dayLabel(iso)).font(.system(size: 11)).foregroundStyle(B.faint)
        }
        .frame(width: 56, alignment: .trailing)
    }
}

private struct B_Row<Content: View>: View {
    let iso: String
    @ViewBuilder let content: Content
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            B_MetaGutter(iso: iso)
            Rectangle().fill(B.border).frame(width: 1).padding(.top, 2)
            VStack(alignment: .leading, spacing: 10) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: Library

private struct B_Library: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                B_Header(title: "库")
                ScrollView {
                    VStack(spacing: 24) {
                        ForEach(Sample.notes) { note in
                            B_Row(iso: note.createdAt) {
                                Text(note.body).font(.system(size: 16)).foregroundStyle(B.ink).lineSpacing(6)
                                    .fixedSize(horizontal: false, vertical: true)
                                if !note.images.isEmpty {
                                    HStack(spacing: 6) {
                                        ForEach(Array(note.images.enumerated()), id: \.offset) { i, _ in
                                            SamplePhoto(seed: i).frame(width: 88, height: 88)
                                                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                                        }
                                    }
                                }
                                if !note.tags.isEmpty {
                                    HStack(spacing: 6) { ForEach(note.tags) { B_Chip(text: $0.name) } }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 104)
                }
            }
            B_NewButton()
        }
        .galleryBackground(B.bg)
    }
}

private struct B_NewButton: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").font(.system(size: 15, weight: .bold))
            Text("记一条").font(.system(size: 15, weight: .semibold))
        }
        .foregroundStyle(B.surface)
        .padding(.horizontal, 20).frame(height: 48)
        .background(Capsule().fill(B.ink))
        .padding(.bottom, 26)
    }
}

// MARK: Sidebar

private struct B_Sidebar: View {
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(B.sunken)
                            .frame(width: 44, height: 44)
                            .overlay(Text(String(Sample.displayName.prefix(1))).font(.system(size: 18, weight: .semibold)).foregroundStyle(B.soft))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(Sample.displayName).font(.system(size: 18, weight: .semibold)).foregroundStyle(B.ink)
                            Text(Sample.maskedPhone).font(.system(size: 12, design: .monospaced)).foregroundStyle(B.faint)
                        }
                        Spacer()
                    }
                    .padding(.top, 8)

                    HStack(spacing: 0) {
                        stat("\(Sample.noteCount)", "笔记"); stat("\(Sample.tagCount)", "标签"); stat("\(Sample.daysUsed)", "天")
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .bCard()
                    .padding(.top, 18)

                    navRow("全部笔记", icon: "square.grid.2x2", active: true).padding(.top, 18)

                    label("收到的邀请卡").padding(.top, 24)
                    searchField.padding(.top, 10)
                    receivedRow.padding(.top, 8)

                    label("标签").padding(.top, 24).padding(.bottom, 6)
                    VStack(spacing: 0) { ForEach(Sample.allTags) { tagRow($0) } }
                }
                .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 24)
            }
            Rectangle().fill(B.border).frame(height: 1)
            HStack {
                Text("当前登录 · \(Sample.maskedPhone)").font(.system(size: 12, design: .monospaced)).foregroundStyle(B.faint)
                Spacer()
                Text("退出登录").font(.system(size: 13, weight: .medium)).foregroundStyle(B.danger)
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
        }
        .galleryBackground(B.bg)
    }
    private func stat(_ n: String, _ t: String) -> some View {
        VStack(spacing: 4) {
            Text(n).font(.system(size: 22, weight: .bold)).foregroundStyle(B.ink)
            Text(t).font(.system(size: 11)).foregroundStyle(B.faint)
        }.frame(maxWidth: .infinity)
    }
    private func label(_ t: String) -> some View {
        Text(t).font(.system(size: 11.5, weight: .semibold)).tracking(1).foregroundStyle(B.faint)
    }
    private func navRow(_ t: String, icon: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 15, weight: .medium)).foregroundStyle(active ? B.steel : B.soft).frame(width: 22)
            Text(t).font(.system(size: 15, weight: .semibold)).foregroundStyle(active ? B.ink : B.soft)
            Spacer()
        }
        .padding(.horizontal, 14).frame(height: 48)
        .background(
            RoundedRectangle(cornerRadius: B.radius, style: .continuous).fill(active ? B.sunken : .clear)
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(active ? B.steel : .clear).frame(width: 3, height: 20).padding(.leading, 2)
        }
    }
    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(B.faint)
            Text("搜索卡名，或输入 8 位邀请码").font(.system(size: 13.5)).foregroundStyle(B.faint)
            Spacer()
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(B.sunken))
    }
    private var receivedRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope").font(.system(size: 15)).foregroundStyle(B.steel)
            VStack(alignment: .leading, spacing: 2) {
                Text(Sample.readerCardTitle).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(B.ink)
                Text("\(Sample.readerOwner) 分享给你").font(.system(size: 11.5)).foregroundStyle(B.faint)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .medium)).foregroundStyle(B.faint)
        }
        .padding(12).bCard()
    }
    private func tagRow(_ tag: TagDTO) -> some View {
        HStack(spacing: 12) {
            Text(tag.icon?.isEmpty == false ? tag.icon! : "#").font(.system(size: 14)).foregroundStyle(B.soft).frame(width: 22)
            Text(tag.name).font(.system(size: 15)).foregroundStyle(B.ink)
            if tag.isPinned == true { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(B.steel) }
            Spacer()
            Text("\(tag.noteCount)").font(.system(size: 13, design: .monospaced)).foregroundStyle(B.faint)
            Image(systemName: "ellipsis").font(.system(size: 14)).foregroundStyle(B.faint).padding(.leading, 8)
        }
        .frame(height: 46)
    }
}

// MARK: Compose

private struct B_Compose: View {
    enum State { case collapsed, expanded, tags }
    let state: State
    var body: some View {
        ZStack(alignment: .bottom) {
            B_Library().disabled(true)
            Color.black.opacity(0.20).ignoresSafeArea()
            panel
        }
    }
    private var panel: some View {
        VStack(spacing: 0) {
            Capsule().fill(B.faint.opacity(0.45)).frame(width: 36, height: 5).padding(.top, 9).padding(.bottom, 12)
            if state == .tags { suggestions; Rectangle().fill(B.border).frame(height: 1) }
            VStack(alignment: .leading, spacing: 8) {
                switch state {
                case .collapsed: Text("记一条…").font(.system(size: 16)).foregroundStyle(B.faint)
                case .expanded:
                    Text(Sample.composeOpenText).font(.system(size: 16)).foregroundStyle(B.ink).lineSpacing(6)
                case .tags:
                    (Text("重读《被讨厌的勇气》，关于课题分离的一点想法。\n").font(.system(size: 16)).foregroundColor(B.ink)
                     + Text("#想").font(.system(size: 16, weight: .semibold)).foregroundColor(B.steel)).lineSpacing(6)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: state == .collapsed ? 84 : (state == .tags ? 74 : 220))
            .padding(.horizontal, 20).padding(.top, 4)
            Rectangle().fill(B.border).frame(height: 1)
            toolbar
        }
        .background(B.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(B.border, lineWidth: 1))
        .padding(.horizontal, 8).padding(.bottom, 8)
    }
    private var suggestions: some View {
        VStack(spacing: 0) {
            ForEach([Sample.tagIdeas, Sample.tagReading]) { tag in
                HStack {
                    B_Chip(text: tag.name, emphasized: true)
                    Spacer()
                    Text("\(tag.noteCount) 条").font(.system(size: 12, design: .monospaced)).foregroundStyle(B.faint)
                }
                .padding(.horizontal, 20).frame(height: 46)
            }
            HStack {
                Image(systemName: "plus.square").font(.system(size: 14)).foregroundStyle(B.soft)
                Text("新建标签 “想”").font(.system(size: 14)).foregroundStyle(B.soft)
                Spacer()
            }.padding(.horizontal, 20).frame(height: 44)
        }
    }
    private var toolbar: some View {
        HStack(spacing: 20) {
            Image(systemName: "number").font(.system(size: 18, weight: .medium)).foregroundStyle(B.soft)
            Image(systemName: "photo").font(.system(size: 17, weight: .medium)).foregroundStyle(B.soft)
            Spacer()
            Image(systemName: "arrow.up")
                .font(.system(size: 16, weight: .bold)).foregroundStyle(B.surface)
                .frame(width: 46, height: 36)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(state == .collapsed ? B.faint : B.steel))
        }
        .padding(.horizontal, 20).frame(height: 56)
    }
}

// MARK: Reader

private struct B_Reader: View {
    var body: some View {
        VStack(spacing: 0) {
            B_Header(title: "阅读", active: "库", leadingBack: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("分享给你").font(.system(size: 11, weight: .semibold)).tracking(2).foregroundStyle(B.faint)
                        HStack(spacing: 10) {
                            Text(Sample.readerCardTitle).font(.system(size: 22, weight: .bold)).foregroundStyle(B.ink)
                            Spacer()
                            Text(Sample.readerOwner).font(.system(size: 13, weight: .medium)).foregroundStyle(B.soft)
                        }
                        HStack(spacing: 8) {
                            readerTab("最近更新", active: true)
                            ForEach(Sample.readerTabs) { readerTab($0.name, active: false) }
                        }
                    }
                    .padding(16).bCard()

                    VStack(spacing: 22) {
                        ForEach(Sample.readerNotes) { note in
                            B_Row(iso: note.createdAt) {
                                Text(note.body).font(.system(size: 16)).foregroundStyle(B.ink).lineSpacing(6)
                                    .fixedSize(horizontal: false, vertical: true)
                                HStack(spacing: 6) { ForEach(note.shares) { B_Chip(text: $0.name, emphasized: true) } }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 60)
            }
        }
        .galleryBackground(B.bg)
    }
    private func readerTab(_ t: String, active: Bool) -> some View {
        Text(t)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(active ? B.surface : B.soft)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(active ? B.steel : B.sunken)
            )
    }
}

// MARK: Cards

private struct B_Cards: View {
    var body: some View {
        VStack(spacing: 0) {
            B_Header(title: "卡", active: "卡")
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(Sample.ownCards) { card in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text(card.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(B.ink)
                                Spacer()
                                Text("\(card.shares.count) 个分享").font(.system(size: 12)).foregroundStyle(B.faint)
                            }
                            HStack(spacing: 8) {
                                Text(card.inviteCode)
                                    .font(.system(size: 14, weight: .semibold, design: .monospaced)).tracking(2).foregroundStyle(B.steel)
                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(B.sunken))
                                Spacer()
                                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 13)).foregroundStyle(B.faint)
                            }
                            HStack(spacing: 6) { ForEach(card.shares) { B_Chip(text: $0.name) } }
                        }
                        .padding(16).bCard()
                    }
                    HStack(spacing: 8) {
                        Image(systemName: "plus").font(.system(size: 14, weight: .semibold))
                        Text("新建一张卡").font(.system(size: 15, weight: .medium))
                        Spacer()
                    }
                    .foregroundStyle(B.soft).padding(16)
                    .overlay(RoundedRectangle(cornerRadius: B.radius, style: .continuous).stroke(B.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 60)
            }
        }
        .galleryBackground(B.bg)
    }
}
#endif
