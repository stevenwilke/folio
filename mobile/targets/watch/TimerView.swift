import SwiftUI
import WatchKit

/// Per-book reading timer. Start → pause/resume → stop, then enter end page
/// and save. Save sends a CompletedSession to the iPhone via WatchConnectivity.
struct TimerView: View {
    let book: ReadingBook

    @Environment(\.dismiss) private var dismiss

    @State private var startedAt: Date?
    @State private var elapsed: TimeInterval = 0
    @State private var isRunning = false
    @State private var pausedAccumulated: TimeInterval = 0
    @State private var resumedAt: Date?

    @State private var showingSaveSheet = false
    @State private var endPage: Int = 0

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 8) {
            Text(book.title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.center)

            Text(formatElapsed(elapsed))
                .font(.system(size: 36, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .padding(.top, 4)

            HStack(spacing: 12) {
                if isRunning {
                    Button(action: pause) {
                        Image(systemName: "pause.fill")
                    }
                    .tint(.orange)
                } else {
                    Button(action: start) {
                        Image(systemName: "play.fill")
                    }
                    .tint(.accentColor)
                }

                Button(action: stop) {
                    Image(systemName: "stop.fill")
                }
                .tint(.red)
                .disabled(startedAt == nil)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
        .onReceive(timer) { _ in
            guard isRunning, let resumedAt = resumedAt else { return }
            elapsed = pausedAccumulated + Date().timeIntervalSince(resumedAt)
        }
        .sheet(isPresented: $showingSaveSheet) {
            SaveSheet(
                book: book,
                onSave: { ep in saveSession(endPage: ep) },
                onDiscard: { dismiss() }
            )
        }
    }

    // MARK: - Controls

    private func start() {
        if startedAt == nil { startedAt = Date() }
        resumedAt = Date()
        isRunning = true
        WKInterfaceDevice.current().play(.start)
    }

    private func pause() {
        if let resumedAt = resumedAt {
            pausedAccumulated += Date().timeIntervalSince(resumedAt)
        }
        resumedAt = nil
        isRunning = false
        WKInterfaceDevice.current().play(.click)
    }

    private func stop() {
        if isRunning { pause() }
        endPage = book.currentPage ?? 0
        showingSaveSheet = true
    }

    private func saveSession(endPage: Int) {
        guard let startedAt = startedAt else { return }
        let session = CompletedSession(
            bookId: book.bookId,
            startedAt: startedAt,
            endedAt: Date(),
            startPage: book.currentPage ?? 0,
            endPage: endPage
        )
        WatchSessionManager.shared.sendCompletedSession(session)
        WKInterfaceDevice.current().play(.success)
        dismiss()
    }

    private func formatElapsed(_ t: TimeInterval) -> String {
        let total = Int(t)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}

// MARK: - Save sheet

private struct SaveSheet: View {
    let book: ReadingBook
    let onSave: (Int) -> Void
    let onDiscard: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var endPage: Int

    init(book: ReadingBook, onSave: @escaping (Int) -> Void, onDiscard: @escaping () -> Void) {
        self.book = book
        self.onSave = onSave
        self.onDiscard = onDiscard
        _endPage = State(initialValue: book.currentPage ?? 0)
    }

    var body: some View {
        VStack(spacing: 12) {
            Text("End page")
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("\(endPage)")
                .font(.system(size: 32, weight: .semibold, design: .rounded))
                .focusable(true)
                .digitalCrownRotation(
                    Binding(
                        get: { Double(endPage) },
                        set: { endPage = max(0, Int($0.rounded())) }
                    ),
                    from: 0,
                    through: Double(book.totalPages ?? 9999),
                    by: 1,
                    sensitivity: .medium,
                    isContinuous: false,
                    isHapticFeedbackEnabled: true
                )

            HStack(spacing: 8) {
                Button("Discard") {
                    onDiscard()
                    dismiss()
                }
                .tint(.gray)

                Button("Save") {
                    onSave(endPage)
                    dismiss()
                }
                .tint(.accentColor)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
