/* ECHO//VOID — local-first rhythm game prototype. No account or upload service. */
"use strict";

const APP_VERSION = "0.1.0";
const DATABASE = "echo-void-library";
const STORE_VERSION = 1;
const MODES = {
  lanes: { name: "Four-lane", keys: ["D", "F", "J", "K"], status: "Playable" },
  circle: { name: "Circle", keys: ["Mouse / touch"], status: "Playable" },
  piano: { name: "Piano", keys: [], status: "Planned" },
  arc: { name: "Arc", keys: [], status: "Experimental" },
  directional: { name: "Directional", keys: [], status: "Planned" },
  runner: { name: "Runner", keys: [], status: "Planned" },
  platform: { name: "Platform", keys: [], status: "Planned" }
};
const BUILTINS = [
  { id: "afterimage", title: "Afterimage", artist: "ECHO//VOID Studio", bpm: 112, duration: 48, genre: "Night pop", mood: "Melancholic", theme: "cover-ice", tonic: 220, scale: [0, 3, 5, 7, 10], color: "#a8c4ec", pulse: 4, seed: 3, license: "Original composition synthesized in your browser for ECHO//VOID. No external recording." },
  { id: "glass-orbit", title: "Glass Orbit", artist: "ECHO//VOID Studio", bpm: 96, duration: 48, genre: "Dream ambient", mood: "Dreamlike", theme: "cover-violet", tonic: 261.63, scale: [0, 2, 5, 7, 9], color: "#c7b7e5", pulse: 8, seed: 9, license: "Original composition synthesized in your browser for ECHO//VOID. No external recording." },
  { id: "static-bloom", title: "Static Bloom", artist: "ECHO//VOID Studio", bpm: 128, duration: 48, genre: "Electronica", mood: "Energetic", theme: "cover-rose", tonic: 196, scale: [0, 2, 3, 7, 10], color: "#ddaabd", pulse: 2, seed: 14, license: "Original composition synthesized in your browser for ECHO//VOID. No external recording." }
];

const app = document.getElementById("app");
const toastRoot = document.getElementById("toast-root");
const state = {
  screen: "home", filter: "", sort: "featured", mood: "All moods", showFavorites: false,
  selectedSongId: null, projects: [], results: {}, favorites: new Set(), recent: [],
  settings: { calibrationMs: 0, videoOpacity: 27, videoBlur: 0, videoVisible: true, videoFit: "cover", musicVolume: .72 },
  databaseReady: false, persistenceAvailable: true, creator: null, editingProject: null, songSync: {},
  editorChart: null, editorUndo: [], editorRedo: [], editorSelectedId: null, editorTool: "tap",
  game: null, lastRun: null, modal: null, toastTimers: []
};
let dbPromise = null;
let gameRaf = 0;
let transport = { playing: false, kind: null, song: null, position: 0, startedAt: 0, rate: 1, context: null, master: null, source: null, element: null, objectUrl: null };
let audioBufferCache = new Map();
let editorRaf = 0;
let viewUrls = [];
let makerPreview = { audioUrl: null, videoUrl: null, audio: null, video: null };
let lastGameVideoUrl = null;
let gameAudioReady = false;

function uid(prefix) {
  const raw = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  return (prefix || "id") + "-" + raw;
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}
function fmtTime(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}
function fmtClock(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  return Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") + "." + String(Math.floor((t % 1) * 100)).padStart(2, "0");
}
function coverMarkup(song, cls) {
  const cover = song.coverDataUrl ? '<img class="cover-img" alt="" src="' + esc(song.coverDataUrl) + '">' : "";
  return '<div class="cover ' + (song.theme || "cover-custom") + " " + (cls || "") + '">' + cover + '<div class="cover-overlay">' + esc((song.mood || song.genre || "ECHO//VOID").toUpperCase()) + '</div></div>';
}
function toast(message, type) {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = message;
  toastRoot.appendChild(el);
  const timer = setTimeout(function () { el.remove(); }, 3600);
  state.toastTimers.push(timer);
}

function openDatabase() {
  if (!("indexedDB" in window)) {
    state.persistenceAvailable = false;
    return Promise.resolve(null);
  }
  return new Promise(function (resolve) {
    const request = indexedDB.open(DATABASE, STORE_VERSION);
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("prefs")) db.createObjectStore("prefs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("results")) db.createObjectStore("results", { keyPath: "key" });
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { state.persistenceAvailable = false; resolve(null); };
    request.onblocked = function () { state.persistenceAvailable = false; resolve(null); };
  });
}
function tx(store, mode, action) {
  return (dbPromise || (dbPromise = openDatabase())).then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
      transaction.onabort = function () { reject(transaction.error || new Error("Storage operation was interrupted.")); };
    });
  });
}
async function loadLibrary() {
  try {
    dbPromise = dbPromise || openDatabase();
    const [projects, prefs, results] = await Promise.all([tx("projects", "readonly", s => s.getAll()), tx("prefs", "readonly", s => s.getAll()), tx("results", "readonly", s => s.getAll())]);
    state.projects = projects || [];
    (prefs || []).forEach(function (item) {
      if (item.key === "settings") state.settings = Object.assign(state.settings, item.value || {});
      if (item.key === "favorites") state.favorites = new Set(item.value || []);
      if (item.key === "recent") state.recent = item.value || [];
      if (item.key && item.key.indexOf("sync:") === 0) state.songSync[item.key.slice(5)] = item.value || {};
    });
    (results || []).forEach(function (item) { state.results[item.key] = item.value; });
  } catch (error) {
    state.persistenceAvailable = false;
    toast("Local storage could not be opened. This session can continue, but changes may not persist.", "error");
  }
  state.databaseReady = true;
  render();
}
async function put(store, item) {
  try { await tx(store, "readwrite", s => s.put(item)); return true; }
  catch (error) { toast("Could not save locally: " + (error && error.message ? error.message : "storage error"), "error"); return false; }
}
function saveSetting(key, value) {
  if (key === "favorites") value = Array.from(state.favorites);
  if (key === "recent") value = state.recent;
  put("prefs", { key: key, value: value });
}
async function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  const ok = await put("projects", project);
  if (ok) {
    const at = state.projects.findIndex(p => p.id === project.id);
    if (at >= 0) state.projects[at] = project; else state.projects.unshift(project);
    return true;
  }
  return false;
}
function allSongs() { return BUILTINS.concat(state.projects); }
function getSong(id) {
  const song = allSongs().find(s => s.id === id) || null;
  if (song && state.songSync[song.id]) song.sync = Object.assign(song.sync || {}, state.songSync[song.id]);
  return song;
}
function songCharts(song) { return Array.isArray(song.charts) ? song.charts : []; }
function isBuiltin(song) { return BUILTINS.some(s => s.id === song.id) || !!song.sourceBuiltinId; }
function isSeedSong(song) { return BUILTINS.some(s => s.id === song.id); }
function builtinTrack(song) { return BUILTINS.find(s => s.id === song.sourceBuiltinId) || BUILTINS.find(s => s.id === song.id) || song; }
function chartKey(songId, chartId) { return songId + "::" + chartId; }
function getBest(songId, chartId) { return state.results[chartKey(songId, chartId)] || null; }
function availableModeNames(charts) {
  const names = [];
  (charts || []).forEach(c => { const label = MODES[c.mode] ? MODES[c.mode].name : c.mode; if (names.indexOf(label) < 0) names.push(label); });
  return names;
}

function builtinNotes(track, mode, difficulty) {
  const step = mode === "lanes" ? .5 : .75;
  const beats = track.duration * track.bpm / 60;
  const notes = [];
  let index = 0;
  for (let beat = 1; beat < beats - 1; beat += step) {
    const variation = (Math.sin((beat + track.seed) * 1.74) + Math.cos((beat * .49) + track.seed) + 2) / 4;
    const threshold = difficulty === "Expert" ? .28 : difficulty === "Normal" ? .5 : .72;
    if (variation < threshold) continue;
    if (mode === "lanes") {
      const lane = index % 4;
      const long = difficulty !== "Easy" && index % 17 === 9;
      notes.push({ id: uid("n"), time: +(beat * 60 / track.bpm).toFixed(4), type: long ? "hold" : "tap", lane: lane, duration: long ? .48 : 0 });
    } else {
      const angle = beat * 2.399 + track.seed * .3;
      notes.push({ id: uid("n"), time: +(beat * 60 / track.bpm).toFixed(4), type: "tap", x: +(0.5 + Math.cos(angle) * .29).toFixed(3), y: +(0.51 + Math.sin(angle) * .27).toFixed(3) });
    }
    index++;
  }
  return notes;
}
function builtinCharts(track) {
  return ["lanes", "circle"].map(function (mode, index) {
    const difficulty = mode === "lanes" ? (track.id === "static-bloom" ? "Expert" : "Normal") : "Normal";
    return {
      id: track.id + "-" + mode, songId: track.id, mode: mode, difficulty: difficulty,
      author: "ECHO//VOID Studio", version: "1.0.0", offset: 0,
      notes: builtinNotes(track, mode, difficulty), procedural: true
    };
  });
}
BUILTINS.forEach(function (track) { track.charts = builtinCharts(track); });

function validateChart(chart, song) {
  const errors = [];
  if (!chart || typeof chart !== "object") return ["Chart data is missing."];
  if (chart.version !== "1.0.0") errors.push("Unsupported chart version. ECHO//VOID accepts chart version 1.0.0.");
  if (!MODES[chart.mode] || !["lanes", "circle"].includes(chart.mode)) errors.push("This chart uses a game mode that is not playable in this build.");
  if (!Array.isArray(chart.notes) || chart.notes.length === 0) errors.push("The chart has no notes.");
  if (!song || !Number.isFinite(Number(song.duration)) || Number(song.duration) <= 0) errors.push("The song duration is not available.");
  if (!Array.isArray(chart.notes)) return errors;
  const ids = new Set();
  const laneEvents = new Map();
  chart.notes.forEach(function (note, index) {
    const prefix = "Note " + (index + 1) + ": ";
    if (!note || typeof note !== "object") { errors.push(prefix + "invalid note data."); return; }
    if (typeof note.id !== "string" || !note.id || ids.has(note.id)) errors.push(prefix + "missing or duplicate identifier.");
    ids.add(note.id);
    if (!Number.isFinite(Number(note.time)) || Number(note.time) < 0) errors.push(prefix + "missing or negative timestamp.");
    else if (song && Number(note.time) > Number(song.duration) + 2) errors.push(prefix + "timestamp is outside the song.");
    if (chart.mode === "lanes") {
      if (!["tap", "hold"].includes(note.type)) errors.push(prefix + "lane charts support tap and hold notes.");
      if (!Number.isInteger(Number(note.lane)) || Number(note.lane) < 0 || Number(note.lane) > 3) errors.push(prefix + "lane must be from 0 to 3.");
      if (note.type === "hold" && (!Number.isFinite(Number(note.duration)) || Number(note.duration) <= 0 || Number(note.duration) > 12)) errors.push(prefix + "hold duration must be between 0 and 12 seconds.");
      if (Number.isInteger(Number(note.lane)) && Number.isFinite(Number(note.time))) {
        const k = note.lane;
        const existing = laneEvents.get(k) || [];
        existing.push(note);
        laneEvents.set(k, existing);
      }
    } else if (chart.mode === "circle") {
      if (note.type !== "tap") errors.push(prefix + "circle charts support tap targets in version 1.0.0.");
      if (!Number.isFinite(Number(note.x)) || !Number.isFinite(Number(note.y)) || note.x < 0 || note.x > 1 || note.y < 0 || note.y > 1) errors.push(prefix + "circle position must be normalized from 0 to 1.");
    }
  });
  laneEvents.forEach(function (notes) {
    notes.sort((a,b) => a.time - b.time);
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i-1], curr = notes[i];
      const prevEnd = Number(prev.time) + (prev.type === "hold" ? Number(prev.duration) || 0 : 0);
      if (Number(curr.time) - prevEnd < .075) errors.push("Lane " + (Number(curr.lane) + 1) + " has contradictory overlapping events.");
    }
  });
  return Array.from(new Set(errors));
}

function getAudioContext() {
  if (!transport.context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("This browser does not support Web Audio.");
    transport.context = new Ctx({ latencyHint: "interactive" });
    transport.master = transport.context.createGain();
    transport.master.gain.value = state.settings.musicVolume;
    transport.master.connect(transport.context.destination);
  }
  return transport.context;
}
function envGain(ctx, gain, start, duration, level, attack) {
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), start + Math.max(.005, attack || .01));
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
}
function addVoice(ctx, output, frequency, start, length, type, volume, slideTo) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type || "sine";
  oscillator.frequency.setValueAtTime(Math.max(25, frequency), start);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, slideTo), start + Math.min(.12, length * .45));
  gain.connect(output);
  oscillator.connect(gain);
  envGain(ctx, gain, start, length, volume, Math.min(.025, length * .18));
  oscillator.start(start);
  oscillator.stop(start + length + .02);
}
function addPad(ctx, output, frequency, start, length, volume, waveform) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1100, start);
  filter.frequency.exponentialRampToValueAtTime(480, start + length);
  filter.connect(output);
  [1, 1.004, 2].forEach(function (multiplier, i) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = i === 2 ? "triangle" : waveform || "sawtooth";
    oscillator.frequency.value = frequency * multiplier;
    gain.gain.value = i === 2 ? .38 : .31;
    oscillator.connect(gain); gain.connect(filter);
    oscillator.start(start); oscillator.stop(start + length + .03);
  });
  const swell = ctx.createGain(); filter.disconnect(); filter.connect(swell);
  envGain(ctx, swell, start, length, volume, Math.min(.22, length * .3));
  swell.connect(output);
}
async function buildBuiltinBuffer(track) {
  if (audioBufferCache.has(track.id)) return audioBufferCache.get(track.id);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Offline audio synthesis is unavailable in this browser.");
  const rate = 22050;
  const off = new Offline(2, Math.ceil(track.duration * rate), rate);
  const master = off.createGain(); master.gain.value = .64; master.connect(off.destination);
  const compressor = off.createDynamicsCompressor();
  compressor.threshold.value = -20; compressor.knee.value = 12; compressor.ratio.value = 3; compressor.connect(master);
  const beat = 60 / track.bpm;
  const chordSteps = track.id === "glass-orbit" ? [0, 5, 9, 7] : (track.id === "static-bloom" ? [0, 3, 7, 10] : [0, 7, 3, 5]);
  const chordFreq = function (semitone) { return track.tonic * Math.pow(2, semitone / 12); };
  const totalBeats = Math.ceil(track.duration / beat);
  for (let b = 0; b < totalBeats; b++) {
    const t = .06 + b * beat;
    const bar = Math.floor(b / 4);
    const root = chordSteps[bar % chordSteps.length];
    const bass = chordFreq(root - 12);
    if (track.id === "static-bloom" || b % 2 === 0) addVoice(off, compressor, bass, t, .27, "triangle", .12, bass * .68);
    if (b % track.pulse === 0) addVoice(off, compressor, 54, t, .24, "sine", .25, 34);
    if ((track.id === "static-bloom" && b % 2 === 1) || (track.id !== "static-bloom" && b % 4 === 2)) {
      addVoice(off, compressor, 180, t, .12, "triangle", .06, 95);
      addVoice(off, compressor, 930 + (b % 3) * 120, t, .09, "sine", .055);
    }
    if (b % 4 === 0) {
      const chordLen = Math.min(beat * 3.7, track.duration - (t - .05));
      addPad(off, compressor, chordFreq(root), t, chordLen, .035, "sawtooth");
      addPad(off, compressor, chordFreq(root + 3), t, chordLen, .018, "triangle");
    }
    const motif = [0, 2, 1, 3, 2, 4, 1, 2];
    const n = motif[b % motif.length];
    const semitone = root + track.scale[n] + (bar % 3 === 2 ? 12 : 0);
    if ((b + track.seed) % 5 !== 1) addVoice(off, compressor, chordFreq(semitone), t + .04, Math.min(beat * .78, .65), "sine", .065, null);
    if (track.id === "glass-orbit" && b % 2 === 1) addVoice(off, compressor, chordFreq(root + track.scale[(n + 2) % track.scale.length] + 12), t + beat * .48, .44, "sine", .03);
  }
  const buffer = await off.startRendering();
  audioBufferCache.set(track.id, buffer);
  return buffer;
}
function songMediaTime() {
  if (!transport.playing) return Math.max(0, transport.position);
  if (transport.kind === "builtin") return Math.max(0, transport.position + (transport.context.currentTime - transport.startedAt) * (transport.rate || 1));
  if (transport.element) return Math.max(0, Number(transport.element.currentTime) || 0);
  return Math.max(0, transport.position);
}
function stopTransport() {
  const pos = songMediaTime();
  if (transport.source) { try { transport.source.stop(); } catch (_) {} transport.source.disconnect(); transport.source = null; }
  if (transport.element) { transport.element.pause(); transport.element.removeAttribute("src"); transport.element.load(); transport.element = null; }
  if (transport.objectUrl) { URL.revokeObjectURL(transport.objectUrl); transport.objectUrl = null; }
  transport.position = pos; transport.playing = false;
}
async function prepareTransport(song, offset, playbackRate) {
  stopTransport();
  transport.song = song;
  transport.position = Math.max(0, Number(offset) || 0);
  transport.rate = Number(playbackRate) || 1;
  const ctx = getAudioContext();
  await ctx.resume();
  if (isBuiltin(song)) {
    transport.kind = "builtin";
    const buffer = await buildBuiltinBuffer(builtinTrack(song));
    const source = ctx.createBufferSource();
    source.buffer = buffer; source.connect(transport.master);
    source.playbackRate.value = transport.rate;
    source.start(0, Math.min(transport.position, Math.max(0, buffer.duration - .03)));
    transport.source = source; transport.startedAt = ctx.currentTime; transport.playing = true;
    source.onended = function () {
      if (transport.source !== source) return;
      transport.position = song.duration; transport.playing = false; transport.source = null;
      if (state.game && state.screen === "game") finishGame();
      else if (state.screen === "editor") { state.editorPlayhead = song.duration; state.editorPlaying = false; render(); }
    };
  } else {
    if (!song.media || !song.media.audioBlob) throw new Error("This project has no saved audio file.");
    transport.kind = "file";
    const element = new Audio();
    element.preload = "auto";
    element.src = URL.createObjectURL(song.media.audioBlob);
    transport.objectUrl = element.src; transport.element = element;
    element.currentTime = transport.position; element.volume = state.settings.musicVolume;
    element.playbackRate = transport.rate;
    await element.play();
    transport.playing = true;
    element.onended = function () {
      transport.position = song.duration; transport.playing = false;
      if (state.game && state.screen === "game") finishGame();
      else if (state.screen === "editor") { state.editorPlayhead = song.duration; state.editorPlaying = false; render(); }
    };
  }
}
function pauseTransport() {
  if (!transport.playing) return;
  transport.position = songMediaTime();
  transport.playing = false;
  if (transport.source) { try { transport.source.stop(); } catch (_) {} transport.source.disconnect(); transport.source = null; }
  if (transport.element) transport.element.pause();
}
async function resumeTransport() {
  if (!transport.song) return;
  const song = transport.song;
  const position = transport.position;
  if (transport.kind === "builtin") {
    const ctx = getAudioContext(); await ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = await buildBuiltinBuffer(builtinTrack(song)); source.connect(transport.master);
    source.playbackRate.value = transport.rate || 1;
    source.start(0, Math.min(position, Math.max(0, source.buffer.duration - .03)));
    transport.source = source; transport.startedAt = ctx.currentTime; transport.playing = true;
    source.onended = function () {
      if (transport.source !== source) return;
      transport.position = song.duration; transport.playing = false; transport.source = null;
      if (state.game && state.screen === "game") finishGame();
      else if (state.screen === "editor") { state.editorPlayhead = song.duration; state.editorPlaying = false; render(); }
    };
  } else if (transport.element) {
    transport.element.currentTime = position;
    transport.element.playbackRate = transport.rate || 1;
    await transport.element.play();
    transport.playing = true;
  }
}
function seekTransport(time) {
  const wasPlaying = transport.playing;
  pauseTransport();
  transport.position = Math.max(0, Math.min(Number(time) || 0, transport.song ? transport.song.duration : Infinity));
  if (transport.element) transport.element.currentTime = transport.position;
  if (wasPlaying) resumeTransport().catch(function () { toast("Audio could not resume after seeking.", "error"); });
}
function syncVideo(video, song, clock, playing) {
  if (!video || !song) return;
  const cfg = song.sync || {};
  const target = clock + (Number(cfg.videoOffset) || 0);
  const visible = target >= 0 && target < (video.duration || Number.MAX_SAFE_INTEGER);
  const allowed = cfg.videoVisible !== false && state.settings.videoVisible !== false;
  const modeFactor = video.dataset.presentation === "lanes" ? .72 : video.dataset.presentation === "circle" ? 1.12 : 1;
  const opacity = Number(cfg.videoOpacity) || state.settings.videoOpacity;
  video.style.display = allowed ? "" : "none";
  video.style.opacity = String(Math.max(0,Math.min(.9,opacity / 100 * modeFactor)));
  video.style.objectFit = cfg.videoFit || state.settings.videoFit || "cover";
  const blur = cfg.videoBlur != null ? Number(cfg.videoBlur) : Number(state.settings.videoBlur || 0);
  video.style.filter = (blur > 0 ? "blur(" + blur + "px) " : "") + "brightness(" + (video.dataset.presentation === "circle" ? ".69" : ".52") + ")";
  if (!allowed) { video.pause(); return; }
  if (!visible) { video.pause(); return; }
  if (Number.isFinite(video.duration) && Math.abs(video.currentTime - target) > .18) {
    try { video.currentTime = target; } catch (_) {}
  }
  if (playing && video.paused) video.play().catch(function () {});
  if (!playing && !video.paused) video.pause();
}

function header() {
  const active = state.screen === "home" ? "home" : (state.screen === "library" || state.screen === "detail" ? "library" : (state.screen === "creator" || state.screen === "editor" ? "create" : ""));
  const ready = state.databaseReady && state.persistenceAvailable;
  return '<div class="shell"><header class="topbar">' +
    '<button class="brand" data-action="home" aria-label="ECHO//VOID home"><span class="brand-mark"></span><span class="brand-name">ECHO<span>//</span>VOID</span></button>' +
    '<nav class="nav" aria-label="Main navigation">' +
    '<button data-action="home" class="' + (active === "home" ? "active" : "") + '">Home</button>' +
    '<button data-action="library" class="' + (active === "library" ? "active" : "") + '">Library</button>' +
    '<button data-action="creator" class="' + (active === "create" ? "active" : "") + '">Song maker</button>' +
    '<button data-action="modes">Modes</button></nav><span class="topbar-spacer"></span>' +
    '<div class="storage-indicator"><i class="storage-dot ' + (ready ? "" : "warn") + '"></i>' + (ready ? "LOCAL LIBRARY READY" : "LOCAL ONLY") + '</div>' +
    '<button class="icon-button" data-action="settings" aria-label="Settings">⚙</button><input class="file-import-hidden" id="backup-import" type="file" accept=".evproj,.json,application/json"></header><main id="main-view"></main>' +
    (state.modal ? modalMarkup(state.modal) : "") + '</div>';
}
function render() {
  if (gameRaf) cancelAnimationFrame(gameRaf);
  if (editorRaf) cancelAnimationFrame(editorRaf);
  if (viewUrls.length) { viewUrls.forEach(URL.revokeObjectURL); viewUrls = []; }
  app.innerHTML = header();
  const main = document.getElementById("main-view");
  if (!main) return;
  const pages = {
    home: renderHome, library: renderLibrary, detail: renderDetail, creator: renderCreator,
    editor: renderEditor, game: renderGame, results: renderResults, settings: renderSettings, modes: renderModes, preview: renderPreview
  };
  (pages[state.screen] || renderHome)(main);
  if (state.screen === "creator") bindCreatorPreview();
  if (state.screen === "editor") bindEditorMedia();
  if (state.screen === "game") bindGameCanvas();
  if (state.screen === "editor") requestAnimationFrame(drawEditorLoop);
}
function modalMarkup(model) {
  return '<div class="modal-scrim" data-action="modal-scrim"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
    '<div class="eyebrow">' + esc(model.kicker || "LOCAL LIBRARY") + '</div><h2 id="modal-title">' + esc(model.title) + '</h2><p>' + esc(model.body) + '</p>' +
    '<div class="modal-actions"><button class="btn quiet" data-action="modal-cancel">Cancel</button><button class="btn ' + (model.danger ? "danger" : "primary") + '" data-action="modal-confirm">' + esc(model.confirm || "Continue") + '</button></div></section></div>';
}

function renderHome(main) {
  const resume = state.recent.length ? getSong(state.recent[0].songId) : null;
  const recent = state.recent.slice(0, 3).map(x => getSong(x.songId)).filter(Boolean);
  const custom = state.projects.slice(0, 3);
  main.innerHTML = '<div class="page home-page"><section class="hero">' +
    '<div class="hero-orbit"></div><div class="hero-content"><div class="hero-kicker">A rhythm game for the in-between</div>' +
    '<h1>ECHO<span>//VOID</span></h1><p class="hero-copy">Find the signal in the silence. Play a song, follow its pulse, leave a little of yourself in the chart.</p>' +
    '<div class="hero-actions"><button class="btn primary" data-action="library">▶ &nbsp; PLAY</button><button class="btn" data-action="library">SONG LIBRARY</button><button class="btn quiet" data-action="creator">＋ CREATE SONG</button></div>' +
    '<div class="hero-meta"><span class="pulse"></span> LOCAL-FIRST RHYTHM STUDIO <span>·</span> NO ACCOUNT REQUIRED</div></div>' +
    '<div class="hero-stamp">A SIGNAL, SENT<br>INTO THE DARK<br><span style="color:#8091ad">VERSION ' + APP_VERSION + '</span></div></section>' +
    '<div class="home-body">' +
    (resume ? '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">Pick up where it faded</div><h2 class="section-title">Continue listening</h2></div></div>' +
      '<div class="continue-card" data-action="resume-song" data-song="' + esc(resume.id) + '">' + coverMarkup(resume, "continue-cover") +
      '<div class="grow"><strong>' + esc(resume.title) + '</strong><small>Last played · ' + esc(state.recent[0].difficulty || "Chart") + ' · ' + esc(resume.artist) +
      (getBest(resume.id,state.recent[0].chartId) ? ' · Best ' + Number(getBest(resume.id,state.recent[0].chartId).score).toLocaleString() : '') + '</small></div><span class="play-glyph">↗</span></div></section>' : "") +
    '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">A small world of sound</div><h2 class="section-title">Featured tracks</h2><p class="section-copy">Three original, locally synthesized compositions. No remote audio, no attribution maze—just press play.</p></div><button class="text-button" data-action="library">Explore library →</button></div>' +
    '<div class="song-grid">' + BUILTINS.map(songCard).join("") + '</div></section>' +
    (recent.length ? '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">Your recent echoes</div><h2 class="section-title">Recently played</h2></div></div><div class="song-grid">' + recent.map(s => songCard(s, true)).join("") + '</div></section>' : "") +
    (custom.length ? '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">Kept on this device</div><h2 class="section-title">Your creations</h2></div><button class="text-button" data-action="library">Open library →</button></div><div class="song-grid">' + custom.map(s => songCard(s, true)).join("") + '</div></section>' :
      '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">Make it your own</div><h2 class="section-title">Bring a song into the void</h2><p class="section-copy">Keep music and video on this device, then make a chart with the local beat analyzer or the timeline editor.</p></div><button class="btn" data-action="creator">OPEN SONG MAKER →</button></div></section>') +
    '<section class="home-shelf"><div class="section-head"><div class="stack"><div class="eyebrow">The playfield keeps growing</div><h2 class="section-title">Two ways to find the beat</h2></div><button class="text-button" data-action="modes">Mode roadmap →</button></div><div class="pill-tabs"><span class="tag status">FOUR-LANE · PLAYABLE</span><span class="tag status">CIRCLE · PLAYABLE</span><span class="tag planned">MORE MODES · ROADMAP</span></div></section>' +
    '<p class="copyright">Your music stays in browser storage on this device. Browser storage can be cleared by the browser or operating system; export a project backup if the work matters to you. Nothing is uploaded.</p></div></div>';
}
function songCard(song, compact) {
  const chartCount = songCharts(song).length;
  const last=state.recent.find(item=>item.songId===song.id);
  const best=last&&getBest(song.id,last.chartId);
  return '<article class="song-card' + (compact ? " compact" : "") + '" data-action="song" data-song="' + esc(song.id) + '">' +
    coverMarkup(song, "cover-art") + '<div class="song-info"><div class="song-title-row"><div><h3 class="song-title">' + esc(song.title) + '</h3><p class="song-artist">' + esc(song.artist) + '</p></div>' +
    '<button class="icon-button ' + (state.favorites.has(song.id) ? "selected" : "") + '" data-action="favorite" data-song="' + esc(song.id) + '" aria-label="Favorite ' + esc(song.title) + '" title="Favorite">♡</button></div>' +
    '<div class="song-meta"><span>' + esc(fmtTime(song.duration)) + '</span><span>·</span><span>' + esc(song.genre || song.mood || "Custom") + '</span><span>·</span><span>' + chartCount + ' chart' + (chartCount === 1 ? "" : "s") + '</span></div>' +
    (compact&&last?'<div class="song-meta"><span>LAST / '+esc(last.difficulty||"Chart")+'</span>'+(best?'<span>BEST / '+Number(best.score).toLocaleString()+'</span>':'')+
      '<button class="text-button" data-action="resume-song" data-song="'+esc(song.id)+'">↺ QUICK REPLAY</button></div>':'')+'</div></article>';
}

function renderLibrary(main) {
  const songs = allSongs().filter(function (song) {
    const q = state.filter.toLowerCase().trim();
    const searchable = (song.title + " " + song.artist + " " + (song.genre || "") + " " + (song.mood || "")).toLowerCase();
    const hasMode = state.modeFilter ? songCharts(song).some(c => c.mode === state.modeFilter) : true;
    return (!q || searchable.includes(q)) && (state.mood === "All moods" || song.mood === state.mood || song.genre === state.mood) &&
      (!state.showFavorites || state.favorites.has(song.id)) && hasMode;
  });
  const ordering = { featured: 0 };
  if (state.sort === "title") songs.sort((a,b) => a.title.localeCompare(b.title));
  else if (state.sort === "duration") songs.sort((a,b) => a.duration - b.duration);
  else if (state.sort === "recent") songs.sort((a,b) => recentRank(a.id) - recentRank(b.id));
  main.innerHTML = '<div class="page"><div class="page-heading"><div class="stack"><div class="eyebrow">Songs are worlds. Charts are ways through.</div><h1>Song library</h1><p class="section-copy">Choose a song, then choose how you want to play it. A chart belongs to a mode—not to a track.</p></div><div class="toolbar"><button class="btn" data-action="creator">＋ IMPORT A SONG</button><button class="btn small" data-action="import-project">IMPORT BACKUP</button></div></div>' +
    '<div class="filters"><input class="field" type="search" placeholder="Find a song, artist, mood…" value="' + esc(state.filter) + '" data-field="library-search">' +
    '<select class="select" data-field="library-sort"><option value="featured"' + selected(state.sort,"featured") + '>Featured</option><option value="recent"' + selected(state.sort,"recent") + '>Recently played</option><option value="title"' + selected(state.sort,"title") + '>Title A–Z</option><option value="duration"' + selected(state.sort,"duration") + '>Duration</option></select>' +
    '<select class="select" data-field="library-mood"><option>All moods</option><option' + selected(state.mood,"Melancholic") + '>Melancholic</option><option' + selected(state.mood,"Dreamlike") + '>Dreamlike</option><option' + selected(state.mood,"Energetic") + '>Energetic</option><option' + selected(state.mood,"Custom") + '>Custom</option></select>' +
    '<select class="select" data-field="library-mode"><option value="">All modes</option><option value="lanes"' + selected(state.modeFilter || "","lanes") + '>Four-lane</option><option value="circle"' + selected(state.modeFilter || "","circle") + '>Circle</option></select>' +
    '<button class="pill ' + (state.showFavorites ? "active" : "") + '" data-action="toggle-favorites">♡ FAVORITES</button></div>' +
    (songs.length ? '<div class="song-grid">' + songs.map(songCard).join("") + '</div>' : '<div class="empty-state"><strong>' + (state.showFavorites ? "No favorite songs yet." : "No songs found.") + '</strong>Try another search or bring a song into your local library.</div>') +
    '<p class="library-note">The built-in tracks are original compositions rendered locally with Web Audio. Imported audio, video, cover art, charts, and results stay in this browser’s IndexedDB. No personal media is uploaded.</p></div>';
}
function selected(value, expected) { return String(value) === String(expected) ? " selected" : ""; }
function recentRank(id) {
  const idx = state.recent.findIndex(item => item.songId === id);
  return idx < 0 ? 9999 : idx;
}

function renderDetail(main) {
  const song = getSong(state.selectedSongId);
  if (!song) { state.screen = "library"; return renderLibrary(main); }
  const charts = songCharts(song);
  const fileSize = song.media && song.media.audioBlob ? Math.round(song.media.audioBlob.size / 1024 / 1024 * 10) / 10 : null;
  main.innerHTML = '<div class="page"><button class="back-link" data-action="library">← BACK TO LIBRARY</button><div class="detail-layout"><aside class="detail-art">' +
    coverMarkup(song, "cover-large") + '<div class="detail-label">ARTIST / CREATOR</div><div class="detail-byline">' + esc(song.artist || "Unknown artist") + '</div>' +
    '<div class="detail-label">SOURCE</div><div class="detail-byline">' + (isBuiltin(song) ? "ECHO//VOID original · local synthesis" : "Private to this browser") + '</div></aside>' +
    '<section class="detail-content"><div class="eyebrow">' + esc(song.mood || song.genre || "A local song project") + '</div><h1>' + esc(song.title) + '</h1><div class="detail-byline">' + esc(song.artist || "Unknown artist") + '</div>' +
    '<div class="detail-metadata"><span>' + esc(fmtTime(song.duration)) + '</span><span>' + esc(song.genre || "Unsorted") + '</span>' + (song.bpm ? '<span>' + esc(song.bpm) + ' BPM</span>' : "") + '<span>' + charts.length + ' chart' + (charts.length === 1 ? "" : "s") + '</span></div>' +
    (song.description ? '<p class="detail-description">' + esc(song.description) + '</p>' : '') +
    '<hr class="detail-divider"><div class="section-head"><div class="stack"><div class="eyebrow">Choose a path through the song</div><h2 class="section-title">Charts &amp; difficulties</h2></div></div>' +
    (charts.length ? '<div class="chart-list">' + charts.map(function (chart) {
      const errors = validateChart(chart, song);
      const best = getBest(song.id, chart.id);
      return '<div class="chart-row"><div><strong>' + esc(chart.difficulty || "Unrated") + ' · ' + esc(chart.mode === "lanes" ? "Four-lane" : chart.mode === "circle" ? "Circle" : chart.mode) + '</strong><small>' + esc(chart.author || "Unknown author") + ' · ' + chart.notes.length + ' notes' + (chart.procedural ? ' · locally generated' : '') + '</small></div>' +
        '<span class="best-score">' + (best ? "BEST " + Number(best.score).toLocaleString() : (errors.length ? '<span style="color:#e29da8">INVALID</span>' : "—")) + '</span>' +
        '<div style="display:flex;gap:6px"><button class="btn small" data-action="duplicate-chart" data-chart="' + esc(chart.id) + '">COPY</button><button class="btn small" data-action="export-chart" data-chart="' + esc(chart.id) + '">JSON</button><button class="btn small primary" data-action="play-chart" data-chart="' + esc(chart.id) + '"' + (errors.length ? " disabled title=\"" + esc(errors[0]) + "\"" : "") + '>PLAY</button></div></div>';
    }).join("") + '</div>' : '<div class="empty-state"><strong>This song is saved as a draft.</strong>Add an existing chart, generate one locally, or create one in the timeline editor.</div>') +
    '<hr class="detail-divider"><div class="detail-actions">' +
    '<button class="btn" data-action="preview-song">▶ PREVIEW</button>' + (isSeedSong(song) ? "" : '<button class="btn" data-action="creator-edit">EDIT PROJECT</button>') +
    '<button class="btn" data-action="manual-chart">＋ MANUAL CHART</button>' + (isSeedSong(song) ? "" : '<button class="btn small" data-action="export-project">EXPORT BACKUP</button>') +
    (charts.length ? '<button class="btn small" data-action="export-chart">EXPORT CHART</button>' : '') +
    (isSeedSong(song) ? "" : '<button class="btn small danger" data-action="delete-project" data-song="' + esc(song.id) + '">DELETE</button>') + '</div>' +
    '<div class="settings-panel top-gap"><div class="eyebrow">Synchronization &amp; video</div><div class="field-row" style="margin-top:12px"><label class="field-label">Chart offset (ms)<input class="field" data-field="song-offset" type="number" step="5" value="' + esc(song.sync && song.sync.chartOffset || 0) + '"></label>' +
    '<label class="field-label">Video offset (s)<input class="field" data-field="song-video-offset" type="number" step=".01" value="' + esc(song.sync && song.sync.videoOffset || 0) + '"></label>' +
    '<label class="field-label">Video opacity<div class="range-row"><input data-field="song-video-opacity" type="range" min="5" max="90" value="' + Number(song.sync && song.sync.videoOpacity || state.settings.videoOpacity) + '"><output class="range-value">' + Number(song.sync && song.sync.videoOpacity || state.settings.videoOpacity) + '%</output></div></label>' +
    '<label class="field-label">Video blur<div class="range-row"><input data-field="song-video-blur" type="range" min="0" max="8" step=".5" value="' + Number(song.sync && song.sync.videoBlur || state.settings.videoBlur) + '"><output class="range-value">' + Number(song.sync && song.sync.videoBlur || state.settings.videoBlur) + ' px</output></div></label>' +
    '<label class="field-label"><span>Show music video</span><div class="range-row"><input data-field="song-video-visible" type="checkbox" ' + (song.sync && song.sync.videoVisible === false ? "" : "checked") + '><small>Hide the video layer for this song</small></div></label></div>' +
    '<p class="license-note">' + esc(song.license || (fileSize ? fileSize + " MB local audio file" : "Personal project")) + ' Timing uses the audio playback clock; adjust the chart offset if the chart itself starts early or late. Video offset is independent.</p></div></section></div></div>';
}

function renderSettings(main) {
  main.innerHTML = '<div class="page"><div class="page-heading"><div class="stack"><div class="eyebrow">Your timing, your room</div><h1>Settings</h1><p class="section-copy">Calibration changes judgment time only. Video controls set the starting presentation for projects without their own override.</p></div></div>' +
    '<section class="settings-panel"><div class="settings-grid"><label class="field-label">Input calibration <small>POSITIVE VALUES MOVE INPUT LATER</small><div class="range-row"><input data-field="setting-calibration" type="range" min="-150" max="150" step="5" value="' + Number(state.settings.calibrationMs) + '"><output class="range-value">' + Number(state.settings.calibrationMs) + ' ms</output></div></label>' +
    '<label class="field-label">Music volume <small>MASTER VOLUME FOR BUILT-IN AND IMPORTED AUDIO</small><div class="range-row"><input data-field="setting-volume" type="range" min="0" max="100" value="' + Math.round(state.settings.musicVolume * 100) + '"><output class="range-value">' + Math.round(state.settings.musicVolume * 100) + '%</output></div></label>' +
    '<label class="field-label">Video opacity <small>DEFAULT PLAYFIELD BACKGROUND INTENSITY</small><div class="range-row"><input data-field="setting-video-opacity" type="range" min="5" max="75" value="' + Number(state.settings.videoOpacity) + '"><output class="range-value">' + Number(state.settings.videoOpacity) + '%</output></div></label>' +
    '<label class="field-label">Video blur <small>DEFAULT PLAYFIELD SOFTENING</small><div class="range-row"><input data-field="setting-video-blur" type="range" min="0" max="8" step=".5" value="' + Number(state.settings.videoBlur) + '"><output class="range-value">' + Number(state.settings.videoBlur) + ' px</output></div></label>' +
    '<label class="field-label">Video scaling<select class="select" data-field="setting-video-fit"><option value="cover"' + selected(state.settings.videoFit,"cover") + '>Fill frame</option><option value="contain"' + selected(state.settings.videoFit,"contain") + '>Fit inside</option></select></label>' +
    '<label class="field-label"><span>Show music video</span><div class="range-row"><input data-field="setting-video-visible" type="checkbox" ' + (state.settings.videoVisible === false ? "" : "checked") + '><small>Global video visibility</small></div></label></div>' +
    '<hr class="detail-divider"><div class="eyebrow">Local data</div><p class="section-copy">Songs, charts, favorites, calibration, and results are stored in this browser. Use a project backup to move work or keep a copy outside browser storage.</p>' +
    '<div class="detail-actions"><button class="btn" data-action="export-all">EXPORT LIBRARY BACKUP</button><button class="btn" data-action="import-project">IMPORT LIBRARY BACKUP</button></div><p class="license-note">Browser storage may be cleared when site data is removed or storage is reclaimed. Export backups to keep your projects.</p></section></div>';
}
function renderModes(main) {
  const data = [
    ["01", "Four-lane", "Playable", "Four keyboard lanes with tap and hold notes. Timing comes from the audio clock; simultaneous notes, score, accuracy, holds, and replay are supported.", "ASDF / JKL; mapped to four lanes."],
    ["02", "Circle", "Playable", "Spatial hit targets appear with an approach ring. Click or touch inside the target during its timing window. Position and timing both matter.", "Mouse or touch."],
    ["03", "Piano", "Planned", "Multi-key piano chart format is not implemented yet.", "Not available."],
    ["04", "Arc", "Experimental", "A future path-following mode. Curved path data is not playable in this build.", "Not available."],
    ["05", "Directional", "Planned", "Directional input patterns are part of the roadmap.", "Not available."],
    ["06", "Runner", "Planned", "A chart-driven runner mode is part of the roadmap.", "Not available."],
    ["07", "Platform", "Planned", "Rhythm-driven platform movement is part of the roadmap.", "Not available."]
  ];
  main.innerHTML = '<div class="page"><div class="page-heading"><div class="stack"><div class="eyebrow">One universe, distinct systems</div><h1>Mode archive</h1><p class="section-copy">Playable modes are selected by compatible chart. The rest are labeled by their actual implementation status.</p></div></div><div class="mode-grid">' +
    data.map(function (item) { return '<article class="mode-card"><div class="mode-index">MODE / ' + item[0] + '</div><h3>' + esc(item[1]) + '</h3><p>' + esc(item[3]) + '</p><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span class="tag ' + (item[2] === "Playable" ? "status" : "planned") + '">' + esc(item[2].toUpperCase()) + '</span><span style="color:var(--quiet);font:9px var(--mono)">' + esc(item[4]) + '</span></div></article>'; }).join("") +
    '</div></div>';
}

function renderCreator(main) {
  const c = state.creator || (state.creator = emptyCreator());
  const audioName = c.audioFile ? (c.audioFile.name || c.audioName || "audio.mp3") + " · " + sizeText(c.audioFile.size) : "No MP3 selected";
  const videoName = c.videoFile ? (c.videoFile.name || c.videoName || "video.mp4") + " · " + sizeText(c.videoFile.size) : "No MP4 selected";
  const coverName = c.coverFile ? (c.coverFile.name || "cover image") + " · " + sizeText(c.coverFile.size) : "Optional cover image";
  const previewVideo = c.videoFile ? makeViewUrl(c.videoFile) : (c.project && c.project.media && c.project.media.videoBlob ? makeViewUrl(c.project.media.videoBlob) : "");
  const previewAudio = c.audioFile ? makeViewUrl(c.audioFile) : (c.project && c.project.media && c.project.media.audioBlob ? makeViewUrl(c.project.media.audioBlob) : "");
  const chartChoice = c.choice || "draft";
  main.innerHTML = '<div class="page"><div class="page-heading"><div class="stack"><div class="eyebrow">A personal song project, kept on this device</div><h1>Song maker</h1><p class="section-copy">Import an MP3, optionally pair it with a video, then keep a draft or make a chart. Media is never uploaded.</p></div><button class="back-link" data-action="library">← LIBRARY</button></div>' +
    '<div class="split-page"><aside class="stepper"><div class="step-item active"><span class="step-num">01</span>Import &amp; details</div><div class="step-item"><span class="step-num">02</span>Preview &amp; sync</div><div class="step-item"><span class="step-num">03</span>Chart path</div><div class="step-item"><span class="step-num">04</span>Save &amp; play</div></aside><div class="studio">' +
    '<section class="panel"><div class="eyebrow">01 / Audio and optional media</div><h2>Bring the source files</h2><p>MP3 audio is the authoritative soundtrack. Video stays silent and follows its own offset. The song can be saved without any chart.</p>' +
    '<div class="drop-row"><div class="drop-slot"><input id="audio-file" type="file" accept=".mp3,audio/mpeg,audio/mp3"><label for="audio-file"><span class="upload-glyph">♫</span><strong>MP3 audio · required to play</strong><small>' + esc(audioName) + '</small></label></div>' +
    '<div class="drop-slot"><input id="video-file" type="file" accept=".mp4,video/mp4"><label for="video-file"><span class="upload-glyph">▣</span><strong>MP4 video · optional</strong><small>' + esc(videoName) + '</small></label></div>' +
    '<div class="drop-slot"><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"><label for="cover-file"><span class="upload-glyph">◌</span><strong>Cover image · optional</strong><small>' + esc(coverName) + '</small></label></div>' +
    '<div class="drop-slot"><input id="chart-file" type="file" accept=".json,application/json"><label for="chart-file"><span class="upload-glyph">{ }</span><strong>Existing ECHO//VOID chart · optional</strong><small>' + esc(c.chartFile ? c.chartFile.name : "Chart format version 1.0.0") + '</small></label></div></div>' +
    '<div class="drop-note">Allowed: MP3, MP4, PNG, JPEG, or WebP. The app checks file type and size before saving. MP4 is a background only; it never replaces the MP3.</div>' +
    '<hr class="detail-divider"><div class="eyebrow">02 / Song metadata</div><div class="field-row" style="margin-top:14px">' +
    '<label class="field-label">Title<input class="field" data-field="creator-title" maxlength="100" placeholder="A name for this song" value="' + esc(c.title) + '"></label>' +
    '<label class="field-label">Artist<input class="field" data-field="creator-artist" maxlength="100" placeholder="Artist or creator" value="' + esc(c.artist) + '"></label>' +
    '<label class="field-label">Genre / mood<input class="field" data-field="creator-genre" maxlength="50" placeholder="Night pop, dreamlike…" value="' + esc(c.genre) + '"></label>' +
    '<label class="field-label">BPM<input class="field" data-field="creator-bpm" type="number" min="40" max="240" step="0.1" value="' + esc(c.bpm) + '"></label>' +
    '<label class="field-label">Audio offset (ms)<input class="field" data-field="creator-audio-offset" type="number" step="1" value="' + esc(c.audioOffset) + '"></label>' +
    '<label class="field-label">Video offset (s)<input class="field" data-field="creator-video-offset" type="number" step=".01" value="' + esc(c.videoOffset) + '"></label></div>' +
    '<label class="field-label" style="margin-top:13px">Description<textarea class="textarea" data-field="creator-description" maxlength="600" placeholder="A note about this song…">' + esc(c.description) + '</textarea></label></section>' +
    '<section class="panel"><div class="eyebrow">03 / Preview with shared time</div><h2>Listen and align the image</h2><p>Audio position is the master preview clock. Video seeks to audio time plus the video offset.</p>' +
    '<div class="preview-box">' + (previewVideo ? '<video id="maker-video" playsinline muted preload="metadata" src="' + esc(previewVideo) + '"></video>' : '<div class="preview-empty">A QUIET PLACE FOR THE VIDEO<br>ADD AN MP4 TO SEE IT HERE</div>') + '</div>' +
    '<div class="preview-controls"><span class="time-code" id="maker-time">00:00.00</span>' + (previewAudio ? '<audio id="maker-audio" controls preload="metadata" src="' + esc(previewAudio) + '"></audio>' : '<span class="time-code">Choose an MP3 to preview</span>') + '<span class="time-code" id="maker-duration">--:--</span></div>' +
    '<div class="preview-settings"><label class="field-label">Preview volume<div class="range-row"><input data-field="maker-volume" type="range" min="0" max="100" value="80"><output class="range-value">80%</output></div></label>' +
    '<label class="field-label">Video opacity<div class="range-row"><input data-field="maker-opacity" type="range" min="5" max="90" value="' + Number(c.videoOpacity || state.settings.videoOpacity) + '"><output class="range-value">' + Number(c.videoOpacity || state.settings.videoOpacity) + '%</output></div></label>' +
    '<label class="field-label">Video blur<div class="range-row"><input data-field="maker-blur" type="range" min="0" max="8" step=".5" value="' + Number(c.videoBlur || 0) + '"><output class="range-value">' + Number(c.videoBlur || 0) + ' px</output></div></label>' +
    '<label class="field-label">Video scaling<select class="select" data-field="creator-video-fit"><option value="cover"' + selected(c.videoFit || state.settings.videoFit,"cover") + '>Fill frame</option><option value="contain"' + selected(c.videoFit || state.settings.videoFit,"contain") + '>Fit inside</option></select></label>' +
    '<label class="field-label"><span>Show music video</span><div class="range-row"><input data-field="maker-visible" type="checkbox" ' + (c.videoVisible === false ? "" : "checked") + '><small>Hide the video during preview and play</small></div></label></div></section>' +
    '<section class="panel"><div class="eyebrow">04 / Choose a chart path</div><h2>Every song can have more than one chart</h2><p>Chart modes stay explicit. This build supports four-lane and circle charts; other modes are not offered as playable choices.</p>' +
    '<div class="choice-grid">' +
    '<button class="choice ' + (chartChoice === "existing" ? "selected" : "") + '" data-action="creator-choice" data-choice="existing"><span class="symbol">01</span><strong>Use an existing chart</strong><small>' + (c.importedChart ? esc(c.importedChart.mode + " · " + c.importedChart.difficulty) : "Select a version 1.0.0 JSON chart above.") + '</small></button>' +
    '<button class="choice ' + (chartChoice === "generate" ? "selected" : "") + '" data-action="creator-choice" data-choice="generate"><span class="symbol">02</span><strong>Generate locally</strong><small>Analyze audio energy and onsets; build a procedural candidate. No external AI inference.</small></button>' +
    '<button class="choice ' + (chartChoice === "manual" ? "selected" : "") + '" data-action="creator-choice" data-choice="manual"><span class="symbol">03</span><strong>Create manually</strong><small>Open a beat grid and place, move, resize, validate, and play-test real chart notes.</small></button></div>' +
    '<div class="field-row" style="margin-top:14px"><label class="field-label">Game mode<select class="select" data-field="creator-mode"><option value="lanes"' + selected(c.mode,"lanes") + '>Four-lane</option><option value="circle"' + selected(c.mode,"circle") + '>Circle</option></select></label>' +
    '<label class="field-label">Difficulty<select class="select" data-field="creator-difficulty"><option' + selected(c.difficulty,"Easy") + '>Easy</option><option' + selected(c.difficulty,"Normal") + '>Normal</option><option' + selected(c.difficulty,"Hard") + '>Hard</option><option' + selected(c.difficulty,"Expert") + '>Expert</option></select></label></div>' +
    '<div class="field-row" style="margin-top:12px"><label class="field-label">Note density<div class="range-row"><input data-field="creator-density" type="range" min="15" max="90" value="' + Number(c.density) + '"><output class="range-value">' + Number(c.density) + '%</output></div></label>' +
    '<label class="field-label">Snap grid<select class="select" data-field="creator-snap"><option value="4">1/4 beat</option><option value="2">1/2 beat</option><option value="1">1 beat</option></select></label></div>' +
    '<div class="maker-status ' + (c.statusType === "error" ? "error" : "") + '" id="creator-status">' + esc(c.status || "A saved draft may have no chart. You can return later to add one.") + '</div>' +
    '<div class="maker-actions"><button class="btn" data-action="save-draft">SAVE SONG DRAFT</button><button class="btn" data-action="generate-chart">ANALYZE &amp; GENERATE</button><button class="btn" data-action="manual-chart-from-creator">OPEN CHART EDITOR</button><button class="btn primary" data-action="save-and-play">SAVE &amp; PLAY</button></div></section>' +
    '<p class="copyright">Local audio, video, cover images, chart data, and sync settings are saved in browser storage. Export a .evproj backup if you need a separate copy.</p>' +
    '</div></div></div>';
}
function emptyCreator() {
  return { audioFile: null, videoFile: null, coverFile: null, coverDataUrl: "", chartFile: null, importedChart: null,
    title: "", artist: "", genre: "", bpm: 112, audioOffset: 0, videoOffset: 0, description: "",
    videoOpacity: state.settings.videoOpacity, videoBlur: state.settings.videoBlur, videoVisible: state.settings.videoVisible, videoFit: state.settings.videoFit, mode: "lanes", difficulty: "Normal",
    density: 55, snap: 4, choice: "draft", status: "", statusType: "", waveform: [] };
}
function makeViewUrl(blob) {
  const url = URL.createObjectURL(blob);
  viewUrls.push(url);
  return url;
}
function sizeText(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function renderEditor(main) {
  const project = state.editingProject;
  const chart = state.editorChart;
  if (!project || !chart) { state.screen = "creator"; return renderCreator(main); }
  const errors = validateChart(chart, project);
  const width = Math.max(1500, Math.ceil(project.duration * 38));
  const height = chart.mode === "lanes" ? 320 : 245;
  const videoUrl = project.media && project.media.videoBlob ? makeViewUrl(project.media.videoBlob) : "";
  const audioUrl = project.media && project.media.audioBlob ? makeViewUrl(project.media.audioBlob) : "";
  main.innerHTML = '<div class="page"><div class="page-heading"><div class="stack"><button class="back-link" data-action="back-to-detail">← BACK TO SONG</button><div class="eyebrow">Chart editor / version ' + esc(chart.version) + '</div><h1>' + esc(project.title) + '</h1><p class="section-copy">Place a note on the timeline, drag it to move it, and select a hold tool to place a hold. The playhead follows the audio clock.</p></div>' +
    '<div class="toolbar"><button class="btn small" data-action="editor-undo" ' + (!state.editorUndo.length ? "disabled" : "") + '>↶ UNDO</button><button class="btn small" data-action="editor-redo" ' + (!state.editorRedo.length ? "disabled" : "") + '>↷ REDO</button></div></div>' +
    '<section class="panel"><div class="eyebrow">Chart metadata</div><div class="editor-meta" style="margin-top:12px">' +
    '<label class="field-label">Mode<select class="select" data-field="editor-mode"><option value="lanes"' + selected(chart.mode,"lanes") + '>Four-lane</option><option value="circle"' + selected(chart.mode,"circle") + '>Circle</option></select></label>' +
    '<label class="field-label">Difficulty<select class="select" data-field="editor-difficulty"><option' + selected(chart.difficulty,"Easy") + '>Easy</option><option' + selected(chart.difficulty,"Normal") + '>Normal</option><option' + selected(chart.difficulty,"Hard") + '>Hard</option><option' + selected(chart.difficulty,"Expert") + '>Expert</option></select></label>' +
    '<label class="field-label">BPM<input class="field" data-field="editor-bpm" type="number" min="40" max="240" step=".1" value="' + esc(chart.bpm || project.bpm || 112) + '"></label>' +
    '<label class="field-label">Chart offset (ms)<input class="field" data-field="editor-offset" type="number" min="-2000" max="2000" step="1" value="' + esc(chart.offset || 0) + '"></label>' +
    '<label class="field-label">Snap grid<select class="select" data-field="editor-snap"><option value="4"' + selected(state.editorSnap || 4,4) + '>1/4 beat</option><option value="2"' + selected(state.editorSnap || 4,2) + '>1/2 beat</option><option value="1"' + selected(state.editorSnap || 4,1) + '>1 beat</option><option value="8"' + selected(state.editorSnap || 4,8) + '>1/8 beat</option></select></label>' +
    '<label class="field-label">Playback speed<select class="select" data-field="editor-speed"><option value="1"' + selected(state.editorPlaybackRate||1,1) + '>1.0×</option><option value=".75"' + selected(state.editorPlaybackRate||1,.75) + '>0.75×</option><option value=".5"' + selected(state.editorPlaybackRate||1,.5) + '>0.5×</option></select></label></div>' +
    '<div class="editor-toolbar"><button class="btn small ' + (state.editorTool === "tap" ? "primary" : "") + '" data-action="editor-tool" data-tool="tap">＋ TAP NOTE</button>' +
    (chart.mode === "lanes" ? '<button class="btn small ' + (state.editorTool === "hold" ? "primary" : "") + '" data-action="editor-tool" data-tool="hold">⇢ HOLD NOTE</button>' : "") +
    '<button class="btn small danger" data-action="editor-delete" ' + (!state.editorSelectedId ? "disabled" : "") + '>DELETE SELECTED</button>' +
    '<button class="btn small" data-action="editor-toggle-play">' + (state.editorPlaying ? "Ⅱ PAUSE" : "▶ PREVIEW") + '</button>' +
    '<span class="time-code" id="editor-time">' + fmtClock(state.editorPlayhead || 0) + ' / ' + fmtTime(project.duration) + '</span><span class="topbar-spacer"></span>' +
    '<button class="btn small" data-action="export-chart">EXPORT .JSON</button><button class="btn small primary" data-action="save-chart">SAVE CHART</button></div>' +
    '<div class="timeline-wrap" id="timeline-wrap"><canvas id="chart-timeline" width="' + width + '" height="' + height + '" style="width:' + width + 'px;height:' + height + 'px"></canvas></div>' +
    '<div class="timeline-help">Click empty space to add a note. Drag an existing note to move it; hold duration can be lengthened with Alt + drag or the duration field. Use Space to preview, Ctrl/⌘+Z to undo, Delete to remove. Notes are snapped to the selected grid.</div>' +
    '<div id="selected-note-panel">' + renderSelectedNote(project, chart) + '</div>' +
    '<div class="editor-preview">' + (audioUrl || isBuiltin(project) ? '<div><div class="eyebrow">' + (audioUrl ? 'Audio preview' : 'Synthesized audio preview') + '</div><div class="range-row" style="margin-top:9px"><label class="field-label" style="flex:1">Seek<input data-field="editor-seek" type="range" min="0" max="' + Math.ceil(project.duration) + '" step=".01" value="' + Number(state.editorPlayhead || 0) + '"></label></div><div class="time-code" style="margin-top:10px">PLAY / PAUSE WITH THE PREVIEW BUTTON ABOVE. AUDIO CLOCK DRIVES THE PLAYHEAD.</div></div>' : '<div class="preview-box"><div class="preview-empty">ATTACH AN MP3 TO PREVIEW AUDIO</div></div>') +
    '<div>' + (videoUrl ? '<div class="eyebrow">Video preview · independent offset</div><div class="preview-box" style="margin-top:10px"><video id="editor-video" playsinline muted preload="metadata" src="' + esc(videoUrl) + '"></video></div>' : '<div class="eyebrow">No video attached</div><p class="license-note">The editor timeline remains complete without a video layer.</p>') +
    '<div class="field-row" style="margin-top:9px"><label class="field-label">Video offset (s)<input class="field" data-field="editor-video-offset" type="number" step=".01" value="' + esc(project.sync && project.sync.videoOffset || 0) + '"></label><label class="field-label">Video opacity<div class="range-row"><input data-field="editor-video-opacity" type="range" min="5" max="90" value="' + Number(project.sync && project.sync.videoOpacity || state.settings.videoOpacity) + '"><output class="range-value">' + Number(project.sync && project.sync.videoOpacity || state.settings.videoOpacity) + '%</output></div></label>' +
    '<label class="field-label">Video blur<div class="range-row"><input data-field="editor-video-blur" type="range" min="0" max="8" step=".5" value="' + Number(project.sync && project.sync.videoBlur || state.settings.videoBlur) + '"><output class="range-value">' + Number(project.sync && project.sync.videoBlur || state.settings.videoBlur) + ' px</output></div></label>' +
    '<label class="field-label"><span>Show music video</span><div class="range-row"><input data-field="editor-video-visible" type="checkbox" ' + (project.sync && project.sync.videoVisible === false ? "" : "checked") + '></div></label></div></div></div>' +
    '<hr class="detail-divider"><div class="eyebrow">Chart validation</div>' +
    (errors.length ? '<ul class="validation-list">' + errors.map(e => '<li>' + esc(e) + '</li>').join("") + '</ul>' : '<div class="validation-ok" style="margin-top:10px">✓ VALID · ' + chart.notes.length + ' notes · ' + esc(MODES[chart.mode].name) + ' · ' + esc(chart.difficulty) + '</div>') +
    '</section></div>';
  drawEditorTimeline();
}
function renderSelectedNote(project, chart) {
  const note = chart.notes.find(n => n.id === state.editorSelectedId);
  if (!note) return '<p class="license-note">No note selected. Select or add a note to edit its exact timing and duration.</p>';
  return '<div class="field-row" style="margin-top:14px"><label class="field-label">Selected note time (s)<input class="field" data-field="selected-note-time" type="number" min="0" max="' + Number(project.duration).toFixed(3) + '" step=".001" value="' + Number(note.time).toFixed(3) + '"></label>' +
    (note.type === "hold" ? '<label class="field-label">Hold duration (s)<input class="field" data-field="selected-note-duration" type="number" min=".05" max="12" step=".05" value="' + Number(note.duration).toFixed(2) + '"></label>' : "") +
    (chart.mode === "lanes" ? '<label class="field-label">Lane<select class="select" data-field="selected-note-lane">' + [0,1,2,3].map(i => '<option value="' + i + '"' + selected(note.lane,i) + '>Lane ' + (i+1) + '</option>').join("") + '</select></label>' :
      '<label class="field-label">Position<select class="select" data-field="selected-note-position"><option value="0.25,0.35"' + selected(note.x + "," + note.y,"0.25,0.35") + '>Upper left</option><option value="0.5,0.5">Center</option><option value="0.75,0.65">Lower right</option></select></label>') + '</div>';
}
function renderGame(main) {
  const game = state.game;
  if (!game) { state.screen = "library"; return renderLibrary(main); }
  const video = game.song.media && game.song.media.videoBlob ? makeViewUrl(game.song.media.videoBlob) : "";
  lastGameVideoUrl = video;
  const keys = game.chart.mode === "lanes" ? "D   F   J   K" : "MOUSE / TOUCH · HIT THE TARGET";
  main.innerHTML = '<div class="page game-page"><div class="game-top"><div class="game-song"><strong>' + esc(game.song.title) + '</strong><small>' + esc(game.chart.difficulty + " · " + MODES[game.chart.mode].name + " · " + game.song.artist) + '</small></div>' +
    '<div class="game-stats"><div class="stat"><strong id="game-score">0</strong><small>Score</small></div><div class="stat"><strong id="game-combo">0</strong><small>Combo</small></div><div class="stat"><strong id="game-accuracy">100.00%</strong><small>Accuracy</small></div></div></div>' +
    '<div class="game-stage mode-' + esc(game.chart.mode) + '" id="game-stage"><div class="fallback-backdrop"></div>' + (video ? '<video id="game-video" data-presentation="' + esc(game.chart.mode) + '" playsinline muted preload="metadata" src="' + esc(video) + '"></video>' : "") +
    '<div class="game-mode-label">' + esc(MODES[game.chart.mode].name) + ' / ' + esc(game.chart.difficulty) + '</div><div class="judge-flash" id="judge-flash"></div><canvas id="game-canvas"></canvas>' +
    '<div class="game-hint">' + esc(keys) + '</div>' +
    (game.paused || !gameAudioReady ? '<div class="pause-overlay"><div><div class="eyebrow">' + (gameAudioReady ? "A MOMENT BETWEEN NOTES" : "PREPARING THE AUDIO CLOCK") + '</div><h2>' + (gameAudioReady ? "Paused" : "Loading local soundtrack") + '</h2>' +
      (gameAudioReady ? '<div class="actions"><button class="btn primary" data-action="resume-game">RESUME</button><button class="btn" data-action="restart-game">RESTART</button><button class="btn quiet" data-action="exit-game">EXIT</button></div>' : '<div class="time-code">Rendering the original track in your browser…</div>') + '</div></div>' : "") +
    '</div><div class="game-toolbar"><div class="left"><button class="btn small" data-action="pause-game">Ⅱ PAUSE</button><button class="btn small" data-action="restart-game">↺ RESTART</button><button class="btn small quiet" data-action="exit-game">EXIT</button></div>' +
    '<div class="progress-wrap"><div class="progress"><i id="game-progress"></i></div></div><div class="right"><span class="time-code" id="game-time">00:00.00</span></div></div>' +
    '<p class="license-note">Judgments use the audio playback clock, with a ' + Number(state.settings.calibrationMs) + ' ms input calibration and ' + (Number(game.chart.offset || 0) + Number(game.song.sync && game.song.sync.chartOffset || 0)) + ' ms chart offset. Rendering and hit detection are separate.</p></div>';
  if (gameAudioReady && !game.paused) requestAnimationFrame(gameFrame);
}
function renderResults(main) {
  const run = state.lastRun;
  if (!run) { state.screen = "library"; return renderLibrary(main); }
  const song = getSong(run.songId) || run.song;
  const best = getBest(run.songId, run.chart.id);
  const isNew = best && best.score === run.score && best.createdAt === run.createdAt;
  main.innerHTML = '<div class="page results-page"><div class="eyebrow">The last note is still in the air</div><div class="result-grade">' + esc(run.grade) + '</div>' +
    '<h1 class="result-title">' + esc(song.title) + '</h1><div class="result-sub">' + esc(run.chart.difficulty.toUpperCase() + " / " + MODES[run.chart.mode].name.toUpperCase()) + '</div>' +
    '<div class="result-score">' + Number(run.score).toLocaleString() + '</div>' +
    (isNew ? '<div class="personal-best">✦ NEW PERSONAL BEST</div>' : (best ? '<div class="personal-best">PERSONAL BEST · ' + Number(best.score).toLocaleString() + '</div>' : "")) +
    '<div class="result-stats"><div><strong>' + run.counts.perfect + '</strong><small>Perfect</small></div><div><strong>' + run.counts.great + '</strong><small>Great</small></div><div><strong>' + run.counts.good + '</strong><small>Good</small></div><div><strong>' + run.counts.miss + '</strong><small>Miss</small></div><div><strong>' + run.maxCombo + '</strong><small>Max combo</small></div></div>' +
    '<div class="result-sub">ACCURACY ' + Number(run.accuracy).toFixed(2) + '%</div><div class="result-actions" style="margin-top:24px">' +
    '<button class="btn primary" data-action="replay-game">↺ REPLAY</button><button class="btn" data-action="change-chart">CHANGE CHART</button><button class="btn quiet" data-action="library">RETURN TO LIBRARY</button></div></div>';
}
function renderPreview(main) {
  const song = state.previewSong;
  if (!song) { state.screen="detail";return renderDetail(main); }
  const video=song.media&&song.media.videoBlob?makeViewUrl(song.media.videoBlob):"";
  main.innerHTML='<div class="page"><button class="back-link" data-action="preview-stop">← BACK TO SONG</button><div class="detail-layout top-gap"><div class="preview-box" style="aspect-ratio:4/5;position:sticky;top:100px">'+
    (video?'<video id="preview-video" playsinline muted preload="metadata" src="'+esc(video)+'"></video>':'<div class="preview-empty">ORIGINAL AUDIO<br>WITH NO VIDEO</div>')+
    '<div class="fallback-backdrop"></div></div><section class="detail-content"><div class="eyebrow">An unhurried first listen</div><h1>'+esc(song.title)+'</h1><div class="detail-byline">'+esc(song.artist||"Unknown artist")+'</div>'+
    '<p class="section-copy">'+esc(song.description||song.mood||song.genre||"A song from your local library.")+'</p>'+
    '<div class="settings-panel"><div class="eyebrow">Audio master / video follows</div><div class="preview-controls"><button class="btn small" data-action="preview-toggle">'+(transport.playing?"Ⅱ PAUSE":"▶ PLAY")+'</button>'+
    '<input data-field="preview-seek" type="range" min="0" max="'+Math.ceil(song.duration)+'" step=".05" value="'+Number(songMediaTime()).toFixed(2)+'"><span class="time-code" id="preview-clock">'+fmtClock(songMediaTime())+'</span></div>'+
    '<label class="field-label">Video offset (s)<input class="field" data-field="preview-video-offset" type="number" step=".01" value="'+esc(song.sync&&song.sync.videoOffset||0)+'"></label>'+
    '<label class="field-label" style="margin-top:12px">Audio volume<div class="range-row"><input data-field="preview-volume" type="range" min="0" max="100" value="'+Math.round(state.settings.musicVolume*100)+'"><output class="range-value">'+Math.round(state.settings.musicVolume*100)+'%</output></div></label></div>'+
    '<div class="detail-actions top-gap"><button class="btn primary" data-action="back-to-detail">CHOOSE A CHART</button></div></section></div></div>';
  if(transport.playing)requestAnimationFrame(previewFrame);
}
function previewFrame(){
  if(state.screen!=="preview"||!state.previewSong)return;
  const time=songMediaTime(),video=document.getElementById("preview-video");
  syncVideo(video,state.previewSong,time,transport.playing);
  const seek=document.querySelector('[data-field="preview-seek"]');
  if(seek&&!seek.matches(":active"))seek.value=time;
  const clock=document.getElementById("preview-clock");
  if(clock)clock.textContent=fmtClock(time)+" / "+fmtTime(state.previewSong.duration);
  if(time>=state.previewSong.duration){pauseTransport();return;}
  if(transport.playing)requestAnimationFrame(previewFrame);
}
async function beginPreview(song){
  if(!song)return;
  stopTransport();state.previewSong=song;state.screen="preview";render();
  try{await prepareTransport(song,0);render();}
  catch(error){state.screen="detail";render();toast("Preview could not start: "+error.message,"error");}
}

function currentChartTime() {
  if (!state.game) return 0;
  return songMediaTime() + Number(state.settings.calibrationMs || 0) / 1000 -
    (Number(state.game.chart.offset || 0) + Number(state.game.song.sync && state.game.song.sync.chartOffset || 0)) / 1000;
}
function pickGrade(delta) {
  const abs = Math.abs(delta);
  if (abs <= .045) return "perfect";
  if (abs <= .09) return "great";
  if (abs <= .15) return "good";
  return "miss";
}
function emptyCounts() { return { perfect: 0, great: 0, good: 0, miss: 0 }; }
async function launchGame(song, chart) {
  if (!song || !chart) { toast("Choose a song and chart first.", "error"); return; }
  const errors = validateChart(chart, song);
  if (errors.length) { toast("This chart cannot be played: " + errors[0], "error"); return; }
  stopTransport();
  const recent = { songId: song.id, difficulty: chart.difficulty, chartId: chart.id, playedAt: Date.now() };
  state.recent = [recent].concat(state.recent.filter(item => item.songId !== song.id || item.chartId !== chart.id)).slice(0, 8);
  saveSetting("recent", state.recent);
  state.game = {
    song: song, chart: chart, judged: new Set(), activeHolds: new Map(), heldLanes: new Set(),
    score: 0, combo: 0, maxCombo: 0, counts: emptyCounts(), accuracyWeighted: 0, accuracyEvents: 0,
    paused: false, startedAt: Date.now(), effects: [], ended: false
  };
  state.lastRun = null;
  gameAudioReady = false;
  state.screen = "game";
  render();
  try {
    await prepareTransport(song, 0);
    gameAudioReady = true;
    state.game.audioPositionAtStart = 0;
    render();
    toast("Audio clock started. Good luck.");
  } catch (error) {
    stopTransport();
    gameAudioReady = false;
    state.screen = "detail";
    render();
    toast("Could not start this song: " + (error && error.message ? error.message : "audio playback error"), "error");
  }
}
function pauseGame() {
  if (!state.game || state.game.paused) return;
  state.game.paused = true;
  pauseTransport();
  render();
}
async function resumeGame() {
  if (!state.game) return;
  state.game.paused = false;
  gameAudioReady = false;
  render();
  try {
    await resumeTransport();
    gameAudioReady = true;
    render();
  } catch (error) {
    state.game.paused = true;
    render();
    toast("Audio could not resume: " + error.message, "error");
  }
}
function restartGame() {
  if (!state.game) return;
  const song = state.game.song, chart = state.game.chart;
  launchGame(song, chart);
}
function exitGame() {
  stopTransport();
  state.game = null; state.lastRun = null; gameAudioReady = false; state.screen = "detail";
  render();
}
function addJudgement(grade, comboEvent) {
  if (!state.game) return;
  const game = state.game;
  game.counts[grade] = (game.counts[grade] || 0) + 1;
  game.accuracyEvents++;
  const values = { perfect: 1, great: .8, good: .5, miss: 0 };
  game.accuracyWeighted += values[grade] || 0;
  if (grade === "miss") game.combo = 0;
  else if (comboEvent !== false) { game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo); }
  const points = { perfect: 1000, great: 700, good: 350, miss: 0 };
  game.score += points[grade] + (grade === "miss" ? 0 : Math.floor(game.combo * 2));
  game.effects.push({ grade: grade, at: performance.now() });
  showJudgement(grade);
}
function showJudgement(grade) {
  const flash = document.getElementById("judge-flash");
  if (!flash) return;
  flash.textContent = grade.toUpperCase();
  flash.className = "judge-flash show";
  setTimeout(function () { if (flash.isConnected) flash.className = "judge-flash"; }, 560);
}
function laneHit(lane) {
  const game = state.game;
  if (!game || game.paused || game.chart.mode !== "lanes" || !gameAudioReady) return;
  const now = currentChartTime();
  let chosen = null, distance = Infinity;
  game.chart.notes.forEach(function (note) {
    if (game.judged.has(note.id) || note.lane !== lane) return;
    const delta = Math.abs(now - note.time);
    if (delta <= .15 && delta < distance) { chosen = note; distance = delta; }
  });
  if (!chosen) return;
  const grade = pickGrade(now - chosen.time);
  if (grade === "miss") return;
  game.judged.add(chosen.id);
  addJudgement(grade, true);
  if (chosen.type === "hold") {
    game.activeHolds.set(chosen.id, { note: chosen, lane: lane, started: now, completed: false });
  }
}
function laneRelease(lane) {
  const game = state.game;
  if (!game || game.chart.mode !== "lanes") return;
  game.heldLanes.delete(lane);
  const now = currentChartTime();
  game.activeHolds.forEach(function (hold, key) {
    if (hold.lane !== lane || hold.completed) return;
    const tail = hold.note.time + Number(hold.note.duration || 0);
    if (now < tail - .15) {
      hold.completed = true; game.activeHolds.delete(key); addJudgement("miss", false);
    } else if (now <= tail + .15) {
      const grade = pickGrade(now - tail);
      hold.completed = true; game.activeHolds.delete(key); addJudgement(grade, grade !== "miss");
    }
  });
}
function circleHit(event) {
  const game = state.game;
  if (!game || game.paused || game.chart.mode !== "circle" || !gameAudioReady) return;
  const canvas = document.getElementById("game-canvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) / rect.width;
  const py = (event.clientY - rect.top) / rect.height;
  const now = currentChartTime();
  let candidate = null, closest = Infinity;
  game.chart.notes.forEach(function (note) {
    if (game.judged.has(note.id) || Math.abs(now - note.time) > .15) return;
    const d = Math.hypot((px - note.x) * rect.width, (py - note.y) * rect.height);
    if (d <= Math.min(51, rect.width * .07) && d < closest) { candidate = note; closest = d; }
  });
  if (candidate) {
    game.judged.add(candidate.id);
    addJudgement(pickGrade(now - candidate.time), true);
  }
}
function updateGame() {
  const game = state.game;
  if (!game || game.paused || !transport.playing) return;
  const now = currentChartTime();
  game.chart.notes.forEach(function (note) {
    if (game.judged.has(note.id)) return;
    if (now > note.time + .15) {
      game.judged.add(note.id);
      addJudgement("miss", false);
    }
  });
  game.activeHolds.forEach(function (hold, id) {
    if (!hold.completed && game.heldLanes.has(hold.lane) && now >= hold.note.time + hold.note.duration) {
      hold.completed = true; game.activeHolds.delete(id); addJudgement("perfect", true);
    }
  });
  const time = songMediaTime();
  const video = document.getElementById("game-video");
  syncVideo(video, game.song, time, transport.playing);
  const scoreNode = document.getElementById("game-score");
  const comboNode = document.getElementById("game-combo");
  const accuracyNode = document.getElementById("game-accuracy");
  const timeNode = document.getElementById("game-time");
  const progress = document.getElementById("game-progress");
  if (scoreNode) scoreNode.textContent = game.score.toLocaleString();
  if (comboNode) comboNode.textContent = game.combo.toLocaleString();
  if (accuracyNode) accuracyNode.textContent = (game.accuracyEvents ? game.accuracyWeighted / game.accuracyEvents * 100 : 100).toFixed(2) + "%";
  if (timeNode) timeNode.textContent = fmtClock(time) + " / " + fmtTime(game.song.duration);
  if (progress) progress.style.width = Math.min(100, time / game.song.duration * 100) + "%";
  if (time >= game.song.duration || (game.judged.size === game.chart.notes.length && time > game.song.duration - 1)) { finishGame(); return; }
}
function gameFrame() {
  if (!state.game || state.screen !== "game" || state.game.paused || !gameAudioReady) return;
  updateGame();
  if (!state.game || state.screen !== "game" || state.game.paused) return;
  drawGameCanvas();
  gameRaf = requestAnimationFrame(gameFrame);
}
function drawGameCanvas() {
  const canvas = document.getElementById("game-canvas"), game = state.game;
  if (!canvas || !game) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
    canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w = rect.width, h = rect.height, now = currentChartTime();
  ctx.clearRect(0,0,w,h);
  if (game.chart.mode === "lanes") {
    const laneWidth = Math.min(w * .66, 620), left = (w - laneWidth) / 2, lane = laneWidth / 4;
    const lineY = h * .83, travel = Math.max(180, lineY - 76);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "rgba(12,17,27,.19)" : "rgba(180,201,236,.035)";
      ctx.fillRect(left + lane * i, 0, lane, h);
      ctx.strokeStyle = "rgba(205,218,239,.13)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left + lane * i, 0); ctx.lineTo(left + lane * i, h); ctx.stroke();
      ctx.fillStyle = "rgba(230,236,247,.5)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      ctx.fillText(["D","F","J","K"][i], left + lane * (i + .5), h - 19);
    }
    ctx.beginPath(); ctx.moveTo(left + laneWidth,0); ctx.lineTo(left + laneWidth,h); ctx.stroke();
    ctx.strokeStyle = "rgba(198,216,244,.75)"; ctx.shadowColor = "rgba(168,196,236,.75)"; ctx.shadowBlur = 12;
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, lineY); ctx.lineTo(left + laneWidth,lineY); ctx.stroke(); ctx.shadowBlur = 0;
    game.chart.notes.forEach(function (note) {
      if (game.judged.has(note.id)) return;
      const delta = note.time - now;
      if (delta < -.18 || delta > 2.35) return;
      const x = left + lane * note.lane + lane * .14;
      const width = lane * .72;
      const y = lineY - delta * travel / 2.15;
      if (note.type === "hold") {
        const tailY = lineY - (delta + note.duration) * travel / 2.15;
        const top = Math.max(0, Math.min(y,tailY)), bottom = Math.min(h,Math.max(y,tailY));
        ctx.fillStyle = "rgba(177,203,240,.21)"; ctx.fillRect(x + width * .24, top, width * .52, Math.max(2,bottom-top));
        ctx.strokeStyle = "rgba(200,221,250,.65)"; ctx.lineWidth = 1; ctx.strokeRect(x + width * .24, top, width * .52, Math.max(2,bottom-top));
      }
      const radius = Math.max(5, Math.min(10, lane * .16));
      const gradient = ctx.createLinearGradient(x,y,x+width,y+10);
      gradient.addColorStop(0, "rgba(224,236,255,.98)"); gradient.addColorStop(1, "rgba(154,186,229,.84)");
      ctx.shadowColor = "rgba(168,196,236,.4)"; ctx.shadowBlur = 10; ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.roundRect(x, y - radius, width, radius * 2, radius); ctx.fill(); ctx.shadowBlur = 0;
    });
  } else {
    const approach = 1.65;
    game.chart.notes.forEach(function (note) {
      if (game.judged.has(note.id)) return;
      const delta = note.time - now;
      if (delta < -.18 || delta > approach) return;
      const x = note.x * w, y = note.y * h;
      const progress = Math.max(0, Math.min(1, 1 - delta / approach));
      const outer = 47 - progress * 25;
      ctx.strokeStyle = "rgba(220,231,249," + (.27 + progress * .56) + ")";
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x,y,outer,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle = "rgba(220,231,249,.58)"; ctx.beginPath(); ctx.arc(x,y,17,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = "rgba(204,222,248,.94)"; ctx.shadowColor = "rgba(168,196,236,.76)"; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(x,y,5.4,0,Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    });
  }
}
function finishGame() {
  if (!state.game || state.game.ended) return;
  const game = state.game;
  game.chart.notes.forEach(function(note){
    if(!game.judged.has(note.id)){game.judged.add(note.id);addJudgement("miss",false);}
  });
  game.activeHolds.forEach(function(hold,id){
    if(!hold.completed){hold.completed=true;game.activeHolds.delete(id);addJudgement("miss",false);}
  });
  game.ended = true; stopTransport();
  const accuracy = game.accuracyEvents ? game.accuracyWeighted / game.accuracyEvents * 100 : 0;
  const grade = accuracy >= 99 ? "S" : accuracy >= 92 ? "A" : accuracy >= 80 ? "B" : accuracy >= 65 ? "C" : "D";
  const run = {
    songId: game.song.id, song: game.song, chart: game.chart, score: game.score, accuracy: accuracy,
    counts: Object.assign({}, game.counts), maxCombo: game.maxCombo, grade: grade, createdAt: new Date().toISOString()
  };
  state.lastRun = run;
  const key = chartKey(game.song.id, game.chart.id);
  const previous = getBest(game.song.id, game.chart.id);
  if (!previous || run.score > previous.score) {
    state.results[key] = { key: key, songId: game.song.id, chartId: game.chart.id, score: run.score, accuracy: run.accuracy, maxCombo: run.maxCombo, grade: run.grade, createdAt: run.createdAt };
    put("results", { key: key, value: state.results[key] });
  }
  state.screen = "results"; gameAudioReady = false; render();
}

function drawEditorTimeline() {
  const canvas = document.getElementById("chart-timeline");
  const project = state.editingProject, chart = state.editorChart;
  if (!canvas || !project || !chart) return;
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "#0a0e16"; ctx.fillRect(0,0,w,h);
  const duration = Number(project.duration), pxSec = w / duration, bpm = Math.max(40, Number(chart.bpm || project.bpm || 112));
  const beat = 60 / bpm;
  const laneCount = chart.mode === "lanes" ? 4 : 1;
  const top = chart.mode === "lanes" ? 28 : 22, rowH = (h - top - 16) / laneCount;
  ctx.font = "10px monospace"; ctx.textAlign = "left";
  for (let second = 0; second <= duration; second++) {
    const x = second * pxSec;
    ctx.strokeStyle = second % 5 === 0 ? "rgba(177,199,229,.19)" : "rgba(177,199,229,.075)";
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,h-8); ctx.stroke();
    if (second % 2 === 0) { ctx.fillStyle = second % 10 === 0 ? "#aab8cf" : "#707d92"; ctx.fillText(fmtTime(second),x+3,14); }
  }
  for (let index = 0; index * beat < duration; index++) {
    const x = index * beat * pxSec;
    ctx.strokeStyle = index % 4 === 0 ? "rgba(178,203,239,.2)" : "rgba(178,203,239,.08)";
    ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,h-8); ctx.stroke();
  }
  if (Array.isArray(project.waveform) && project.waveform.length) {
    ctx.fillStyle = "rgba(144,169,207,.18)";
    const center = h - 28;
    const binW = w / project.waveform.length;
    project.waveform.forEach(function (v,i) {
      const amp = Math.max(1,Number(v) * 48);
      ctx.fillRect(i * binW,center - amp / 2,Math.max(1,binW * .66),amp);
    });
  }
  for (let row = 0; row < laneCount; row++) {
    const y = top + row * rowH;
    ctx.fillStyle = row % 2 ? "rgba(255,255,255,.012)" : "rgba(185,205,236,.027)";
    ctx.fillRect(0,y,w,rowH);
    ctx.strokeStyle = "rgba(192,207,232,.12)"; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    if (chart.mode === "lanes") { ctx.fillStyle = "#8a96aa"; ctx.font = "9px monospace"; ctx.fillText("LANE " + (row+1),5,y+15); }
  }
  chart.notes.forEach(function (note) {
    const x = Number(note.time) * pxSec;
    const row = chart.mode === "lanes" ? Number(note.lane) : 0;
    const y = top + row * rowH + rowH * .23;
    const hh = Math.max(12,rowH * .5);
    const color = note.id === state.editorSelectedId ? "#e3edff" : (chart.mode === "circle" ? "#ccb9e7" : ["#aac5e9","#c9b9e7","#dfb5c2","#a6d3c9"][row % 4]);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = note.id === state.editorSelectedId ? 13 : 0;
    if (note.type === "hold") {
      const tail = x + Number(note.duration || 0) * pxSec;
      ctx.globalAlpha = .33; ctx.fillRect(x + 5,y + hh * .25,Math.max(2,tail-x-5),hh * .5); ctx.globalAlpha = 1;
      ctx.fillRect(x,y,9,hh);
    } else if (chart.mode === "circle") {
      ctx.beginPath(); ctx.arc(x,y+hh/2,7,0,Math.PI*2); ctx.fill();
    } else ctx.fillRect(x,y,9,hh);
    ctx.shadowBlur = 0;
  });
  const playhead = Number(state.editorPlayhead || 0) * pxSec;
  ctx.strokeStyle = "#eef2fb"; ctx.lineWidth = 1.5; ctx.shadowColor = "rgba(190,210,244,.7)"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(playhead,0); ctx.lineTo(playhead,h); ctx.stroke(); ctx.shadowBlur = 0;
}
function drawEditorLoop() {
  if (state.screen !== "editor") return;
  if (state.editorPlaying && transport.playing) {
    state.editorPlayhead = songMediaTime();
    if(state.editorPlayhead>=state.editingProject.duration){
      state.editorPlayhead=state.editingProject.duration;pauseTransport();state.editorPlaying=false;
      const button=document.querySelector('[data-action="editor-toggle-play"]');if(button)button.textContent="▶ PREVIEW";
    }
    const time = document.getElementById("editor-time");
    if (time) time.textContent = fmtClock(state.editorPlayhead) + " / " + fmtTime(state.editingProject.duration);
    const seek = document.querySelector('[data-field="editor-seek"]');
    if (seek && !seek.matches(":active")) seek.value = state.editorPlayhead;
    const video = document.getElementById("editor-video");
    syncVideo(video,state.editingProject,state.editorPlayhead,transport.playing);
  }
  drawEditorTimeline();
  if (state.editorPlaying && transport.playing) editorRaf = requestAnimationFrame(drawEditorLoop);
}
function timelinePointer(event) {
  const canvas = document.getElementById("chart-timeline");
  if (!canvas || !state.editorChart || !state.editingProject) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(canvas.width, event.clientX - rect.left));
  const y = event.clientY - rect.top;
  const duration = state.editingProject.duration;
  const laneCount = state.editorChart.mode === "lanes" ? 4 : 1;
  const top = state.editorChart.mode === "lanes" ? 28 : 22;
  const rowH = (canvas.height - top - 16) / laneCount;
  const lane = Math.max(0, Math.min(laneCount - 1, Math.floor((y - top) / rowH)));
  const time = x / canvas.width * duration;
  const near = state.editorChart.notes.find(function (note) {
    const dx = Math.abs(note.time - time) / duration * canvas.width;
    const noteRow = state.editorChart.mode === "lanes" ? note.lane : 0;
    return dx < 13 && noteRow === lane;
  });
  if (near) {
    state.editorSelectedId = near.id;
    state.editorDrag = { id: near.id, x: x, time: near.time, duration: near.duration || 0, lane: near.lane, alt: event.altKey, changed: false };
    canvas.setPointerCapture(event.pointerId);
    const panel = document.getElementById("selected-note-panel");
    if (panel) panel.innerHTML = renderSelectedNote(state.editingProject,state.editorChart);
    drawEditorTimeline();
    event.preventDefault();
    return;
  }
  pushUndo();
  const grid = 60 / Number(state.editorChart.bpm || 112) / Number(state.editorSnap || 4);
  const snapped = Math.max(0,Math.min(duration,Math.round(time / grid) * grid));
  let note;
  if (state.editorChart.mode === "lanes") note = { id: uid("n"), time: +snapped.toFixed(4), type: state.editorTool, lane: lane, duration: state.editorTool === "hold" ? grid * 4 : 0 };
  else note = { id: uid("n"), time: +snapped.toFixed(4), type: "tap", x: +Math.max(.08,Math.min(.92,.15 + .7 * time / duration)).toFixed(3), y: +(.28 + .42 * ((Math.sin(snapped * 1.7) + 1) / 2)).toFixed(3) };
  state.editorChart.notes.push(note);
  state.editorChart.notes.sort((a,b) => a.time - b.time);
  state.editorSelectedId = note.id;
  const notePanel = document.getElementById("selected-note-panel");
  if (notePanel) notePanel.innerHTML = renderSelectedNote(state.editingProject,state.editorChart);
  drawEditorTimeline(); updateEditorToolbar();
}
function moveTimelinePointer(event) {
  const canvas = document.getElementById("chart-timeline");
  const drag = state.editorDrag;
  if (!canvas || !drag || !state.editorChart) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const deltaSeconds = (x - drag.x) / canvas.width * state.editingProject.duration;
  const grid = 60 / Number(state.editorChart.bpm || 112) / Number(state.editorSnap || 4);
  const note = state.editorChart.notes.find(n => n.id === drag.id);
  if (!note) return;
  if(!drag.changed){pushUndo();drag.changed=true;}
  if (event.altKey && note.type === "hold") note.duration = Math.max(grid,Math.min(12,Math.round((drag.duration + deltaSeconds) / grid) * grid));
  else note.time = Math.max(0,Math.min(state.editingProject.duration,Math.round((drag.time + deltaSeconds) / grid) * grid));
  drawEditorTimeline();
}
function endTimelineDrag() {
  if (state.editorDrag) {
    state.editorDrag = null;
    const panel = document.getElementById("selected-note-panel");
    if (panel) panel.innerHTML = renderSelectedNote(state.editingProject,state.editorChart);
  }
}
function pushUndo() {
  if (!state.editorChart) return;
  state.editorUndo.push(JSON.stringify(state.editorChart));
  if (state.editorUndo.length > 80) state.editorUndo.shift();
  state.editorRedo = [];
  updateEditorToolbar();
}
function updateEditorToolbar() {
  const undo = document.querySelector('[data-action="editor-undo"]');
  const redo = document.querySelector('[data-action="editor-redo"]');
  const del = document.querySelector('[data-action="editor-delete"]');
  if (undo) undo.disabled = !state.editorUndo.length;
  if (redo) redo.disabled = !state.editorRedo.length;
  if (del) del.disabled = !state.editorSelectedId;
}
function editorUndo(direction) {
  const from = direction === "undo" ? state.editorUndo : state.editorRedo;
  const to = direction === "undo" ? state.editorRedo : state.editorUndo;
  if (!from.length) return;
  to.push(JSON.stringify(state.editorChart));
  state.editorChart = JSON.parse(from.pop());
  state.editorSelectedId = null;
  render();
}

function setCreatorStatus(message, isError) {
  if (!state.creator) state.creator = emptyCreator();
  state.creator.status = message;
  state.creator.statusType = isError ? "error" : "";
  const node = document.getElementById("creator-status");
  if (node) { node.textContent = message; node.className = "maker-status" + (isError ? " error" : ""); }
}
function fileAccepted(file, type, maxBytes) {
  if (!file) return false;
  if (file.size > maxBytes) {
    setCreatorStatus("That file is too large (" + sizeText(file.size) + "). Maximum size is " + sizeText(maxBytes) + ".", true);
    return false;
  }
  const name = file.name.toLowerCase();
  let okay = false;
  if (type === "audio") okay = file.type === "audio/mpeg" || file.type === "audio/mp3" || name.endsWith(".mp3");
  if (type === "video") okay = file.type === "video/mp4" || name.endsWith(".mp4");
  if (type === "image") okay = /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (type === "chart") okay = file.type === "application/json" || name.endsWith(".json");
  if (!okay) setCreatorStatus("Unsupported file type. Expected " + ({audio:"an MP3",video:"an MP4",image:"PNG, JPEG, or WebP",chart:"JSON"})[type] + ".", true);
  return okay;
}
function readFileText(file) { return file.text ? file.text() : new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=()=>reject(r.error); r.readAsText(file); }); }
function fileAsDataUrl(file) { return new Promise(function (resolve,reject) { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
function makeProjectFromCreator() {
  const c = state.creator;
  if (!c) throw new Error("Open the song maker first.");
  const previous = c.project || null;
  const audioBlob = c.audioFile || (previous && previous.media && previous.media.audioBlob);
  const sourceBuiltinId = previous && previous.sourceBuiltinId && !c.audioFile ? previous.sourceBuiltinId : null;
  if (!audioBlob && !sourceBuiltinId) throw new Error("Choose an MP3 before saving a playable song project.");
  const title = c.title.trim() || (c.audioFile && c.audioFile.name ? c.audioFile.name.replace(/\.[^.]+$/,"") : (previous ? previous.title : "Untitled song"));
  const duration = Number(c.duration || (previous && previous.duration) || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio duration is not ready yet. Wait for the preview to finish loading, then save again.");
  const id = previous ? previous.id : uid("song");
  const oldCharts = previous && previous.charts ? previous.charts.slice() : [];
  const project = {
    id: id, title: title, artist: c.artist.trim() || (previous && previous.artist) || "Unknown artist",
    genre: c.genre.trim() || (previous && previous.genre) || "Custom", mood: "Custom",
    description: c.description.trim(), bpm: Math.max(40,Math.min(240,Number(c.bpm) || 112)),
    duration: duration, theme: (previous && previous.theme) || "cover-custom",
    audioName: (c.audioFile && c.audioFile.name) || (previous && previous.audioName) || "audio.mp3",
    videoName: (c.videoFile && c.videoFile.name) || (previous && previous.videoName) || "",
    media: audioBlob ? {
      audioBlob: audioBlob,
      videoBlob: c.videoFile || (previous && previous.media && previous.media.videoBlob) || null,
      coverBlob: c.coverFile || (previous && previous.media && previous.media.coverBlob) || null
    } : null,
    coverDataUrl: c.coverDataUrl || (previous && previous.coverDataUrl) || "",
    waveform: c.waveform && c.waveform.length ? c.waveform : ((previous && previous.waveform) || []),
    charts: oldCharts, sync: {
      audioOffset: Number(c.audioOffset) || 0,
      chartOffset: Number(c.audioOffset) || 0,
      videoOffset: Number(c.videoOffset) || 0,
      videoOpacity: Number(c.videoOpacity) || state.settings.videoOpacity,
      videoFit: c.videoFit || state.settings.videoFit,
      videoBlur: Number(c.videoBlur) || 0,
      videoVisible: c.videoVisible !== false
    },
    license: sourceBuiltinId ? previous.license : "User-provided media. The user is responsible for confirming its license and redistribution rights.",
    source: sourceBuiltinId ? "built-in-song-copy" : "local-import",
    sourceBuiltinId: sourceBuiltinId || undefined,
    createdAt: (previous && previous.createdAt) || new Date().toISOString()
  };
  return project;
}
function emptyChart(project, mode, difficulty) {
  return { id: uid("chart"), songId: project.id, mode: mode || "lanes", difficulty: difficulty || "Normal", author: "You",
    version: "1.0.0", bpm: Number(project.bpm) || 112, offset: 0, notes: [] };
}
async function saveCreatorProject(includeImportedChart) {
  const project = makeProjectFromCreator();
  const c = state.creator;
  if (includeImportedChart && c.importedChart) {
    const chart = JSON.parse(JSON.stringify(c.importedChart));
    chart.songId = project.id;
    chart.id = chart.id || uid("chart");
    const errors = validateChart(chart,project);
    if (errors.length) throw new Error("Imported chart is invalid: " + errors[0]);
    const idx = project.charts.findIndex(c => c.id === chart.id);
    if (idx >= 0) project.charts[idx] = chart; else project.charts.push(chart);
  }
  await saveProject(project);
  c.project = project;
  c.duration = project.duration;
  c.saved = true;
  return project;
}
async function saveDraft() {
  try {
    const project = await saveCreatorProject(state.creator && state.creator.choice === "existing");
    state.selectedSongId = project.id;
    state.screen = "detail";
    render();
    toast(project.charts.length ? "Song and chart saved to this browser." : "Song draft saved locally.");
  } catch (error) { setCreatorStatus(error.message,true); toast(error.message,"error"); }
}
async function loadImportedChart(file) {
  try {
    const parsed = JSON.parse(await readFileText(file));
    const chart = parsed.chart || parsed;
    if (!chart || chart.version !== "1.0.0") throw new Error("This is not an ECHO//VOID chart version 1.0.0.");
    if (!["lanes","circle"].includes(chart.mode)) throw new Error("This chart’s game mode is not playable in this version.");
    if (!Array.isArray(chart.notes)) throw new Error("The chart has no notes array.");
    const draftDuration = state.creator.duration || 600;
    const errors = validateChart(chart,{duration:draftDuration});
    if (errors.length) throw new Error(errors[0]);
    state.creator.importedChart = chart;
    state.creator.mode = chart.mode;
    state.creator.difficulty = chart.difficulty || "Normal";
    state.creator.choice = "existing";
    setCreatorStatus("Validated " + chart.notes.length + " notes for " + MODES[chart.mode].name + " (" + chart.difficulty + ").");
    render();
  } catch (error) { setCreatorStatus("Could not use this chart: " + error.message,true); toast(error.message,"error"); }
}
async function updateAudioDuration(file) {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = url;
  audio.onloadedmetadata = function () {
    state.creator.duration = audio.duration;
    URL.revokeObjectURL(url);
    if (!state.creator.title) state.creator.title = String(file.name || state.creator.audioName || "Untitled song").replace(/\.[^.]+$/,"");
    setCreatorStatus("Audio ready · " + fmtTime(audio.duration) + " · " + sizeText(file.size));
    render();
  };
  audio.onerror = function () {
    URL.revokeObjectURL(url);
    setCreatorStatus("The browser could not read audio duration. Check that this is a valid MP3 file.",true);
  };
}
async function analyzeAudio(blob, mode, density, fallbackBpm) {
  setCreatorStatus("Reading local audio and extracting short-window energy…");
  const ctx = getAudioContext();
  const raw = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(raw.slice(0));
  const data = decoded.getChannelData(0);
  const frameSize = 2048;
  const rms = [];
  for (let i = 0; i < data.length; i += frameSize) {
    const end = Math.min(data.length,i+frameSize);
    let sum = 0;
    for (let j = i; j < end; j += 4) sum += data[j] * data[j];
    rms.push(Math.sqrt(sum / Math.max(1,Math.ceil((end-i)/4))));
  }
  const frameSeconds = frameSize / decoded.sampleRate;
  const flux = rms.map((v,i) => i === 0 ? 0 : Math.max(0,v-rms[i-1]));
  const mean = flux.reduce((a,b) => a+b,0) / Math.max(1,flux.length);
  const variance = flux.reduce((a,b) => a+(b-mean)*(b-mean),0) / Math.max(1,flux.length);
  const threshold = mean + Math.sqrt(variance) * .48;
  const onsets = [];
  for (let i = 2; i < flux.length - 2; i++) {
    if (flux[i] > threshold && flux[i] > flux[i-1] && flux[i] >= flux[i+1]) onsets.push(i * frameSeconds);
  }
  let bestBpm = Math.max(40,Math.min(240,Number(fallbackBpm) || 112)), bestScore = -Infinity;
  const normalized = flux.map(v => Math.max(0,v-mean));
  for (let bpm=70;bpm<=180;bpm++) {
    const lag = Math.round(60 / bpm / frameSeconds);
    if (lag < 1 || lag >= normalized.length) continue;
    let correlation = 0, energy = 0;
    for (let i=lag;i<normalized.length;i++) { correlation += normalized[i]*normalized[i-lag]; energy += normalized[i]*normalized[i]; }
    const score = correlation / Math.max(1e-9,energy);
    if (score > bestScore) { bestScore=score; bestBpm=bpm; }
  }
  const period = 60 / bestBpm;
  const beatCount = Math.floor(decoded.duration / period);
  const maxFrames = Math.max(1,Math.floor(decoded.duration / frameSeconds));
  const sample = [];
  const maxRms = rms.reduce((m,v)=>Math.max(m,v),1e-9);
  for (let i=0;i<180;i++) {
    const frame = Math.floor(i / 180 * Math.min(maxFrames,rms.length-1));
    sample.push(+(rms[frame] / maxRms).toFixed(3));
  }
  const candidateTimes = [];
  const densityRatio = Math.max(.15,Math.min(.9,Number(density) / 100));
  let seed = 13;
  const rand = function () { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const seen = new Set();
  for (let beat=0;beat<beatCount;beat++) {
    const time = beat * period;
    const frame = Math.min(normalized.length-1,Math.round(time/frameSeconds));
    const local = normalized.slice(Math.max(0,frame-2),Math.min(normalized.length,frame+3)).reduce((a,b)=>a+b,0)/5;
    const nextOnset = onsets.some(t => Math.abs(t-time) < period*.24);
    if ((nextOnset || local > mean * .48 || beat % 4 === 0) && rand() < densityRatio) {
      const snapped = +(time + Math.min(period*.14,(onsets.find(t=>Math.abs(t-time)<period*.24)||time)-time)).toFixed(4);
      if (!seen.has(Math.round(snapped * 100))) { candidateTimes.push(snapped); seen.add(Math.round(snapped * 100)); }
    }
  }
  if (candidateTimes.length < 8) {
    for (let beat=0;beat<beatCount;beat+=2) if (rand() < densityRatio) candidateTimes.push(+(beat*period).toFixed(4));
  }
  candidateTimes.sort((a,b)=>a-b);
  let chartIndex = 0;
  const notes = candidateTimes.map(function (time) {
    const index = chartIndex++;
    if (mode === "lanes") {
      const lane = index % 4;
      const hold = index > 0 && index % 13 === 7 && time + .5 < decoded.duration;
      return { id:uid("n"),time:time,type:hold?"hold":"tap",lane:lane,duration:hold?.45:0 };
    }
    const angle=index*2.399;
    return { id:uid("n"),time:time,type:"tap",x:+(.5+Math.cos(angle)*.28).toFixed(3),y:+(.5+Math.sin(angle)*.25).toFixed(3) };
  });
  return { duration: decoded.duration, bpm: bestBpm, waveform: sample, onsets: onsets, notes: notes };
}
async function generateCreatorChart(openForPlay) {
  const c = state.creator;
  try {
    const blob = c.audioFile || (c.project && c.project.media && c.project.media.audioBlob);
    if (!blob) throw new Error("Choose an MP3 before generating a chart.");
    c.choice = "generate";
    const analysis = await analyzeAudio(blob,c.mode,c.density,c.bpm);
    c.duration = analysis.duration; c.bpm = analysis.bpm; c.waveform = analysis.waveform;
    const project = makeProjectFromCreator();
    project.duration = analysis.duration; project.bpm = analysis.bpm; project.waveform = analysis.waveform;
    const chart = { id:uid("chart"),songId:project.id,mode:c.mode,difficulty:c.difficulty,author:"Local procedural generator",version:"1.0.0",
      bpm:analysis.bpm,offset:0,notes:analysis.notes,source:"local-onset-analysis" };
    const errors=validateChart(chart,project);
    if (errors.length) throw new Error("Generated chart failed validation: " + errors[0]);
    project.charts=project.charts.filter(x=>!(x.mode===chart.mode && x.difficulty===chart.difficulty)).concat([chart]);
    await saveProject(project);
    c.project=project;c.saved=true;
    if(openForPlay){
      state.selectedSongId=project.id;
      toast("Procedural chart saved locally · "+analysis.notes.length+" notes · "+analysis.bpm+" BPM.");
      await launchGame(project,chart);
      return;
    }
    state.editingProject=project; state.editorChart=JSON.parse(JSON.stringify(chart));
    state.editorUndo=[];state.editorRedo=[];state.editorTool="tap";state.editorPlaying=false;state.editorPlayhead=0;
    state.screen="editor";
    render();
    toast("Local beat analysis complete · " + analysis.onsets.length + " onsets · " + analysis.notes.length + " notes · estimated " + analysis.bpm + " BPM.");
  } catch(error) { setCreatorStatus(error.message,true); toast(error.message,"error"); }
}
async function startManualChart(fromCreator) {
  try {
    let project;
    if (fromCreator) {
      project=await saveCreatorProject(state.creator && state.creator.choice==="existing");
    } else {
      const song=getSong(state.selectedSongId);
      if(!song) throw new Error("Choose a song first.");
    if(isSeedSong(song)) {
        project={...song,id:uid("song"),sourceBuiltinId:song.id,title:song.title+" · My charts",charts:[],media:null,sync:{chartOffset:0,videoOffset:0,videoOpacity:state.settings.videoOpacity,videoFit:state.settings.videoFit},createdAt:new Date().toISOString()};
        await saveProject(project);
      } else project=song;
    }
    const chart=emptyChart(project,state.creator && fromCreator ? state.creator.mode : "lanes",state.creator && fromCreator ? state.creator.difficulty : "Normal");
    state.editingProject=project;state.editorChart=chart;state.editorUndo=[];state.editorRedo=[];state.editorSelectedId=null;
    state.editorTool="tap";state.editorSnap=4;state.editorPlaying=false;state.editorPlayhead=0;
    state.screen="editor";render();
  } catch(error){setCreatorStatus(error.message,true);toast(error.message,"error");}
}
function openEditor(project, chart) {
  state.editingProject=project;
  state.editorChart=JSON.parse(JSON.stringify(chart));
  state.editorUndo=[];state.editorRedo=[];state.editorSelectedId=null;
  state.editorTool="tap";state.editorSnap=4;state.editorPlaying=false;state.editorPlayhead=0;
  state.screen="editor";render();
}
async function saveCurrentChart() {
  const project=state.editingProject, chart=state.editorChart;
  if(!project||!chart)return;
  chart.songId=project.id;
  chart.author=chart.author||"You";
  chart.version="1.0.0";
  const errors=validateChart(chart,project);
  if(errors.length){toast("Fix the chart before saving: "+errors[0],"error");return;}
  const next=JSON.parse(JSON.stringify(project));
  next.charts=(next.charts||[]).filter(c=>c.id!==chart.id).concat([JSON.parse(JSON.stringify(chart))]);
  if(next.sync){
    const videoOffset=document.querySelector('[data-field="editor-video-offset"]'),opacity=document.querySelector('[data-field="editor-video-opacity"]');
    const blur=document.querySelector('[data-field="editor-video-blur"]'),visible=document.querySelector('[data-field="editor-video-visible"]');
    if(videoOffset)next.sync.videoOffset=Number(videoOffset.value)||0;
    if(opacity)next.sync.videoOpacity=Number(opacity.value)||state.settings.videoOpacity;
    if(blur)next.sync.videoBlur=Number(blur.value)||0;
    if(visible)next.sync.videoVisible=visible.checked;
  }
  await saveProject(next);
  state.editingProject=next;state.selectedSongId=next.id;state.screen="detail";state.editorPlaying=false;
  pauseTransport();render();toast("Chart saved to the local song project.");
}
async function toggleEditorPlayback() {
  if(!state.editingProject)return;
  if(state.editorPlaying && transport.playing){state.editorPlayhead=songMediaTime();pauseTransport();state.editorPlaying=false;render();return;}
  try{
    const seek=Number(state.editorPlayhead)||0;
    if(transport.song!==state.editingProject || transport.position===0) await prepareTransport(state.editingProject,seek,state.editorPlaybackRate||1);
    else {transport.position=seek;if(transport.element)transport.element.currentTime=seek;await resumeTransport();}
    state.editorPlaying=true;
    const audio=document.getElementById("editor-audio");
    render();
  }catch(error){toast("Editor preview could not start: "+error.message,"error");}
}
async function saveAndPlayCreator() {
  const c=state.creator;
  if(c.choice==="generate"){await generateCreatorChart(true);return;}
  try{
    const project=await saveCreatorProject(c.choice==="existing");
    const charts=project.charts||[];
    const usable=charts.find(ch=>ch.mode===c.mode&&ch.difficulty===c.difficulty&&validateChart(ch,project).length===0);
    state.selectedSongId=project.id;
    if(!usable){state.screen="detail";render();toast("Song draft saved. Add or select a compatible chart before playing.");return;}
    await launchGame(project,usable);
  }catch(error){setCreatorStatus(error.message,true);toast(error.message,"error");}
}

function toDataUrl(blob) {
  return new Promise(function(resolve,reject) {
    if(!blob){resolve(null);return;}
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  if(!dataUrl)return null;
  const match=String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if(!match)throw new Error("A project backup contains invalid media data.");
  const mime=match[1]||"application/octet-stream";
  const bytes=match[2]?Uint8Array.from(atob(match[3]),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(match[3]));
  return new Blob([bytes],{type:mime});
}
async function projectForExport(project) {
  const plain=Object.assign({},project);
  plain.coverDataUrl="";
  plain.media=project.media?{
    audioData:await toDataUrl(project.media.audioBlob),
    videoData:await toDataUrl(project.media.videoBlob),
    coverData:await toDataUrl(project.media.coverBlob)
  }:null;
  return plain;
}
function downloadText(text, name, type) {
  const blob=new Blob([text],{type:type||"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportProject(project) {
  if(!project)throw new Error("Choose a local song project first.");
  const file={format:"echo-void-project",version:1,exportedAt:new Date().toISOString(),project:await projectForExport(project)};
  downloadText(JSON.stringify(file),"echo-void-"+safeFilename(project.title)+".evproj","application/json");
  toast("Project backup exported. Keep that .evproj file somewhere safe.");
}
async function exportLibraryBackup() {
  const projects=await Promise.all(state.projects.map(projectForExport));
  const backup={format:"echo-void-library",version:1,exportedAt:new Date().toISOString(),projects:projects,
    favorites:Array.from(state.favorites),settings:state.settings,recent:state.recent};
  downloadText(JSON.stringify(backup),"echo-void-library-backup.evproj","application/json");
  toast("Local library backup exported ("+projects.length+" project"+(projects.length===1?"":"s")+").");
}
function safeFilename(value) {
  const base=String(value||"song").toLowerCase().replace(/[^a-z0-9-_]+/g,"-").replace(/^-+|-+$/g,"");
  return base||"song";
}
function exportChart(chart, song) {
  if(!chart)throw new Error("This song does not have a chart to export.");
  const payload={format:"echo-void-chart",version:1,chart:chart};
  downloadText(JSON.stringify(payload,null,2),safeFilename(song?song.title:"song")+"-"+chart.mode+"-"+safeFilename(chart.difficulty)+".json");
  toast("Chart JSON exported.");
}
async function importBackup(file) {
  if(!file)return;
  if(file.size>750*1024*1024){toast("This backup is larger than 750 MB and cannot be imported safely in this browser.", "error");return;}
  try {
    const parsed=JSON.parse(await readFileText(file));
    let projects=[];
    if(parsed.format==="echo-void-project"&&parsed.version===1&&parsed.project)projects=[parsed.project];
    else if(parsed.format==="echo-void-library"&&parsed.version===1&&Array.isArray(parsed.projects))projects=parsed.projects;
    else throw new Error("This is not an ECHO//VOID project or library backup.");
    let imported=0;
    for(const raw of projects){
      if(!raw||!Array.isArray(raw.charts)||!Number.isFinite(Number(raw.duration))||Number(raw.duration)<=0)throw new Error("A project in this backup has invalid metadata.");
      const project=Object.assign({},raw);
      const media=raw.media;
      project.media=media?{
        audioBlob:dataUrlToBlob(media.audioData),videoBlob:dataUrlToBlob(media.videoData),coverBlob:dataUrlToBlob(media.coverData)
      }:null;
      if(!project.id||state.projects.some(p=>p.id===project.id)){
        const oldId=project.id;project.id=uid("song");
        project.charts=project.charts.map(c=>Object.assign({},c,{id:uid("chart"),songId:project.id,author:"Imported backup"}));
        if(oldId)project.sourceBackupId=oldId;
      }
      if(project.media&&!project.media.audioBlob&&!project.sourceBuiltinId)throw new Error("A custom project backup is missing its MP3 data.");
      for(const chart of project.charts){
        chart.songId=project.id;
        const errors=validateChart(chart,project);
        if(errors.length)throw new Error("A chart in "+project.title+" is invalid: "+errors[0]);
      }
      if(!project.coverDataUrl&&project.media&&project.media.coverBlob)project.coverDataUrl=await toDataUrl(project.media.coverBlob);
      await saveProject(project);imported++;
    }
    if(Array.isArray(parsed.favorites)){
      parsed.favorites.forEach(id=>state.favorites.add(id));saveSetting("favorites",Array.from(state.favorites));
    }
    if(parsed.settings&&parsed.format==="echo-void-library"){
      state.settings=Object.assign(state.settings,parsed.settings);saveSetting("settings",state.settings);
    }
    state.screen="library";state.selectedSongId=null;render();
    toast("Imported "+imported+" local project"+(imported===1?"":"s")+".");
  }catch(error){toast("Backup import failed: "+error.message,"error");}
}
function initCreator(project) {
  if(!project){state.creator=Object.assign(emptyCreator(),{saved:false});return;}
  state.creator=Object.assign(emptyCreator(),{
    project:project,audioFile:project.media&&project.media.audioBlob,
    videoFile:project.media&&project.media.videoBlob,coverFile:project.media&&project.media.coverBlob,
    coverDataUrl:project.coverDataUrl||"",audioName:project.audioName||"audio.mp3",videoName:project.videoName||"",
    title:project.title||"",artist:project.artist||"",genre:project.genre||"",bpm:project.bpm||112,
    duration:project.duration,audioOffset:project.sync&&project.sync.chartOffset||0,
    videoOffset:project.sync&&project.sync.videoOffset||0,description:project.description||"",
    videoOpacity:project.sync&&project.sync.videoOpacity||state.settings.videoOpacity,videoBlur:project.sync&&project.sync.videoBlur||state.settings.videoBlur,
    videoVisible:project.sync?project.sync.videoVisible!==false:state.settings.videoVisible,videoFit:project.sync&&project.sync.videoFit||state.settings.videoFit,
    waveform:project.waveform||[],mode:(project.charts&&project.charts[0]&&project.charts[0].mode)||"lanes",
    difficulty:(project.charts&&project.charts[0]&&project.charts[0].difficulty)||"Normal",saved:true
  });
}
function navigate(screen) {
  if(state.screen==="game"&&screen!=="game"){
    stopTransport();state.game=null;state.lastRun=null;gameAudioReady=false;
  }else if((state.screen==="preview"||state.screen==="editor")&&screen!==state.screen){
    pauseTransport();state.editorPlaying=false;
  }
  if(screen!=="preview"&&screen!=="editor"&&screen!=="game"&&transport.playing)stopTransport();
  state.screen=screen;render();
}
function detailSong() { return getSong(state.selectedSongId); }
function handleAction(event) {
  const node=event.target.closest("[data-action]");
  if(!node)return;
  const action=node.dataset.action;
  if(node.disabled)return;
  if(action==="modal-scrim"&&event.target.closest(".modal"))return;
  if(action==="home"){navigate("home");return;}
  if(action==="library"){navigate("library");return;}
  if(action==="creator"){if(!state.creator||state.creator.saved)initCreator();navigate("creator");return;}
  if(action==="settings"){navigate("settings");return;}
  if(action==="modes"){navigate("modes");return;}
  if(action==="song"){
    const song=getSong(node.dataset.song);if(!song)return;
    state.selectedSongId=song.id;state.screen="detail";render();return;
  }
  if(action==="favorite"){
    event.stopPropagation();const id=node.dataset.song;
    if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);
    saveSetting("favorites",Array.from(state.favorites));render();return;
  }
  if(action==="toggle-favorites"){state.showFavorites=!state.showFavorites;render();return;}
  if(action==="resume-song"){
    const item=state.recent.find(x=>x.songId===(node.dataset.song||""))||state.recent[0];
    const song=item&&getSong(item.songId);const chart=song&&songCharts(song).find(c=>c.id===item.chartId);
    if(song&&chart)launchGame(song,chart);else if(song){state.selectedSongId=song.id;state.screen="detail";render();}
    return;
  }
  if(action==="play-chart"){
    const song=detailSong();const chart=song&&songCharts(song).find(c=>c.id===node.dataset.chart);
    if(song&&chart)launchGame(song,chart);return;
  }
  if(action==="duplicate-chart"){
    const song=detailSong(),source=song&&songCharts(song).find(c=>c.id===node.dataset.chart);
    if(!song||!source)return;
      const project=isSeedSong(song)?
      Object.assign({},song,{id:uid("song"),sourceBuiltinId:song.id,title:song.title+" · My charts",charts:[],media:null,createdAt:new Date().toISOString(),
        sync:Object.assign({chartOffset:0,videoOffset:0,videoOpacity:state.settings.videoOpacity,videoFit:state.settings.videoFit},song.sync||{})}):
      Object.assign({},song,{charts:songCharts(song).map(c=>JSON.parse(JSON.stringify(c)))});
    const copy=JSON.parse(JSON.stringify(source));copy.id=uid("chart");copy.songId=project.id;copy.author="You · duplicate";
    project.charts=(project.charts||[]).filter(c=>c.id!==copy.id).concat([copy]);
    saveProject(project).then(function(){state.selectedSongId=project.id;state.screen="detail";render();toast("Chart duplicated into a local song project.");});
    return;
  }
  if(action==="preview-song"){beginPreview(detailSong());return;}
  if(action==="preview-stop"||action==="back-to-detail"){
    if(state.screen==="editor"&&state.editorPlaying){pauseTransport();state.editorPlaying=false;}
    if(state.screen==="preview")stopTransport();
    state.selectedSongId=(state.editingProject&&state.screen==="editor")?state.editingProject.id:state.selectedSongId;
    state.screen="detail";render();return;
  }
  if(action==="preview-toggle"){
    if(transport.playing){pauseTransport();render();}
    else if(transport.song===state.previewSong)resumeTransport().then(render).catch(e=>toast(e.message,"error"));
    else beginPreview(state.previewSong);
    return;
  }
  if(action==="creator-edit"){
    const song=detailSong();if(song&&!isSeedSong(song)){initCreator(song);state.screen="creator";render();}
    else if(song){initCreator();state.creator.title=song.title+" · My song";state.creator.bpm=song.bpm;state.creator.duration=song.duration;state.creator.mode="lanes";state.screen="creator";render();}
    return;
  }
  if(action==="manual-chart"){startManualChart(false);return;}
  if(action==="manual-chart-from-creator"){startManualChart(true);return;}
  if(action==="creator-choice"){state.creator.choice=node.dataset.choice;render();return;}
  if(action==="save-draft"){saveDraft();return;}
  if(action==="generate-chart"){generateCreatorChart();return;}
  if(action==="save-and-play"){saveAndPlayCreator();return;}
  if(action==="import-project"||action==="import-all"){
    const input=document.getElementById("backup-import");if(input)input.click();return;
  }
  if(action==="export-project"){exportProject(detailSong()).catch(e=>toast(e.message,"error"));return;}
  if(action==="export-all"){exportLibraryBackup().catch(e=>toast(e.message,"error"));return;}
  if(action==="export-chart"){
    const song=state.screen==="editor"?state.editingProject:detailSong();
    const chart=(state.screen==="editor"?state.editorChart:(song&&songCharts(song).find(c=>c.id===node.dataset.chart)));
    if(!chart&&song&&songCharts(song).length===1)exportChart(songCharts(song)[0],song);
    else exportChart(chart,song);
    return;
  }
  if(action==="delete-project"){
    const song=getSong(node.dataset.song);
    if(!song||isSeedSong(song))return;
    state.modal={title:"Delete “"+song.title+"”?",body:"This removes the project and its media from this browser’s local library. Export a backup first if you want to keep a copy.",confirm:"DELETE PROJECT",danger:true,projectId:song.id};
    render();return;
  }
  if(action==="modal-cancel"||action==="modal-scrim"){state.modal=null;render();return;}
  if(action==="modal-confirm"){
    const id=state.modal&&state.modal.projectId;
    if(id){tx("projects","readwrite",s=>s.delete(id)).then(function(){state.projects=state.projects.filter(p=>p.id!==id);state.modal=null;state.screen="library";render();toast("Project removed from this browser.");});}
    return;
  }
  if(action==="pause-game"){pauseGame();return;}
  if(action==="resume-game"){resumeGame();return;}
  if(action==="restart-game"){restartGame();return;}
  if(action==="exit-game"){exitGame();return;}
  if(action==="replay-game"){if(state.lastRun)launchGame(getSong(state.lastRun.songId)||state.lastRun.song,state.lastRun.chart);return;}
  if(action==="change-chart"){state.screen="detail";render();return;}
  if(action==="editor-tool"){state.editorTool=node.dataset.tool;render();return;}
  if(action==="editor-delete"){
    if(!state.editorSelectedId)return;pushUndo();state.editorChart.notes=state.editorChart.notes.filter(n=>n.id!==state.editorSelectedId);state.editorSelectedId=null;
    const panel=document.getElementById("selected-note-panel");if(panel)panel.innerHTML=renderSelectedNote(state.editingProject,state.editorChart);drawEditorTimeline();updateEditorToolbar();return;
  }
  if(action==="editor-undo"){editorUndo("undo");return;}
  if(action==="editor-redo"){editorUndo("redo");return;}
  if(action==="editor-toggle-play"){toggleEditorPlayback();return;}
  if(action==="save-chart"){saveCurrentChart();return;}
  if(action==="export-current-chart"){exportChart(state.editorChart,state.editingProject);return;}
}

function handleInput(event) {
  const field=event.target.dataset.field;
  if(!field)return;
  const value=event.target.value;
  if(field==="library-search"){
    state.filter=value;
    clearTimeout(handleInput.filterTimer);
    handleInput.filterTimer=setTimeout(function(){
      const focused=state.filter;
      render();
      const input=document.querySelector('[data-field="library-search"]');
      if(input){input.focus();input.value=focused;input.setSelectionRange(focused.length,focused.length);}
    },180);
    return;
  }
  if(field==="setting-calibration"){
    state.settings.calibrationMs=Number(value);saveSetting("settings",state.settings);
    updateRangeOutput(event.target,Number(value)+" ms");return;
  }
  if(field==="setting-volume"||field==="preview-volume"){
    const volume=Number(value)/100;
    if(field==="setting-volume"){state.settings.musicVolume=volume;saveSetting("settings",state.settings);}
    if(transport.master)transport.master.gain.value=volume;
    if(transport.element)transport.element.volume=volume;
    updateRangeOutput(event.target,Math.round(volume*100)+"%");return;
  }
  if(field==="setting-video-opacity"){
    state.settings.videoOpacity=Number(value);saveSetting("settings",state.settings);updateRangeOutput(event.target,value+"%");return;
  }
  if(field==="setting-video-blur"){
    state.settings.videoBlur=Number(value);saveSetting("settings",state.settings);updateRangeOutput(event.target,value+" px");return;
  }
  if(field==="maker-volume"){
    const audio=document.getElementById("maker-audio");if(audio)audio.volume=Number(value)/100;
    updateRangeOutput(event.target,value+"%");return;
  }
  if(field==="maker-opacity"){
    if(state.creator)state.creator.videoOpacity=Number(value);
    syncMakerVideo();
    updateRangeOutput(event.target,value+"%");return;
  }
  if(field==="maker-blur"){
    if(state.creator)state.creator.videoBlur=Number(value);
    syncMakerVideo();updateRangeOutput(event.target,value+" px");return;
  }
  if(field==="creator-title"||field==="creator-artist"||field==="creator-genre"||field==="creator-bpm"||field==="creator-audio-offset"||field==="creator-video-offset"||field==="creator-description"){
    if(!state.creator)return;
    const map={"creator-title":"title","creator-artist":"artist","creator-genre":"genre","creator-bpm":"bpm","creator-audio-offset":"audioOffset","creator-video-offset":"videoOffset","creator-description":"description"};
    state.creator[map[field]]=field==="creator-bpm"||field==="creator-audio-offset"||field==="creator-video-offset"?Number(value):value;
    state.creator.saved=false;
    if(field==="creator-density")state.creator.density=Number(value);
    if(field==="creator-video-offset")syncMakerVideo();
    return;
  }
  if(field==="creator-density"){
    state.creator.density=Number(value);updateRangeOutput(event.target,value+"%");return;
  }
  if(field==="editor-seek"){
    state.editorPlayhead=Number(value)||0;
    syncVideo(document.getElementById("editor-video"),state.editingProject,state.editorPlayhead,false);
    drawEditorTimeline();return;
  }
  if(field==="selected-note-time"||field==="selected-note-duration"){
    const note=state.editorChart&&state.editorChart.notes.find(n=>n.id===state.editorSelectedId);if(!note)return;
    pushUndo();
    if(field==="selected-note-time")note.time=Math.max(0,Math.min(state.editingProject.duration,Number(value)||0));
    else note.duration=Math.max(.05,Math.min(12,Number(value)||.05));
    drawEditorTimeline();return;
  }
  if(field==="editor-video-offset"){
    if(state.editingProject){state.editingProject.sync=state.editingProject.sync||{};state.editingProject.sync.videoOffset=Number(value)||0;}
    return;
  }
  if(field==="editor-video-opacity"){
    if(state.editingProject){state.editingProject.sync=state.editingProject.sync||{};state.editingProject.sync.videoOpacity=Number(value)||state.settings.videoOpacity;}
    syncVideo(document.getElementById("editor-video"),state.editingProject,Number(state.editorPlayhead)||0,false);
    updateRangeOutput(event.target,value+"%");return;
  }
  if(field==="editor-video-blur"){
    if(state.editingProject){state.editingProject.sync=state.editingProject.sync||{};state.editingProject.sync.videoBlur=Number(value)||0;}
    syncVideo(document.getElementById("editor-video"),state.editingProject,Number(state.editorPlayhead)||0,false);
    updateRangeOutput(event.target,value+" px");return;
  }
  if(field==="preview-video-offset"){
    if(state.previewSong){state.previewSong.sync=state.previewSong.sync||{};state.previewSong.sync.videoOffset=Number(value)||0;}
    return;
  }
  if(field==="preview-seek"){
    const time=Number(value)||0;
    if(!transport.playing){transport.position=time;if(transport.element)transport.element.currentTime=time;}
    syncVideo(document.getElementById("preview-video"),state.previewSong,time,false);
    return;
  }
  if(field==="song-video-opacity"||field==="song-video-blur"){
    const song=detailSong();if(!song)return;song.sync=song.sync||{};
    if(field==="song-video-opacity"){song.sync.videoOpacity=Number(value);updateRangeOutput(event.target,value+"%");}
    else {song.sync.videoBlur=Number(value);updateRangeOutput(event.target,value+" px");}
    persistSongSync(song);return;
  }
}
function updateRangeOutput(input,value){
  const output=input.parentElement.querySelector("output");
  if(output)output.textContent=value;
}
function handleChange(event) {
  const target=event.target,field=target.dataset.field;
  if(target.id==="audio-file"||target.id==="video-file"||target.id==="cover-file"||target.id==="chart-file"){
    const file=target.files&&target.files[0];if(!file)return;
    const c=state.creator||(state.creator=emptyCreator());
    const type={ "audio-file":"audio","video-file":"video","cover-file":"image","chart-file":"chart"}[target.id];
    const max={audio:250,video:600,image:8,chart:2}[type]*1024*1024;
    if(!fileAccepted(file,type,max)){target.value="";return;}
    if(type==="audio"){
      c.audioFile=file;c.audioName=file.name;c.title=c.title||file.name.replace(/\.[^.]+$/,"");c.duration=0;
      setCreatorStatus("Reading MP3 metadata…");render();updateAudioDuration(file);return;
    }
    if(type==="video"){c.videoFile=file;c.videoName=file.name;setCreatorStatus("MP4 selected · playback will follow the independent video offset.");render();return;}
    if(type==="image"){
      c.coverFile=file;
      fileAsDataUrl(file).then(function(data){c.coverDataUrl=data;setCreatorStatus("Cover image ready.");render();}).catch(e=>toast("Cover could not be read: "+e.message,"error"));
      render();return;
    }
    if(type==="chart"){c.chartFile=file;render();loadImportedChart(file);return;}
  }
  if(field==="library-sort"){state.sort=target.value;render();return;}
  if(field==="library-mood"){state.mood=target.value;render();return;}
  if(field==="library-mode"){state.modeFilter=target.value;render();return;}
  if(field==="setting-video-fit"){state.settings.videoFit=target.value;saveSetting("settings",state.settings);return;}
  if(field==="setting-video-visible"){state.settings.videoVisible=target.checked;saveSetting("settings",state.settings);return;}
  if(field==="creator-mode"){state.creator.mode=target.value;return;}
  if(field==="creator-difficulty"){state.creator.difficulty=target.value;return;}
  if(field==="creator-snap"){state.creator.snap=Number(target.value);return;}
  if(field==="creator-video-fit"){state.creator.videoFit=target.value;syncMakerVideo();return;}
  if(field==="maker-visible"){state.creator.videoVisible=target.checked;syncMakerVideo();return;}
  if(field==="editor-mode"){
    if(state.editorChart.notes.length){toast("This chart already has notes. Save it, then create a new chart to use another mode.","error");target.value=state.editorChart.mode;return;}
    state.editorChart.mode=target.value;state.editorChart.notes=[];state.editorSelectedId=null;render();return;
  }
  if(field==="editor-difficulty"){state.editorChart.difficulty=target.value;return;}
  if(field==="editor-bpm"){state.editorChart.bpm=Math.max(40,Math.min(240,Number(target.value)||112));drawEditorTimeline();return;}
  if(field==="editor-offset"){state.editorChart.offset=Number(target.value)||0;return;}
  if(field==="editor-snap"){state.editorSnap=Number(target.value);return;}
  if(field==="editor-speed"){
    const speed=Number(target.value)||1;
    const current=transport.playing?songMediaTime():transport.position;
    if(transport.playing&&transport.kind==="builtin"){transport.position=current;transport.startedAt=transport.context.currentTime;}
    state.editorPlaybackRate=speed;transport.rate=speed;
    if(transport.element)transport.element.playbackRate=speed;
    if(transport.source)transport.source.playbackRate.value=speed;
    return;
  }
  if(field==="selected-note-lane"){
    const note=state.editorChart.notes.find(n=>n.id===state.editorSelectedId);if(note){pushUndo();note.lane=Number(target.value);drawEditorTimeline();}return;
  }
  if(field==="selected-note-position"){
    const note=state.editorChart.notes.find(n=>n.id===state.editorSelectedId);if(note){pushUndo();const pos=target.value.split(",");note.x=Number(pos[0]);note.y=Number(pos[1]);drawEditorTimeline();}return;
  }
  if(field==="song-offset"||field==="song-video-offset"){
    const song=detailSong();if(!song)return;
    song.sync=song.sync||{};
    if(field==="song-offset")song.sync.chartOffset=Number(target.value)||0;
    else song.sync.videoOffset=Number(target.value)||0;
    persistSongSync(song);
    return;
  }
  if(field==="preview-video-offset"){if(state.previewSong){state.previewSong.sync=state.previewSong.sync||{};state.previewSong.sync.videoOffset=Number(target.value)||0;
    syncVideo(document.getElementById("preview-video"),state.previewSong,songMediaTime(),transport.playing);}return;}
  if(field==="song-video-visible"){
    const song=detailSong();if(song){song.sync=song.sync||{};song.sync.videoVisible=target.checked;persistSongSync(song);}return;
  }
  if(field==="editor-video-visible"){
    if(state.editingProject){state.editingProject.sync=state.editingProject.sync||{};state.editingProject.sync.videoVisible=target.checked;
      syncVideo(document.getElementById("editor-video"),state.editingProject,Number(state.editorPlayhead)||0,false);}
    return;
  }
  if(field==="preview-seek"){
    const time=Number(target.value)||0;
    if(state.screen==="preview"&&transport.playing)seekTransport(time);
    else {transport.position=time;if(transport.element)transport.element.currentTime=time;}
    return;
  }
  if(field==="editor-seek"){
    const time=Number(target.value)||0;state.editorPlayhead=time;
    if(state.editorPlaying)seekTransport(time);else transport.position=time;
    drawEditorTimeline();return;
  }
}

function syncMakerVideo() {
  const audio=document.getElementById("maker-audio"),video=document.getElementById("maker-video");
  if(!video||!state.creator)return;
  video.style.opacity=String(Number(state.creator.videoOpacity||state.settings.videoOpacity)/100);
  video.style.objectFit=state.creator.videoFit||"cover";
  video.style.display=state.creator.videoVisible===false||state.settings.videoVisible===false?"none":"";
  video.style.filter="blur("+Number(state.creator.videoBlur||0)+"px) brightness(.58)";
  if(state.creator.videoVisible===false||state.settings.videoVisible===false){video.pause();return;}
  const target=(audio?audio.currentTime:0)+Number(state.creator.videoOffset||0);
  if(target<0||Number.isFinite(video.duration)&&target>=video.duration){video.pause();return;}
  if(Math.abs(video.currentTime-target)>.22){try{video.currentTime=target;}catch(_){}}
  if(audio&&!audio.paused&&video.paused)video.play().catch(function(){});
  if((!audio||audio.paused)&&!video.paused)video.pause();
}
function bindCreatorPreview() {
  const audio=document.getElementById("maker-audio"),video=document.getElementById("maker-video");
  if(audio){
    audio.volume=.8;
    audio.onloadedmetadata=function(){
      if(state.creator&&Number.isFinite(audio.duration)&&audio.duration>0){
        state.creator.duration=audio.duration;
        const duration=document.getElementById("maker-duration");if(duration)duration.textContent=fmtTime(audio.duration);
      }
    };
    audio.onplay=function(){syncMakerVideo();};
    audio.onpause=function(){if(video)video.pause();};
    audio.ontimeupdate=function(){
      const current=document.getElementById("maker-time");if(current)current.textContent=fmtClock(audio.currentTime);
      syncMakerVideo();
    };
    audio.onseeked=syncMakerVideo;
  }
  if(video){
    video.style.opacity=String(Number(state.creator&&state.creator.videoOpacity||state.settings.videoOpacity)/100);
    video.style.objectFit=(state.creator&&state.creator.videoFit)||"cover";
    video.style.display=state.creator&&state.creator.videoVisible===false||state.settings.videoVisible===false?"none":"";
    video.onerror=function(){setCreatorStatus("The selected MP4 could not be decoded by this browser. Try another MP4 encoding.",true);};
    video.onloadedmetadata=syncMakerVideo;
  }
}
function bindEditorMedia() {
  const video=document.getElementById("editor-video");
  if(video){
    const sync=state.editingProject&&state.editingProject.sync||{};
    video.style.opacity=String(Number(sync.videoOpacity||state.settings.videoOpacity)/100);
    video.style.objectFit=sync.videoFit||state.settings.videoFit;
    syncVideo(video,state.editingProject,Number(state.editorPlayhead)||0,false);
    video.onerror=function(){toast("This browser could not decode the project video.", "error");};
  }
}
function bindGameCanvas() {
  const canvas=document.getElementById("game-canvas");
  if(!canvas)return;
  if(state.game&&state.game.chart.mode==="circle"){
    canvas.addEventListener("pointerdown",function(event){event.preventDefault();circleHit(event);});
  }else if(state.game&&state.game.chart.mode==="lanes"){
    state.game.pointerLanes=new Map();
    canvas.addEventListener("pointerdown",function(event){
      const rect=canvas.getBoundingClientRect(),relative=(event.clientX-rect.left)/rect.width;
      const fieldWidth=.66,left=(1-fieldWidth)/2;
      if(relative<left||relative>left+fieldWidth)return;
      const lane=Math.max(0,Math.min(3,Math.floor((relative-left)/fieldWidth*4)));
      state.game.pointerLanes.set(event.pointerId,lane);state.game.heldLanes.add(lane);
      laneHit(lane);try{canvas.setPointerCapture(event.pointerId);}catch(_){}
      event.preventDefault();
    });
    const release=function(event){
      if(!state.game||!state.game.pointerLanes)return;
      const lane=state.game.pointerLanes.get(event.pointerId);
      if(lane!==undefined){state.game.pointerLanes.delete(event.pointerId);laneRelease(lane);}
    };
    canvas.addEventListener("pointerup",release);
    canvas.addEventListener("pointercancel",release);
  }
}

function handlePointerDown(event) {
  if(event.target&&event.target.id==="chart-timeline")timelinePointer(event);
}
function handlePointerMove(event) {
  if(state.editorDrag)moveTimelinePointer(event);
}
function handlePointerUp() { endTimelineDrag(); }
function handleKeyDown(event) {
  const tag=event.target&&event.target.tagName;
  const typing=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||event.target.isContentEditable;
  if(state.screen==="editor"&&!typing){
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();editorUndo(event.shiftKey?"redo":"undo");return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();editorUndo("redo");return;}
    if(event.code==="Space"){event.preventDefault();toggleEditorPlayback();return;}
    if(event.key==="Delete"||event.key==="Backspace"){
      if(state.editorSelectedId){event.preventDefault();const b=document.querySelector('[data-action="editor-delete"]');if(b)b.click();}
      return;
    }
  }
  if(state.screen==="game"&&state.game&&!state.game.paused&&!typing&&state.game.chart.mode==="lanes"){
    const key=event.key.toLowerCase(),lane=["d","f","j","k"].indexOf(key);
    if(lane>=0){event.preventDefault();if(event.repeat)return;state.game.heldLanes.add(lane);laneHit(lane);}
  }
}
function handleKeyUp(event) {
  if(state.screen==="game"&&state.game&&state.game.chart.mode==="lanes"){
    const lane=["d","f","j","k"].indexOf(event.key.toLowerCase());
    if(lane>=0)laneRelease(lane);
  }
}
function persistSongSync(song) {
  if(!song)return;
  song.sync=song.sync||{};
  if(isSeedSong(song)){state.songSync[song.id]=song.sync;saveSetting("sync:"+song.id,song.sync);}
  else saveProject(song);
}
window.addEventListener("blur",function(){
  if(state.screen==="game"&&state.game&&!state.game.paused)pauseGame();
});
app.addEventListener("click",handleAction);
app.addEventListener("input",handleInput);
app.addEventListener("change",handleChange);
app.addEventListener("pointerdown",handlePointerDown);
app.addEventListener("pointermove",handlePointerMove);
app.addEventListener("pointerup",handlePointerUp);
app.addEventListener("pointercancel",handlePointerUp);
document.addEventListener("keydown",handleKeyDown);
document.addEventListener("keyup",handleKeyUp);
document.addEventListener("change",function(event){
  if(event.target&&event.target.id==="backup-import"){
    const file=event.target.files&&event.target.files[0];
    if(file)importBackup(file);
    event.target.value="";
  }
});

render();
loadLibrary();


