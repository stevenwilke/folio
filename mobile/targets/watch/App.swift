import SwiftUI

@main
struct ExLibrisWatchApp: App {
    @StateObject private var session = WatchSessionManager.shared

    var body: some Scene {
        WindowGroup {
            BookListView()
                .environmentObject(session)
        }
    }
}
