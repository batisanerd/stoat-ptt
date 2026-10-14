/* Windows integration test: real Electron preload, native global key hook and audio. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = path.resolve(__dirname, "..");
const executable =
  process.env.PTT_TEST_EXE ||
  path.join(root, "out", "Stoat PTT-win32-x64", "stoat-ptt.exe");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "stoat-ptt-test-"));
const mouseInput = (action, button = 5, point) =>
  JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "mouse-input.ps1"),
        "-Action",
        action,
        "-Button",
        String(button),
        ...(point
          ? [
              "-X",
              String(Math.round(point.x)),
              "-Y",
              String(Math.round(point.y)),
            ]
          : []),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    ),
  );
const fixture = `<!doctype html><html><head><title>PTT integration test</title>
<script>
// Request immediately: preload must gate audio before the app gets a track.
window.initialPromise = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
  window.stream = stream;
  window.track = stream.getAudioTracks()[0];
  window.audio = new AudioContext();
  window.source = audio.createMediaStreamSource(stream);
  window.analyser = audio.createAnalyser();
  source.connect(analyser);
  return audio.resume();
});
window.sampleAudio = async () => {
  const data = new Float32Array(analyser.fftSize);
  let peak = 0;
  for(let i = 0; i < 25; i++) {
    analyser.getFloatTimeDomainData(data);
    peak = Math.max(peak, ...data.map(Math.abs));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return peak;
};
</script></head><body style="background:#151b18;color:#eee;font-family:system-ui;padding:40px">
<h1>Stoat PTT integration test</h1><p>Fake microphone. No account or real audio is used.</p></body></html>`;

async function main() {
  if (process.platform !== "win32")
    throw new Error("This integration test targets Windows.");
  if (!fs.existsSync(executable))
    throw new Error("Run pnpm package before pnpm test:electron.");
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  // Reserve an unused debugging port without assuming that 9222 is available.
  const debugProbe = http.createServer();
  await new Promise((resolve) => debugProbe.listen(0, "127.0.0.1", resolve));
  const debugPort = debugProbe.address().port;
  await new Promise((resolve) => debugProbe.close(resolve));
  let appLog = "";
  const child = spawn(
    executable,
    [
      `--user-data-dir=${userData}`,
      `--force-server=http://127.0.0.1:${port}`,
      `--remote-debugging-port=${debugPort}`,
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      ...(process.env.PTT_TEST_SCREENSHOT ? [] : ["--hidden"]),
    ],
    {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
    },
  );
  child.stdout.on("data", (data) => {
    appLog += data;
  });
  child.stderr.on("data", (data) => {
    appLog += data;
  });
  let socket;
  let restoreCursor;
  let mousePoint;
  try {
    let target;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null)
        throw new Error(`App exited: ${child.exitCode}\n${appLog}`);
      try {
        const tabs = await (
          await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        ).json();
        target = tabs.find(
          (tab) =>
            tab.type === "page" &&
            tab.url.startsWith(`http://127.0.0.1:${port}`),
        );
        if (target) break;
      } catch {
        /* Wait for Electron's debugger to start. */
      }
      await delay(100);
    }
    if (!target) throw new Error(`No renderer target.\n${appLog}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let nextId = 0;
    const pending = new Map();
    socket.on("message", (buffer) => {
      const message = JSON.parse(buffer);
      if (message.id) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          message.error
            ? reject(new Error(JSON.stringify(message.error)))
            : resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      return result.result?.value;
    };
    await delay(600); // Upstream reloads once on initial navigation.
    await evaluate("initialPromise.then(() => true)");
    const initial = await evaluate(
      "({state:stoatPTT.getState(),media:stoatPTTMedia.status(),overlay:!!document.getElementById('stoat-ptt-controls')})",
    );
    assert.equal(initial.state.available, true, initial.state.error);
    assert.equal(initial.state.settings.enabled, true);
    assert.equal(initial.state.settings.key, "Mouse5");
    assert.equal(initial.media.transmitting, 0);
    assert.equal(initial.overlay, true);
    assert.equal(await evaluate("sampleAudio()"), 0);
    console.log(
      "PASS: startup microphone is silent before page scripts receive it",
    );

    await evaluate(
      "stoatPTT.configure({...stoatPTT.getState().settings,key:'F8'})",
    );
    uIOhook.keyToggle(UiohookKey.F8, "down");
    for (let i = 0; i < 40; i++) {
      if ((await evaluate("stoatPTTMedia.status()")).transmitting === 1) break;
      await delay(50);
    }
    assert.equal(
      (await evaluate("stoatPTTMedia.status()")).transmitting,
      1,
      JSON.stringify(
        await evaluate(
          "({state:stoatPTT.getState(),media:stoatPTTMedia.status()})",
        ),
      ),
    );
    assert.ok(
      (await evaluate("sampleAudio()")) > 0.001,
      "Held key should pass real fake-device audio",
    );
    uIOhook.keyToggle(UiohookKey.F8, "up");
    await delay(200);
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
    assert.equal(await evaluate("sampleAudio()"), 0);
    console.log(
      `PASS: global hold/release works ${process.env.PTT_TEST_SCREENSHOT ? "while focused" : "with the app hidden"}; audio goes silent on release`,
    );

    await evaluate("track.enabled = false");
    uIOhook.keyToggle(UiohookKey.F8, "down");
    await delay(100);
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
    uIOhook.keyToggle(UiohookKey.F8, "up");
    await evaluate(
      "track.enabled = true; window.trackClone = track.clone(); window.streamClone = stream.clone(); true",
    );
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
    console.log(
      "PASS: manual mute survives PTT; cloned microphone tracks remain gated",
    );

    await evaluate(
      "stoatPTT.configure({...stoatPTT.getState().settings,key:'F9',ctrl:true,releaseDelay:120})",
    );
    uIOhook.keyToggle(UiohookKey.F9, "down");
    await delay(100);
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
    uIOhook.keyToggle(UiohookKey.F9, "up");
    uIOhook.keyToggle(UiohookKey.Ctrl, "down");
    uIOhook.keyToggle(UiohookKey.F9, "down");
    await delay(100);
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 3);
    uIOhook.keyToggle(UiohookKey.Ctrl, "up");
    await delay(250);
    assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
    uIOhook.keyToggle(UiohookKey.F9, "up");
    console.log(
      "PASS: configurable chord, release delay and releasing modifier first",
    );

    await call("Page.reload");
    await delay(600);
    await evaluate("initialPromise.then(() => true)");
    const afterReload = await evaluate(
      "({state:stoatPTT.getState(),media:stoatPTTMedia.status()})",
    );
    assert.equal(afterReload.state.settings.key, "F9");
    assert.equal(afterReload.state.settings.ctrl, true);
    assert.equal(afterReload.media.transmitting, 0);
    await assert.rejects(() =>
      evaluate(
        "stoatPTT.configure({...stoatPTT.getState().settings,releaseDelay:-1})",
      ),
    );
    console.log(
      "PASS: persisted settings survive reload; reload is muted; invalid settings rejected",
    );

    // Keep OS mouse events inside this test's own window, then restore the cursor.
    await evaluate("native.maximise();true");
    await call("Page.bringToFront");
    await delay(400);
    assert.equal(
      await evaluate("document.hasFocus()"),
      true,
      "Mouse test window must be focused before injecting clicks",
    );
    mousePoint = await evaluate(
      "({x:(screenX+outerWidth/2)*devicePixelRatio,y:(screenY+outerHeight/2)*devicePixelRatio})",
    );
    restoreCursor = mouseInput("position");
    await evaluate(
      "history.pushState({},'', '?before');history.pushState({},'', '?middle');history.pushState({},'', '?after');history.back();true",
    );
    await delay(150);
    for (const button of [5, 4]) {
      await evaluate(
        `stoatPTT.configure({...stoatPTT.getState().settings,key:'Mouse${button}',ctrl:false,releaseDelay:0})`,
      );
      mouseInput("down", button, mousePoint);
      await delay(150);
      assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 1);
      assert.ok(
        (await evaluate("sampleAudio()")) > 0.001,
        `Mouse ${button} should pass audio while held`,
      );
      mouseInput("up", button, mousePoint);
      await delay(200);
      assert.equal((await evaluate("stoatPTTMedia.status()")).transmitting, 0);
      assert.equal(await evaluate("sampleAudio()"), 0);
      assert.equal(
        await evaluate("location.search"),
        "?middle",
        `Mouse ${button} must not navigate Stoat history`,
      );
    }
    await evaluate(
      "stoatPTT.configure({...stoatPTT.getState().settings,key:'Mouse5'})",
    );
    console.log(
      "PASS: real Windows Mouse 5 and Mouse 4 hold/release gate audio without browser navigation",
    );
    if (process.env.PTT_TEST_SCREENSHOT) {
      await evaluate(
        "document.getElementById('stoat-ptt-controls').shadowRoot.querySelector('.pill').click();true",
      );
      const screenshot = await call("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        path.join(root, "out", "ptt-settings-preview.png"),
        Buffer.from(screenshot.data, "base64"),
      );
    }
    console.log("All Electron integration checks passed.");
  } catch (error) {
    console.error("Packaged app diagnostics:", appLog.slice(-8000));
    throw error;
  } finally {
    if (mousePoint) {
      mouseInput("up", 5, mousePoint);
      mouseInput("up", 4, mousePoint);
    }
    if (restoreCursor) mouseInput("move", 5, restoreCursor);
    for (const key of [UiohookKey.F8, UiohookKey.F9, UiohookKey.Ctrl])
      uIOhook.keyToggle(key, "up");
    socket?.close();
    child.kill();
    server.close();
    // Keep temporary user data for diagnosing an unsuccessful run.
    console.log(`Test user data: ${userData}`);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
