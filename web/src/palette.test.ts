import { expect, test } from 'vitest';
import { CYAN, CYAN_CSS } from './palette';

test('the accent is Felix cyan', () => {
  expect(CYAN_CSS).toBe('hsl(192, 90%, 46%)');
  expect(CYAN.h).toBe(192);
});
