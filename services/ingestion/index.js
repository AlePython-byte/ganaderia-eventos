// Servicio de INGESTA — contexto delimitado "Ingesta de dispositivos".
//
// Responsabilidad: recibir lecturas firmadas de los collares, rechazar lo que no sea auténtico,
// fresco y único, y PUBLICAR el hecho `location.reported`. No evalúa reglas ni notifica:
// no sabe quién consume el evento (ADR-001).
import { config } from '../../shared/config.js';
import { isMain } from '../../shared/main.js';
import { createLogger } from '../../shared/log.js';
import { createRedis } from '../../shared/redis.js';
import { serve, sendJson, readRawBody } from '../../shared/http.js';
import { makeEvent, serialize } from '../../shared/events.js';
import { verify, withinWindow } from '../../shared/signing.js';
import { collars } from '../../shared/seed.js';
import { validateReading } from './validate.js';

const log = createLogger('ingestion');
// failFast: si Redis (el bus) está caído respondemos 503 enseguida; el collar reintenta después.
const redis = createRedis({ failFast: true });
redis.on('error', () => {});

const PATH = '/api/device/locations';
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

const reject = (res, status, error, reason, extra = {}) => {
  // Auditoría (táctica de seguridad): cada rechazo deja rastro con el motivo REAL,
  // pero la respuesta al dispositivo es genérica para no ayudar a un atacante.
  log.warn('security.rejected', { reason, status, ...extra });
  return sendJson(res, status, { error });
};

async function handleLocation(req, res) {
  const body = await readRawBody(req);
  const token = req.headers['x-device-token'];
  const timestamp = req.headers['x-device-timestamp'];
  const nonce = req.headers['x-device-nonce'];
  const signature = req.headers['x-device-signature'];

  if (!token || !timestamp || !nonce || !signature || !NONCE_RE.test(nonce)) {
    return reject(res, 401, 'UNAUTHORIZED', 'MISSING_OR_MALFORMED_HEADERS', { token });
  }

  // 1) Frescura: barato, se descarta antes de gastar CPU en el HMAC.
  if (!withinWindow(timestamp, config.deviceAuthWindowSeconds)) {
    return reject(res, 401, 'TIMESTAMP_OUT_OF_WINDOW', 'STALE_TIMESTAMP', { token });
  }

  // 2) Autenticidad: dispositivo conocido y firma válida. Mismo mensaje para "no existe" y "firma mala".
  const collar = collars[token];
  if (!collar) return reject(res, 401, 'UNAUTHORIZED', 'UNKNOWN_DEVICE', { token });
  if (!verify(collar.secret, { method: req.method, path: PATH, timestamp, nonce, body }, signature)) {
    return reject(res, 401, 'UNAUTHORIZED', 'BAD_SIGNATURE', { token });
  }
  if (!collar.enabled) return reject(res, 403, 'DEVICE_DISABLED', 'DEVICE_DISABLED', { token });

  try {
    // 3) Unicidad (anti-replay): el nonce solo se consume si la firma fue válida, así un atacante
    //    no puede llenar Redis de nonces con peticiones falsas.
    const ttl = config.deviceAuthWindowSeconds * 2;
    const first = await redis.set(`nonce:${token}:${nonce}`, '1', 'EX', ttl, 'NX');
    if (first !== 'OK') return reject(res, 409, 'REPLAYED_REQUEST', 'NONCE_REUSED', { token });

    // 4) Validación del contenido.
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return reject(res, 400, 'INVALID_PAYLOAD', 'BODY_NOT_JSON', { token });
    }
    const problem = validateReading(payload);
    if (problem) return reject(res, 400, 'INVALID_PAYLOAD', problem, { token });

    // 5) Publicar el hecho. El cowId lo fija el servidor según el collar autenticado,
    //    nunca el cuerpo: un collar no puede reportar por otra vaca.
    const event = makeEvent('location.reported', {
      cowId: collar.cowId,
      collarToken: collar.token,
      latitude: payload.latitude,
      longitude: payload.longitude,
      batteryLevel: payload.batteryLevel,
      gpsAccuracy: payload.gpsAccuracy,
      readingAt: new Date(payload.timestamp).toISOString(),
      receivedAt: new Date().toISOString(),
    });
    await redis.xadd(config.streams.locationReported, 'MAXLEN', '~', config.streamMaxLen, '*', 'event', serialize(event));

    log.info('location.accepted', { eventId: event.id, correlationId: event.correlationId, cowId: collar.cowId });
    // 202: aceptado para procesamiento asíncrono; las alertas se calculan después (consistencia eventual).
    return sendJson(res, 202, { status: 'ACCEPTED', eventId: event.id });
  } catch (err) {
    log.error('bus.unavailable', { error: err.message });
    return sendJson(res, 503, { error: 'BUS_UNAVAILABLE' }, { 'retry-after': '5' });
  }
}

async function health(_req, res) {
  try {
    await redis.ping();
    sendJson(res, 200, { status: 'UP', service: 'ingestion', bus: 'UP' });
  } catch {
    sendJson(res, 503, { status: 'DEGRADED', service: 'ingestion', bus: 'DOWN' });
  }
}

if (isMain(import.meta.url)) {
  serve({
    name: 'ingestion',
    port: config.ports.ingestion,
    log,
    routes: [
      { method: 'POST', path: PATH, handler: handleLocation },
      { method: 'GET', path: '/health', handler: health },
    ],
  });
  const stop = () => process.exit(0);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
