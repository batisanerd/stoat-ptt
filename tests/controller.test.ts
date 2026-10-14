import assert from "node:assert/strict";
import { test } from "node:test";

import { PttController } from "../src/ptt/controller";
import {
  DEFAULT_PTT_SETTINGS,
  mouseBindingButton,
  validateSettings,
} from "../src/ptt/types";

test("only the held PTT chord opens the mic; repeats do not toggle it", () => {
  const changes: boolean[] = [];
  const controller = new PttController(DEFAULT_PTT_SETTINGS, (value) =>
    changes.push(value),
  );
  controller.input(false, true, true);
  controller.input(true, true, false);
  assert.deepEqual(changes, []);
  controller.input(true, true, true);
  controller.input(true, true, true);
  assert.deepEqual(changes, [true]);
  controller.input(true, false, false);
  assert.deepEqual(changes, [true, false]);
});

test("releasing a required modifier closes the mic", () => {
  const changes: boolean[] = [];
  const controller = new PttController(
    { ...DEFAULT_PTT_SETTINGS, ctrl: true },
    (value) => changes.push(value),
  );
  controller.input(true, true, true);
  controller.input(false, false, false);
  assert.deepEqual(changes, [true, false]);
});

test("reload or suspend requires release and a fresh press", () => {
  const changes: boolean[] = [];
  const controller = new PttController(DEFAULT_PTT_SETTINGS, (value) =>
    changes.push(value),
  );
  controller.input(true, true, true);
  controller.reset();
  controller.input(true, true, true);
  assert.deepEqual(changes, [true, false]);
  controller.input(true, false, true);
  controller.input(true, true, true);
  assert.deepEqual(changes, [true, false, true]);
});

test("release delay is cancelled by a new press and reset mutes immediately", async () => {
  const changes: boolean[] = [];
  const controller = new PttController(
    { ...DEFAULT_PTT_SETTINGS, releaseDelay: 30 },
    (value) => changes.push(value),
  );
  controller.input(true, true, true);
  controller.input(true, false, true);
  controller.input(true, true, true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(changes, [true]);
  controller.input(true, false, true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(changes, [true, false]);
  controller.input(true, true, true);
  controller.input(true, false, true);
  controller.reset();
  assert.deepEqual(changes, [true, false, true, false]);
});

test("disabled PTT never produces a talking event", () => {
  const changes: boolean[] = [];
  const controller = new PttController(
    { ...DEFAULT_PTT_SETTINGS, enabled: false },
    (value) => changes.push(value),
  );
  controller.input(true, true, true);
  assert.deepEqual(changes, []);
});

test("side mouse buttons map to native XBUTTON1 and XBUTTON2 and release closes PTT", () => {
  assert.equal(DEFAULT_PTT_SETTINGS.key, "Mouse5");
  assert.equal(mouseBindingButton("Mouse4"), 4);
  assert.equal(mouseBindingButton("Mouse5"), 5);
  assert.equal(mouseBindingButton("F8"), undefined);
  for (const key of ["Mouse4", "Mouse5"]) {
    const changes: boolean[] = [];
    const controller = new PttController(
      { ...DEFAULT_PTT_SETTINGS, key },
      (value) => changes.push(value),
    );
    controller.input(false, true, true); // The other side button does nothing.
    controller.input(true, true, true);
    controller.input(false, false, true); // Releasing another button does not mute.
    controller.input(true, false, true);
    assert.deepEqual(changes, [true, false]);
  }
});

test("settings reject invalid keys, types, delays, and strip unknown fields", () => {
  for (const value of [
    null,
    {},
    { ...DEFAULT_PTT_SETTINGS, key: "Unknown" },
    { ...DEFAULT_PTT_SETTINGS, enabled: "true" },
    { ...DEFAULT_PTT_SETTINGS, releaseDelay: -1 },
    { ...DEFAULT_PTT_SETTINGS, releaseDelay: 501 },
    { ...DEFAULT_PTT_SETTINGS, releaseDelay: 1.5 },
  ]) {
    assert.throws(() => validateSettings(value));
  }
  assert.deepEqual(
    validateSettings({ ...DEFAULT_PTT_SETTINGS, ignored: true }),
    DEFAULT_PTT_SETTINGS,
  );
});
