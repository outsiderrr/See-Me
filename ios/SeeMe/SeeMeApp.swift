import SwiftUI

@main
struct SeeMeApp: App {
    @StateObject private var api = APIClient()

    var body: some Scene {
        WindowGroup {
            Group {
                if api.isLoggedIn {
                    HomeView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(api)
        }
    }
}

struct HomeView: View {
    var body: some View {
        TabView {
            LibraryView()
                .tabItem { Label("库", systemImage: "doc.text") }
            CardsView()
                .tabItem { Label("卡", systemImage: "person.crop.rectangle.stack") }
        }
    }
}
