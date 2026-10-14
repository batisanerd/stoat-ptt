import { PttSettings } from "./types";

/** Hold semantics are independent of Electron and the native keyboard hook. */
export class PttController {
  private held = false;
  private talking = false;
  private blocked = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private settings: PttSettings,
    private onChange: (talking: boolean) => void,
  ) {}

  configure(settings: PttSettings) {
    this.reset();
    this.settings = settings;
  }

  input(baseKey: boolean, down: boolean, modifiersMatch: boolean) {
    if (baseKey) {
      this.held = down;
      if (!down) this.blocked = false;
    }
    const active =
      this.settings.enabled && this.held && !this.blocked && modifiersMatch;
    if (active) {
      this.cancelRelease();
      this.setTalking(true);
    } else if (this.talking && !this.timer) {
      if (this.settings.releaseDelay > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.setTalking(false);
        }, this.settings.releaseDelay);
      } else {
        this.setTalking(false);
      }
    }
  }

  /** Require a fresh press after reload, suspend, settings changes, or failure. */
  reset() {
    this.blocked = this.held;
    this.cancelRelease();
    this.setTalking(false);
  }

  private cancelRelease() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setTalking(value: boolean) {
    if (value !== this.talking) {
      this.talking = value;
      this.onChange(value);
    }
  }
}
