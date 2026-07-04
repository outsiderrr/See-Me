#if DEBUG
import SwiftUI
import UIKit

// `dyn(_:_:)` lives in Theme.swift (compiled in all configs) so the gallery and
// the production app share one definition.

extension View {
    /// Fills the whole window (incl. under the status bar) with `bg`, while
    /// keeping content inside the safe area.
    func galleryBackground(_ bg: Color) -> some View {
        background(bg.ignoresSafeArea())
    }
}
#endif
