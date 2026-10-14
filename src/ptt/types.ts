export const PTT_KEYS = [
  "Mouse5",
  "Mouse4",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  "Space",
] as const;

export type PttSettings = {
  enabled: boolean;
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  releaseDelay: number;
};

export type PttState = {
  settings: PttSettings;
  talking: boolean;
  available: boolean;
  error: string | null;
};

export const DEFAULT_PTT_SETTINGS: PttSettings = {
  enabled: true,
  key: "Mouse5",
  ctrl: false,
  shift: false,
  alt: false,
  releaseDelay: 0,
};

export function validateSettings(value: unknown): PttSettings {
  const settings = value as PttSettings;
  if (
    !settings ||
    typeof settings.enabled !== "boolean" ||
    !PTT_KEYS.includes(settings.key) ||
    typeof settings.ctrl !== "boolean" ||
    typeof settings.shift !== "boolean" ||
    typeof settings.alt !== "boolean" ||
    !Number.isInteger(settings.releaseDelay) ||
    settings.releaseDelay < 0 ||
    settings.releaseDelay > 500
  ) {
    throw new Error(
      "Choose a supported button or key and a release delay from 0 to 500 ms.",
    );
  }
  return {
    enabled: settings.enabled,
    key: settings.key,
    ctrl: settings.ctrl,
    shift: settings.shift,
    alt: settings.alt,
    releaseDelay: settings.releaseDelay,
  };
}

export function bindingLabel(settings: PttSettings) {
  return [
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
}

export function mouseBindingButton(key: string) {
  return key === "Mouse4" ? 4 : key === "Mouse5" ? 5 : undefined;
}
