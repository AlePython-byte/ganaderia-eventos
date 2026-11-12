# Ganadería 4.0 · Esqueleto funcional orientado a eventos

Proyecto integrador de Arquitectura de Software (Momento evaluativo 3).
Este repositorio contiene **el esqueleto que materializa el diseño** (carpeta `docs/`).
Diseño y código se califican juntos: cada decisión documentada tiene su huella en el código (ver el mapa al final).

## Qué demuestra

Una lectura de un collar entra por **un servicio**, se publica como **un evento** y la procesan
**consumidores independientes** que reaccionan por separado:

```
Collar ──HTTPS+HMAC──▶ [Ingesta] ──location.reported──▶ Bus (Redis Streams) ──┬──▶ [Alertas] ──alert.raised──▶ Bus ──▶ [Notificaciones] ──▶ email / SMS / log
                                                                                └──▶ [Seguimiento]  (última posición e historial)
```

| Proceso | Puerto | Qué hace |
|---|---|---|
| `ingestion` | 8081 | Autentica al collar (HMAC + ventana de tiempo + nonce anti-replay) y publica `location.reported` |
| `alerts` | 8082 | Consume `location.reported`, evalúa reglas (geocerca, batería) y publica `alert.raised` |
| `track` | 8083 | Consume `location.reported` y guarda la última posición y el historial |
| `notifications` | 8084 | Consume `alert.raised` y notifica; reintenta con backoff y manda lo irrecuperable a la DLQ |
| `redis` | 6379 | Bus de eventos (Redis Streams, con persistencia AOF) |

## Requisitos

- **Docker Desktop** abierto (Windows 11, macOS o Linux). Nada más: no hace falta instalar Node ni Java.

## 1 · Levantar todo (un solo comando)

```bash
docker compose up --build
```

La primera vez tarda 1–2 minutos (construye la imagen). Cuando termine, en **otra terminal**:

```bash
docker compose ps
```

Deben aparecer `redis`, `ingestion`, `alerts`, `track` y `notifications` en estado **healthy**.

## 2 · Correr la demo completa (2 minutos)

```bash
docker compose run --rm tools demo
```

Ejecuta la historia completa y **verifica cada paso** (termina con error si algo falla):
lectura normal → collar sale de la geocerca → alerta → notificación → ataques rechazados.
Todo lo que pasa queda en los logs de la terminal del paso 1.

## 3 · Escenarios para mostrar en vivo

Cada uno corresponde a un escenario de calidad de `docs/02-escenarios.md`.

**E1 · No se pierde ninguna alerta aunque notificaciones esté caído**

```bash
docker compose stop notifications
docker compose run --rm tools send exit
docker compose run --rm tools status        # la alerta existe; la notificación está pendiente en el bus
docker compose start notifications
docker compose run --rm tools status        # ahora aparece entregada
```

**E1b · El proveedor de email falla: reintentos con backoff y DLQ**

```bash
docker compose run --rm tools provider down
docker compose run --rm tools send exit
# esperar ~15 s y mirar los logs: reintentos a 1 s, 2 s, 4 s, 8 s y luego dead_letter
docker compose run --rm tools status        # DLQ con 1 mensaje; el canal "log" se envió una sola vez
docker compose run --rm tools provider up
```

**E2 · Ataques a la ingesta**

```bash
docker compose run --rm tools attack replay    # copia exacta de una petición válida  → 409
docker compose run --rm tools attack forged    # firma con un secreto robado          → 401
docker compose run --rm tools attack stale     # timestamp de hace 20 minutos         → 401
```

**E3 · Agregar un canal sin tocar Ingesta ni Alertas** (SMS ya está programado como adaptador)

Descomentar la línea `NOTIFY_CHANNELS` en `docker-compose.yml` (servicio `notifications`) y:

```bash
docker compose up -d notifications
docker compose run --rm tools send exit     # ahora se entrega por log + email + sms
```

**E4 · Carga**

```bash
docker compose run --rm tools load --rps 200 --seconds 10
```

**Independencia de procesos** (matar uno no afecta a los demás):

```bash
docker compose kill track
docker compose run --rm tools send exit     # las alertas siguen funcionando sin "track"
docker compose start track
```

Si repites `send exit` seguido puede que no genere alerta nueva: hay un **cooldown de 30 s por vaca y tipo**
(evita avalanchas de alertas). `tools send exit` elige un collar al azar; para limpiar todo: `docker compose run --rm tools reset`.

## 4 · Pruebas unitarias

```bash
npm install
npm test
```

19 pruebas: firma HMAC, ventana de tiempo, validación de lecturas, reglas de negocio (incluye agregar un tipo de alerta) y backoff.
No necesitan Redis. (La demo del paso 2 es la prueba de integración, contra los procesos reales.)

## 5 · Detener

```bash
docker compose down          # conserva los datos del bus
docker compose down -v       # borra también los datos
```

## Qué es esqueleto y qué NO es (honestidad)

- **Collares y geocerca vienen de `shared/seed.js`**, no de la API Spring Boot de Gestión. En el diseño objetivo
  los consulta a la API existente (ver `docs/04-c4.md`, flechas punteadas).
- **El estado de Alertas y Seguimiento vive en Redis** (con prefijo por servicio). En el diseño objetivo cada servicio
  tendría su propio esquema en PostgreSQL. Está registrado como consecuencia en `docs/adr/0002`.
- **Email y SMS están simulados.** El envío real con Resend ya existe en el backend Spring Boot.
- **No hay regla `COLLAR_OFFLINE`** (necesita un temporizador); el servicio de Seguimiento es la base para agregarla.
- **No hay priorización de alertas por incidentes recurrentes ni IA:** ambas existen en el backend Spring Boot. En el diseño objetivo la IA sería un consumidor más de `alert.raised`.
- **Sin limitación de tasa por dispositivo** en el esqueleto (el backend existente sí la tiene).
- Los secretos de `shared/seed.js` son valores de juguete solo para la demostración.

## Mapa: decisión de diseño → dónde está en el código

| Decisión / táctica (docs) | Archivo |
|---|---|
| Autenticar: HMAC-SHA256 sobre petición canónica | `shared/signing.js`, `services/ingestion/index.js` |
| Anti-replay: nonce único con `SET NX EX` | `services/ingestion/index.js` |
| Auditar: log `security.rejected` con el motivo real | `services/ingestion/index.js` |
| Procesamiento asíncrono: responde `202` y publica el evento | `services/ingestion/index.js` |
| Intermediario (pub/sub) y contratos versionados | `shared/events.js`, `shared/config.js` |
| Reintento con backoff exponencial y DLQ | `shared/consumer.js` |
| Entrega al-menos-una-vez + idempotencia | `shared/consumer.js`, `services/alerts/index.js` (Lua atómico), `services/notifications/index.js` |
| Reglas sin estado (toleran desorden y duplicados) | `services/alerts/rules.js` |
| Encapsular canales detrás de adaptadores | `services/notifications/channels.js` |
| Degradación elegante: `503` rápido si el bus cae | `shared/redis.js` (`failFast`), `services/ingestion/index.js` |
| Trazabilidad: `correlationId` / `causationId` | `shared/events.js` |
| Escalar consumidores: nombre único por réplica | `shared/config.js` (`consumerName`) |
