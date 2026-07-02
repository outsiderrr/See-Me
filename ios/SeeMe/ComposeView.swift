import PhotosUI
import SwiftUI
import UIKit

struct ComposeView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    /// When set, the composer edits this existing note (body + tags; images
    /// stay as they are — the backend has no image-edit endpoint).
    var editing: NoteDTO? = nil
    let onSaved: () async -> Void

    @State private var text = ""
    @State private var tags: [TagDTO] = []
    @State private var selection = NSRange(location: 0, length: 0)
    @State private var activeTagRange: NSRange?
    @State private var activeTagQuery: String?
    @State private var wantsFocus = false
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var images: [Data] = []
    @State private var saving = false
    @State private var message = ""

    private var suggestions: [TagDTO] {
        guard let query = activeTagQuery else { return [] }
        if query.isEmpty { return tags }
        return tags.filter { $0.name.lowercased().hasPrefix(query.lowercased()) }
    }

    private var parsed: ParsedMemo { ParsedMemo(text) }
    private var canSave: Bool {
        // Editing PATCHes the body, which the backend requires non-empty.
        editing == nil ? (!parsed.body.isEmpty || !images.isEmpty) : !parsed.body.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            if activeTagQuery != nil {
                suggestionList
            }

            ZStack(alignment: .topLeading) {
                TagTextView(
                    text: $text,
                    selection: $selection,
                    wantsFocus: $wantsFocus
                ) { query, range in
                    activeTagQuery = query
                    activeTagRange = range
                }
                if text.isEmpty {
                    Text("现在的想法是…")
                        .font(Theme.serif(18))
                        .foregroundStyle(Theme.faint)
                        .padding(.horizontal, 17)
                        .padding(.vertical, 15)
                        .allowsHitTesting(false)
                }
            }

            if !images.isEmpty {
                imageStrip
            }

            Hairline()
            inputToolbar
        }
        .background(Theme.raised)
        .onAppear {
            if let note = editing, text.isEmpty {
                // Tags were stripped from the stored body; re-append them as
                // #tokens so the round trip is editable in place.
                var prefill = note.body
                if !note.tags.isEmpty {
                    prefill += (prefill.isEmpty ? "" : "\n\n") + note.tags.map { "#\($0.name)" }.joined(separator: " ")
                }
                text = prefill
                selection = NSRange(location: (prefill as NSString).length, length: 0)
            }
            Task {
                tags = (try? await api.listTags()) ?? []
                try? await Task.sleep(nanoseconds: 180_000_000)
                wantsFocus = true
            }
        }
        .onChange(of: pickerItems) { newItems in
            Task { await loadImages(newItems) }
        }
        .alert("提示", isPresented: Binding(
            get: { !message.isEmpty },
            set: { if !$0 { message = "" } }
        )) {
            Button("好") { message = "" }
        } message: {
            Text(message)
        }
    }

    private var suggestionList: some View {
        Group {
            if suggestions.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .light))
                    Text(activeTagQuery?.isEmpty == false ? "新建标签「\(activeTagQuery!)」" : "输入标签名称")
                        .font(Theme.serif(16))
                    Spacer()
                }
                .foregroundStyle(Theme.soft)
                .padding(.horizontal, Theme.hPad)
                .frame(height: 48)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(suggestions) { tag in
                            Button {
                                chooseTag(tag)
                            } label: {
                                HStack {
                                    Text("# \(tag.name)")
                                        .font(Theme.serif(16))
                                        .foregroundStyle(Theme.clay)
                                    Spacer()
                                    Text("\(tag.noteCount)")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.faint)
                                }
                                .padding(.horizontal, Theme.hPad)
                                .frame(height: 44)
                            }
                            Hairline(inset: Theme.hPad)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .background(Theme.raised)
    }

    private var imageStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(images.enumerated()), id: \.offset) { index, data in
                    if let image = UIImage(data: data) {
                        ZStack(alignment: .topTrailing) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            Button {
                                images.remove(at: index)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .black.opacity(0.65))
                            }
                            .offset(x: 5, y: -5)
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
    }

    private var inputToolbar: some View {
        HStack(spacing: 26) {
            Button(action: insertHash) {
                Image(systemName: "number")
                    .font(.system(size: 19, weight: .light))
                    .foregroundStyle(Theme.soft)
            }

            if editing == nil {
                PhotosPicker(
                    selection: $pickerItems,
                    maxSelectionCount: max(1, 9 - images.count),
                    matching: .images
                ) {
                    Image(systemName: "photo")
                        .font(.system(size: 18, weight: .light))
                        .foregroundStyle(images.count >= 9 ? Theme.faint : Theme.soft)
                }
                .disabled(images.count >= 9)
            }

            Spacer()

            if !message.isEmpty {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.brick)
                    .lineLimit(1)
            }

            Button {
                Task { await save() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.paper)
                    .frame(width: 46, height: 38)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(canSave ? Theme.ink : Theme.faint))
            }
            .disabled(!canSave || saving)
        }
        .padding(.horizontal, Theme.hPad)
        .frame(height: 60)
    }

    private func insertHash() {
        let mutable = NSMutableString(string: text)
        let safe = NSRange(
            location: min(selection.location, mutable.length),
            length: min(selection.length, max(0, mutable.length - min(selection.location, mutable.length)))
        )
        mutable.replaceCharacters(in: safe, with: "#")
        text = mutable as String
        selection = NSRange(location: safe.location + 1, length: 0)
        activeTagRange = NSRange(location: safe.location, length: 1)
        activeTagQuery = ""
        wantsFocus = true
    }

    private func chooseTag(_ tag: TagDTO) {
        guard let range = activeTagRange else { return }
        let mutable = NSMutableString(string: text)
        guard NSMaxRange(range) <= mutable.length else { return }
        let replacement = "#\(tag.name) "
        mutable.replaceCharacters(in: range, with: replacement)
        text = mutable as String
        selection = NSRange(location: range.location + (replacement as NSString).length, length: 0)
        activeTagRange = nil
        activeTagQuery = nil
        wantsFocus = true
    }

    private func loadImages(_ items: [PhotosPickerItem]) async {
        let remaining = max(0, 9 - images.count)
        guard remaining > 0 else { pickerItems = []; return }
        var loaded: [Data] = []
        for item in items.prefix(remaining) {
            guard let raw = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: raw),
                  let jpeg = image.memoJPEG(maxDimension: 1600, quality: 0.78) else { continue }
            loaded.append(jpeg)
        }
        images.append(contentsOf: loaded)
        pickerItems = []
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            var tagIds: [String] = []
            var known = tags
            for name in parsed.tagNames {
                if let tag = known.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
                    tagIds.append(tag.id)
                } else {
                    let tag = try await api.createTag(name: name)
                    known.append(tag)
                    tagIds.append(tag.id)
                }
            }
            if let note = editing {
                _ = try await api.updateNote(id: note.id, body: parsed.body)
                _ = try await api.setNoteTags(id: note.id, tagIds: Array(Set(tagIds)))
            } else {
                _ = try await api.createNote(body: parsed.body, tagIds: Array(Set(tagIds)), images: images)
            }
            await onSaved()
            dismiss()
        } catch APIClient.APIError.status(let status) {
            message = status == 409 ? "有一个标签已经存在。" : "保存失败，请检查内容或图片。"
        } catch {
            message = "保存失败，请稍后再试。"
        }
    }
}

private struct ParsedMemo {
    let body: String
    let tagNames: [String]

    init(_ source: String) {
        let ns = source as NSString
        let regex = try! NSRegularExpression(pattern: "(?<!\\S)#([^\\s#]+)")
        let matches = regex.matches(in: source, range: NSRange(location: 0, length: ns.length))

        var seen = Set<String>()
        var names: [String] = []
        for match in matches where match.numberOfRanges > 1 {
            let name = ns.substring(with: match.range(at: 1))
            let key = name.lowercased()
            if seen.insert(key).inserted { names.append(name) }
        }

        let mutable = NSMutableString(string: source)
        for match in matches.reversed() {
            mutable.replaceCharacters(in: match.range, with: "")
        }
        body = (mutable as String)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        tagNames = names
    }
}

struct TagTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    @Binding var wantsFocus: Bool
    let onActiveTag: (String?, NSRange?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    static let editorFont: UIFont = {
        let base = UIFont.systemFont(ofSize: 18)
        guard let d = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: d, size: 18)
    }()

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = TagTextView.editorFont
        view.textColor = UIColor(Theme.ink)
        view.tintColor = UIColor(Theme.clay)
        view.textContainerInset = UIEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
        view.keyboardDismissMode = .interactive
        view.alwaysBounceVertical = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
        }
        let maxLocation = (view.text as NSString).length
        let safeSelection = NSRange(location: min(selection.location, maxLocation), length: 0)
        if view.selectedRange != safeSelection { view.selectedRange = safeSelection }
        context.coordinator.highlight(view)
        if wantsFocus && !view.isFirstResponder {
            view.becomeFirstResponder()
            DispatchQueue.main.async { wantsFocus = false }
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: TagTextView
        private let regex = try! NSRegularExpression(pattern: "(?<!\\S)#[^\\s#]+")

        init(_ parent: TagTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            parent.selection = textView.selectedRange
            highlight(textView)
            reportActiveTag(textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            parent.selection = textView.selectedRange
            reportActiveTag(textView)
        }

        func highlight(_ textView: UITextView) {
            let selected = textView.selectedRange
            let full = NSRange(location: 0, length: (textView.text as NSString).length)
            textView.textStorage.beginEditing()
            textView.textStorage.setAttributes([
                .font: TagTextView.editorFont,
                .foregroundColor: UIColor(Theme.ink),
            ], range: full)
            for match in regex.matches(in: textView.text, range: full) {
                textView.textStorage.addAttribute(.foregroundColor, value: UIColor(Theme.clay), range: match.range)
            }
            textView.textStorage.endEditing()
            textView.selectedRange = selected
            textView.typingAttributes = [
                .font: TagTextView.editorFont,
                .foregroundColor: UIColor(Theme.ink),
            ]
        }

        private func reportActiveTag(_ textView: UITextView) {
            let ns = textView.text as NSString
            let caret = min(textView.selectedRange.location, ns.length)
            var start = caret
            while start > 0 {
                let scalar = ns.substring(with: NSRange(location: start - 1, length: 1))
                if scalar.rangeOfCharacter(from: .whitespacesAndNewlines) != nil { break }
                start -= 1
            }
            let range = NSRange(location: start, length: caret - start)
            let token = ns.substring(with: range)
            if token.hasPrefix("#") && !token.dropFirst().contains("#") {
                parent.onActiveTag(String(token.dropFirst()), range)
            } else {
                parent.onActiveTag(nil, nil)
            }
        }
    }
}

private extension UIImage {
    func memoJPEG(maxDimension: CGFloat, quality: CGFloat) -> Data? {
        let largest = max(size.width, size.height)
        let scale = largest > maxDimension ? maxDimension / largest : 1
        let target = CGSize(width: max(1, size.width * scale), height: max(1, size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        return rendered.jpegData(compressionQuality: quality)
    }
}
