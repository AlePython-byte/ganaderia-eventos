// Configuración central. Todo se puede cambiar por variables de entorno.
const int = (name, def) => (process.env[name] !== undefined ? Number(process.env[name]) : def);

export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Nombres de los streams (el "bus de eventos") y de los grupos de consumidores.
  streams: {
    locationReported: 'stream:location.reported',
    alertRaised: 'stream:alert.raised',
    dlq: (group) => `stream:dlq:${group}`,
  },
  groups: { alerts: 'alerts', track: 'track', notifications: 'notifications' },

  // Seguridad de la ingesta (HMAC + anti-replay).
  deviceAuthWindowSeconds: int('DEVICE_AUTH_WINDOW_SECONDS', 300),

  // Reglas de alertas.
  lowBatteryThreshold: int('LOW_BATTERY_THRESHOLD', 20),
  alertCooldownSeconds: int('ALERT_COOLDOWN_SECONDS', 30),

  // Reintentos del consumidor: backoff exponencial base * 2^(intento-1).
  maxAttempts: int('MAX_ATTEMPTS', 5),
  retryBaseMs: int('RETRY_BASE_MS', 1000),

  // Canales de notificación activos.
  channels: (process.env.NOTIFY_CHANNELS ?? 'log,email').split(',').map((s) => s.trim()),

  // Tamaño máximo aproximado de cada stream (evita crecimiento sin límite).
  streamMaxLen: int('STREAM_MAXLEN', 100000),

  ports: {
    ingestion: int('PORT_INGESTION', 8081),
    alerts: int('PORT_ALERTS', 8082),
    track: int('PORT_TRACK', 8083),
    notifications: int('PORT_NOTIFICATIONS', 8084),
  },
};

// Nombre único de cada réplica dentro de su grupo de consumidores (permite escalar a N réplicas).
import { hostname } from 'node:os';
export const consumerName = (service) => `${service}-${process.env.CONSUMER_ID ?? hostname()}`;
