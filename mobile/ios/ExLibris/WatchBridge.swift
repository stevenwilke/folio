import Foundation
import UIKit
import WatchConnectivity

/// iPhone-side bridge for the Apple Watch reading-timer app.
///
/// Responsibilities:
/// 1. Push the user's currently-reading book list to the watch via
///    `updateApplicationContext` (latest-state-only delivery — perfect for
///    "what's the user reading right now").
/// 2. Receive completed reading sessions from the watch via `userInfo` queue
///    and stash them in the App Group UserDefaults under
///    `pendingWatchSessions`. JavaScript reads + drains that queue on
///    foreground (see mobile/lib/watchSessions.ts) and writes to Supabase.
///
/// The data model intentionally mirrors mobile/lib/currentlyReadingWidget.ts
/// so we can reuse the same UserDefaults payload that already feeds the widget.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()

    private let appGroup = "group.com.exlibris.app"
    private let widgetKey = "currentlyReading"           // shape: { books: [...], updatedAt }
    private let pendingSessionsKey = "pendingWatchSessions"  // shape: [{...}, {...}]

    /// Activate the WCSession. Call once on app launch.
    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()

        // Re-push the latest book list every time the iPhone app comes to the
        // foreground — that's a cheap heuristic for "the user might have
        // updated their currently-reading list and we want the watch to know".
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func handleForeground() {
        pushCurrentlyReading()
    }

    // MARK: - Pushing currently-reading list to the watch

    /// Pull the latest currently-reading books from the App Group (the same
    /// payload the widget reads) and push them to the watch.
    /// Safe to call repeatedly; iOS dedupes identical contexts.
    func pushCurrentlyReading() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        guard WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }

        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let raw = defaults.string(forKey: widgetKey),
            let data = raw.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        // updateApplicationContext rejects NSNull (which JSONSerialization
        // produces from JS `null`). Strip nulls recursively before pushing —
        // otherwise a single book with a missing author/cover would cause the
        // whole push to throw and the watch never updates.
        let context: [String: Any] = [
            "books":     stripNulls(json["books"] ?? []),
            "updatedAt": stripNulls(json["updatedAt"] ?? ""),
        ]

        do {
            try WCSession.default.updateApplicationContext(context)
        } catch {
            NSLog("[WatchBridge] updateApplicationContext failed: \(error)")
        }
    }

    private func stripNulls(_ value: Any) -> Any {
        if value is NSNull { return "" }
        if let dict = value as? [String: Any] {
            var clean: [String: Any] = [:]
            for (k, v) in dict where !(v is NSNull) {
                clean[k] = stripNulls(v)
            }
            return clean
        }
        if let arr = value as? [Any] {
            return arr.map { stripNulls($0) }
        }
        return value
    }

    // MARK: - Receiving completed sessions from the watch

    private func enqueueIncomingSession(_ session: [String: Any]) {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return }
        var queue: [[String: Any]] = []
        if
            let existing = defaults.string(forKey: pendingSessionsKey),
            let data = existing.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        {
            queue = parsed
        }
        queue.append(session)

        if let payload = try? JSONSerialization.data(withJSONObject: queue),
           let str = String(data: payload, encoding: .utf8)
        {
            defaults.set(str, forKey: pendingSessionsKey)
        }
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // After activation, push the latest list so the watch picks up changes
        // made on the phone since last sync.
        DispatchQueue.main.async { self.pushCurrentlyReading() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // iOS requires reactivation if the user switches paired watches.
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
        guard
            let type = userInfo["type"] as? String,
            type == "completedSession",
            let sessionPayload = userInfo["session"] as? [String: Any]
        else { return }
        enqueueIncomingSession(sessionPayload)
    }
}
