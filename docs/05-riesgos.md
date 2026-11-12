# 5 · Riesgos y evaluación de la arquitectura

> Pieza del entregable: **Riesgos identificados** (al menos dos, con lo que habría que verificar para descartarlos).

Siguiendo la evaluación tipo ATAM del curso, los hallazgos se clasifican en **riesgos** (decisiones que podrían impedir
cumplir un atributo), **no-riesgos** (decisiones verificadas), **puntos sensibles** (un atributo depende mucho de la
decisión) y **puntos de compromiso** (la decisión mejora un atributo y empeora otro).

Estado de verificación: ✅ verificado en el esqueleto · 🔶 verificado parcialmente · ⬜ **no verificado**.

---

## Riesgos

### R1 · Redis es un punto único de falla y de pérdida de datos
*Decisión:* [ADR-0002](adr/0002-redis-streams-como-bus.md) · *Atributo en riesgo:* disponibilidad (D1, D2) · *Hoja negociada:* H1

Si el bus cae, la ingesta no puede aceptar lecturas; si además pierde datos, se pierden eventos y estado.

| Qué habría que verificar para descartarlo | Estado | Evidencia |
|---|---|---|
| Que con el bus caído la ingesta **no se cuelgue** | ✅ | Respondió `503` en ~40 ms; `/health` pasó a `DEGRADED` |
| Que el sistema **se recupere solo** al volver Redis | ✅ | Tras reiniciar Redis sin persistencia, los consumidores recrearon su grupo y la siguiente alerta fluyó |
| Que **matar el proceso** de Redis no pierda eventos confirmados (con AOF) | ✅ | 43 497 de 43 497 eventos sobrevivieron a `kill -9` |
| Que una **caída de la máquina o del disco** pierda poco | ⬜ | Con `appendfsync everysec` se podrían perder hasta ~1 s de escrituras; no se midió |
| Que un **fallo de Redis con réplicas** conmute sin pérdida | ⬜ | No hay réplicas ni Sentinel (hoja H1 negociada) |
| Que el **collar real** guarde y reenvíe cuando recibe `503` | ⬜ | Depende del firmware; no se probó con hardware |

**Estado:** abierto. Para descartarlo del todo hace falta Redis replicado y firmware con cola local.

### R2 · El desorden y los duplicados podrían producir alertas falsas o perdidas
*Decisión:* [ADR-0003](adr/0003-entrega-al-menos-una-vez-e-idempotencia.md) · *Atributo en riesgo:* corrección de las alertas (D1)

Con entrega *al menos una vez* y varias réplicas por grupo no hay orden garantizado. Hoy se evita con reglas sin estado
y un cooldown atómico; una regla futura con estado, o una condición de carrera no prevista, podría romperlo.

| Qué habría que verificar para descartarlo | Estado | Evidencia |
|---|---|---|
| Que **dos réplicas** del mismo grupo no dupliquen alertas | ✅ | 2 400 lecturas → exactamente 20 alertas (una por vaca), 221 suprimidas por cooldown |
| Que la creación de la alerta y la publicación del evento sean **atómicas** | 🔶 | Diseñado con un script Lua; probado en funcionamiento normal, **no** con una caída justo en medio |
| Que lecturas **fuera de orden** no pisen datos más nuevos | 🔶 | La "última posición" solo avanza si la lectura es más reciente (en el código); no hay una prueba automática que invierta el orden |
| Que las **reglas con estado** funcionen con réplicas | ⬜ | Fuera de alcance; hoy están prohibidas por diseño |

**Estado:** abierto. Pendiente: una prueba que reordene lecturas y una que mate el proceso entre el `SET` y el `XADD`.

### R3 · Atraso de las alertas bajo carga sostenida (consistencia eventual)
*Decisión:* [ADR-0001](adr/0001-arquitectura-orientada-a-eventos.md) · *Atributo en riesgo:* rendimiento (P1)

Si los consumidores no dan abasto, el *backlog* crece y las alertas llegan tarde sin que nadie lo note.

| Qué habría que verificar para descartarlo | Estado | Evidencia |
|---|---|---|
| Que el atraso se mantenga bajo con **10× la carga de referencia** | ✅ | A 500 lecturas/s: atraso p95 del consumidor de alertas 3 ms; backlog en 0 |
| Dónde está el **límite** | 🔶 | A 2 000/s la aceptación p95 sube a 782 ms sin errores; entorno de 2 vCPU **compartido con el generador**, no es capacidad real |
| Que aguante carga **durante horas** y con un **proveedor lento** | ⬜ | Solo se probaron corridas de 10 s |
| Que **alguien se entere** si el backlog crece | ⬜ | Se mide el atraso (`tools status`), pero no hay alarma |

**Estado:** parcialmente descartado para 10×; abierto para carga sostenida.

### R4 · La complejidad operativa supera la capacidad de un equipo de tres
*Decisión:* [ADR-0001](adr/0001-arquitectura-orientada-a-eventos.md) · *Atributo en riesgo:* operabilidad

Pagamos el costo de varios procesos sin tener varios equipos (el curso lo advierte). Si nadie puede diagnosticar una falla
a las 2 a. m., el aislamiento de fallas no sirve.

| Qué habría que verificar para descartarlo | Estado | Evidencia |
|---|---|---|
| Que **cualquier integrante** levante todo con un comando | ⬜ | `docker compose up --build` está definido y su sintaxis valida, **pero no se ejecutó con Docker** (sin daemon en el entorno de desarrollo); los procesos sí se probaron individualmente contra un Redis real |
| Que una falla inyectada se **diagnostique solo con los logs** | 🔶 | Los logs JSON incluyen `correlationId`/`causationId` y se usaron para leer los reintentos; no se cronometró un diagnóstico |

**Estado:** abierto. La verificación más barata: que los tres integrantes corran el README en sus equipos.

---

## No-riesgos (decisiones verificadas)

| # | Decisión | Evidencia |
|---|---|---|
| NR1 | Autenticación HMAC + ventana de tiempo + nonce | 5 de 5 ataques rechazados; 0 eventos publicados por rechazos; 6 pruebas unitarias |
| NR2 | Aislamiento de fallas de Notificaciones | `kill -9` del servicio: ingesta `202` y alerta entregada al volver |
| NR3 | Agregar un canal sin tocar el resto | SMS entregó junto a correo y log con ~12 líneas en un solo servicio |
| NR4 | Reintentos con backoff y DLQ | Reintentos a 1/2/4/8 s y `dead_letter` a los 5 intentos |

## Puntos sensibles (un atributo depende mucho de una decisión)

| Decisión | Atributo que depende de ella | Qué pasa si se cambia |
|---|---|---|
| `DEVICE_AUTH_WINDOW_SECONDS` = 300 s | Seguridad (ventana de replay) | Más ancha: más margen para repetir peticiones. Más angosta: se rechazan collares con el reloj desviado |
| `MAX_ATTEMPTS` y backoff base | Latencia de entrega ↔ carga sobre el proveedor | Menos intentos: la DLQ se llena antes. Más: una notificación fallida tarda más |
| `ALERT_COOLDOWN_SECONDS` | Ruido de alertas | Más corto: avalancha de avisos. Más largo: se puede silenciar un incidente real |

## Puntos de compromiso (mejoran un atributo y empeoran otro)

| Decisión | Mejora | Empeora |
|---|---|---|
| Procesamiento asíncrono (`202` + bus) | Disponibilidad y rendimiento de la ingesta | Consistencia inmediata y facilidad de depurar |
| Validar timestamp ±300 s | Seguridad (anti-replay) | Disponibilidad ante relojes desviados de los collares |
| AOF `everysec` | Durabilidad frente a un reinicio | Rendimiento de escritura y ~1 s de pérdida posible ante caída de la máquina |
| Un servicio por contexto | Aislamiento de fallas (D2) | Simplicidad operativa (R4) |
