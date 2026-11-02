// A small panel of live numbers for tuning: the view distance and why it changed, frame rate, chunks. It is plain DOM
// with the same dark glass as the rest of the interface, and it is off unless asked for (?debug=1 or F3).
import { UI } from './palette';
import type { TierChange } from './view-distance';

export interface Readings {
  tier: number;
  fps: number;
  loaded: number;
  meshing: number;
  changes: readonly TierChange[];
}

/** The panel's lines, so a test can read them without a browser. */
export function overlayLines({ tier, fps, loaded, meshing, changes }: Readings): string[] {
  const rate = Number.isFinite(fps) && fps > 0 ? fps.toFixed(0) : '--';
  const lines = [`view ${tier} chunks`, `${rate} fps`, `${loaded} loaded, ${meshing} meshing`];
  for (const c of changes.slice(-4)) lines.push(`${c.from} to ${c.to}: ${c.reason}, ${c.meanMs.toFixed(1)} ms`);
  return lines;
}

export class DebugOverlay {
  readonly element: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.element = document.createElement('pre');
    this.element.id = 'debug';
    Object.assign(this.element.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      margin: '0',
      padding: '8px 12px',
      borderRadius: '10px',
      background: UI.panel,
      color: UI.text,
      font: "500 12px/1.5 'JetBrains Mono', ui-monospace, monospace",
      pointerEvents: 'none',
      display: 'none',
    });
    parent.append(this.element);
    addEventListener('keydown', (e) => e.key === 'F3' && (e.preventDefault(), this.toggle()));
  }

  get visible(): boolean {
    return this.element.style.display !== 'none';
  }

  toggle(on = !this.visible): void {
    this.element.style.display = on ? 'block' : 'none';
  }

  update(readings: Readings): void {
    if (this.visible) this.element.textContent = overlayLines(readings).join('\n');
  }
}
