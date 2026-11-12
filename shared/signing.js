import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Autenticación de dispositivos: HMAC-SHA256 sobre una petición canónica.
// La firma cubre método, ruta, timestamp, nonce y el hash del cuerpo: cambiar cualquiera la invalida.
export function canonical({ method, path, timestamp, nonce, body }) {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

export function sign(secret, parts) {
  return createHmac('sha256', secret).update(canonical(parts)).digest('hex');
}

// Comparación en tiempo constante (evita ataques de temporización).
export function verify(secret, parts, signatureHex) {
  const expected = Buffer.from(sign(secret, parts), 'hex');
  const given = Buffer.from(String(signatureHex ?? ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ¿El timestamp de la petición está dentro de la ventana permitida?
export function withinWindow(timestampIso, windowSeconds, now = Date.now()) {
  const t = Date.parse(timestampIso);
  if (Number.isNaN(t)) return false;
  return Math.abs(now - t) <= windowSeconds * 1000;
}
