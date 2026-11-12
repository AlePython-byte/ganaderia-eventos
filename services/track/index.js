// Servicio de SEGUIMIENTO — segundo consumidor de `location.reported`.
//
// Mantiene la última posición conocida de cada vaca y un historial corto. Existe para demostrar
// que el MISMO evento lo procesan dos consumidores independientes: si este servicio cae, las
// alertas siguen funcionando (y al revés). También es la base para detectar "collar sin señal".
import { config, consumerName } from '../../shared/config.js';
import { isMain } from '../../shared/main.js';
import { createLogger } from '../../shared/log.js';
import { createRedis } from '../../shared/redis.js';
import { serve, sendJson } from '../../shared/http.js';
import { runConsumer } from '../../shared/consumer.js';
import { recordLag } from '../../shared/metrics.js';

const log = createLogger('track');
const redis = createRedis();
const blocking = createRedis();
redis.on('error', () => {});
blocking.on('error', () => {});

const HISTORY_SIZE = 500;

// Idempotente: el historial es un conjunto ordenado cuyo miembro es la lectura completa,
// así que reprocesar el mismo evento no duplica nada. La "última posición" solo avanza si la
// lectura es más reciente, de modo que una lectura atrasada no pisa una más nueva (sin orden garantizado).
export async function handleLocation(event) {
  const d = event.data;
  const readingMs = Date.parse(d.readingAt);
  const lastKey = `track:last:${d.cowId}`;

  const prev = Number(await redis.hget(lastKey, 'readingMs') ?? 0);
  if (readingMs >= prev) {
    await redis.hset(lastKey, {
      readingMs,
      readingAt: d.readingAt,
      latitude: d.latitude,
      longitude: d.longitude,
      batteryLevel: d.batteryLevel,
      gpsAccuracy: d.gpsAccuracy,
      collarToken: d.collarToken,
    });
  }
  const histKey = `track:history:${d.cowId}`;
  await redis.zadd(histKey, readingMs, JSON.stringify({ eventId: event.id, readingAt: d.readingAt, latitude: d.latitude, longitude: d.longitude, batteryLevel: d.batteryLevel }));
  await redis.zremrangebyrank(histKey, 0, -(HISTORY_SIZE + 1));
  log.info('track.updated', { cowId: d.cowId, correlationId: event.correlationId });
}

async function getTrack(_req, res, { match }) {
  const cowId = decodeURIComponent(match[1]);
  const last = await redis.hgetall(`track:last:${cowId}`);
  if (!Object.keys(last).length) return sendJson(res, 404, { error: 'NO_TRACK_FOR_COW', cowId });
  const history = (await redis.zrevrange(`track:history:${cowId}`, 0, 9)).map((r) => JSON.parse(r));
  sendJson(res, 200, { cowId, last, history });
}

if (isMain(import.meta.url)) {
  serve({
    name: 'track',
    port: config.ports.track,
    log,
    routes: [
      { method: 'GET', path: /^\/track\/([^/]+)$/, handler: getTrack },
      { method: 'GET', path: '/health', handler: (_q, res) => sendJson(res, 200, { status: 'UP', service: 'track' }) },
    ],
  });
  const consumer = await runConsumer({
    redis,
    blocking,
    stream: config.streams.locationReported,
    group: config.groups.track,
    consumer: consumerName('track'),
    handler: handleLocation,
    onProcessed: (ev) => recordLag(redis, config.groups.track, ev),
    log,
  });
  const stop = async () => { await consumer.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
