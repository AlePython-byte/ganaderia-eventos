# ADR-0002 · Redis Streams como bus de eventos

**Estado:** Aceptada · 2026-11-11

## Contexto

La decisión del ADR-0001 necesita un bus que **conserve** los eventos aunque el consumidor esté caído, que reparta el
trabajo entre réplicas y que permita saber qué mensajes quedaron sin confirmar (para reintentarlos).

Condiciones:

- Debe arrancar con un solo comando, en laptops de 8 GB de RAM (R6, R7).
- El equipo de tres no tiene experiencia operando Kafka; sí conoce Redis y PostgreSQL.
- La ingesta además necesita guardar *nonces* con expiración (anti-replay, S1).
- La carga de referencia es ≈ 33 lecturas/s (supuesto), con un objetivo de 10× (≈ 330/s).
- El backend actual ya usa una tabla *outbox* en PostgreSQL para el correo.

## Decisión

Usar **Redis 7 Streams** con grupos de consumidores y persistencia **AOF** (`appendfsync everysec`). El mismo Redis
guarda los nonces y el estado pequeño de cada servicio.

## Alternativas consideradas

1. **RabbitMQ.** *Descartada.* Es una opción sólida, con confirmaciones y colas de mensajes fallidos nativas. Se descarta por: (a) con colas clásicas un mensaje confirmado desaparece, así que un consumidor nuevo no puede releer el histórico ni se puede reproducir un incidente para depurarlo; (b) agrega un broker nuevo para aprender y aun así necesitaríamos Redis o una base para los nonces. No es que RabbitMQ no sirva: pesó la curva de aprendizaje y la cantidad de piezas.
2. **Apache Kafka.** *Descartada.* Da orden por clave (resolvería el orden por vaca) y escala mucho más. Se descarta por el peso operativo (brokers, coordinación) y de memoria en laptops de 8 GB, y porque el volumen de referencia no lo justifica. **Es el camino de escalamiento** si la carga supera lo que Redis aguante.
3. **Tabla outbox en PostgreSQL con sondeo.** *Descartada.* Evita infraestructura nueva y ya existe para el correo. Se descarta porque cada lectura de collar (el camino de mayor volumen) cargaría la base transaccional con escrituras y con el sondeo de los consumidores, agregaría latencia por el intervalo de sondeo y mezclaría los eventos con el esquema de Gestión.

## Consecuencias

**Lo bueno**

- Un solo contenedor liviano que arranca en segundos, con grupos de consumidores y mensajes pendientes nativos (`XPENDING`, `XCLAIM`): los reintentos y la DLQ resultaron simples de implementar y se verificaron.
- El mismo Redis sirve el anti-replay (`SET NX EX`), una pieza menos.
- Los consumidores se recuperan solos si Redis pierde los datos (recrean su grupo): verificado.

**Lo malo (lo que se pierde o se vuelve más difícil)**

- **Redis es un punto único de falla.** Con el bus caído la ingesta responde `503` en ~40 ms (falla rápido, no se cuelga) y el collar debe reintentar o guardar la lectura; qué hace el firmware real **no está verificado**. No hay réplicas ni conmutación (hoja H1, negociada).
- **Durabilidad con matices.** Sin persistencia, un reinicio pierde todo el estado (verificado). Con AOF, matar el proceso de Redis no perdió ningún evento (43 497 de 43 497), pero una caída de la **máquina** podría perder hasta ~1 s de escrituras con `everysec`; esto **no se midió**.
- **Sin orden por vaca entre réplicas** de un mismo grupo y sin registro de esquemas de eventos; la entrega es *al menos una vez*.
- **Estado en Redis como deuda.** En el esqueleto, Alertas y Seguimiento guardan su estado en Redis; en el diseño objetivo cada servicio tendría su esquema en PostgreSQL. Cuando eso ocurra, la creación atómica estado+evento (hoy un script Lua) deberá pasar a un outbox transaccional.
- **Retención acotada:** los streams se recortan por tamaño aproximado (`MAXLEN ~`), así que los eventos viejos se pierden y no sirven como archivo histórico.
