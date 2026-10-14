import type { PttState } from "./types";

/** Serialized into the page before its scripts run. Keep this self-contained. */
export function installMicrophoneGate() {
  const api = window.stoatPTT;
  let state: PttState = api.getState();
  let lastUpdate = performance.now();
  const tracks = new Map<MediaStreamTrack, boolean>();
  const descriptor = Object.getOwnPropertyDescriptor(
    MediaStreamTrack.prototype,
    "enabled",
  );
  if (!descriptor?.get || !descriptor.set || !navigator.mediaDevices) {
    throw new Error("Microphone gate cannot be installed.");
  }
  const read = descriptor.get;
  const write = descriptor.set;
  const allowed = () =>
    !state.settings.enabled ||
    (state.available && state.talking && performance.now() - lastUpdate < 1000);
  const apply = () => {
    for (const [track, requested] of tracks) {
      if (track.readyState === "ended") tracks.delete(track);
      else write.call(track, requested && allowed());
    }
  };
  const trackMicrophone = (
    track: MediaStreamTrack,
    requested = read.call(track) as boolean,
  ) => {
    if (track.kind !== "audio" || tracks.has(track)) return;
    tracks.set(track, requested);
    // Silence before returning the stream to the caller or any WebRTC sender.
    write.call(track, requested && allowed());
    track.addEventListener("ended", () => tracks.delete(track), { once: true });
  };
  Object.defineProperty(MediaStreamTrack.prototype, "enabled", {
    ...descriptor,
    get() {
      // Preserve the web client's manual mute state separately from the PTT gate.
      return tracks.has(this) ? tracks.get(this) : read.call(this);
    },
    set(value: boolean) {
      if (tracks.has(this)) {
        tracks.set(this, Boolean(value));
        write.call(this, Boolean(value) && allowed());
      } else write.call(this, value);
    },
  });
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async function (
    this: MediaDevices,
    constraints,
  ) {
    const stream: MediaStream = await originalGetUserMedia.call(
      this,
      constraints,
    );
    stream.getAudioTracks().forEach((track) => trackMicrophone(track));
    return stream;
  };
  const originalClone = MediaStreamTrack.prototype.clone;
  MediaStreamTrack.prototype.clone = function (this: MediaStreamTrack) {
    const clone = originalClone.call(this);
    if (tracks.has(this)) trackMicrophone(clone, tracks.get(this));
    return clone;
  };
  // MediaStream.clone() clones tracks internally without invoking the JS method.
  const originalStreamClone = MediaStream.prototype.clone;
  MediaStream.prototype.clone = function (this: MediaStream) {
    const clone = originalStreamClone.call(this);
    this.getTracks().forEach((source, index) => {
      if (tracks.has(source))
        trackMicrophone(clone.getTracks()[index], tracks.get(source));
    });
    return clone;
  };
  api.subscribe((next) => {
    state = next;
    lastUpdate = performance.now();
    apply();
  });
  setInterval(apply, 100);
  window.addEventListener("pagehide", () => {
    state = { ...state, talking: false };
    apply();
  });
  window.stoatPTTMedia = Object.freeze({
    status: () => {
      apply();
      const live = [...tracks].filter(([track]) => track.readyState === "live");
      return {
        microphones: live.length,
        transmitting: live.filter(([track]) => read.call(track)).length,
        clientMuted:
          live.length > 0 && live.every(([, requested]) => !requested),
      };
    },
  });
}
