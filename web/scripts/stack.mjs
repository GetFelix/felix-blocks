// What the checks that run against the dev stack share: signing in as a player and opening the play page in a world.
import { chromium } from 'playwright';

export const GATEWAY = process.env.BLOCKS_GATEWAY ?? 'ws://127.0.0.1:8787/ws';
const IDP = process.env.BLOCKS_ISSUER ?? 'http://127.0.0.1:9400';

/** Starts the headless browser the checks use. Frames are software-rendered. */
export const launch = () =>
  chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** An ID token from the stand-in provider for the player `user`. */
export async function idToken(user) {
  const response = await fetch(`${IDP}/token?sub=${user}&aud=felix-blocks`);
  if (!response.ok) throw new Error(`the provider at ${IDP} answered ${response.status}`);
  return (await response.json()).id_token;
}

/**
 * Opens the play page as `user` in `world` and waits until it is ready. Page errors go into `errors`. Throws if the page
 * is not saving to the world.
 */
export async function openAs(browser, url, world, user, errors) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => errors.push(`${user}: ${e}`));
  const log = [];
  page.on('console', (m) => {
    log.push(`${m.type()}: ${m.text()}`);
    if (m.type() === 'error') errors.push(`${user}: ${m.text()}`);
  });
  const where = new URL(url);
  where.searchParams.set('gateway', GATEWAY);
  where.searchParams.set('world', world);
  where.searchParams.set('token', await idToken(user));
  // A short view keeps two software-rendered pages from starving each other on a small runner.
  where.searchParams.set('tier', '4');
  await page.goto(where.href, { waitUntil: 'load', timeout: 120_000 });
  await page
    .waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 300_000 })
    .catch(async (e) => {
      const state = await page
        .evaluate(
          () => `status "${document.getElementById('status').textContent}", timing ${JSON.stringify(window.__timing)}`,
        )
        .catch(() => 'page state unavailable');
      throw new Error(
        `${user}'s page never became ready (${state}); console: ${log.slice(-10).join(' | ')}; ${e.message}`,
      );
    });
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  if (!(await page.evaluate(() => window.__edit?.saving))) throw new Error(`${user}'s page is not saving: ${status}`);
  return page;
}
