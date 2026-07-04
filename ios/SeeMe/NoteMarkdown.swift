import MarkdownUI
import SwiftUI

/// Renders a note body as light-structure Markdown in the paper design.
/// Editing stays plain text; only display is rendered.
struct NoteBody: View {
    let markdown: String

    var body: some View {
        Markdown(hardBreaked(markdown))
            .markdownTheme(.paperNote)
            .markdownImageProvider(BlockedImageProvider())
            .markdownInlineImageProvider(BlockedInlineImageProvider())
    }

    /// flomo-style notes treat every newline as a visual break; CommonMark
    /// folds single newlines into spaces. Turn them into hard breaks
    /// ("  \n") so existing plain notes keep their line layout.
    private func hardBreaked(_ s: String) -> String {
        s.replacingOccurrences(of: "\n", with: "  \n")
    }
}

/// Markdown image syntax is never rendered: on the reader side a note must
/// not be able to make the client fetch an author-controlled URL (that would
/// leak a read signal). Real images go through the permission-checked
/// /images endpoints only. One rule for both own and reader streams.
private struct BlockedImageProvider: ImageProvider {
    func makeImage(url: URL?) -> some View { EmptyView() }
}
private struct BlockedInlineImageProvider: InlineImageProvider {
    func image(with url: URL, label: String) async throws -> Image {
        Image(uiImage: UIImage())
    }
}

extension MarkdownUI.Theme {
    /// The paper journal look: serif body in ink, clay accents, quiet blocks.
    static let paperNote = MarkdownUI.Theme()
        .text {
            FontFamily(.system(.serif))
            FontSize(17.5)
            ForegroundColor(Theme.ink)
        }
        .paragraph { cfg in
            cfg.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.38))
                .markdownMargin(top: .zero, bottom: .em(0.8))
        }
        .heading1 { cfg in
            cfg.label
                .markdownTextStyle { FontSize(21); FontWeight(.semibold) }
                .markdownMargin(top: .em(0.2), bottom: .em(0.5))
        }
        .heading2 { cfg in
            cfg.label
                .markdownTextStyle { FontSize(19); FontWeight(.semibold) }
                .markdownMargin(top: .em(0.2), bottom: .em(0.5))
        }
        .heading3 { cfg in
            cfg.label
                .markdownTextStyle { FontSize(18); FontWeight(.semibold) }
                .markdownMargin(top: .em(0.2), bottom: .em(0.5))
        }
        .link { ForegroundColor(Theme.clay) }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
        }
        .blockquote { cfg in
            cfg.label
                .markdownTextStyle { ForegroundColor(Theme.soft) }
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Theme.clay.opacity(0.6)).frame(width: 2)
                }
                .markdownMargin(top: .zero, bottom: .em(0.8))
        }
        .listItem { cfg in
            cfg.label.markdownMargin(top: .em(0.15))
        }
        .thematicBreak {
            Rectangle().fill(Theme.rule).frame(height: 1)
                .markdownMargin(top: .em(1), bottom: .em(1))
        }
}
