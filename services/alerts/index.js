// Servicio de ALERTAS — contexto delimitado "Monitoreo y alertas".
//
// Consume `location.reported`, evalúa las reglas y publica `alert.raised`.
// No conoce a Ingesta ni a Notificaciones: solo el contrato de los eventos.
import { config, consumerName } from '../../shared/config.js';
import { isMain } from '../../shared/main.js';
import { createLogger } from '../../shared/log.js';
import { createRedis } from '../../shared/redis.js';
import { serve, sendJson } from '../../shared/http.js';
import { makeEvent, serialize } from '../../shared/events.js';
import { runConsumer } from '../../shared/consumer.js';
import { recordLag } from '../../shared/metrics.js';
import { evaluate } from './rules.js';

const log = createLogger('alerts');
const redis = createRedis();
const blocking = createRedis();
redis.on('error', () => {});
blocking.on('error', () => {});

// Crear la alerta + registrarla + publicar `alert.raised` en UN solo paso atómico (Lua).
// Si el proceso muere a la mitad, no queda una alerta creada sin su evento ni al revés.
// (Es el equivalente a un "outbox transaccional": aquí estado y evento viven en el mismo Redis.)
// KEYS: 1 llave de alerta activa (cooldown)  2 registro de la alerta  3 índice  4 stream de salida
// ARGV: 1 alertId  2 segundos de cooldown  3 JSON de la alerta  4 score  5 maxlen  6 JSON del evento
redis.defineCommand('raiseAlert', {
  numberOfKeys: 4,
  lua: `
    local created = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
    if not created then return 0 end
    redis.call('SET', KEYS[2], ARGV[3])
    redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
    redis.call('XADD', KEYS[4], 'MAXLEN', '~', ARGV[5], '*', 'event', ARGV[6])
    return 1
  `,
});

export async function handleLocation(event) {
  const reading = event.data;
  for (const rule of evaluate(reading)) {
    // Id determinista (lectura + regla): el mismo mensaje reentregado produce la misma alerta.
    const alertId = `AL-${event.id.slice(0, 8)}-${rule.type}`;
    const alert = {
      alertId,
      type: rule.type,
      severity: rule.severity,
      cowId: reading.cowId,
      collarToken: reading.collarToken,
      location: { latitude: reading.latitude, longitude: reading.longitude },
      detail: rule.detail(reading),
      sourceEventId: event.id,
      status: 'PENDING',
      detectedAt: new Date().toISOString(),
    };
    const out = makeEvent('alert.raised', alert, { correlationId: event.correlationId, causationId: event.id });

    const created = await redis.raiseAlert(
      `alert:active:${reading.cowId}:${rule.type}`, // una alerta activa por vaca y tipo (cooldown)
      `alert:${alertId}`,
      'alerts:index',
      config.streams.alertRaised,
      alertId,
      config.alertCooldownSeconds,
      JSON.stringify(alert),
      Date.now(),
      config.streamMaxLen,
      serialize(out),
    );
    log.info(created ? 'alert.raised' : 'alert.suppressed', {
      alertId,
      type: rule.type,
      cowId: reading.cowId,
      correlationId: event.correlationId,
      reason: created ? undefined : 'COOLDOWN_ACTIVE',
    });
  }
}

async function listAlerts(_req, res) {
  const ids = await redis.zrevrange('alerts:index', 0, 49);
  const rows = ids.length ? await redis.mget(ids.map((id) => `alert:${id}`)) : [];
  sendJson(res, 200, { alerts: rows.filter(Boolean).map((r) => JSON.parse(r)) });
}

if (isMain(import.meta.url)) {
  serve({
    name: 'alerts',
    port: config.ports.alerts,
    log,
    routes: [
      { method: 'GET', path: '/alerts', handler: listAlerts },
      { method: 'GET', path: '/health', handler: (_q, res) => sendJson(res, 200, { status: 'UP', service: 'alerts' }) },
    ],
  });
  const consumer = await runConsumer({
    redis,
    blocking,
    stream: config.streams.locationReported,
    group: config.groups.alerts,
    consumer: consumerName('alerts'),
    handler: handleLocation,
    onProcessed: (ev) => recordLag(redis, config.groups.alerts, ev),
    log,
  });
  const stop = async () => { await consumer.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
