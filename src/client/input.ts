import type { Dir } from "../shared/constants.js";

type InputState = { dir: Dir | null; bomb: boolean };

const DIR_KEYS: Record<string, Dir> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

// Tracks held keys and reports the active direction (most recently pressed
// among those still held) plus whether bomb is held.
export class InputTracker {
  private held: Dir[] = [];
  private bomb = false;
  private onChange: (s: InputState) => void;
  private onGesture: () => void;
  private enabled = false;

  constructor(onChange: (s: InputState) => void, onGesture: () => void) {
    this.onChange = onChange;
    this.onGesture = onGesture;
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.held = [];
      this.bomb = false;
      this.emit();
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    // ignore typing into form fields
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    const key = e.key.toLowerCase();
    const isGame = key === " " || key in DIR_KEYS;
    if (isGame) {
      this.onGesture();
      e.preventDefault();
    }
    if (!this.enabled) return;

    if (key === " ") {
      if (this.bomb !== down) {
        this.bomb = down;
        this.emit();
      }
      return;
    }
    const dir = DIR_KEYS[key];
    if (!dir) return;
    const had = this.held.includes(dir);
    if (down && !had) this.held.push(dir);
    else if (!down && had) this.held = this.held.filter((d) => d !== dir);
    else return;
    this.emit();
  }

  private emit(): void {
    const dir = this.held.length ? this.held[this.held.length - 1] : null;
    this.onChange({ dir, bomb: this.bomb });
  }
}
