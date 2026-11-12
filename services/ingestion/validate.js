import { config } from '../../shared/config.js';

// Validación del contenido de una lectura. Devuelve el motivo del rechazo o null si es válida.
export function validateReading(p, now = Date.now()) {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!p || typeof p !== 'object') return 'BODY_NOT_OBJECT';
  if (!isNum(p.latitude) || p.latitude < -90 || p.latitude > 90) return 'LATITUDE_INVALID';
  if (!isNum(p.longitude) || p.longitude < -180 || p.longitude > 180) return 'LONGITUDE_INVALID';
  if (!isNum(p.batteryLevel) || p.batteryLevel < 0 || p.batteryLevel > 100) return 'BATTERY_INVALID';
  if (!isNum(p.gpsAccuracy) || p.gpsAccuracy < 0) return 'GPS_ACCURACY_INVALID';
  const t = Date.parse(p.timestamp);
  if (Number.isNaN(t)) return 'TIMESTAMP_INVALID';
  if (t - now > config.deviceAuthWindowSeconds * 1000) return 'TIMESTAMP_IN_FUTURE';
  return null;
}
