// Keyboard and mouse: WASD or the arrows to move, space to jump, shift to sprint, F or a double tap of space to fly,
// the mouse to look once the canvas has the pointer.
import type { Input } from './player';

const SENSITIVITY = 0.0022;
const LIMIT = Math.PI / 2 - 0.01;
/** Two taps of space this close together toggle flying. */
const DOUBLE_TAP_MS = 300;

export class Controls {
  yaw = 0;
  pitch = 0;
  /** Set when the player asks to start or stop flying; read it with `takeFlyToggle`. */
  private fly = 0;
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
