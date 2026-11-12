// Servicio de NOTIFICACIONES — contexto delimitado "Notificaciones".
//
// Consume `alert.raised` y entrega por cada canal activo. Si un canal falla, el mensaje queda
// pendiente y se reintenta (backoff exponencial); agotados los intentos va a la DLQ.
// Los reintentos solo repiten los canales que fallaron: lo ya entregado no se vuelve a enviar.
import { config, consumerName } from '../../shared/config.js';
import { isMain } from '../../shared/main.js';
import { createLogger } from '../../shared/log.js';
import { createRedis } from '../../shared/redis.js';
import { serve, sendJson } from '../../shared/http.js';
import { runConsumer } from '../../shared/consumer.js';
import { recordLag } from '../../shared/metrics.js';
import { logChannel, emailChannel, smsChannel } from './channels.js';

const log = createLogger('notifications');
const redis = createRedis();
const blocking = createRedis();
redis.on('error', () => {});
blocking.on('error', () => {});

const available = { log: logChannel(log), email: emailChannel(redis, log), sms: smsChannel(log) };
const channels = config.channels.map((c) => available[c]).filter(Boolean);

const record = (alertId, channel, status, error) =>
  redis
    .lpush('deliveries', JSON.stringify({ alertId, channel, status, error: error ?? null, at: new Date().toISOString() }))
    .then(() => redis.ltrim('deliveries', 0, 199));

// Idempotente por canal: antes de enviar se consulta si ya se entregó; después de enviar se marca.
// Límite honesto: si el proceso muere ENTRE enviar y marcar, el mensaje puede duplicarse
// (entrega al-menos-una-vez). Se mitiga con una llave de idempotencia en el proveedor real.
export async function handleAlert(event) {
  const a = event.data;
  const msg = {
    alertId: a.alertId,
    subject: `[${a.severity}] ${a.type} · ${a.cowId}`,
    text: `Alerta ${a.type} en ${a.cowId} (collar ${a.collarToken}) — ${JSON.stringify(a.detail)}`,
  };
  const failures = [];
  for (const channel of channels) {
    const doneKey = `delivered:${a.alertId}:${channel.name}`;
    if (await redis.exists(doneKey)) continue;
    try {
      await channel.send(msg);
      await redis.set(doneKey, new Date().toISOString(), 'EX', 7 * 24 * 3600);
      await record(a.alertId, channel.name, 'SENT');
    } catch (err) {
      failures.push(`${channel.name}: ${err.message}`);
      await record(a.alertId, channel.name, 'FAILED', err.message);
    }
  }
  if (failures.length) throw new Error(failures.join('; ')); // no se confirma → se reintenta
}

async function listDeliveries(_req, res) {
  const rows = await redis.lrange('deliveries', 0, 49);
  sendJson(res, 200, { deliveries: rows.map((r) => JSON.parse(r)) });
}

async function listDlq(_req, res) {
  const rows = await redis.xrange(config.streams.dlq(config.groups.notifications), '-', '+', 'COUNT', 50);
  const items = rows.map(([id, f]) => {
    const o = {};
    for (let i = 0; i < f.length; i += 2) o[f[i]] = f[i + 1];
    return { id, reason: o.reason, attempts: Number(o.attempts), failedAt: o.failedAt };
  });
  sendJson(res, 200, { deadLetters: items });
}

if (isMain(import.meta.url)) {
  serve({
    name: 'notifications',
    port: config.ports.notifications,
    log,
    routes: [
      { method: 'GET', path: '/deliveries', handler: listDeliveries },
      { method: 'GET', path: '/dlq', handler: listDlq },
      { method: 'GET', path: '/health', handler: (_q, res) => sendJson(res, 200, { status: 'UP', service: 'notifications' }) },
    ],
  });
  const consumer = await runConsumer({
    redis,
    blocking,
    stream: config.streams.alertRaised,
    group: config.groups.notifications,
    consumer: consumerName('notifications'),
    handler: handleAlert,
    onProcessed: (ev) => recordLag(redis, config.groups.notifications, ev),
    log,
  });
  const stop = async () => { await consumer.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
