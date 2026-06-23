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
    @State private var section: Section = HomeView.debugInitialSection
    @State private var sidebarOpen = HomeView.debugShowSidebar

    private static var debugInitialSection: Section {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--section-cards") ? .cards : .library
        #else
        .library
        #endif
    }

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
                    Image(systemName: "line.horizontal.3")
                        .font(.system(size: 18, weight: .light))
                        .foregroundStyle(Theme.soft)
                        .frame(width: 38, height: 38)
                }
                .opacity(section == .library ? 1 : 0)
                .disabled(section != .library)
                Spacer()
                Color.clear.frame(width: 38, height: 38)
            }
            HStack(spacing: 26) {
                topChoice("库", value: .library)
                topChoice("卡", value: .cards)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 6)
        .padding(.bottom, 12)
        .background(Theme.paper)
    }

    private func topChoice(_ title: String, value: HomeView.Section) -> some View {
        let active = section == value
        return Button {
            section = value
        } label: {
            VStack(spacing: 5) {
                Text(title)
                    .font(Theme.serif(18, active ? .semibold : .regular))
                    .foregroundStyle(active ? Theme.ink : Theme.faint)
                Rectangle()
                    .fill(active ? Theme.clay : .clear)
                    .frame(width: 16, height: 2)
            }
        }
    }
}
