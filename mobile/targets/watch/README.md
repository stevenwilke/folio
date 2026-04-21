# Ex Libris Watch — reading timer

A watchOS companion to the iPhone app. Lists the user's currently-reading books
and lets them run a per-book reading timer. When a session is saved on the
watch, it's queued in the App Group for the iPhone app to write to Supabase.

## Architecture

```
┌─────────────────────┐                          ┌─────────────────────┐
│   iPhone app (RN)   │                          │   Watch app (Swift) │
│                     │                          │                     │
│  syncCurrentlyRead. │                          │  BookListView       │
│  writes →           │                          │  shows ←            │
│   App Group         │                          │   WatchSession-     │
│   `currentlyReading`│                          │   Manager.books     │
│         │           │                          │         ▲           │
│         ▼           │                          │         │           │
│  WatchBridge.swift ─┼── updateApplication- ────┼─→ ingestApp-        │
│  (on foreground)    │   Context (latest only)  │   licationContext   │
│                     │                          │                     │
│         ▲           │                          │         │           │
│         │           │                          │         ▼           │
│  WatchBridge.swift ←┼── transferUserInfo  ─────┼── TimerView         │
│  enqueues →         │   (queued)               │   on Save           │
│   App Group         │                          │                     │
│   `pendingWatch-    │                          │                     │
│    Sessions`        │                          │                     │
│         │           │                          │                     │
│         ▼           │                          │                     │
│  TODO (phase 2):    │                          │                     │
│  RN drains queue +  │                          │                     │
│  writes Supabase    │                          │                     │
└─────────────────────┘                          └─────────────────────┘
```

## What's wired up (Phase 1)

- **Watch target** at `mobile/targets/watch/` registered via
  `@bacons/apple-targets` (`type: "watch"` in `expo-target.config.json`).
- **Watch UI**: book list → tap → timer → pause/resume → stop → page stepper → save.
- **Watch → iPhone**: `WatchSessionManager.sendCompletedSession` uses
  `transferUserInfo` (queued, retried until delivered).
- **iPhone WatchBridge** (`mobile/ios/ExLibris/WatchBridge.swift`):
  - Activated on app launch from `AppDelegate.swift`.
  - Pushes the currently-reading list (read from the same App Group key the
    widget uses) every time the iPhone app foregrounds.
  - Receives sessions from the watch and enqueues them in App Group
    UserDefaults under `pendingWatchSessions`.
- **Config plugin** (`mobile/plugins/withWatchBridge.js`) re-registers
  `WatchBridge.swift` with the Xcode project on `expo prebuild`, so a clean
  prebuild doesn't drop it.

## What's left (Phase 2)

The pending-sessions queue accumulates in App Group UserDefaults but nothing
drains it yet. To finish the loop:

1. Build a tiny Expo native module (e.g. `mobile/modules/watch-bridge`) that
   exposes:
   - `getPendingSessions(): Promise<CompletedSession[]>` — reads the App Group
     key `pendingWatchSessions` and parses the JSON.
   - `clearPendingSessions(): Promise<void>` — wipes the key.
2. Add `mobile/lib/watchSessions.ts`:
   - `processPendingWatchSessions()` — pulls the queue, for each session
     `INSERT INTO reading_sessions` with `status = 'completed'` and updates
     `collection_entries.current_page`, then clears the queue.
3. Call `processPendingWatchSessions()` from:
   - App launch (`mobile/app/_layout.tsx`).
   - Foreground (`AppState` `change → "active"` listener).

## Build instructions

The watch target needs a clean iOS prebuild before it will appear in Xcode:

```bash
cd mobile
npx expo prebuild --platform ios --clean
npx pod-install
```

Then either open `ios/ExLibris.xcworkspace` in Xcode (you should see a new
`Ex Libris Watch` target) or build for TestFlight via EAS:

```bash
npx eas-cli@latest build --platform ios --profile production
```

EAS will sign both the iPhone and watch targets in one build. The watch app
ships as a paired companion — no separate App Store listing needed.

## Pairing notes for testers

- The watch app installs automatically on the paired Apple Watch when the
  iPhone app updates (assuming the user has "Show App on Apple Watch" enabled
  in the Watch app on their iPhone).
- First sync may take 30 seconds after install while WatchConnectivity
  activates on both devices.
- The sample book ("The Three-Body Problem") is shown until the iPhone has
  pushed a real list — that's intentional, so testers see something useful
  even before they open the iPhone app.
