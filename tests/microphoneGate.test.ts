import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { DEFAULT_PTT_SETTINGS, PttState } from "../src/ptt/types";

function fixture() {
  let now = 0;
  let state: PttState = {
    settings: DEFAULT_PTT_SETTINGS,
    talking: false,
    available: true,
    error: null,
  };
  const listeners: ((state: PttState) => void)[] = [];
  const intervals: (() => void)[] = [];
  class Track {
    actual = true;
    readyState = "live";
    constructor(public kind = "audio") {}
    get enabled() {
      return this.actual;
    }
    set enabled(value: boolean) {
      this.actual = value;
    }
    clone() {
      const track = new Track(this.kind);
      track.actual = this.actual;
      return track;
    }
    addEventListener(): void {
      return;
    }
  }
  const nativeClone = Track.prototype.clone;
  class Stream {
    constructor(private tracks: Track[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks.filter((track) => track.kind === "audio");
    }
    clone() {
      return new Stream(this.tracks.map((track) => nativeClone.call(track)));
    }
  }
  const window = {
    stoatPTT: {
      getState: () => state,
      subscribe: (listener: (state: PttState) => void) =>
        listeners.push(listener),
    },
    addEventListener(): void {
      return;
    },
    stoatPTTMedia: undefined as unknown as Window["stoatPTTMedia"],
  };
  const mediaDevices = {
    getUserMedia: async () => new Stream([new Track(), new Track("video")]),
    getDisplayMedia: async () => new Stream([new Track()]),
  };
  const compiled = ts.transpileModule(
    fs.readFileSync("src/ptt/microphoneGate.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  vm.runInNewContext(`${compiled}; exports.installMicrophoneGate()`, {
    exports: {},
    window,
    navigator: { mediaDevices },
    MediaStreamTrack: Track,
    MediaStream: Stream,
    performance: { now: () => now },
    setInterval: (callback: () => void) => intervals.push(callback),
  });
  return {
    window,
    mediaDevices,
    update: (next: Partial<PttState>) => {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener(state));
    },
    elapse: (duration: number) => {
      now += duration;
      intervals.forEach((callback) => callback());
    },
  };
}

test("microphones are silent before getUserMedia resolves; video is unchanged", async () => {
  const f = fixture();
  const stream = await f.mediaDevices.getUserMedia();
  assert.equal(stream.getAudioTracks()[0].actual, false);
  assert.equal(stream.getTracks()[1].actual, true);
  // Logical enabled preserves Stoat's own manual mute state.
  assert.equal(stream.getAudioTracks()[0].enabled, true);
  f.update({ talking: true });
  assert.equal(stream.getAudioTracks()[0].actual, true);
  f.update({ talking: false });
  assert.equal(stream.getAudioTracks()[0].actual, false);
});

test("Stoat cannot override PTT and manual mute survives presses and disabling PTT", async () => {
  const f = fixture();
  const track = (await f.mediaDevices.getUserMedia()).getAudioTracks()[0];
  track.enabled = true;
  assert.equal(track.actual, false);
  track.enabled = false;
  f.update({ talking: true });
  assert.equal(track.actual, false);
  f.update({ settings: { ...DEFAULT_PTT_SETTINGS, enabled: false } });
  assert.equal(track.actual, false);
  track.enabled = true;
  assert.equal(track.actual, true);
  f.update({ settings: DEFAULT_PTT_SETTINGS, talking: false });
  assert.equal(track.actual, false);
});

test("track clones and stream clones inherit gating and their logical mute state", async () => {
  const f = fixture();
  const stream = await f.mediaDevices.getUserMedia();
  const track = stream.getAudioTracks()[0];
  const clone = track.clone();
  const streamClone = stream.clone().getAudioTracks()[0];
  assert.equal(clone.actual, false);
  assert.equal(streamClone.actual, false);
  f.update({ talking: true });
  assert.equal(clone.actual, true);
  assert.equal(streamClone.actual, true);
  track.enabled = false;
  assert.equal(track.clone().actual, false);
});

test("replacement microphones are gated, screen share audio is untouched", async () => {
  const f = fixture();
  await f.mediaDevices.getUserMedia();
  const replacement = await f.mediaDevices.getUserMedia();
  assert.equal(replacement.getAudioTracks()[0].actual, false);
  const screen = await f.mediaDevices.getDisplayMedia();
  assert.equal(screen.getAudioTracks()[0].actual, true);
});

test("lost IPC heartbeat and failed keyboard hook close an open microphone", async () => {
  const f = fixture();
  const track = (await f.mediaDevices.getUserMedia()).getAudioTracks()[0];
  f.update({ talking: true });
  assert.equal(track.actual, true);
  f.elapse(1001);
  assert.equal(track.actual, false);
  f.update({ talking: true });
  assert.equal(track.actual, true);
  f.update({ available: false });
  assert.equal(track.actual, false);
});
