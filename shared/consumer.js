import { config } from './config.js';
import { fieldsToEvent } from './events.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retraso antes del reintento número `attempt` (1, 2, 3...): base * 2^(attempt-1).
export const backoffMs = (attempt, base = config.retryBaseMs) => base * 2 ** (attempt - 1);

// Consumidor de un stream de Redis con grupo de consumidores.
//
// Garantías (ADR-003): entrega AL MENOS UNA VEZ.
//  - Un mensaje solo se confirma (XACK) cuando el handler termina sin error.
//  - Si el handler falla o el proceso muere, el mensaje queda "pendiente" y se reintenta
//    con backoff exponencial. Tras `maxAttempts` intentos pasa a la DLQ (stream de muertos).
//  - Por eso un mismo mensaje puede llegar más de una vez: los handlers DEBEN ser idempotentes.
export async function runConsumer({
  redis, // conexión para comandos normales
  blocking, // conexión dedicada a XREADGROUP BLOCK
  stream,
  group,
  consumer,
  handler,
  log,
  maxAttempts = config.maxAttempts,
  retryBaseMs = config.retryBaseMs,
  blockMs = 2000,
  count = 10,
  onProcessed = null,
}) {
  let running = true;
  const inFlight = new Set();
  const dlq = config.streams.dlq(group);

  const ensureGroup = async () => {
    try {
      // '0' = el grupo ve el stream desde el inicio: nada se pierde si el consumidor arranca tarde.
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
      log.info('consumer.group_created', { stream, group });
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) throw err;
    }
  };

  const toDlq = async (id, fields, reason, attempts) => {
    await redis.xadd(
      dlq,
      'MAXLEN', '~', config.streamMaxLen,
      '*',
      'originalId', id,
      'stream', stream,
      'reason', String(reason).slice(0, 500),
      'attempts', String(attempts),
      'failedAt', new Date().toISOString(),
      'event', fieldsToRaw(fields),
    );
    await redis.xack(stream, group, id);
    log.error('consumer.dead_letter', { stream, group, id, reason: String(reason).slice(0, 200), attempts });
  };

  const processEntry = async (id, fields) => {
    if (inFlight.has(id)) return;
    inFlight.add(id);
    let event;
    try {
      try {
        event = fieldsToEvent(fields);
      } catch (err) {
        await toDlq(id, fields, `MALFORMED: ${err.message}`, 1);
        return;
      }
      await handler(event, { streamId: id });
      await redis.xack(stream, group, id);
      if (onProcessed) await onProcessed(event);
    } catch (err) {
      // No se hace XACK: el mensaje queda pendiente y el bucle de reintentos lo retomará.
      log.warn('consumer.handler_failed', { stream, group, id, eventId: event?.id, error: err.message });
    } finally {
      inFlight.delete(id);
    }
  };

  // Bucle de reintentos: revisa los mensajes pendientes (entregados y no confirmados).
  const retryLoop = async () => {
    while (running) {
      await sleep(Math.max(200, Math.floor(retryBaseMs / 2)));
      try {
        // Cada fila: [id, consumidor, msSinceUltimaEntrega, vecesEntregado]
        const pending = await redis.xpending(stream, group, '-', '+', 50);
        for (const [id, , idleMs, deliveries] of pending) {
          if (inFlight.has(id)) continue;
          if (deliveries >= maxAttempts) {
            const rows = await redis.xrange(stream, id, id);
            if (rows.length) await toDlq(id, rows[0][1], 'MAX_ATTEMPTS_EXCEEDED', deliveries);
            else await redis.xack(stream, group, id); // el mensaje fue recortado del stream
          } else if (idleMs >= backoffMs(deliveries, retryBaseMs)) {
            const claimed = await redis.xclaim(stream, group, consumer, backoffMs(deliveries, retryBaseMs), id);
            for (const [cid, cfields] of claimed) {
              if (cfields) {
                log.info('consumer.retry', { stream, group, id: cid, attempt: deliveries + 1 });
                await processEntry(cid, cfields);
              }
            }
          }
        }
      } catch (err) {
        if (String(err.message).includes('NOGROUP')) await ensureGroup().catch(() => {});
        else log.error('consumer.retry_loop_error', { error: err.message });
      }
    }
  };

  const readLoop = async () => {
    while (running) {
      try {
        const res = await blocking.xreadgroup('GROUP', group, consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', stream, '>');
        if (!res) continue;
        for (const [, entries] of res) {
          for (const [id, fields] of entries) await processEntry(id, fields);
        }
      } catch (err) {
        if (String(err.message).includes('NOGROUP')) {
          await ensureGroup().catch(() => {});
        } else if (running) {
          log.error('consumer.read_error', { error: err.message });
          await sleep(1000);
        }
      }
    }
  };

  await ensureGroup();
  log.info('consumer.started', { stream, group, consumer });
  readLoop();
  retryLoop();

  return {
    stop: async () => {
      running = false;
      blocking.disconnect();
    },
  };
}

function fieldsToRaw(fields) {
  const idx = fields.indexOf('event');
  return idx >= 0 ? fields[idx + 1] : '';
}
