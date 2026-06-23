import SwiftUI
import UIKit

/// Resolves to `light` or `dark` per the active interface style — one
/// declaration adapts to dark mode everywhere.
func dyn(_ light: Color, _ dark: Color) -> Color {
    Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
    })
}

/// See Me design system — "纸页 / 私人手札" (Direction A).
/// Warm ivory paper, serif body, hairline dividers instead of cards, almost no
/// shadow. Hierarchy from typography, whitespace and thin rules.
enum Theme {
    // Surfaces
    static let paper  = dyn(Color(red: 0.984, green: 0.965, blue: 0.933), Color(red: 0.090, green: 0.082, blue: 0.066))
    static let raised = dyn(Color(red: 0.996, green: 0.984, blue: 0.961), Color(red: 0.137, green: 0.125, blue: 0.105))

    // Text
    static let ink   = dyn(Color(red: 0.157, green: 0.137, blue: 0.117), Color(red: 0.925, green: 0.902, blue: 0.863))
    static let soft  = dyn(Color(red: 0.482, green: 0.447, blue: 0.404), Color(red: 0.612, green: 0.580, blue: 0.522))
    static let faint = dyn(Color(red: 0.682, green: 0.651, blue: 0.604), Color(red: 0.435, green: 0.412, blue: 0.376))

    // Accents
    static let clay  = dyn(Color(red: 0.604, green: 0.376, blue: 0.235), Color(red: 0.792, green: 0.561, blue: 0.408))
    static let brick = dyn(Color(red: 0.604, green: 0.290, blue: 0.235), Color(red: 0.804, green: 0.490, blue: 0.420))

    // Hairline
    static let rule  = dyn(Color(red: 0.157, green: 0.137, blue: 0.117).opacity(0.12),
                           Color(red: 0.925, green: 0.902, blue: 0.863).opacity(0.14))

    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    // Metrics
    static let hPad: CGFloat = 26
    static let cardRadius: CGFloat = 12
}

extension View {
    /// Fills the whole window (incl. under the status bar) with `bg`, keeping
    /// content inside the safe area.
    func paperBackground(_ bg: Color = Theme.paper) -> some View {
        background(bg.ignoresSafeArea())
    }
}

/// A thin horizontal hairline used to separate entries / sections.
struct Hairline: View {
    var inset: CGFloat = 0
    var body: some View {
        Rectangle().fill(Theme.rule).frame(height: 1).padding(.leading, inset)
    }
}
