import SwiftUI

@main
struct SeeMeApp: App {
    @StateObject private var api = APIClient()

    var body: some Scene {
        WindowGroup {
            Group {
                if api.isLoggedIn {
                    LibraryView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(api)
        }
    }
}
