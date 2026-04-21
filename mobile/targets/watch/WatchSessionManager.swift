import Foundation
import WatchConnectivity
import Combine

/// Singleton that owns the WCSession on the watch side.
///
/// - Receives the currently-reading book list from the iPhone via
///   `applicationContext` (latest-state-only — perfect for our "what's the
///   user reading right now" use case).
/// - Sends completed reading sessions back to the iPhone via
///   `transferUserInfo` (queued and reliably delivered, even if the iPhone
///   isn't reachable at the moment of save).
final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    @Published var books: [ReadingBook] = []
    @Published var lastSyncedAt: Date?

    /// Local fallback shown until the iPhone has pushed real data over.
    /// Same sample as the widget so testers see something on first install.
    private let sampleBook = ReadingBook(
        bookId: "sample",
        title: "The Three-Body Problem",
        author: "Liu Cixin",
        coverUrl: nil,
        currentPage: 142,
        totalPages: 400
    )

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
        books = [sampleBook]
    }

    // MARK: - Sending

    /// Send a completed session to the iPhone for Supabase persistence.
    /// Uses transferUserInfo so it's queued and retried until delivery succeeds.
    func sendCompletedSession(_ session: CompletedSession) {
        guard WCSession.isSupported() else { return }
        let payload: [String: Any] = [
            "type":    "completedSession",
            "session": session.asDictionary(),
        ]
        WCSession.default.transferUserInfo(payload)
    }

    // MARK: - Receiving

    private func ingestApplicationContext(_ context: [String: Any]) {
        guard let booksRaw = context["books"] as? [[String: Any]] else { return }
        let decoded: [ReadingBook] = booksRaw.compactMap { dict in
            guard
                let bookId = dict["bookId"] as? String,
                let title = dict["title"] as? String
            else { return nil }
            return ReadingBook(
                bookId: bookId,
                title: title,
                author: dict["author"] as? String,
                coverUrl: dict["coverUrl"] as? String,
                currentPage: dict["currentPage"] as? Int,
                totalPages: dict["totalPages"] as? Int
            )
        }
        DispatchQueue.main.async {
            // Keep the sample book around if the user genuinely has nothing.
            self.books = decoded.isEmpty ? [self.sampleBook] : decoded
            self.lastSyncedAt = Date()
        }
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // After activation, pick up whatever applicationContext the phone left for us.
        ingestApplicationContext(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        ingestApplicationContext(applicationContext)
    }
}
