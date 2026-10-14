import type { PttSettings, PttState } from "./types";

/** Runs in the page, with a shadow root to isolate styles from Stoat. */
export function installPttOverlay() {
  const api = window.stoatPTT;
  // Chromium also exposes side buttons as DOM buttons 3 (Back) and 4 (Forward).
  for (const name of [
    "mousedown",
    "mouseup",
    "auxclick",
    "click",
    "pointerdown",
    "pointerup",
  ]) {
    window.addEventListener(
      name,
      (event) => {
        const settings = api.getState().settings;
        const button = (event as MouseEvent).button;
        if (
          settings.enabled &&
          ((settings.key === "Mouse4" && button === 3) ||
            (settings.key === "Mouse5" && button === 4))
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }
  const mount = () => {
    if (document.getElementById("stoat-ptt-controls")) return;
    const host = document.createElement("div");
    host.id = "stoat-ptt-controls";
    host.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:2147483647;-webkit-app-region:no-drag";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{color-scheme:dark;font:14px/1.5 system-ui,sans-serif;color:#eaf0ee}
        *{box-sizing:border-box}button,input,select{font:inherit}button,select,input{color:inherit}
        button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #8de5bb;outline-offset:3px}
        .pill{display:flex;gap:10px;align-items:center;background:#202925;border:1px solid #43574b;border-radius:28px;padding:10px 16px;box-shadow:0 6px 24px #0006}
        .dot{width:9px;height:9px;border-radius:50%;background:#9ba9a2;flex:none}.talking .dot{background:#8de5bb;box-shadow:0 0 14px #8de5bb80}
        .talking{border-color:#8de5bb}.error .dot{background:#ffb4a6}.key{font-size:11px;color:#b7c4be;border:1px solid #57655e;border-radius:5px;padding:1px 5px}
        .panel{position:absolute;right:0;bottom:58px;width:min(350px,calc(100vw - 36px));max-height:calc(100vh - 100px);overflow:auto;background:#1b211e;border:1px solid #43574b;border-radius:16px;padding:22px;box-shadow:0 12px 48px #0008}
        [hidden]{display:none!important}h2{font-size:19px;letter-spacing:-.5px;margin:0 0 4px}p{color:#aebdb4;font-size:13px;margin:0 0 18px}
        label{display:flex;gap:9px;align-items:center;margin:14px 0}.field{display:block}.field span{display:block;margin-bottom:6px}
        select,input[type=number]{display:block;width:100%;background:#101713;border:1px solid #43574b;border-radius:8px;padding:9px 11px}input[type=checkbox]{accent-color:#8de5bb}
        .mods{display:flex;gap:17px}.mods label{margin-top:0}.save{border:0;border-radius:9px;background:#8de5bb;color:#0b2618;font-weight:650;padding:10px 18px;width:100%}
        .close{float:right;background:none;border:0;color:#aebdb4;font-size:20px;padding:0 0 4px 10px}.note{margin:14px 0 0;font-size:12px}.notice{color:#ffb4a6;white-space:pre-wrap;margin:12px 0 0}
      </style>
      <section class="panel" hidden role="dialog" aria-label="Push to talk settings">
        <button class="close" aria-label="Close settings">×</button>
        <h2>Push to talk</h2><p>Your voice, only when you choose.</p>
        <form>
          <label><input id="enabled" type="checkbox"> Enable push to talk</label>
          <label class="field" for="key"><span>Hold this button or key to talk</span><select id="key"></select></label>
          <div class="mods">
            <label><input id="ctrl" type="checkbox">Ctrl</label>
            <label><input id="shift" type="checkbox">Shift</label>
            <label><input id="alt" type="checkbox">Alt</label>
          </div>
          <label class="field" for="delay"><span>Release delay (ms)</span><input id="delay" type="number" min="0" max="500" step="1" required></label>
          <button class="save" type="submit">Save settings</button>
        </form>
        <p class="note">Mouse 5 is usually the front / upper side button; Mouse 4 is the rear / lower one. Works in other apps. Keep Stoat's own mic unmuted. PTT also gates mic tests and voice recordings.</p>
        <p class="notice" role="status"></p>
      </section>
      <button class="pill" aria-label="Push to talk settings" aria-expanded="false">
        <span class="dot"></span><span class="status">Microphone muted</span><span class="key">Mouse 5</span>
      </button>`;
    const get = <T extends Element>(selector: string) => {
      const element = root.querySelector<T>(selector);
      if (!element) throw new Error(`Missing PTT control: ${selector}`);
      return element;
    };
    const panel = get<HTMLElement>(".panel");
    const pill = get<HTMLButtonElement>(".pill");
    const status = get<HTMLElement>(".status");
    const keyLabel = get<HTMLElement>(".key");
    const notice = get<HTMLElement>(".notice");
    const select = get<HTMLSelectElement>("#key");
    api.keys.forEach((key) =>
      select.add(
        new Option(
          key === "Mouse5"
            ? "Mouse 5 · Forward (upper side)"
            : key === "Mouse4"
              ? "Mouse 4 · Back (lower side)"
              : key,
          key,
        ),
      ),
    );
    let current: PttState = api.getState();
    let lastUpdate = performance.now();
    let saving = false;
    const label = (settings: PttSettings) =>
      [
        settings.ctrl && "Ctrl",
        settings.shift && "Shift",
        settings.alt && "Alt",
        settings.key === "Mouse5"
          ? "Mouse 5"
          : settings.key === "Mouse4"
            ? "Mouse 4"
            : settings.key,
      ]
        .filter(Boolean)
        .join(" + ");
    const render = () => {
      const media = window.stoatPTTMedia.status();
      const stale = performance.now() - lastUpdate >= 1000;
      const error = current.settings.enabled && (!current.available || stale);
      const talking =
        current.settings.enabled &&
        !error &&
        current.talking &&
        media.transmitting > 0;
      pill.className = `pill${talking ? " talking" : ""}${error ? " error" : ""}`;
      status.textContent = !current.settings.enabled
        ? "PTT off · open mic"
        : error
          ? "PTT unavailable · muted"
          : media.clientMuted
            ? "Muted in Stoat"
            : talking
              ? "Talking"
              : media.microphones === 0
                ? "PTT ready"
                : "Microphone muted";
      keyLabel.textContent = label(current.settings);
      keyLabel.hidden = !current.settings.enabled;
      pill.title =
        current.error ||
        (stale && current.settings.enabled
          ? "Connection to desktop lost. Microphone muted."
          : `Hold ${label(current.settings)} to talk. Click for settings.`);
    };
    const close = () => {
      panel.hidden = true;
      pill.setAttribute("aria-expanded", "false");
      pill.focus();
    };
    pill.addEventListener("click", () => {
      if (!panel.hidden) {
        close();
        return;
      }
      const settings = current.settings;
      ["enabled", "ctrl", "shift", "alt"].forEach((key) => {
        get<HTMLInputElement>(`#${key}`).checked =
          settings[key as "enabled" | "ctrl" | "shift" | "alt"];
      });
      select.value = settings.key;
      get<HTMLInputElement>("#delay").value = String(settings.releaseDelay);
      notice.textContent = current.error || "";
      panel.hidden = false;
      pill.setAttribute("aria-expanded", "true");
      get<HTMLButtonElement>(".close").focus();
    });
    get(".close").addEventListener("click", close);
    root.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") close();
    });
    get<HTMLFormElement>("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving) return;
      const enabled = get<HTMLInputElement>("#enabled").checked;
      if (
        current.settings.enabled &&
        !enabled &&
        !window.confirm(
          "Turn off push to talk? Your microphone can transmit continuously while unmuted in Stoat.",
        )
      )
        return;
      saving = true;
      get<HTMLButtonElement>(".save").disabled = true;
      try {
        current = await api.configure({
          enabled,
          key: select.value,
          ctrl: get<HTMLInputElement>("#ctrl").checked,
          shift: get<HTMLInputElement>("#shift").checked,
          alt: get<HTMLInputElement>("#alt").checked,
          releaseDelay: get<HTMLInputElement>("#delay").valueAsNumber,
        });
        notice.textContent = current.error || "Settings saved.";
        render();
      } catch (error) {
        notice.textContent =
          error instanceof Error ? error.message : "Could not save settings.";
      } finally {
        saving = false;
        get<HTMLButtonElement>(".save").disabled = false;
      }
    });
    api.subscribe((next) => {
      current = next;
      lastUpdate = performance.now();
      render();
    });
    setInterval(render, 250);
    document.body.appendChild(host);
    render();
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
