"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function createOfflineAudioContext() {
  function param() {
    return {
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {}
    };
  }
  function node() {
    return { connect() {}, disconnect() {} };
  }
  return class OfflineAudioContext {
    constructor(channels, length, sampleRate) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.destination = node();
    }
    createGain() { const out = node(); out.gain = param(); return out; }
    createDynamicsCompressor() {
      const out = node(); out.threshold = param(); out.knee = param(); out.ratio = param(); return out;
    }
    createOscillator() {
      const out = node(); out.frequency = param(); out.start = () => {}; out.stop = () => {}; return out;
    }
    createBiquadFilter() { const out = node(); out.frequency = param(); return out; }
    startRendering() { return Promise.resolve({ duration: this.length / this.sampleRate, numberOfChannels: this.channels }); }
  };
}

function loadApp() {
  const appNode = { innerHTML: "", addEventListener() {} };
  const mainNode = { innerHTML: "" };
  const toastNode = { appendChild() {} };
  const document = {
    getElementById(id) { return id === "app" ? appNode : id === "main-view" ? mainNode : id === "toast-root" ? toastNode : null; },
    addEventListener() {},
    querySelector() { return null; },
    createElement() { return { className: "", textContent: "", remove() {} }; }
  };
  const webCrypto = { randomUUID: crypto.randomUUID };
  const window = {
    crypto: webCrypto,
    OfflineAudioContext: createOfflineAudioContext(),
    addEventListener() {},
    devicePixelRatio: 1
  };
  const sandbox = {
    document, window, crypto: webCrypto, console, Date, Math, Number, String, Array, Object, Set, Map, JSON, Promise,
    URL, Blob, FileReader: class {}, TextEncoder, atob, performance: { now: () => 1 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const exposed = "\nglobalThis.__echoTest = { state, BUILTINS, MODES, validateChart, currentChartTime, addJudgement, buildBuiltinBuffer, renderHome, renderLibrary, renderDetail, getSong };";
  vm.runInNewContext(source + exposed, sandbox, { filename: "app.js" });
  return { api: sandbox.__echoTest, mainNode };
}

test("built-in charts validate for their declared modes", () => {
  const { api } = loadApp();
  assert.equal(api.BUILTINS.length, 3);
  for (const song of api.BUILTINS) {
    assert.equal(song.duration, 48);
    assert.equal(song.charts.length, 2);
    for (const chart of song.charts) {
      assert.deepEqual(Array.from(api.validateChart(chart, song)), []);
    }
  }
});

test("chart validator rejects invalid lanes, negative time, and contradictory holds", () => {
  const { api } = loadApp();
  const song = { id: "test", duration: 10 };
  const chart = {
    id: "bad", songId: "test", mode: "lanes", difficulty: "Normal", version: "1.0.0", offset: 0,
    notes: [
      { id: "a", time: -1, type: "tap", lane: 5 },
      { id: "b", time: 1, type: "hold", lane: 0, duration: 2 },
      { id: "c", time: 2, type: "tap", lane: 0 }
    ]
  };
  const errors = Array.from(api.validateChart(chart, song));
  assert.ok(errors.some(error => error.includes("negative timestamp")));
  assert.ok(errors.some(error => error.includes("lane must be")));
  assert.ok(errors.some(error => error.includes("overlapping")));
});

test("circle validation rejects positions outside normalized playfield space", () => {
  const { api } = loadApp();
  const chart = {
    id: "circle", songId: "test", mode: "circle", difficulty: "Normal", version: "1.0.0",
    notes: [{ id: "n1", time: 1, type: "tap", x: 1.2, y: .5 }]
  };
  assert.ok(Array.from(api.validateChart(chart, { id: "test", duration: 10 })).some(error => error.includes("normalized")));
});

test("original starter audio can be synthesized through the offline audio graph", async () => {
  const { api } = loadApp();
  const buffer = await api.buildBuiltinBuffer(api.BUILTINS[0]);
  assert.equal(buffer.duration, 48);
  assert.equal(buffer.numberOfChannels, 2);
});

test("judgments update actual score, combo, and accuracy state", () => {
  const { api } = loadApp();
  api.state.game = { counts: { perfect: 0, great: 0, good: 0, miss: 0 }, accuracyWeighted: 0, accuracyEvents: 0, combo: 0, maxCombo: 0, score: 0, effects: [] };
  api.addJudgement("perfect", true);
  api.addJudgement("great", true);
  api.addJudgement("miss", false);
  assert.equal(api.state.game.score, 1706);
  assert.equal(api.state.game.combo, 0);
  assert.equal(api.state.game.maxCombo, 2);
  assert.equal(api.state.game.counts.miss, 1);
  assert.equal(api.state.game.accuracyEvents, 3);
  assert.ok(Math.abs(api.state.game.accuracyWeighted - 1.8) < 1e-9);
});

test("home and detail screens render song and chart choices", () => {
  const { api, mainNode } = loadApp();
  api.renderHome(mainNode);
  assert.match(mainNode.innerHTML, /ECHO\/\/VOID/);
  assert.match(mainNode.innerHTML, /Afterimage/);
  api.state.selectedSongId = api.BUILTINS[0].id;
  api.renderDetail(mainNode);
  assert.match(mainNode.innerHTML, /Charts &amp; difficulties/);
  assert.match(mainNode.innerHTML, /Four-lane/);
  assert.match(mainNode.innerHTML, /Circle/);
});
