#if DEBUG
import SwiftUI

/// Entry point for the UI-direction gallery. DEBUG-only; never reachable in a
/// Release build. Launched with a single arg token like `a_library`,
/// `b_reader`, `c_sidebar`, optionally suffixed `_dark` (e.g. `a_library_dark`).
///
///   xcrun simctl launch <udid> com.seeme.app a_library
struct GalleryHost: View {
    let token: String

    /// Finds a gallery token in the process launch args, if any.
    static func tokenFromLaunchArgs() -> String? {
        let pattern = try! NSRegularExpression(pattern: "^[abc]_[a-z]+(_dark)?$")
        return ProcessInfo.processInfo.arguments.first { arg in
            let r = NSRange(arg.startIndex..., in: arg)
            return pattern.firstMatch(in: arg, range: r) != nil
        }
    }

    private var variant: Character { token.first ?? "a" }
    private var dark: Bool { token.hasSuffix("_dark") }
    private var screen: String {
        var parts = token.split(separator: "_").map(String.init)
        parts.removeFirst()                       // drop variant
        if parts.last == "dark" { parts.removeLast() }
        return parts.joined(separator: "_")
    }

    var body: some View {
        content
            .preferredColorScheme(dark ? .dark : .light)
    }

    @ViewBuilder
    private var content: some View {
        switch variant {
        case "a": DirectionA.screen(screen)
        case "b": DirectionB.screen(screen)
        default:  DirectionC.screen(screen)
        }
    }
}
#endif
