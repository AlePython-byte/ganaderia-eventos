import { randomUUID } from 'node:crypto';

// Contrato de evento versionado (táctica de modificabilidad: "contratos versionados").
// Todo evento viaja dentro de este sobre. Los consumidores solo dependen del sobre y del `type`.
//
//   id            identificador único (clave de idempotencia para los consumidores)
//   type          'location.reported' | 'alert.raised'
//   version       versión del contrato del `data`
//   correlationId une todos los eventos que nacen de una misma lectura del collar
//   causationId   id del evento que causó a éste (permite rastrear una alerta hasta su lectura)
export function makeEvent(type, data, { correlationId, causationId = null, version = 1 } = {}) {
  const id = randomUUID();
  return {
    id,
    type,
    version,
    emittedAt: Date.now(),
    correlationId: correlationId ?? id,
    causationId,
    data,
  };
}

export const serialize = (event) => JSON.stringify(event);
export const parse = (raw) => JSON.parse(raw);

// Los streams de Redis guardan pares campo/valor planos; guardamos el evento en un solo campo.
export function fieldsToEvent(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return parse(obj.event);
}
