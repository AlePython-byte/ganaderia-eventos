# ADR-0001 · Arquitectura orientada a eventos entre servicios independientes

**Estado:** Aceptada · 2026-11-11

## Contexto

El monitoreo de Ganadería 4.0 hoy corre en un solo proceso Spring Boot: recibir la lectura, evaluar reglas, enviar
correos y generar resúmenes con IA ocurren en el mismo proceso. El correo ya tiene una tabla *outbox* para reintentos,
pero el resto comparte fallos y recursos.

Lo que sabemos:

- **D1:** una alerta perdida es una vaca perdida; no puede perderse porque falle el correo o un servicio (importancia alta, dificultad alta).
- **D2:** la recepción de lecturas debe seguir aceptándolas aunque lo demás esté caído o lento (alta, alta).
- **M1:** se agregarán canales (SMS está pendiente) sin querer tocar lo que ya funciona (alta, media).
- **R3 y R4:** los collares reintentan y duplican lecturas por la conectividad rural; el proveedor de correo falla.
- **R5:** un solo equipo de tres personas despliega todo, y las laptops tienen 8 GB de RAM.
- El backend actual tiene una suite de 475 pruebas y **no se va a reescribir** (se queda como contexto de Gestión).

## Decisión

Ingesta publica el hecho `location.reported` en un bus durable; **Alertas** y **Seguimiento** lo consumen por separado;
Alertas publica `alert.raised`, que consume **Notificaciones**. Cada servicio es un proceso independiente y solo conoce el
contrato del evento, nunca a sus productores o consumidores.

## Alternativas consideradas

1. **Mantener el monolito en capas (estado actual).** *Descartada.* Es la opción más simple y ya tiene 475 pruebas; para el volumen actual probablemente bastaría. Se descarta por **D1/D2**, no por moda: comparte proceso y falla en bloque, de modo que una lentitud en notificaciones o IA puede frenar la ingesta, y no se puede reiniciar ni escalar la ingesta por separado.
2. **Monolito modular con eventos internos y outbox transaccional** (el patrón que ya usa el correo, generalizado). *Descartada, y es la alternativa más fuerte.* Cubre **D1** con un solo despliegue y es bastante más barata de operar. Se descarta porque sigue compartiendo proceso y JVM: una caída o saturación tumba también la ingesta, incumpliendo **D2**. Si D2 no fuera un driver, elegiríamos esta.
3. **Servicios separados con llamadas síncronas (HTTP) en cadena.** *Descartada.* Acopla la disponibilidad: si Notificaciones cae, la cadena falla o hay que reintentar desde Ingesta, y el collar queda esperando toda la cadena; esto viola **D1** y **D2**.

## Consecuencias

**Lo bueno**

- Las fallas quedan aisladas: con notificaciones caído la ingesta siguió respondiendo `202` y la alerta se entregó al volver el servicio (E1 verificado).
- Un consumidor nuevo se suma sin modificar a nadie: SMS se agregó con ~12 líneas en un solo servicio (E3 verificado).
- Los consumidores escalan por réplicas: dos réplicas de Alertas repartieron 2 400 lecturas sin duplicar ninguna alerta.

**Lo malo (lo que se pierde o se vuelve más difícil)**

- **Consistencia eventual.** La alerta aparece después de la lectura, no en la misma transacción. Medido: p95 del atraso del consumidor de alertas entre 2 y 5 ms hasta 1 000 lecturas/s, pero ya no es instantáneo ni atómico.
- **Pagamos el costo de los microservicios sin recibir su beneficio principal.** El curso explica que se compra *autonomía de despliegue entre equipos*; aquí hay un solo equipo. Lo justificamos únicamente por el aislamiento de fallas (D2).
- **Más piezas que operar:** 4 servicios más el bus (5 procesos), para un equipo de 3. Es el atributo que más empeora.
- **Depurar cuesta más:** un incidente cruza procesos. Se mitiga con `correlationId` y `causationId` en cada evento y log.
- **Dos fuentes de verdad en transición:** Gestión (PostgreSQL) y el estado de eventos (Redis).
- Obliga a tolerar **duplicados y desorden** (ver ADR-0003).
