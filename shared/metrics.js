// Métrica mínima: cuánto tarda cada consumidor en procesar un evento desde que fue emitido
// ("lag"). Se guarda en una lista acotada en Redis para poder medirla con la herramienta de carga.
export const lagKey = (group) => `metrics:lag:${group}`;

export async function recordLag(redis, group, event) {
  const lag = Date.now() - event.emittedAt;
  await redis.lpush(lagKey(group), String(lag));
  await redis.ltrim(lagKey(group), 0, 4999);
}

export function percentile(sortedNumbers, p) {
  if (!sortedNumbers.length) return null;
  const idx = Math.min(sortedNumbers.length - 1, Math.ceil((p / 100) * sortedNumbers.length) - 1);
  return sortedNumbers[Math.max(0, idx)];
}
