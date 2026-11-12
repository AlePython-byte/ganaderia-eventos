import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify, withinWindow } from '../shared/signing.js';

const parts = { method: 'POST', path: '/api/device/locations', timestamp: '2026-11-11T10:00:00.000Z', nonce: 'abc12345', body: '{"latitude":1.2}' };

test('una firma válida se verifica', () => {
  assert.equal(verify('secreto', parts, sign('secreto', parts)), true);
});
test('un secreto distinto invalida la firma', () => {
  assert.equal(verify('otro', parts, sign('secreto', parts)), false);
});
test('alterar el cuerpo invalida la firma', () => {
  const sig = sign('secreto', parts);
  assert.equal(verify('secreto', { ...parts, body: '{"latitude":9.9}' }, sig), false);
});
test('alterar el nonce o el timestamp invalida la firma', () => {
  const sig = sign('secreto', parts);
  assert.equal(verify('secreto', { ...parts, nonce: 'otro9999' }, sig), false);
  assert.equal(verify('secreto', { ...parts, timestamp: '2026-11-11T10:00:01.000Z' }, sig), false);
});
test('firmas basura o ausentes no rompen la verificación', () => {
  assert.equal(verify('secreto', parts, undefined), false);
  assert.equal(verify('secreto', parts, 'zzzz'), false);
  assert.equal(verify('secreto', parts, ''), false);
});
test('ventana de tiempo: dentro, fuera y fecha inválida', () => {
  const now = Date.parse('2026-11-11T10:00:00Z');
  assert.equal(withinWindow('2026-11-11T09:57:00Z', 300, now), true); // 3 min
  assert.equal(withinWindow('2026-11-11T09:50:00Z', 300, now), false); // 10 min
  assert.equal(withinWindow('2026-11-11T10:10:00Z', 300, now), false); // futuro lejano
  assert.equal(withinWindow('no-es-fecha', 300, now), false);
});
