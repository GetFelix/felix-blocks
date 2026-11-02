// Keyboard and mouse: WASD or the arrows to move, space to jump, shift to sprint, F or a double tap of space to fly,
// the mouse to look once the canvas has the pointer, left click to dig, right click to place, 1 to 9 or the wheel to
// pick what to place.
import type { Input } from './player';

const SENSITIVITY = 0.0022;
const LIMIT = Math.PI / 2 - 0.01;
/** Two taps of space this close together toggle flying. */
const DOUBLE_TAP_MS = 300;
/** How many things the player can pick between. */
export const SLOTS = 9;

export type Action = 'dig' | 'place';

export class Controls {
  yaw = 0;
  pitch = 0;
  /** Set when the player asks to start or stop flying; read it with `takeFlyToggle`. */
  private fly = 0;
  /** Which slot is picked, 0 to SLOTS - 1. */
  slot = 0;
  private actions: Action[] = [];
  /** A jump pressed and released between two samples still counts. */
  private jumped = false;
  private readonly held = new Set<string>();
  private lastSpace = -Infinity;
  private readonly off: (() => void)[] = [];

  /** Listens on `keys` for the keyboard (the window) and on `canvas` for the pointer. */
  constructor(
    keys: EventTarget,
    canvas: HTMLElement | null = null,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.listen(keys, 'keydown', (e) => this.key(e as KeyboardEvent, true));
    this.listen(keys, 'keyup', (e) => this.key(e as KeyboardEvent, false));
    // Keys released while the page was not looking never send keyup.
    this.listen(keys, 'blur', () => {
      this.held.clear();
      this.lastSpace = -Infinity;
    });
    if (canvas) {
      this.listen(canvas, 'click', () => void canvas.requestPointerLock?.());
      this.listen(canvas.ownerDocument, 'mousemove', (e) => {
        if (canvas.ownerDocument.pointerLockElement === canvas) this.look(e as MouseEvent);
      });
      this.listen(canvas, 'mousedown', (e) => {
        if (canvas.ownerDocument.pointerLockElement === canvas) this.press(e as MouseEvent);
      });
      this.listen(canvas, 'wheel', (e) => this.scroll(e as WheelEvent));
      this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    }
  }

  /** What the player is asking for now. */
  sample(): Input {
    const axis = (plus: string[], minus: string[]) =>
      (plus.some((c) => this.held.has(c)) ? 1 : 0) - (minus.some((c) => this.held.has(c)) ? 1 : 0);
    const jump = this.held.has('Space') || this.jumped;
    this.jumped = false;
    return {
      forward: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      right: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
      jump,
      down: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      sprint: this.held.has('ControlLeft') || this.held.has('ShiftLeft'),
      yaw: this.yaw,
    };
  }

  /** True if flying was asked to toggle an odd number of times since the last call. */
  takeFlyToggle(): boolean {
    const odd = this.fly % 2 === 1;
    this.fly = 0;
    return odd;
  }

  /** The digs and places asked for since the last call, in order. */
  takeActions(): Action[] {
    const actions = this.actions;
    this.actions = [];
    return actions;
  }

  /** A mouse button: the left digs, the right places. */
  press(e: { button: number; preventDefault?: () => void }): void {
    if (e.button === 0) this.actions.push('dig');
    else if (e.button === 2) this.actions.push('place');
    e.preventDefault?.();
  }

  /** Moves the pick by the wheel, one slot for each notch. */
  scroll(e: { deltaY: number; preventDefault?: () => void }): void {
    if (e.deltaY !== 0) this.slot = (this.slot + (e.deltaY > 0 ? 1 : SLOTS - 1)) % SLOTS;
    e.preventDefault?.();
  }

  /** Turns the view by a mouse movement, in pixels. */
  look(e: { movementX: number; movementY: number }): void {
    this.yaw -= e.movementX * SENSITIVITY;
    this.pitch = Math.max(-LIMIT, Math.min(LIMIT, this.pitch - e.movementY * SENSITIVITY));
  }

  dispose(): void {
    for (const off of this.off) off();
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (down) {
      if (!this.held.has(e.code)) {
        // Ctrl+F and Cmd+F are the browser's find.
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (digit) this.slot = Number(digit[1]) - 1;
        if (e.code === 'KeyF' && !(e.ctrlKey || e.metaKey || e.altKey)) this.fly++;
        if (e.code === 'Space') {
          this.jumped = true;
          const at = this.now();
          const twice = at - this.lastSpace < DOUBLE_TAP_MS;
          if (twice) this.fly++;
          this.lastSpace = twice ? -Infinity : at;
        }
      }
      this.held.add(e.code);
    } else {
      this.held.delete(e.code);
    }
    // The page does not scroll under a player who is walking.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault?.();
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.off.push(() => target.removeEventListener(type, handler));
  }
}
