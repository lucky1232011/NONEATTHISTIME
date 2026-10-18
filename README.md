# ECHO//VOID

A local-first, cinematic rhythm-game prototype and song-making studio. It runs in a modern browser without a backend, account, package install, external media service, or network dependency.

The runnable app is currently on the `codex/echo-void-playable-prototype` branch while [PR #1](https://github.com/lucky1232011/NONEATTHISTIME/pull/1) is open. The `main` branch contains this README; clone the app branch using the steps below.

## Run on Windows

### 1. Install Node.js

Install the current Node.js LTS release if `node` is not already available. You do not need to install npm packages for this project.

### 2. Clone this project

Open PowerShell in the folder where you want the project saved, then run:

    git clone --branch codex/echo-void-playable-prototype https://github.com/lucky1232011/NONEATTHISTIME.git
    cd NONEATTHISTIME

If you already cloned the repository, just use `cd` to move into its `NONEATTHISTIME` folder. Run the remaining commands from that folder—the one containing `server.js`.

### 3. Start the local server

In PowerShell, run:

    node server.js

Leave this PowerShell window open while you play. It should print that the ECHO//VOID server is listening at `http://localhost:4173`.

### 4. Open the game

On the same computer where the server is running, open this address in your browser:

    http://localhost:4173

If the page does not load, check that PowerShell is still running `node server.js` and that you are using a browser on the same computer. A browser embedded in a separate app or remote environment may not be able to reach that computer's `localhost`.

To stop the server, return to PowerShell and press **Ctrl+C**.

There is no build step or package install. Web Audio and IndexedDB work on the local `localhost` address.

### Optional: run the checks

Open a second PowerShell window in the `NONEATTHISTIME` folder and run:

    node --check app.js
    node --check server.js
    node --test tests/smoke.test.cjs

## Included

- Three original 48-second electronic compositions are synthesized locally with Web Audio; their audio is not downloaded.
- Two playable systems: four-lane (D, F, J, K) with tap and hold notes, and circle targets (mouse or touch).
- Audio-clock judgments, adjustable global input calibration, per-song synchronization, scoring, combo, accuracy, results, personal bests, pause, restart, and replay.
- Search, mood/mode filters, favorites, recent songs, song details, chart compatibility checks, and a mode roadmap that identifies unavailable modes.
- MP3 import with optional independent MP4 video and cover image, metadata, synchronized preview, opacity, video offset, and crop settings.
- Local onset/energy analysis and deterministic procedural chart generation. It is not an external AI inference service.
- A beat-grid chart editor with tap/hold tools, drag-to-move, lane editing, hold duration, snap, undo/redo, preview speed, video preview, validation, JSON export, and playtesting.
- IndexedDB storage for projects, media blobs, favorites, settings, charts, and personal bests. .evproj files back up projects or the local library.

## Keyboard and editor controls

- Four-lane play: **D F J K** (hold a key through a hold note).
- Circle play: click/tap inside a target during its timing window.
- Chart editor: click empty timeline space to place a note; drag to move; **Alt + drag** a hold tail to change duration; **Delete** removes the selected note; **Space** previews; **Ctrl/⌘ + Z** undo; **Ctrl/⌘ + Shift + Z** or **Ctrl/⌘ + Y** redo.

## Chart JSON format

Exported chart files are UTF-8 JSON. Timestamps and hold lengths are in seconds. Circle positions are normalized to 0–1. The current version accepts only lanes and circle charts.

    {
      "format": "echo-void-chart",
      "version": 1,
      "chart": {
        "id": "chart-example",
        "songId": "song-example",
        "mode": "lanes",
        "difficulty": "Normal",
        "author": "You",
        "version": "1.0.0",
        "bpm": 112,
        "offset": 0,
        "notes": [
          { "id": "n1", "time": 1.0714, "type": "tap", "lane": 0 },
          { "id": "n2", "time": 2.1429, "type": "hold", "lane": 2, "duration": 0.5 }
        ]
      }
    }

## Local data and boundaries

Imported songs stay in this browser’s IndexedDB. Media is not uploaded or shared. Browser storage is not a guaranteed backup; export .evproj files for work you want to keep.

Only four-lane and circle modes are playable. Piano, directional, runner, and platform modes are planned; arc mode is experimental. Circle charts currently support tap targets. Chart imports from other games are not translated. The procedural generator estimates tempo from local audio energy and onsets; it is a baseline, not a claim of perfect beat detection.

The original built-in compositions are synthesized in your browser and are provided for use in this prototype. User-imported media remains subject to its owner’s license and permissions.

