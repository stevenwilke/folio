import WidgetKit
import SwiftUI

// MARK: - Data model (matches JSON written from RN)

struct ReadingBook: Codable {
    let title: String
    let author: String?
    let coverUrl: String?
    let currentPage: Int?
    let totalPages: Int?
    let bookId: String?
}

struct WidgetData: Codable {
    let books: [ReadingBook]?
    let updatedAt: String?
}

// MARK: - Provider

struct Provider: TimelineProvider {
    let appGroup = "group.com.exlibris.app"
    let userDefaultsKey = "currentlyReading"
    let rotateMinutes = 5

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: Date(), book: sampleBook, totalBooks: 3, index: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        let data = loadData()
        let books = data?.books ?? []
        let first = books.first ?? sampleBook
        completion(WidgetEntry(date: Date(), book: first, totalBooks: max(1, books.count), index: 0))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        let data = loadData()
        let books = data?.books ?? []

        // Empty library → single empty entry, re-check every 30 min
        if books.isEmpty {
            let next = Calendar.current.date(byAdding: .minute, value: rotateMinutes, to: Date()) ?? Date()
            let entry = WidgetEntry(date: Date(), book: nil, totalBooks: 0, index: 0)
            completion(Timeline(entries: [entry], policy: .after(next)))
            return
        }

        // Rotate: emit one entry per book, each scheduled `rotateMinutes` apart
        var entries: [WidgetEntry] = []
        let now = Date()
        for (i, book) in books.enumerated() {
            let date = Calendar.current.date(byAdding: .minute, value: i * rotateMinutes, to: now) ?? now
            entries.append(WidgetEntry(date: date, book: book, totalBooks: books.count, index: i))
        }
        // After the full cycle, ask iOS to reload timeline (the app also nudges on progress updates)
        let refreshAfter = Calendar.current.date(byAdding: .minute, value: books.count * rotateMinutes, to: now) ?? now
        completion(Timeline(entries: entries, policy: .after(refreshAfter)))
    }

    private func loadData() -> WidgetData? {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
        guard let str = defaults.string(forKey: userDefaultsKey),
              let data = str.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }

    private var sampleBook: ReadingBook {
        ReadingBook(
            title: "The Three-Body Problem",
            author: "Liu Cixin",
            coverUrl: nil,
            currentPage: 142,
            totalPages: 400,
            bookId: nil
        )
    }
}

struct WidgetEntry: TimelineEntry {
    let date: Date
    let book: ReadingBook?
    let totalBooks: Int
    let index: Int
}

// MARK: - Views

struct CurrentlyReadingView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if let book = entry.book {
            bookView(book)
                .widgetURL(deepLinkURL(for: book))
        } else {
            emptyView
        }
    }

    private func deepLinkURL(for book: ReadingBook) -> URL? {
        guard let id = book.bookId, !id.isEmpty else { return URL(string: "exlibris://") }
        return URL(string: "exlibris://book/\(id)")
    }

    @ViewBuilder
    private func bookView(_ book: ReadingBook) -> some View {
        let pct: Double = {
            guard let c = book.currentPage, let t = book.totalPages, t > 0 else { return 0 }
            return min(1.0, Double(c) / Double(t))
        }()

        // Warm palette tuned for the cream widget background (#f5f0e8)
        let inkColor = Color(red: 0.18, green: 0.13, blue: 0.09)
        let mutedColor = Color(red: 0.42, green: 0.36, blue: 0.30)
        let trackColor = Color(red: 0.78, green: 0.70, blue: 0.58).opacity(0.45)

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                coverThumb(urlStr: book.coverUrl)
                    .frame(width: family == .systemSmall ? 44 : 56,
                           height: family == .systemSmall ? 66 : 84)
                    .cornerRadius(4)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("NOW READING")
                            .font(.system(size: 9, weight: .heavy))
                            .foregroundColor(mutedColor)
                            .tracking(0.9)
                        if entry.totalBooks > 1 {
                            Text("\(entry.index + 1)/\(entry.totalBooks)")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(Color("AccentColor"))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(
                                    Capsule().fill(Color("AccentColor").opacity(0.15))
                                )
                        }
                    }
                    Text(book.title)
                        .font(.system(size: family == .systemSmall ? 13 : 15, weight: .bold, design: .serif))
                        .lineLimit(2)
                        .foregroundColor(Color("AccentColor"))
                    if let author = book.author {
                        Text(author)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(inkColor)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            Spacer(minLength: 2)
            VStack(alignment: .leading, spacing: 4) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(trackColor)
                        Capsule().fill(Color("AccentColor")).frame(width: max(6, geo.size.width * pct))
                    }
                }
                .frame(height: 6)
                if let c = book.currentPage, let t = book.totalPages {
                    Text("Page \(c) of \(t) · \(Int(pct * 100))%")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(inkColor)
                }
            }
        }
        .padding(12)
        .containerBackground(for: .widget) { Color("WidgetBackground") }
    }

    private var emptyView: some View {
        VStack(spacing: 6) {
            Text("📚").font(.system(size: 32))
            Text("No book in progress")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Color("AccentColor"))
            Text("Start a book in Folio to track progress here.")
                .font(.system(size: 11))
                .foregroundColor(Color(red: 0.4, green: 0.35, blue: 0.3))
                .multilineTextAlignment(.center)
        }
        .padding(12)
        .containerBackground(for: .widget) { Color("WidgetBackground") }
    }

    @ViewBuilder
    private func coverThumb(urlStr: String?) -> some View {
        if let urlStr = urlStr, let url = URL(string: urlStr),
           let data = try? Data(contentsOf: url),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage).resizable().scaledToFill()
        } else {
            RoundedRectangle(cornerRadius: 4).fill(Color("AccentColor").opacity(0.25))
        }
    }
}

// MARK: - Widget

@main
struct FolioWidget: Widget {
    let kind: String = "FolioCurrentlyReading"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            CurrentlyReadingView(entry: entry)
        }
        .configurationDisplayName("Currently Reading")
        .description("Your current books and reading progress — taps open the book.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
