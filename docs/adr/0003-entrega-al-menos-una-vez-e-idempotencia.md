# ADR-0003 · Entrega al menos una vez, consumidores idempotentes, reintentos con backoff y DLQ

**Estado:** Aceptada · 2026-11-11

## Contexto

D1 exige que ninguna alerta se pierda. Pero los procesos mueren, las redes fallan y el proveedor de correo cae (R4).
Además los collares reenvían lecturas (R3), así que ya llegan duplicados desde el origen.

Lo que sabemos del terreno:

- Redis Streams entrega los mensajes y permite confirmarlos (`XACK`); no ofrece *exactly-once* de extremo a extremo.
- El proveedor de correo **no participa en transacciones** con nuestro estado: no se puede "enviar y confirmar" de forma atómica.
- Un mensaje que siempre falla (venenoso) no debe bloquear a los demás.
- Un proveedor caído no debe recibir una avalancha de reintentos.

## Decisión

1. Un mensaje se confirma **solo después** de procesarse sin error; si el proceso muere o el handler falla, queda pendiente y se reintenta.
2. Reintentos con **backoff exponencial** (1, 2, 4, 8 s); tras **5 intentos** el mensaje pasa a una **DLQ** (stream de mensajes fallidos) y deja de bloquear.
3. Todos los consumidores son **idempotentes**: el id de alerta se deriva de la lectura y la regla; la creación de la alerta y la publicación de `alert.raised` se hacen en un solo paso atómico (script Lua); la entrega se marca **por canal** y los reintentos solo repiten el canal que falló; el historial de posiciones usa un conjunto ordenado (reprocesar no duplica).
4. Las reglas de alerta son **sin estado** (cada lectura se evalúa sola) y hay un **cooldown** por vaca y tipo de alerta.

## Alternativas consideradas

1. **A lo sumo una vez (confirmar al leer, antes de procesar).** *Descartada.* Es simple y nunca duplica, pero una caída en medio del procesamiento **pierde la alerta**, lo que viola D1 directamente.
2. **Exactamente una vez (transacciones distribuidas / 2PC).** *Descartada.* Exigiría coordinar Redis con el proveedor de correo, que no admite transacciones; el costo y la complejidad serían desproporcionados. En la práctica, "exactamente una vez" se logra con *al menos una vez + idempotencia*, que es lo que hacemos.
3. **Reintentar de inmediato en bucle, sin backoff ni DLQ.** *Descartada.* Con el proveedor caído generaría una tormenta de reintentos, y un mensaje venenoso bloquearía la cola para siempre.

## Consecuencias

**Lo bueno**

- No se pierde ninguna alerta ante la muerte de un proceso (verificado con `kill -9`).
- Un mensaje irrecuperable queda aislado en la DLQ; los reintentos salieron a 1, 2, 4 y 8 s (verificado).
- Dos réplicas de Alertas procesando el mismo grupo no duplicaron ninguna alerta (2 400 lecturas → 20 alertas, una por vaca; 221 suprimidas por cooldown).

**Lo malo (lo que se pierde o se vuelve más difícil)**

- **Pueden existir duplicados.** Si el servicio muere *entre* enviar el correo y marcarlo como entregado, el aviso se envía dos veces. La ventana es pequeña; se mitigaría con una llave de idempotencia en el proveedor real (no implementada).
- **La DLQ necesita que alguien la mire.** Hoy solo se puede listar (`GET /dlq`); falta reencolar. El backend actual sí tiene reencolado administrativo.
- **Más disciplina y más pruebas:** cada regla y cada consumidor deben escribirse y probarse pensando en reentregas y desorden.
- **Las reglas con estado quedan prohibidas por ahora** (p. ej. "entró y luego salió"): con desorden entre réplicas producirían falsas alertas. Es una limitación consciente (riesgo R2).
- **El cooldown puede silenciar un incidente real** durante su ventana (30 s en la demo); el valor hay que calibrarlo con el negocio.
- **Una notificación fallida tarda más:** hasta ~15 s antes de ir a la DLQ con la configuración de la demo.
