import { expect, test } from 'vitest';
import { Controls } from './controls';

const setup = () => {
  const keys = new EventTarget();
  let t = 0;
  const controls = new Controls(keys, null, () => t);
  return { keys, controls, tick: (ms: number) => (t += ms) };
};
const send = (keys: EventTarget, type: string, code: string) =>
  keys.dispatchEvent(Object.assign(new Event(type), { code }));

test('keys make the input, and opposite keys cancel', () => {
  const { keys, controls } = setup();
  send(keys, 'keydown', 'KeyW');
  send(keys, 'keydown', 'KeyD');
  expect(controls.sample()).toMatchObject({ forward: 1, right: 1, jump: false });
  send(keys, 'keydown', 'KeyS');
  expect(controls.sample().forward).toBe(0);
  send(keys, 'keyup', 'KeyW');
  expect(controls.sample().forward).toBe(-1);
  send(keys, 'blur', '');
  expect(controls.sample()).toMatchObject({ forward: 0, right: 0 });
});

test('the mouse turns the view and the pitch stops short of straight up and down', () => {
  const { controls } = setup();
  controls.look({ movementX: 100, movementY: 0 });
  expect(controls.sample().yaw).toBeLessThan(0);
  controls.look({ movementX: 0, movementY: -100000 });
  expect(controls.pitch).toBeLessThan(Math.PI / 2);
  expect(controls.pitch).toBeGreaterThan(1.5);
  controls.look({ movementX: 0, movementY: 100000 });
  expect(controls.pitch).toBeGreaterThan(-Math.PI / 2);
});

test('F, or a double tap of space, asks to toggle flying once', () => {
  const { keys, controls, tick } = setup();
  send(keys, 'keydown', 'KeyF');
  send(keys, 'keyup', 'KeyF');
  expect(controls.takeFlyToggle()).toBe(true);
  expect(controls.takeFlyToggle()).toBe(false);

  send(keys, 'keydown', 'Space');
  send(keys, 'keyup', 'Space');
  expect(controls.takeFlyToggle()).toBe(false);
  tick(150);
  send(keys, 'keydown', 'Space');
  send(keys, 'keyup', 'Space');
  expect(controls.takeFlyToggle()).toBe(true);
  // A third tap starts a new pair instead of toggling back.
  tick(100);
  send(keys, 'keydown', 'Space');
  expect(controls.takeFlyToggle()).toBe(false);
  // Taps far apart do not count.
  send(keys, 'keyup', 'Space');
  tick(1000);
  send(keys, 'keydown', 'Space');
  expect(controls.takeFlyToggle()).toBe(false);
});

test('a key that stays down does not repeat a toggle', () => {
  const { keys, controls } = setup();
  send(keys, 'keydown', 'KeyF');
  controls.takeFlyToggle();
  send(keys, 'keydown', 'KeyF');
  expect(controls.takeFlyToggle()).toBe(false);
});

test('a tap of space between two samples still jumps, once', () => {
  const { keys, controls } = setup();
  send(keys, 'keydown', 'Space');
  send(keys, 'keyup', 'Space');
  expect(controls.sample().jump).toBe(true);
  expect(controls.sample().jump).toBe(false);
});

test("two toggles between samples cancel, and Ctrl+F is the browser's", () => {
  const { keys, controls } = setup();
  send(keys, 'keydown', 'KeyF');
  send(keys, 'keyup', 'KeyF');
  send(keys, 'keydown', 'KeyF');
  send(keys, 'keyup', 'KeyF');
  expect(controls.takeFlyToggle()).toBe(false);
  keys.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyF', ctrlKey: true }));
  expect(controls.takeFlyToggle()).toBe(false);
});
