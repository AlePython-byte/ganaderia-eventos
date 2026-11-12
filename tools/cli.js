#!/usr/bin/env node
// Herramienta de demostración: simula collares, lanza ataques, muestra el estado y corre la demo.
//
//   docker compose run --rm tools demo          historia completa con verificaciones (sale con error si algo falla)
//   docker compose run --rm tools send exit     un collar fuera de la geocerca
//   docker compose run --rm tools attack replay reenvía una petición ya usada
//   docker compose run --rm tools status        qué ve cada servicio
//   docker compose run --rm tools provider down apaga el proveedor de email simulado
//   docker compose run --rm tools load --rps 100 --seconds 10
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRedis } from '../shared/redis.js';
import { config } from '../shared/config.js';
import { sign } from '../shared/signing.js';
import { collars, geofence } from '../shared/seed.js';
import { lagKey, percentile } from '../shared/metrics.js';

const URLS = {
  ingestion: process.env.INGESTION_URL ?? `http://localhost:${config.ports.ingestion}`,
  alerts: process.env.ALERTS_URL ?? `http://localhost:${config.ports.alerts}`,
  track: process.env.TRACK_URL ?? `http://localhost:${config.ports.track}`,
  notifications: process.env.NOTIFICATIONS_URL ?? `http://localhost:${config.ports.notifications}`,
};
const PATH = '/api/device/locations';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => (await fetch(url)).json();
const randomCollar = () => `COLLAR-${String(1 + Math.floor(Math.random() * 20)).padStart(3, '0')}`;

// ---------- Lecturas y peticiones firmadas ----------
function payload(kind) {
  const base = { latitude: geofence.center.lat + 0.001, longitude: geofence.center.lon, batteryLevel: 80, gpsAccuracy: 6.5, timestamp: new Date().toISOString() };
  if (kind === 'exit') return { ...base, latitude: geofence.center.lat + 0.02 }; // ~2,2 km al norte: fuera
  if (kind === 'lowbattery') return { ...base, batteryLevel: 9 };
  return base; // 'normal': dentro de la geocerca
}

function buildRequest({ collar, kind = 'normal', timestamp, nonce, secret }) {
  const token = collar;
  const body = JSON.stringify(payload(kind));
  const ts = timestamp ?? new Date().toISOString();
  const n = nonce ?? randomBytes(12).toString('hex');
  const key = secret ?? collars[token]?.secret ?? 'unknown';
  const signature = sign(key, { method: 'POST', path: PATH, timestamp: ts, nonce: n, body });
  return { body, headers: { 'content-type': 'application/json', 'x-device-token': token, 'x-device-timestamp': ts, 'x-device-nonce': n, 'x-device-signature': signature } };
}

async function post({ body, headers }) {
  const t0 = performance.now();
  const res = await fetch(URLS.ingestion + PATH, { method: 'POST', headers, body });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: performance.now() - t0 };
}

// ---------- Verificaciones de la demo ----------
let failed = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
};
async function waitFor(fn, timeoutMs = 8000, everyMs = 200) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}
const title = (t) => console.log(`\n▶ ${t}`);

async function demo() {
  const collar = randomCollar();
  const cow = collars[collar].cowId;
  console.log(`DEMO · collar ${collar} (${cow}) · geocerca "${geofence.name}" de ${geofence.radiusMeters} m`);

  title('1. Lectura normal (dentro de la geocerca)');
  const r1 = await post(buildRequest({ collar, kind: 'normal' }));
  check(r1.status === 202, 'la ingesta acepta la lectura', `HTTP ${r1.status} · ${r1.ms.toFixed(0)} ms`);
  const tr = await waitFor(async () => { const t = await fetch(`${URLS.track}/track/${cow}`); return t.ok ? t.json() : null; });
  check(!!tr, 'el servicio de seguimiento (consumidor #2) guardó la posición');
  await sleep(600);
  const a0 = (await get(`${URLS.alerts}/alerts`)).alerts.filter((a) => a.cowId === cow);
  check(a0.length === 0, 'NO se genera alerta (la vaca está dentro)');

  title('2. Collar sale de la geocerca → alerta → notificación');
  const sent = await post(buildRequest({ collar, kind: 'exit' }));
  check(sent.status === 202, 'la ingesta acepta y responde sin esperar el procesamiento', `HTTP ${sent.status} · ${sent.ms.toFixed(0)} ms · eventId ${sent.json.eventId?.slice(0, 8)}`);
  const alert = await waitFor(async () => (await get(`${URLS.alerts}/alerts`)).alerts.find((a) => a.cowId === cow && a.type === 'EXIT_GEOFENCE'));
  check(!!alert, 'el servicio de alertas (consumidor #1) detectó EXIT_GEOFENCE', alert ? `${alert.alertId} · ${alert.detail.distanceMeters} m del centro` : '');
  check(alert?.sourceEventId === sent.json.eventId, 'trazabilidad: la alerta apunta a la lectura que la causó (causationId)');
  const delivered = await waitFor(async () => {
    const d = (await get(`${URLS.notifications}/deliveries`)).deliveries.filter((x) => x.alertId === alert?.alertId && x.status === 'SENT');
    return d.length >= config.channels.length ? d : null;
  });
  check(!!delivered, `notificaciones entregadas por ${config.channels.join(' + ')}`, delivered ? delivered.map((d) => d.channel).join(', ') : '');

  title('3. Ataques a la ingesta (seguridad)');
  const rq = buildRequest({ collar, kind: 'normal' });
  const first = await post(rq);
  const again = await post(rq); // misma petición exacta: mismo nonce
  check(first.status === 202 && again.status === 409, 'replay: la segunda copia exacta se rechaza', `HTTP ${first.status} luego ${again.status} ${again.json.error ?? ''}`);
  const forged = await post(buildRequest({ collar, kind: 'normal', secret: 'secreto-robado-incorrecto' }));
  check(forged.status === 401, 'firma falsificada se rechaza', `HTTP ${forged.status}`);
  const stale = await post(buildRequest({ collar, kind: 'normal', timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
  check(stale.status === 401, 'timestamp viejo (20 min) se rechaza', `HTTP ${stale.status} ${stale.json.error ?? ''}`);
  const unknown = await post(buildRequest({ collar: 'COLLAR-999', kind: 'normal' }));
  check(unknown.status === 401, 'collar desconocido se rechaza', `HTTP ${unknown.status}`);
  const disabled = await post(buildRequest({ collar: 'COLLAR-DISABLED', kind: 'normal' }));
  check(disabled.status === 403, 'collar deshabilitado se rechaza', `HTTP ${disabled.status}`);

  title('4. Estado de los consumidores del bus');
  await printGroups();
  console.log(failed ? `\n❌ ${failed} verificación(es) fallaron` : '\n✅ Todas las verificaciones pasaron');
  process.exitCode = failed ? 1 : 0;
}

async function printGroups() {
  const redis = createRedis();
  redis.on('error', () => {});
  for (const stream of [config.streams.locationReported, config.streams.alertRaised]) {
    const len = await redis.xlen(stream);
    console.log(`  ${stream}  (${len} eventos)`);
    const groups = await redis.xinfo('GROUPS', stream).catch(() => []);
    for (const g of groups) {
      const o = Object.fromEntries(g.reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v, a[i + 1]]]), []));
      console.log(`    grupo ${String(o.name).padEnd(14)} pendientes=${o.pending}  lag=${o.lag ?? '?'}`);
    }
  }
  redis.disconnect();
}

async function status() {
  const tryGet = async (url) => { try { return await get(url); } catch { return null; } };
  const alertsRes = await tryGet(`${URLS.alerts}/alerts`);
  const deliveriesRes = await tryGet(`${URLS.notifications}/deliveries`);
  const dlqRes = await tryGet(`${URLS.notifications}/dlq`);
  const alerts = alertsRes?.alerts ?? [];
  console.log(`\nALERTAS (${alerts.length}, últimas 5):`);
  if (!alertsRes) console.log('  ⛔ el servicio de alertas no responde');
  alerts.slice(0, 5).forEach((a) => console.log(`  ${a.alertId}  ${a.type.padEnd(14)} ${a.cowId}  ${a.detectedAt}`));
  console.log(`\nENTREGAS (últimas 8):`);
  if (!deliveriesRes) console.log('  ⛔ el servicio de notificaciones está caído: las alertas nuevas esperan en el bus (ver "pendientes/lag" abajo)');
  (deliveriesRes?.deliveries ?? []).slice(0, 8).forEach((d) => console.log(`  ${d.alertId}  ${d.channel.padEnd(6)} ${d.status}${d.error ? '  (' + d.error + ')' : ''}`));
  const dlq = dlqRes?.deadLetters ?? [];
  console.log(`\nDLQ de notificaciones: ${dlqRes ? dlq.length + ' mensaje(s)' : 'no disponible (servicio caído)'}`);
  dlq.forEach((d) => console.log(`  ${d.id}  ${d.reason}  intentos=${d.attempts}`));
  console.log('\nBUS:');
  await printGroups();
}

async function provider(state) {
  const redis = createRedis();
  redis.on('error', () => {});
  if (state === 'down') await redis.set('sim:email:down', '1');
  else await redis.del('sim:email:down');
  console.log(`Proveedor de email simulado: ${state === 'down' ? 'APAGADO ⛔' : 'ENCENDIDO ✅'}`);
  redis.disconnect();
}

async function load({ rps, seconds }) {
  const redis = createRedis();
  redis.on('error', () => {});
  for (const g of Object.values(config.groups)) await redis.del(lagKey(g));
  const total = rps * seconds;
  console.log(`Carga: ${rps} lecturas/s durante ${seconds} s = ${total} lecturas (10% fuera de la geocerca)`);
  const inflight = [];
  const start = performance.now();
  for (let i = 0; i < total; i++) {
    const wait = start + (i * 1000) / rps - performance.now();
    if (wait > 0) await sleep(wait);
    const kind = Math.random() < 0.1 ? 'exit' : 'normal';
    inflight.push(post(buildRequest({ collar: randomCollar(), kind })).catch((e) => ({ status: 0, ms: 0, json: { error: e.message } })));
  }
  const results = await Promise.all(inflight);
  const elapsed = (performance.now() - start) / 1000;
  const byStatus = {};
  results.forEach((r) => (byStatus[r.status] = (byStatus[r.status] ?? 0) + 1));
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nIngesta: ${JSON.stringify(byStatus)} en ${elapsed.toFixed(1)} s · aceptación p50=${percentile(ms, 50).toFixed(1)} ms  p95=${percentile(ms, 95).toFixed(1)} ms  p99=${percentile(ms, 99).toFixed(1)} ms`);

  // Esperar a que los consumidores vacíen el backlog.
  const drainStart = performance.now();
  const drained = await waitFor(async () => {
    const info = await redis.xinfo('GROUPS', config.streams.locationReported);
    return info.every((g) => { const o = Object.fromEntries(g.reduce((a, v, i, arr) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), [])); return Number(o.pending) === 0 && Number(o.lag ?? 0) === 0; });
  }, 60000, 250);
  console.log(`Backlog vaciado: ${drained ? 'sí' : 'NO (timeout 60 s)'} · ${((performance.now() - drainStart) / 1000).toFixed(1)} s después de enviar la última`);
  for (const g of [config.groups.alerts, config.groups.track]) {
    const lags = (await redis.lrange(lagKey(g), 0, -1)).map(Number).sort((a, b) => a - b);
    if (lags.length) console.log(`Lag consumidor "${g}" (emisión → procesado): n=${lags.length}  p50=${percentile(lags, 50)} ms  p95=${percentile(lags, 95)} ms  p99=${percentile(lags, 99)} ms  máx=${lags.at(-1)} ms`);
  }
  redis.disconnect();
}

async function reset() {
  const redis = createRedis();
  redis.on('error', () => {});
  await redis.flushdb();
  console.log('Redis limpiado (los servicios recrean sus grupos solos).');
  redis.disconnect();
}

// ---------- Entrada ----------
const [command, ...argv] = process.argv.slice(2);
const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { collar: { type: 'string' }, rps: { type: 'string', default: '50' }, seconds: { type: 'string', default: '10' } }, strict: false });
const sub = positionals[0];

switch (command) {
  case 'demo': await demo(); break;
  case 'status': await status(); break;
  case 'reset': await reset(); break;
  case 'provider': await provider(sub === 'down' ? 'down' : 'up'); break;
  case 'load': await load({ rps: Number(values.rps), seconds: Number(values.seconds) }); break;
  case 'send': {
    const collar = values.collar ?? randomCollar();
    const kind = ['normal', 'exit', 'lowbattery'].includes(sub) ? sub : 'normal';
    const r = await post(buildRequest({ collar, kind }));
    console.log(`${collar} · lectura "${kind}" → HTTP ${r.status} ${JSON.stringify(r.json)} (${r.ms.toFixed(0)} ms)`);
    break;
  }
  case 'attack': {
    const collar = values.collar ?? randomCollar();
    if (sub === 'replay') {
      const rq = buildRequest({ collar });
      const a = await post(rq); const b = await post(rq);
      console.log(`Original → HTTP ${a.status}\nCopia exacta (replay) → HTTP ${b.status} ${JSON.stringify(b.json)}`);
    } else if (sub === 'forged') {
      const r = await post(buildRequest({ collar, secret: 'secreto-robado-incorrecto' }));
      console.log(`Firma falsificada → HTTP ${r.status} ${JSON.stringify(r.json)}`);
    } else if (sub === 'stale') {
      const r = await post(buildRequest({ collar, timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
      console.log(`Timestamp de hace 20 min → HTTP ${r.status} ${JSON.stringify(r.json)}`);
    } else console.log('Uso: attack replay | forged | stale');
    break;
  }
  default:
    console.log('Comandos: demo | send [normal|exit|lowbattery] | attack [replay|forged|stale] | status | provider [up|down] | load --rps N --seconds N | reset');
}
process.exit(process.exitCode ?? 0);