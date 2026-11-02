// Seeds a Felix for the gateway and the web app: bootstrap a tenant that trusts idp.mjs, create the resources of a
// world called `demo` (the ones in scope.toml), let two players into it, and write the broker's token to the state
// directory. Safe to run again: existing objects are kept. Real worlds are made by blocks-tool; this one only gives
// the stack something to join.
import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';

const env = (name, fallback) => process.env[name] || fallback;

const CONTROL_PLANE = env('BLOCKS_FELIX_CONTROL_PLANE', 'http://controlplane:8443');
const BOOTSTRAP = env('BLOCKS_FELIX_BOOTSTRAP', 'http://controlplane:9095');
const BOOTSTRAP_TOKEN = env('BLOCKS_FELIX_BOOTSTRAP_TOKEN', 'dev-bootstrap');
const IDP = env('BLOCKS_IDP', 'http://idp:9400');
const STATE = env('BLOCKS_STATE_DIR', '/state');
const TENANT = env('BLOCKS_TENANT', 'blocks');
const NAMESPACE = env('BLOCKS_NAMESPACE', 'default');
const WORLDS = env('BLOCKS_WORLDS', 'demo')
  .split(/[\s,]+/)
  .filter(Boolean);
const PLAYERS = env('BLOCKS_PLAYERS', 'ana,ben').split(',').filter(Boolean);
const AUDIENCE = 'felix-blocks';

async function request(method, url, { token, headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status === 409) {
    console.log(`  ${method} ${url}: already exists`);
    return null;
  }
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const { issuer } = await request('GET', `${IDP}/.well-known/openid-configuration`);
// Felix keys RBAC on sha256(issuer|subject), not on the subject itself.
const principal = (subject) => createHash('sha256').update(`${issuer}|${subject}`).digest('hex');

async function exchange(subject, body) {
  const { id_token } = await request('GET', `${IDP}/token?sub=${subject}&aud=${AUDIENCE}`);
  const url = `${CONTROL_PLANE}/v1/tenants/${TENANT}/token/exchange`;
  return (await request('POST', url, { token: id_token, body })).felix_token;
}

const object = (kind, name) => `${kind}:${TENANT}/${NAMESPACE}/${name}`;
const tenant = `${CONTROL_PLANE}/v1/tenants/${TENANT}`;

console.log(`bootstrap tenant ${TENANT}`);
await request('POST', `${BOOTSTRAP}/internal/bootstrap/tenants/${TENANT}/initialize`, {
  headers: { 'x-felix-bootstrap-token': BOOTSTRAP_TOKEN },
  body: {
    display_name: 'Felix Blocks',
    idp_issuers: [
      {
        issuer,
        audiences: [AUDIENCE],
        jwks_url: `${IDP}/jwks.json`,
        claim_mappings: { subject_claim: 'sub' },
      },
    ],
    initial_admin_principals: [principal('blocks-admin')],
    policies: [
      { subject: 'role:admin', object: object('stream', '*'), action: 'stream.manage' },
      { subject: 'role:admin', object: object('cache', '*'), action: 'cache.manage' },
      // The admin finalizes the fleet features the broker's cluster needs.
      { subject: 'role:admin', object: 'cluster:*', action: 'node.manage' },
      { subject: 'role:broker', object: 'cluster:*', action: 'node.view' },
      { subject: 'role:broker', object: 'cluster:*', action: 'node.manage' },
    ],
    groupings: [
      { user: principal('blocks-admin'), role: 'role:admin' },
      { user: principal('blocks-broker'), role: 'role:broker' },
    ],
  },
});

const admin = await exchange('blocks-admin', { audience: 'felix-controlplane' });
await request('POST', `${tenant}/namespaces`, {
  token: admin,
  body: { namespace: NAMESPACE, display_name: NAMESPACE },
});

const stream = (name, durable) => ({
  stream: name,
  kind: 'Stream',
  shards: 1,
  replication_factor: 1,
  retention: { max_age_seconds: durable ? 7 * 24 * 60 * 60 : null, max_size_bytes: null },
  consistency: 'Leader',
  delivery: durable ? 'AtLeastOnce' : 'AtMostOnce',
  durable,
});
// One shard each: the gateway's cache watch reads a single shard.
const cache = (name) => ({
  cache: name,
  display_name: name,
  shards: 1,
  replication_factor: 1,
  consistency: 'Leader',
});

// A role holds exactly what a session in the world needs; the gateway asks the token exchange for no more than the
// scope file grants.
function policies(world) {
  const role = `role:world-${world}`;
  const grant = (kind, name, action) => ({ subject: role, object: object(kind, name), action });
  return [
    grant('cache', `blocks.chunks.${world}`, 'cache.read'),
    grant('cache', `blocks.chunks.${world}`, 'cache.write'),
    grant('cache', `blocks.info.${world}`, 'cache.read'),
    grant('cache', `blocks.online.${world}`, 'cache.read'),
    grant('cache', `blocks.online.${world}`, 'cache.write'),
    ...[`blocks.presence.${world}`, `blocks.chat.${world}`].flatMap((name) => [
      grant('stream', name, 'stream.publish'),
      grant('stream', name, 'stream.subscribe'),
    ]),
  ];
}

for (const world of WORLDS) {
  console.log(`world ${world}`);
  for (const name of [`blocks.chunks.${world}`, `blocks.info.${world}`, `blocks.online.${world}`]) {
    await request('POST', `${tenant}/namespaces/${NAMESPACE}/caches`, { token: admin, body: cache(name) });
  }
  for (const [name, durable] of [
    [`blocks.presence.${world}`, false],
    [`blocks.chat.${world}`, true],
  ]) {
    await request('POST', `${tenant}/namespaces/${NAMESPACE}/streams`, { token: admin, body: stream(name, durable) });
  }
  for (const policy of policies(world)) {
    await request('POST', `${tenant}/rbac/policies`, { token: admin, body: policy });
  }
  for (const name of PLAYERS) {
    await request('POST', `${tenant}/rbac/groupings`, {
      token: admin,
      body: { user: principal(name), role: `role:world-${world}` },
    });
  }
  console.log(`  open to ${PLAYERS.join(', ')}`);
}

// The broker runs as uid 65532 and writes its certificate here too.
await mkdir(STATE, { recursive: true });
await chmod(STATE, 0o777).catch(() => {});
const broker = await exchange('blocks-broker', { audience: 'felix-controlplane' });
await writeFile(`${STATE}/node.token`, broker, { mode: 0o644 });
console.log(`wrote node.token to ${STATE}`);

// up.sh waits for this before it calls the stack ready.
await writeFile(`${STATE}/seeded`, '');
