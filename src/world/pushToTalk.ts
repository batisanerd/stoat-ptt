import { contextBridge, ipcRenderer } from "electron";

import { installMicrophoneGate } from "../ptt/microphoneGate";
import { installPttOverlay } from "../ptt/overlay";
import {
  DEFAULT_PTT_SETTINGS,
  PTT_KEYS,
  PttSettings,
  PttState,
} from "../ptt/types";

let state: PttState = ipcRenderer.sendSync("ptt:get") || {
  settings: DEFAULT_PTT_SETTINGS,
  talking: false,
  available: false,
  error: "Waiting for desktop keyboard hook.",
};
const listeners = new Set<(state: PttState) => void>();
ipcRenderer.on("ptt:state", (_event, next: PttState) => {
  state = next;
  for (const listener of listeners) listener(next);
});
contextBridge.exposeInMainWorld("stoatPTT", {
  getState: () => state,
  keys: PTT_KEYS,
  subscribe: (listener: (state: PttState) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  configure: (settings: PttSettings) =>
    ipcRenderer.invoke("ptt:configure", settings),
});

// This synchronous injection runs before any of Stoat's scripts can request audio.
contextBridge.executeInMainWorld({ func: installMicrophoneGate });
ipcRenderer.send("ptt:ready");
contextBridge.executeInMainWorld({ func: installPttOverlay });
