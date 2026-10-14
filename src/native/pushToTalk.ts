import type { UiohookKeyboardEvent, UiohookMouseEvent } from "uiohook-napi";

import {
  BrowserWindow,
  app,
  ipcMain,
  powerMonitor,
  systemPreferences,
} from "electron";
import Store from "electron-store";

import { PttController } from "../ptt/controller";
import {
  DEFAULT_PTT_SETTINGS,
  PttSettings,
  PttState,
  mouseBindingButton,
  validateSettings,
} from "../ptt/types";

let activeSettings = DEFAULT_PTT_SETTINGS;

export function isPttKeyboardShortcut(input: Electron.Input) {
  return (
    activeSettings.enabled &&
    input.key.toUpperCase() ===
      (activeSettings.key === "Space" ? " " : activeSettings.key) &&
    input.control === activeSettings.ctrl &&
    input.shift === activeSettings.shift &&
    input.alt === activeSettings.alt &&
    !input.meta
  );
}

export function initPushToTalk(window: BrowserWindow) {
  const store = new Store<{ settings: PttSettings }>({
    name: "push-to-talk",
    defaults: { settings: DEFAULT_PTT_SETTINGS },
  }) as unknown as {
    get(key: "settings"): unknown;
    set(key: "settings", settings: PttSettings): void;
  };
  let settings: PttSettings;
  try {
    settings = validateSettings(store.get("settings"));
  } catch {
    settings = { ...DEFAULT_PTT_SETTINGS };
  }
  let state: PttState = {
    settings,
    talking: false,
    available: false,
    error: null,
  };
  activeSettings = settings;
  let hook: typeof import("uiohook-napi") | undefined;
  let running = false;
  let suspended = false;
  let gateReady = false;
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      contents === window.webContents &&
      (permission !== "media" || (gateReady && details.isMainFrame)),
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        contents === window.webContents &&
          (permission !== "media" || (gateReady && details.isMainFrame)),
      );
    },
  );

  const publish = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("ptt:state", state);
    }
  };
  const controller = new PttController(settings, (talking) => {
    state = { ...state, talking };
    publish();
  });
  const reset = () => {
    controller.reset();
    state = { ...state, talking: false };
    publish();
  };
  const onInput = (event: UiohookKeyboardEvent, down: boolean) => {
    if (!hook || suspended || !running) return;
    const keys = hook.UiohookKey;
    // libuiohook can report modifiers before their key-up has taken effect.
    const ctrl =
      event.ctrlKey &&
      (down ||
        (event.keycode !== keys.Ctrl && event.keycode !== keys.CtrlRight));
    const shift =
      event.shiftKey &&
      (down ||
        (event.keycode !== keys.Shift && event.keycode !== keys.ShiftRight));
    const alt =
      event.altKey &&
      (down || (event.keycode !== keys.Alt && event.keycode !== keys.AltRight));
    const matches =
      ctrl === settings.ctrl &&
      shift === settings.shift &&
      alt === settings.alt &&
      !event.metaKey;
    controller.input(
      event.keycode === keys[settings.key as keyof typeof keys],
      down,
      matches,
    );
  };
  const keydown = (event: UiohookKeyboardEvent) => onInput(event, true);
  const keyup = (event: UiohookKeyboardEvent) => onInput(event, false);
  const onMouse = (event: UiohookMouseEvent, down: boolean) => {
    if (!hook || suspended || !running) return;
    const matches =
      event.ctrlKey === settings.ctrl &&
      event.shiftKey === settings.shift &&
      event.altKey === settings.alt &&
      !event.metaKey;
    const button = mouseBindingButton(settings.key);
    controller.input(
      button !== undefined && event.button === button,
      down,
      matches,
    );
  };
  const mousedown = (event: UiohookMouseEvent) => onMouse(event, true);
  const mouseup = (event: UiohookMouseEvent) => onMouse(event, false);
  // Side buttons must not navigate away from a call when Stoat is focused.
  window.on("app-command", (event, command) => {
    if (
      settings.enabled &&
      ((settings.key === "Mouse4" && command === "browser-backward") ||
        (settings.key === "Mouse5" && command === "browser-forward"))
    )
      event.preventDefault();
  });

  const stop = () => {
    reset();
    if (running && hook) {
      running = false;
      hook.uIOhook.stop();
    }
  };
  const start = () => {
    state = { ...state, available: false, error: null };
    if (!settings.enabled) {
      publish();
      return;
    }
    try {
      if (
        process.platform === "linux" &&
        (process.env.WAYLAND_DISPLAY ||
          process.env.XDG_SESSION_TYPE === "wayland")
      ) {
        throw new Error(
          "Global PTT requires an X11 session on Linux. Your microphone stays muted.",
        );
      }
      if (
        process.platform === "darwin" &&
        !systemPreferences.isTrustedAccessibilityClient(false)
      ) {
        throw new Error(
          "Allow Stoat PTT in System Settings > Privacy & Security > Accessibility, then restart. Your microphone stays muted.",
        );
      }
      if (!hook) {
        // Keep the native addon external so Forge includes its prebuilt binary.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        hook = require("uiohook-napi") as typeof import("uiohook-napi");
        hook.uIOhook.on("keydown", keydown);
        hook.uIOhook.on("keyup", keyup);
        hook.uIOhook.on("mousedown", mousedown);
        hook.uIOhook.on("mouseup", mouseup);
      }
      if (!running) {
        hook.uIOhook.start();
        running = true;
      }
      state = { ...state, available: true };
    } catch (error) {
      reset();
      state = {
        ...state,
        available: false,
        error:
          error instanceof Error
            ? error.message
            : "Global input hook failed. Microphone muted.",
      };
      console.error("PTT unavailable:", state.error);
    }
    publish();
  };

  const trusted = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) =>
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame;
  const getState = (event: Electron.IpcMainEvent) => {
    if (trusted(event)) event.returnValue = state;
  };
  ipcMain.on("ptt:get", getState);
  const ready = (event: Electron.IpcMainEvent) => {
    if (trusted(event)) gateReady = true;
  };
  ipcMain.on("ptt:ready", ready);
  ipcMain.handle("ptt:configure", (event, value: unknown) => {
    if (!trusted(event)) throw new Error("Invalid PTT settings sender.");
    const next = validateSettings(value);
    reset();
    store.set("settings", next);
    settings = next;
    activeSettings = settings;
    controller.configure(settings);
    state = { ...state, settings, talking: false };
    if (!settings.enabled) stop();
    start();
    return state;
  });
  const suspend = () => {
    suspended = true;
    reset();
  };
  const resume = () => {
    suspended = false;
    reset();
  };
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("lock-screen", suspend);
  powerMonitor.on("resume", resume);
  powerMonitor.on("unlock-screen", resume);
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) {
        gateReady = false;
        reset();
      }
    },
  );
  window.webContents.on("render-process-gone", reset);
  window.webContents.on("did-finish-load", publish);
  // A short lease lets the renderer close the gate if IPC stops arriving.
  const heartbeat = setInterval(publish, 250);
  const dispose = () => {
    clearInterval(heartbeat);
    stop();
    hook?.uIOhook.removeListener("keydown", keydown);
    hook?.uIOhook.removeListener("keyup", keyup);
    hook?.uIOhook.removeListener("mousedown", mousedown);
    hook?.uIOhook.removeListener("mouseup", mouseup);
    ipcMain.removeListener("ptt:get", getState);
    ipcMain.removeListener("ptt:ready", ready);
    ipcMain.removeHandler("ptt:configure");
    powerMonitor.removeListener("suspend", suspend);
    powerMonitor.removeListener("resume", resume);
    powerMonitor.removeListener("lock-screen", suspend);
    powerMonitor.removeListener("unlock-screen", resume);
    app.removeListener("before-quit", stop);
  };
  window.once("closed", dispose);
  app.once("before-quit", stop);
  start();
}
