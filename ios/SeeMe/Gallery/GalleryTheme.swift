#if DEBUG
import SwiftUI
import UIKit

/// Builds a color that resolves differently in light vs dark, so every
/// direction adapts to dark mode from one declaration.
func dyn(_ light: Color, _ dark: Color) -> Color {
    Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
    })
}

extension View {
    /// Fills the whole window (incl. under the status bar) with `bg`, while
    /// keeping content inside the safe area.
    func galleryBackground(_ bg: Color) -> some View {
        background(bg.ignoresSafeArea())
    }
}
#endif
