# 2 · Escenarios de calidad

> Pieza del entregable: **Escenarios** (al menos tres, completos, con entorno y medida).

Cada escenario tiene las seis partes (fuente, estímulo, entorno, artefacto, respuesta, medida) y responde las tres
preguntas de control del curso: **¿se puede probar?**, **¿dice en qué condiciones?**, **¿qué se degrada si lo cumplimos?**
La columna "Verificado" separa lo que **se midió de verdad en el esqueleto** de lo que es solo una meta.

---

## E1 · Una alerta no se pierde aunque falle la notificación (hojas D1 y D2)

| Parte | Descripción |
|---|---|
| **Fuente** | Un collar |
| **Estímulo** | Reporta una posición fuera de la geocerca |
| **Entorno** | Operación normal, **con el servicio de notificaciones caído** (proceso muerto) **o con el proveedor de correo o de IA fallando** |
| **Artefacto** | El camino Ingesta → Bus → Alertas → Bus → Notificaciones |
| **Respuesta** | La ingesta acepta la lectura; la alerta se crea y **queda pendiente en el bus**; al recuperarse el servicio se entrega. Si el proveedor falla, se reintenta con backoff exponencial (1, 2, 4, 8 s) y, tras 5 intentos, el mensaje pasa a la cola de mensajes fallidos (DLQ) sin bloquear a los demás |
| **Medida** | 0 alertas perdidas · la ingesta responde `202` mientras notificaciones está caído · entrega < 5 s tras recuperarse el servicio |
| **Se prueba con** | `docker compose stop notifications` → `docker compose run --rm --no-deps tools send exit` → `docker compose start notifications` (y `tools provider down` para el proveedor) |
| **Qué se degrada** | La **latencia de la notificación** crece durante la falla (hasta que se recupere, o ~15 s antes de la DLQ) y puede haber **duplicados** (ADR-003). Se pierde consistencia inmediata |

**Verificado:** con el proceso de notificaciones muerto (`kill -9`) la ingesta respondió `202` y la alerta quedó creada con `lag 1` en el grupo `notifications`; al reiniciar se entregó por los dos canales y el `lag` volvió a 0 (≤ 3 s). Con el proveedor caído se observaron reintentos a 1 s, 2 s, 4 s y 8 s, `dead_letter` tras 5 intentos, el canal `log` enviado **una sola vez** y 1 mensaje en la DLQ.

**Proveedor de IA — no verificado en el esqueleto.** El esqueleto no incluye IA. El diseño la trata como un consumidor más de `alert.raised` (un resumen es un *enriquecimiento*, no un requisito para avisar), de modo que su falla no puede bloquear la alerta ni la notificación. El backend existente ya la tiene con proveedor seleccionable (`AI_PROVIDER`) y *fallback* heurístico cuando el proveedor falla.

---

## E2 · La ingesta rechaza lecturas falsas o repetidas (hoja S1)

| Parte | Descripción |
|---|---|
| **Fuente** | Un atacante que captura tráfico o conoce un token de collar |
| **Estímulo** | (a) reenvía una petición legítima capturada, (b) firma con un secreto incorrecto, (c) usa un timestamp de hace 20 minutos, (d) usa un collar inexistente, (e) usa un collar deshabilitado |
| **Entorno** | Producción, endpoint de ingesta expuesto a Internet |
| **Artefacto** | El servicio de ingesta |
| **Respuesta** | Rechaza con un código genérico (`409` replay, `401`, `403`), registra `security.rejected` con el **motivo real** y **no publica ningún evento** |
| **Medida** | 5 de 5 variantes rechazadas · 0 eventos publicados por peticiones rechazadas · la respuesta no distingue "no existe" de "firma mala" |
| **Se prueba con** | `docker compose run --rm tools attack replay \| forged \| stale` y `tools demo` |
| **Qué se degrada** | Un poco de **latencia por petición** (verificar HMAC + consulta de nonce) y la **disponibilidad ante relojes desviados**: un collar con reloj fuera de ±300 s es rechazado (punto de compromiso en `05-riesgos.md`) |

**Verificado:** la demo comprueba las 5 variantes (replay → `409`, firma falsa → `401`, timestamp viejo → `401`, collar desconocido → `401`, collar deshabilitado → `403`). El contador del stream quedó en 3 eventos tras la lectura normal, la lectura fuera de geocerca y la primera copia del replay: los rechazados no publicaron nada. Más 6 pruebas unitarias de firma y ventana de tiempo.

---

## E3 · Agregar un canal, un tipo de alerta o un proveedor de IA sin tocar el núcleo (hoja M1)

| Parte | Descripción |
|---|---|
| **Fuente** | Una persona del equipo de desarrollo |
| **Estímulo** | El negocio pide (a) avisar también por SMS, (b) un tipo de alerta nuevo (p. ej. temperatura) o (c) cambiar de proveedor de IA |
| **Entorno** | Mantenimiento, con el sistema en producción |
| **Artefacto** | Servicio de notificaciones (a), servicio de alertas (b), consumidor de IA (c) |
| **Respuesta** | (a) se agrega un adaptador de canal y se activa por configuración; (b) se agrega una regla al arreglo de reglas; (c) se cambia por configuración. Los demás servicios no se modifican ni se redespliegan |
| **Medida** | 0 archivos modificados en Ingesta, Alertas y Seguimiento · cambio acotado a ~12 líneas nuevas en `channels.js` y 2 líneas modificadas en `notifications/index.js` |
| **Se prueba con** | (a) `NOTIFY_CHANNELS=log,email,sms` y `tools send exit`; (b) la prueba `E3: agregar un tipo de alerta nuevo…` en `tests/rules.test.js` |
| **Qué se degrada** | Una **capa de indirección** más (el adaptador) y hay que **versionar el contrato** del evento `alert.raised` para que los consumidores viejos no se rompan |

**Verificado (a):** con `NOTIFY_CHANNELS=log,email,sms` la misma alerta se entregó por los tres canales (`sms SENT | email SENT | log SENT`).

**Verificado (b):** una prueba agrega una regla `HIGH_TEMPERATURE` al arreglo y `evaluate()` la aplica sin modificarse.

**No verificado (c):** el cambio de proveedor de IA lo cubre el backend existente (`AI_PROVIDER`: tres proveedores intercambiables); el esqueleto no tiene IA.

---

## E4 · Crecer 10× sin perder el ritmo (hoja P1)

| Parte | Descripción |
|---|---|
| **Fuente** | El crecimiento del negocio (más fincas y collares) |
| **Estímulo** | La carga sube de ≈ 33 a ≈ 330 lecturas/s (supuesto en `01-drivers.md`) |
| **Entorno** | Operación normal |
| **Artefacto** | Ingesta + bus + consumidores |
| **Respuesta** | La ingesta acepta sin errores y los consumidores mantienen el backlog en cero |
| **Medida** | Aceptación p95 ≤ 200 ms · atraso de los consumidores p95 ≤ 1 s · 0 errores |
| **Se prueba con** | `docker compose run --rm tools load --rps 330 --seconds 10` |
| **Qué se degrada** | **Costo** (más procesos/réplicas) y **consistencia**: con más carga las alertas llegan un poco más tarde |

**Verificado** (prueba de carga en un entorno de 2 vCPU **compartido** con el generador de carga, así que es orientativa y no una capacidad real):

| Carga | Lecturas aceptadas | Aceptación p95 | Atraso consumidor `alerts` p95 |
|---|---|---|---|
| 100 /s | 1 000 / 1 000 | 3,5 ms | 2 ms |
| 500 /s | 5 000 / 5 000 | 12 ms | 3 ms |
| 1 000 /s | 10 000 / 10 000 | 35 ms | 5 ms |
| 2 000 /s | 20 000 / 20 000 | **782 ms** (supera la meta) | 27 ms |

La meta se cumple con holgura hasta 1 000 lecturas/s (≈ 30× la carga de referencia). A 2 000/s lo primero que se degrada es la **latencia de aceptación de la ingesta**, sin errores; los consumidores siguen al día. No se puede atribuir con certeza a la ingesta o al generador de carga porque comparten CPU.
