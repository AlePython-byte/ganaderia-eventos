import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters } from '../shared/geo.js';
import { geofence } from '../shared/seed.js';
import { evaluate, rules } from '../services/alerts/rules.js';
import { backoffMs } from '../shared/consumer.js';

const inside = { latitude: geofence.center.lat + 0.001, longitude: geofence.center.lon, batteryLevel: 80 };

test('distancia: 0,01° de latitud ≈ 1,11 km', () => {
  const d = distanceMeters({ lat: 0, lon: 0 }, { lat: 0.01, lon: 0 });
  assert.ok(d > 1100 && d < 1120, `d=${d}`);
});
test('lectura dentro de la geocerca y batería normal: sin alertas', () => {
  assert.deepEqual(evaluate(inside), []);
});
test('lectura fuera de la geocerca: EXIT_GEOFENCE', () => {
  const types = evaluate({ ...inside, latitude: geofence.center.lat + 0.02 }).map((r) => r.type);
  assert.deepEqual(types, ['EXIT_GEOFENCE']);
});
test('batería baja: LOW_BATTERY', () => {
  assert.deepEqual(evaluate({ ...inside, batteryLevel: 9 }).map((r) => r.type), ['LOW_BATTERY']);
});
test('fuera y con batería baja: las dos alertas, de forma independiente', () => {
  const types = evaluate({ ...inside, latitude: geofence.center.lat + 0.02, batteryLevel: 5 }).map((r) => r.type).sort();
  assert.deepEqual(types, ['EXIT_GEOFENCE', 'LOW_BATTERY']);
});
test('el borde de la batería (20%) no dispara alerta', () => {
  assert.deepEqual(evaluate({ ...inside, batteryLevel: 20 }), []);
});
test('backoff exponencial 1s, 2s, 4s, 8s', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffMs(n, 1000)), [1000, 2000, 4000, 8000]);
});

test('E3: agregar un tipo de alerta nuevo es sumar una regla; evaluate() no cambia', () => {
  const nueva = { type: 'HIGH_TEMPERATURE', severity: 'HIGH', check: (r) => r.temperature > 40, detail: (r) => ({ temperature: r.temperature }) };
  rules.push(nueva);
  try {
    assert.deepEqual(evaluate({ ...inside, temperature: 41 }).map((r) => r.type), ['HIGH_TEMPERATURE']);
    assert.deepEqual(evaluate(inside), []);
  } finally {
    rules.splice(rules.indexOf(nueva), 1);
  }
});
