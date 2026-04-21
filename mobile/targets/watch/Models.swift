import Foundation

/// Mirrors the JSON shape that the iPhone app pushes to the widget App Group
/// (see mobile/lib/currentlyReadingWidget.ts) and forwards over WatchConnectivity.
struct ReadingBook: Codable, Identifiable, Equatable {
    let bookId: String
    let title: String
    let author: String?
    let coverUrl: String?
    let currentPage: Int?
    let totalPages: Int?

    var id: String { bookId }

    var progressFraction: Double {
        guard let cur = currentPage, let total = totalPages, total > 0 else { return 0 }
        return min(1.0, Double(cur) / Double(total))
    }
}

/// Payload sent from the watch to the iPhone when a reading session ends.
/// The iPhone-side WatchBridge picks this up and writes it to Supabase via the
/// existing reading_sessions flow.
struct CompletedSession: Codable {
    let bookId: String
    let startedAt: Date
    let endedAt: Date
    let startPage: Int
    let endPage: Int

    var pagesRead: Int { max(0, endPage - startPage) }
    var durationSeconds: Int { Int(endedAt.timeIntervalSince(startedAt)) }

    func asDictionary() -> [String: Any] {
        return [
            "bookId":         bookId,
            "startedAt":      ISO8601DateFormatter().string(from: startedAt),
            "endedAt":        ISO8601DateFormatter().string(from: endedAt),
            "startPage":      startPage,
            "endPage":        endPage,
            "pagesRead":      pagesRead,
            "durationSec":    durationSeconds,
        ]
    }
}
