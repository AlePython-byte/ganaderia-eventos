// Datos de referencia de DEMOSTRACIÓN.
//
// En el sistema real, collares y geocercas pertenecen al contexto "Gestión" (la API Spring Boot
// existente, con PostgreSQL). El esqueleto no la levanta: usa esta semilla en su lugar.
// Los secretos de abajo son valores de juguete solo para la demo; nunca se usan en producción.
const COLLARS = Number(process.env.SEED_COLLARS ?? 20);
const pad = (n) => String(n).padStart(3, '0');

export const collars = {};
for (let i = 1; i <= COLLARS; i++) {
  const token = `COLLAR-${pad(i)}`;
  collars[token] = { token, secret: `dev-secret-${pad(i)}`, cowId: `COW-${pad(i)}`, enabled: true };
}

// Un collar deshabilitado, para demostrar el rechazo (403).
collars['COLLAR-DISABLED'] = {
  token: 'COLLAR-DISABLED',
  secret: 'dev-secret-disabled',
  cowId: 'COW-DISABLED',
  enabled: false,
};

// Geocerca circular de 500 m (zona de Pasto, Nariño).
export const geofence = {
  id: 'GF-001',
  name: 'Potrero Norte',
  center: { lat: 1.2136, lon: -77.2811 },
  radiusMeters: 500,
};
