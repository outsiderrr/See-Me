import SwiftUI

@main
struct SeeMeApp: App {
    @StateObject private var api = APIClient()

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if let token = GalleryHost.tokenFromLaunchArgs() {
                    GalleryHost(token: token)
                } else if api.isLoggedIn {
                    HomeView()
                } else {
                    LoginView()
                }
                #else
                if api.isLoggedIn {
                    HomeView()
                } else {
                    LoginView()
                }
                #endif
            }
            .environmentObject(api)
        }
    }
}

struct HomeView: View {
    private static var debugShowSidebar: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--show-sidebar")
        #else
        false
        #endif
    }

    @EnvironmentObject private var api: APIClient
    enum Section { case library, cards }
    @StateObject private var library = LibraryStore()
    @State private var section: Section = .library
    @State private var sidebarOpen = HomeView.debugShowSidebar

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                HomeTopBar(section: $section) {
                    withAnimation(.easeOut(duration: 0.22)) { sidebarOpen = true }
                }
                if section == .library {
                    LibraryView(store: library)
                } else {
                    CardsView()
                }
            }

            if sidebarOpen {
                Color.black.opacity(0.22)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { sidebarOpen = false } }
                LibrarySidebar(store: library) {
                    withAnimation(.easeOut(duration: 0.2)) { sidebarOpen = false }
                }
                .frame(width: min(UIScreen.main.bounds.width * 0.88, 370))
                .transition(.move(edge: .leading))
            }
        }
        .task {
            await library.loadAll(api)
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--select-first-card"),
               let first = library.receivedCards.first {
                await library.toggleReceivedCard(first, api: api)
            }
            #endif
        }
    }
}

struct HomeTopBar: View {
    @Binding var section: HomeView.Section
    let openSidebar: () -> Void

    var body: some View {
        ZStack {
            HStack {
                Button(action: openSidebar) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 21, weight: .medium))
                        .frame(width: 42, height: 42)
                }
                .opacity(section == .library ? 1 : 0)
                .disabled(section != .library)
                Spacer()
                Color.clear.frame(width: 42, height: 42)
            }
            HStack(spacing: 4) {
                topChoice("库", value: .library)
                topChoice("卡", value: .cards)
            }
            .padding(4)
            .background(Color.secondary.opacity(0.1))
            .clipShape(Capsule())
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color(uiColor: .systemBackground))
    }

    private func topChoice(_ title: String, value: HomeView.Section) -> some View {
        Button {
            section = value
        } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(section == value ? Color.primary : Color.secondary)
                .frame(width: 62)
                .padding(.vertical, 7)
                .background(section == value ? Color(uiColor: .secondarySystemBackground) : Color.clear)
                .clipShape(Capsule())
        }
    }
}
