import SwiftUI

/// Top-level screen on the watch: shows what the user is currently reading.
/// Tap a book to start a timed session.
struct BookListView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        NavigationStack {
            List {
                if session.books.isEmpty {
                    EmptyStateRow()
                } else {
                    ForEach(session.books) { book in
                        NavigationLink(destination: TimerView(book: book)) {
                            BookRow(book: book)
                        }
                    }
                }
            }
            .navigationTitle("Reading")
        }
    }
}

private struct BookRow: View {
    let book: ReadingBook

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(book.title)
                .font(.headline)
                .lineLimit(2)
            if let author = book.author {
                Text(author)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if book.totalPages != nil {
                ProgressView(value: book.progressFraction)
                    .tint(.accentColor)
                    .padding(.top, 2)
                if let cur = book.currentPage, let total = book.totalPages {
                    Text("\(cur) / \(total)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct EmptyStateRow: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("📖")
                .font(.system(size: 32))
            Text("No books in progress")
                .font(.caption)
                .multilineTextAlignment(.center)
            Text("Start one on your iPhone")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}
