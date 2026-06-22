#if DEBUG
import SwiftUI

// MARK: - Direction A · 纸页 / 私人手札
// Warm ivory paper, serif body, hairline dividers instead of cards, almost no
// shadow. Hierarchy comes from typography, generous whitespace and thin rules.

enum A {
    static let paper   = dyn(Color(red: 0.984, green: 0.965, blue: 0.933), Color(red: 0.090, green: 0.082, blue: 0.066))
    static let raised  = dyn(Color(red: 0.996, green: 0.984, blue: 0.961), Color(red: 0.137, green: 0.125, blue: 0.105))
    static let ink     = dyn(Color(red: 0.157, green: 0.137, blue: 0.117), Color(red: 0.925, green: 0.902, blue: 0.863))
    static let soft    = dyn(Color(red: 0.482, green: 0.447, blue: 0.404), Color(red: 0.612, green: 0.580, blue: 0.522))
    static let faint   = dyn(Color(red: 0.682, green: 0.651, blue: 0.604), Color(red: 0.435, green: 0.412, blue: 0.376))
    static let clay    = dyn(Color(red: 0.604, green: 0.376, blue: 0.235), Color(red: 0.792, green: 0.561, blue: 0.408))
    static let brick   = dyn(Color(red: 0.604, green: 0.290, blue: 0.235), Color(red: 0.804, green: 0.490, blue: 0.420))
    static let rule    = dyn(Color(red: 0.157, green: 0.137, blue: 0.117).opacity(0.12), Color(red: 0.925, green: 0.902, blue: 0.863).opacity(0.14))

    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

enum DirectionA {
    @ViewBuilder
    static func screen(_ key: String) -> some View {
        switch key {
        case "library":     A_Library()
        case "sidebar":     A_Sidebar()
        case "sidebarcard": A_Sidebar(selectedCard: true)
        case "compose":     A_Compose(state: .collapsed)
        case "composeopen": A_Compose(state: .expanded)
        case "composetags": A_Compose(state: .tags)
        case "reader":      A_Reader()
        case "cards":       A_Cards()
        default:            A_Library()
        }
    }
}

// MARK: Chrome

private struct A_TopBar: View {
    var leading: AnyView? = nil
    var active: String = "库"
    var body: some View {
        ZStack {
            HStack {
                if let leading { leading } else { Color.clear.frame(width: 30, height: 30) }
                Spacer()
                Color.clear.frame(width: 30, height: 30)
            }
            HStack(spacing: 26) {
                segment("库")
                segment("卡")
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }
    private func segment(_ t: String) -> some View {
        VStack(spacing: 5) {
            Text(t)
                .font(A.serif(18, active == t ? .semibold : .regular))
                .foregroundStyle(active == t ? A.ink : A.faint)
            Rectangle().fill(active == t ? A.clay : .clear)
                .frame(width: 16, height: 2)
        }
    }
}

private struct A_Entry: View {
    let note: NoteDTO
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(SampleDate.clock(note.createdAt))
                    .font(.system(size: 12, weight: .medium)).monospacedDigit()
                    .foregroundStyle(A.faint)
                Spacer()
                if !note.tags.isEmpty { A_Tags(names: note.tags.map(\.name)) }
            }
            Text(note.body)
                .font(A.serif(17.5)).foregroundStyle(A.ink)
                .lineSpacing(7)
                .fixedSize(horizontal: false, vertical: true)
            if !note.images.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(note.images.enumerated()), id: \.offset) { i, _ in
                        SamplePhoto(seed: i)
                            .frame(width: 96, height: 96)
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
                .padding(.top, 2)
            }
        }
    }
}

private struct A_Tags: View {
    let names: [String]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, n in
                if i > 0 {
                    Text("·").foregroundStyle(A.faint).padding(.horizontal, 6)
                }
                Text(n).font(.system(size: 12.5)).tracking(0.5).foregroundStyle(A.clay)
            }
        }
    }
}

// MARK: Library

private struct A_Library: View {
    private var grouped: [(String, [NoteDTO])] {
        var order: [String] = []; var map: [String: [NoteDTO]] = [:]
        for n in Sample.notes {
            let k = SampleDate.dayWithWeekday(n.createdAt)
            if map[k] == nil { order.append(k) }
            map[k, default: []].append(n)
        }
        return order.map { ($0, map[$0]!) }
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 0) {
                A_TopBar(leading: AnyView(
                    Image(systemName: "line.horizontal.3").font(.system(size: 17, weight: .light)).foregroundStyle(A.soft).frame(width: 30, height: 30)
                ))
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(grouped.enumerated()), id: \.offset) { gi, group in
                            HStack(spacing: 8) {
                                Circle().fill(A.clay).frame(width: 4, height: 4)
                                Text(group.0).font(.system(size: 12.5, weight: .semibold)).tracking(1).foregroundStyle(A.soft)
                            }
                            .padding(.top, gi == 0 ? 4 : 30).padding(.bottom, 16)

                            ForEach(Array(group.1.enumerated()), id: \.element.id) { i, note in
                                A_Entry(note: note)
                                if i < group.1.count - 1 {
                                    Rectangle().fill(A.rule).frame(height: 1).padding(.vertical, 20)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 26)
                    .padding(.bottom, 110)
                }
            }
            Button {} label: {
                Image(systemName: "pencil")
                    .font(.system(size: 20, weight: .regular)).foregroundStyle(A.paper)
                    .frame(width: 54, height: 54)
                    .background(Circle().fill(A.ink))
            }
            .padding(.trailing, 24).padding(.bottom, 30)
        }
        .galleryBackground(A.paper)
    }
}

// MARK: Sidebar

private struct A_Sidebar: View {
    var selectedCard = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // profile
                    Text(Sample.displayName).font(A.serif(28, .semibold)).foregroundStyle(A.ink)
                        .padding(.top, 8)
                    Text(Sample.maskedPhone).font(.system(size: 13)).foregroundStyle(A.faint)
                        .padding(.top, 4)
                    HStack(spacing: 0) {
                        stat("\(Sample.noteCount)", "笔记")
                        divider
                        stat("\(Sample.tagCount)", "标签")
                        divider
                        stat("\(Sample.daysUsed)", "天")
                    }
                    .padding(.top, 22)

                    Rectangle().fill(A.rule).frame(height: 1).padding(.vertical, 22)

                    navRow("全部笔记", active: !selectedCard)

                    sectionTitle("收到的邀请卡").padding(.top, 26)
                    searchField.padding(.top, 12)
                    receivedRow(owner: Sample.readerOwner, title: Sample.readerCardTitle, selected: selectedCard)

                    if selectedCard {
                        // The card's own categories replace the tag index — same
                        // place, same role. These are Share display names, not
                        // the author's internal tags.
                        sectionTitle("这张卡里的分类").padding(.top, 28)
                        categoryRow("最近更新", active: true)
                        ForEach(Sample.readerTabs) { categoryRow($0.name, active: false) }
                    } else {
                        sectionTitle("标签").padding(.top, 28)
                        ForEach(Sample.allTags) { tag in tagRow(tag) }
                    }
                }
                .padding(.horizontal, 26)
                .padding(.top, 14)
                .padding(.bottom, 24)
            }
            Rectangle().fill(A.rule).frame(height: 1)
            HStack {
                Label("当前登录 · \(Sample.maskedPhone)", systemImage: "person")
                    .font(.system(size: 12)).foregroundStyle(A.faint)
                Spacer()
                Text("退出").font(.system(size: 13)).foregroundStyle(A.brick)
            }
            .padding(.horizontal, 26).padding(.vertical, 16)
        }
        .galleryBackground(A.paper)
    }

    private var divider: some View { Rectangle().fill(A.rule).frame(width: 1, height: 30).padding(.horizontal, 22) }
    private func stat(_ n: String, _ t: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(n).font(A.serif(24, .semibold)).foregroundStyle(A.ink)
            Text(t).font(.system(size: 11)).foregroundStyle(A.faint)
        }
    }
    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .semibold)).tracking(1.5).foregroundStyle(A.soft)
    }
    private func navRow(_ t: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            Rectangle().fill(active ? A.clay : .clear).frame(width: 2, height: 18)
            Text(t).font(A.serif(18, active ? .semibold : .regular)).foregroundStyle(active ? A.ink : A.soft)
            Spacer()
        }
    }
    private var searchField: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .light)).foregroundStyle(A.faint)
                Text("搜索卡名，或输入 8 位邀请码").font(.system(size: 14)).foregroundStyle(A.faint)
                Spacer()
            }
            Rectangle().fill(A.rule).frame(height: 1)
        }
    }
    private func receivedRow(owner: String, title: String, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: selected ? "envelope.open" : "envelope")
                .font(.system(size: 15, weight: .light)).foregroundStyle(A.clay)
            VStack(alignment: .leading, spacing: 2) {
                Text(owner).font(A.serif(17, .medium)).foregroundStyle(A.ink)        // who shared = primary
                Text("分享 ·《\(title)》").font(.system(size: 11.5)).foregroundStyle(A.faint)
            }
            Spacer()
            Image(systemName: selected ? "checkmark" : "chevron.right")
                .font(.system(size: 11, weight: selected ? .semibold : .light)).foregroundStyle(A.clay)
        }
        .padding(.horizontal, 14).padding(.vertical, 12).padding(.top, 4)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(selected ? A.clay.opacity(0.10) : .clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(selected ? A.clay.opacity(0.35) : .clear, lineWidth: 1)
        )
        .padding(.top, 14)
    }
    private func categoryRow(_ name: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            Rectangle().fill(active ? A.clay : A.faint.opacity(0.5)).frame(width: 2, height: 16)
            Text(name).font(A.serif(17, active ? .semibold : .regular)).foregroundStyle(active ? A.ink : A.soft)
            Spacer()
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(A.rule).frame(height: 1) }
    }
    private func tagRow(_ tag: TagDTO) -> some View {
        HStack(spacing: 12) {
            Text(tag.icon?.isEmpty == false ? tag.icon! : "·")
                .font(.system(size: 15)).frame(width: 22)
            Text(tag.name).font(A.serif(17)).foregroundStyle(A.ink)
            if tag.isPinned == true {
                Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(A.clay)
            }
            Spacer()
            Text("\(tag.noteCount)").font(.system(size: 13)).monospacedDigit().foregroundStyle(A.faint)
            Image(systemName: "ellipsis").font(.system(size: 13)).foregroundStyle(A.faint).padding(.leading, 6)
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(A.rule).frame(height: 1) }
    }
}

// MARK: Compose

private struct A_Compose: View {
    enum State { case collapsed, expanded, tags }
    let state: State

    var body: some View {
        ZStack(alignment: .bottom) {
            A_Library().disabled(true)
            Color.black.opacity(0.18).ignoresSafeArea()
            panel
        }
    }

    private var panel: some View {
        VStack(spacing: 0) {
            Capsule().fill(A.faint.opacity(0.5)).frame(width: 36, height: 5).padding(.top, 10).padding(.bottom, 12)

            if state == .tags { suggestions; Rectangle().fill(A.rule).frame(height: 1) }

            VStack(alignment: .leading, spacing: 10) {
                switch state {
                case .collapsed:
                    Text("现在的想法是…").font(A.serif(18)).foregroundStyle(A.faint)
                case .expanded:
                    Text(Sample.composeOpenText).font(A.serif(18)).foregroundStyle(A.ink).lineSpacing(7)
                case .tags:
                    composingWithTag
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: state == .collapsed ? 92 : (state == .tags ? 80 : 230))
            .padding(.horizontal, 24)
            .padding(.top, 6)

            Rectangle().fill(A.rule).frame(height: 1)
            toolbar
        }
        .background(A.raised)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(A.rule, lineWidth: 1))
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
    }

    private var composingWithTag: some View {
        (Text("重读《被讨厌的勇气》，关于课题分离的一点想法。\n").font(A.serif(18)).foregroundColor(A.ink)
         + Text("#想").font(A.serif(18, .medium)).foregroundColor(A.clay))
            .lineSpacing(7)
    }

    private var suggestions: some View {
        VStack(spacing: 0) {
            ForEach([Sample.tagIdeas, Sample.tagReading]) { tag in
                HStack {
                    Text("# \(tag.name)").font(A.serif(16)).foregroundStyle(A.clay)
                    Spacer()
                    Text("\(tag.noteCount)").font(.system(size: 12)).foregroundStyle(A.faint)
                }
                .padding(.horizontal, 24).frame(height: 44)
                Rectangle().fill(A.rule).frame(height: 1).padding(.leading, 24)
            }
            HStack {
                Image(systemName: "plus").font(.system(size: 13, weight: .light)).foregroundStyle(A.soft)
                Text("新建标签「想」").font(A.serif(16)).foregroundStyle(A.soft)
                Spacer()
            }
            .padding(.horizontal, 24).frame(height: 44)
        }
    }

    private var toolbar: some View {
        HStack(spacing: 26) {
            Image(systemName: "number").font(.system(size: 19, weight: .light)).foregroundStyle(A.soft)
            Image(systemName: "photo").font(.system(size: 18, weight: .light)).foregroundStyle(A.soft)
            Spacer()
            Image(systemName: "arrow.up")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(A.paper)
                .frame(width: 44, height: 38)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(state == .collapsed ? A.faint : A.ink))
        }
        .padding(.horizontal, 24).frame(height: 58)
    }
}

// MARK: Reader

private struct A_Reader: View {
    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                HStack {
                    Image(systemName: "chevron.left").font(.system(size: 16, weight: .light)).foregroundStyle(A.soft).frame(width: 30, height: 30)
                    Spacer()
                    Color.clear.frame(width: 30, height: 30)
                }
                Text("收到的邀请卡").font(A.serif(15, .medium)).foregroundStyle(A.soft)
            }
            .padding(.horizontal, 24).padding(.top, 6).padding(.bottom, 14)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // letterhead — who shared is primary; the card name is secondary.
                    // No tab row: filtering lives in the left index, like the library.
                    Text(Sample.readerOwner)
                        .font(A.serif(28, .semibold)).foregroundStyle(A.ink)
                    Text("分享给你 ·《\(Sample.readerCardTitle)》")
                        .font(.system(size: 13)).foregroundStyle(A.soft).padding(.top, 5)
                    Rectangle().fill(A.rule).frame(height: 1).padding(.top, 18).padding(.bottom, 24)

                    ForEach(Array(Sample.readerNotes.enumerated()), id: \.element.id) { i, note in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(SampleDate.dayLabel(note.createdAt)).font(.system(size: 12, weight: .medium)).foregroundStyle(A.faint)
                                Spacer()
                                A_Tags(names: note.shares.map(\.name))
                            }
                            Text(note.body).font(A.serif(17.5)).foregroundStyle(A.ink).lineSpacing(7)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if i < Sample.readerNotes.count - 1 {
                            Rectangle().fill(A.rule).frame(height: 1).padding(.vertical, 22)
                        }
                    }
                }
                .padding(.horizontal, 26).padding(.top, 6).padding(.bottom, 60)
            }
        }
        .galleryBackground(A.paper)
    }
}

// MARK: Cards

private struct A_Cards: View {
    var body: some View {
        VStack(spacing: 0) {
            A_TopBar(active: "卡")
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("我发出的卡").font(.system(size: 12.5, weight: .semibold)).tracking(1.5).foregroundStyle(A.soft)
                        .padding(.bottom, 4)
                    ForEach(Sample.ownCards) { card in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(card.title).font(A.serif(20, .medium)).foregroundStyle(A.ink)
                            HStack(spacing: 10) {
                                Text(card.inviteCode)
                                    .font(.system(size: 13, weight: .medium, design: .monospaced)).tracking(2)
                                    .foregroundStyle(A.clay)
                                Text("·").foregroundStyle(A.faint)
                                Text("\(card.shares.count) 个分享").font(.system(size: 13)).foregroundStyle(A.soft)
                            }
                            A_Tags(names: card.shares.map(\.name))
                        }
                        .padding(.vertical, 22)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Rectangle().fill(A.rule).frame(height: 1) }
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "plus").font(.system(size: 14, weight: .light))
                        Text("新建一张卡").font(A.serif(17))
                    }
                    .foregroundStyle(A.soft).padding(.top, 24)
                }
                .padding(.horizontal, 26).padding(.top, 8).padding(.bottom, 60)
            }
        }
        .galleryBackground(A.paper)
    }
}
#endif
