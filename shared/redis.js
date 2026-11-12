import Redis from 'ioredis';
import { config } from './config.js';

// Conexión a Redis. Por defecto reintenta indefinidamente (los consumidores deben sobrevivir
// a un reinicio de Redis). La ingesta usa failFast para responder 503 en vez de colgarse.
export function createRedis({ failFast = false } = {}) {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: failFast ? 1 : null,
    enableOfflineQueue: !failFast,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}
