import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReading } from '../services/ingestion/validate.js';

const now = Date.parse('2026-11-11T10:00:00Z');
const ok = { latitude: 1.2, longitude: -77.2, batteryLevel: 80, gpsAccuracy: 5, timestamp: '2026-11-11T10:00:00Z' };

test('una lectura correcta es válida', () => assert.equal(validateReading(ok, now), null));
test('rechaza coordenadas fuera de rango', () => {
  assert.equal(validateReading({ ...ok, latitude: 91 }, now), 'LATITUDE_INVALID');
  assert.equal(validateReading({ ...ok, longitude: -181 }, now), 'LONGITUDE_INVALID');
});
test('rechaza batería y precisión GPS inválidas', () => {
  assert.equal(validateReading({ ...ok, batteryLevel: 101 }, now), 'BATTERY_INVALID');
  assert.equal(validateReading({ ...ok, gpsAccuracy: -1 }, now), 'GPS_ACCURACY_INVALID');
});
test('rechaza tipos incorrectos y cuerpo no objeto', () => {
  assert.equal(validateReading({ ...ok, latitude: '1.2' }, now), 'LATITUDE_INVALID');
  assert.equal(validateReading(null, now), 'BODY_NOT_OBJECT');
});
test('rechaza timestamp inválido o muy en el futuro', () => {
  assert.equal(validateReading({ ...ok, timestamp: 'ayer' }, now), 'TIMESTAMP_INVALID');
  assert.equal(validateReading({ ...ok, timestamp: '2026-11-11T11:00:00Z' }, now), 'TIMESTAMP_IN_FUTURE');
});
