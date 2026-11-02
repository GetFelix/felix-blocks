// Joins the world `demo` (or BLOCKS_WORLD) through the gateway the way the game will, and checks what the game
// relies on: a player the world is open to is in, anyone else and any other world is refused, and a chunk key can be
// written conditionally, read back with its version, refused when its version is stale, and seen by a second
// player's watch.
// Usage: [BLOCKS_WORLD=name] node dev/check-join.mjs [gateway url] [idp url]. The stack must be up (dev/up.sh). A
// world made with blocks-tool must be open to both ana and ben.
import assert from 'node:assert/strict';

const GATEWAY = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';
const IDP = process.argv[3] ?? 'http://127.0.0.1:9400';
const AUDIENCE = 'felix-blocks';
const WORLD = process.env.BLOCKS_WORLD || 'demo';
// A chunk key of region (0, 0), as core/ names it, that this run alone writes: the cache keeps what was written, so a
// second run against the same stack would otherwise find the key taken. The last digit is the chunk's height.
const hex = (n) => Math.floor(Math.random() * n).toString(16);
const KEY = `R8000_8000-0${hex(8)}${hex(16)}`;

async function idToken(subject) {
  const response = await fetch(`${IDP}/token?sub=${subject}&aud=${AUDIENCE}`);
  assert.ok(response.ok, `the IdP answered ${response.status}`);
  return (await response.json()).id_token;
}

/** A session: sends JSON, and hands back the next message that matches. */
function open(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiting = [];
  const settle = () => {
    for (const wait of [...waiting]) {
      const at = inbox.findIndex(wait.match);
      if (at >= 0) {
        waiting.splice(waiting.indexOf(wait), 1);
        wait.resolve(inbox.splice(at, 1)[0]);
      }
    }
  };
  socket.addEventListener('message', (event) => {
    inbox.push(JSON.parse(event.data));
    settle();
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot reach the gateway at ${url}`)), { once: true });
  });
  return {
    opened,
    send: (message) => socket.send(JSON.stringify(message)),
    next: (match, what) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no ${what} within 10 s; received ${JSON.stringify(inbox)}`)),
          10_000,
        );
        waiting.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
        settle();
      }),
    close: () => socket.close(),
  };
}

async function join(subject, world) {
  // Right after the stack comes up, the broker may not yet lead the world's shards; that is `unavailable`, and it passes.
  for (let attempt = 1; ; attempt++) {
    const session = open(GATEWAY);
    await session.opened;
    session.send({
      type: 'join',
      protocol: 1,
      features: ['cache_versions'],
      world,
      token: await idToken(subject),
    });
    const answer = await session.next((m) => m.type === 'hello' || m.type === 'error', 'hello');
    if (answer.code !== 'unavailable' || attempt === 10) return { session, answer };
    session.close();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const b64 = (text) => Buffer.from(text).toString('base64');
let id = 0;

async function request(session, message, reply) {
  const mine = ++id;
  session.send({ ...message, id: mine });
  return session.next((m) => m.id === mine && (m.type === reply || m.type === 'error'), reply);
}

const failures = [];
async function check(name, run) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

await check('a player in the world joins', async () => {
  const { session, answer } = await join('ana', WORLD);
  assert.equal(answer.type, 'hello', JSON.stringify(answer));
  assert.equal(answer.world, WORLD);
  assert.deepEqual(answer.features, ['cache_versions']);
  assert.equal(answer.cache_ttl_ms.online, 30_000);
  session.close();
});

await check('someone the world is not open to is refused', async () => {
  const { session, answer } = await join('mallory', WORLD);
  assert.equal(answer.code, 'forbidden', JSON.stringify(answer));
  session.close();
});

await check('a world that does not exist is refused', async () => {
  const { session, answer } = await join('ana', 'nowhere');
  assert.equal(answer.code, 'forbidden', JSON.stringify(answer));
  session.close();
});

await check('a chunk is written conditionally, read with its version and refused when stale', async () => {
  const { session: ana, answer } = await join('ana', WORLD);
  assert.equal(answer.type, 'hello', JSON.stringify(answer));
  const { session: ben } = await join('ben', WORLD);
  ben.send({ type: 'cache_watch', cache: 'chunks' });
  await ben.next((m) => m.type === 'cache_entries' && m.cache === 'chunks', 'cache_entries');

  const created = await request(
    ana,
    { type: 'cache_put_if', cache: 'chunks', key: KEY, payload: b64('one'), if: 'absent' },
    'cache_put_result',
  );
  assert.equal(created.applied, true, JSON.stringify(created));
  const again = await request(
    ana,
    { type: 'cache_put_if', cache: 'chunks', key: KEY, payload: b64('two'), if: 'absent' },
    'cache_put_result',
  );
  assert.equal(again.applied, false, 'a second write at absent must be refused');
  assert.equal(again.version, created.version);

  const read = await request(ana, { type: 'cache_get', cache: 'chunks', key: KEY }, 'cache_value');
  assert.equal(Buffer.from(read.payload, 'base64').toString(), 'one');
  assert.equal(read.version, created.version);

  const updated = await request(
    ana,
    { type: 'cache_put_if', cache: 'chunks', key: KEY, payload: b64('three'), if: { version: read.version } },
    'cache_put_result',
  );
  assert.equal(updated.applied, true, JSON.stringify(updated));
  const stale = await request(
    ana,
    { type: 'cache_put_if', cache: 'chunks', key: KEY, payload: b64('four'), if: { version: read.version } },
    'cache_put_result',
  );
  assert.equal(stale.applied, false, 'a write at an old version must be refused');
  assert.equal(stale.version, updated.version);

  const change = await ben.next(
    (m) => m.type === 'cache_change' && m.key === KEY && Buffer.from(m.payload ?? '', 'base64').toString() === 'three',
    "ben's change",
  );
  assert.equal(change.cache, 'chunks');
  ana.close();
  ben.close();
});

if (failures.length > 0) {
  console.error(`${failures.length} check${failures.length === 1 ? '' : 's'} failed`);
  process.exit(1);
}
