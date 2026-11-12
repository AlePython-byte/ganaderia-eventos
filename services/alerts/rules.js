import { isOutside, distanceMeters } from '../../shared/geo.js';
import { config } from '../../shared/config.js';
import { geofence } from '../../shared/seed.js';

// Reglas de negocio de alertas. Son SIN ESTADO: cada lectura se evalúa por sí sola.
// Es una decisión consciente: con entrega al-menos-una-vez y sin orden garantizado entre
// instancias (ADR-003), una regla que dependa de "la lectura anterior" produciría falsos positivos.
// Para agregar una regla nueva basta con sumarla a este arreglo.
export const rules = [
  {
    type: 'EXIT_GEOFENCE',
    severity: 'HIGH',
    check: (r) => isOutside(geofence, { lat: r.latitude, lon: r.longitude }),
    detail: (r) => ({
      geofenceId: geofence.id,
      distanceMeters: Math.round(distanceMeters(geofence.center, { lat: r.latitude, lon: r.longitude })),
      radiusMeters: geofence.radiusMeters,
    }),
  },
  {
    type: 'LOW_BATTERY',
    severity: 'MEDIUM',
    check: (r) => r.batteryLevel < config.lowBatteryThreshold,
    detail: (r) => ({ batteryLevel: r.batteryLevel, threshold: config.lowBatteryThreshold }),
  },
];

export const evaluate = (reading) => rules.filter((rule) => rule.check(reading));
