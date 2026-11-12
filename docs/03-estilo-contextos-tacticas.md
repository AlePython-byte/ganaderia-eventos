# 3 · Estilo, contextos delimitados y tácticas

> Piezas del entregable: **Estilo elegido** (cuál, por qué driver, qué sacrifica) · **Contextos delimitados** (fronteras y la señal que justifica cada una) · **Tácticas aplicadas** (cuáles, contra qué escenario, qué degradan).

---

## 3.1 Estilo elegido: arquitectura orientada a eventos (publicación/suscripción)

**Qué es aquí.** Los servicios no se llaman entre sí. Ingesta publica el hecho `location.reported` en un bus durable;
Alertas y Seguimiento lo consumen **por separado**; Alertas publica `alert.raised`; Notificaciones lo consume.
Cada servicio es un proceso independiente y solo conoce el **contrato del evento**, nunca a quién lo produce o lo consume.

**Por qué (traza a los drivers).**

| Decisión de estructura | Driver que la justifica |
|---|---|
| Bus durable entre servicios: el mensaje sigue ahí aunque el consumidor esté caído | **D1** (ninguna alerta se pierde) |
| Procesos separados: una falla o lentitud en Notificaciones/Alertas no afecta a Ingesta | **D2** (la ingesta sigue aceptando) |
| Productores que no conocen a los consumidores: agregar un consumidor no modifica a nadie | **M1** (nuevo canal sin tocar el resto) |
| La ingesta responde `202` sin esperar el procesamiento | **P1** (aceptar rápido bajo carga) |

**Qué sacrifica (atributos que empeoran).**

- **Consistencia inmediata:** la alerta aparece después de la lectura, no en la misma transacción. Aceptable porque "a tiempo" significa segundos (supuesto en `01-drivers.md`).
- **Simplicidad operativa:** 4 servicios más el bus (5 procesos) para un equipo de 3. El curso advierte que separar servicios compra *autonomía de despliegue entre equipos*; **tenemos un solo equipo, así que pagamos ese costo sin recibir ese beneficio**. Lo justificamos por **aislamiento de fallas (D2)**, no por autonomía de equipo.
- **Facilidad de depurar:** un incidente cruza procesos (se mitiga con `correlationId`/`causationId`).
- **Orden y unicidad de mensajes:** hay duplicados y desorden; las reglas y consumidores deben tolerarlos (ADR-003).

**Alternativas evaluadas y descartadas:** monolito en capas, monolito modular con eventos internos y microservicios síncronos → ver [ADR-001](adr/0001-arquitectura-orientada-a-eventos.md).

---

## 3.2 Contextos delimitados

Cada frontera se justifica con **una de las cuatro señales del curso**: vocabulario, dueño, ritmo de cambio o carga.
Ninguna es técnica: salen del negocio y de la organización.

| Contexto | Responsabilidad | Señal que justifica la frontera |
|---|---|---|
| **Ingesta de dispositivos** | Recibir lecturas firmadas y rechazar lo no auténtico | **Carga**: recibe una petición por cada lectura de cada collar, mucho más que cualquier otro contexto. **Dueño**: lo determina el protocolo del dispositivo (HMAC), no la lógica de la finca |
| **Alertas** | Aplicar las reglas de negocio y producir alertas | **Ritmo**: las reglas cambian seguido (nuevos tipos de alerta, umbrales); **Vocabulario**: "geocerca", "incidente", "severidad" |
| **Notificaciones** | Entregar avisos por canal con reintentos | **Ritmo**: los proveedores y canales cambian por razones externas (correo hoy, SMS mañana); **Vocabulario**: "canal", "destinatario", "entrega" |
| **Seguimiento** | Última posición e historial de cada vaca | **Vocabulario**: "trayectoria", "última posición" ≠ "incidente". **Es la frontera más débil** (ver abajo) |
| **Gestión** *(existente, no se parte)* | Fincas, vacas, collares, usuarios, reportes | Se queda como el monolito Spring Boot actual |

### La misma palabra significa cosas distintas (señal de vocabulario)

| Término | En **Ingesta** | En **Alertas** | En **Gestión** |
|---|---|---|---|
| **Collar** | Dispositivo con un secreto, un nonce y un reloj | Origen de una lectura | Inventario: ficha asignada a una vaca |
| **Vaca** | No existe: solo conoce el collar (el `cowId` lo fija el servidor al autenticar) | Sujeto de incidentes y de cooldown | Registro administrativo (`COW-xxx`, activa/inactiva) |

Forzar un único modelo de "collar" y "vaca" para los tres contextos produciría un objeto enorme que no sirve bien a ninguno.

### Lo que NO partimos (y por qué)

**Gestión** queda como monolito: un solo dueño, ritmo bajo, sin señal de carga distinta. Partirla pagaría el costo de
operar más servicios sin recibir ningún beneficio ("cuándo NO partir").

### La frontera más débil: Seguimiento

Un revisor puede decir que Seguimiento es demasiado delgado para ser un contexto. Es cierto: lo separamos por
vocabulario y porque es la base de la regla `COLLAR_OFFLINE` (necesita saber cuándo fue la última lectura). Su valor
inmediato es **demostrar que el mismo evento lo procesan dos consumidores independientes**. Si el negocio no lo
necesita, es la primera pieza que se fusionaría con Alertas.

### Mapa de contextos (relaciones)

```
Gestión ··(datos de referencia: secretos de collares, geocercas)··▶ Ingesta, Alertas      [esqueleto: shared/seed.js]
Ingesta ──(evento location.reported, contrato versionado)──▶ Alertas, Seguimiento
Alertas ──(evento alert.raised, contrato versionado)──────▶ Notificaciones
```

Los eventos son el **lenguaje publicado** entre contextos: un contexto no ve el modelo interno del otro.

---

## 3.3 Tácticas aplicadas

Nombres tomados de la tabla de tácticas del curso. **Estado:** ✅ implementada y verificada en el esqueleto ·
◻ existe en el backend actual, no en el esqueleto · ✖ no se aplica (declarado como riesgo).

| Atributo | Táctica | Escenario | Dónde | Estado | "Y pagas con" (qué degrada) |
|---|---|---|---|---|---|
| Seguridad | **Autenticar** (HMAC-SHA256 sobre petición canónica) | E2 | `shared/signing.js` | ✅ | Latencia por petición |
| Seguridad | **Autenticar** (nonce único: anti-replay) | E2 | `services/ingestion/index.js` | ✅ | Estado en el bus; relojes desviados rechazados |
| Seguridad | **Auditar** (`security.rejected` con el motivo real) | E2 | `services/ingestion/index.js` | ✅ | Volumen de logs |
| Seguridad | **Limitar la tasa** de peticiones | E2 | — | ◻ | Usabilidad (falsos bloqueos) |
| Disponibilidad | **Reintento** con backoff exponencial | E1 | `shared/consumer.js` | ✅ | Consistencia: entregas tardías; **duplicados** |
| Disponibilidad | **Degradación elegante** (un canal caído no bloquea al resto; ingesta responde `503` rápido si el bus cae) | E1 | `services/notifications/index.js`, `shared/redis.js` | ✅ | Funcionalidad parcial durante la falla |
| Disponibilidad | **Detección de fallos** (`/health` + healthcheck de Docker) | E1 | `docker-compose.yml` | ✅ | Costo de los chequeos |
| Disponibilidad | **Redundancia** del bus | — | — | ✖ | Costo y consistencia → hoja H1 negociada; riesgo R1 |
| Rendimiento | **Procesamiento asíncrono** (`202` + stream) | E4 | `services/ingestion/index.js` | ✅ | Consistencia eventual; complejidad |
| Rendimiento | **Agrupar en lotes** (el consumidor lee hasta 10 eventos por vez) | E4 | `shared/consumer.js` | ✅ | Latencia mínima por lote |
| Modificabilidad | **Usar un intermediario** (bus pub/sub) | E1, E3 | `shared/config.js`, `shared/events.js` | ✅ | Latencia y una capa de indirección |
| Modificabilidad | **Encapsular** (adaptadores de canal; reglas como arreglo) | E3 | `services/notifications/channels.js`, `services/alerts/rules.js` | ✅ | Indirección |
| Modificabilidad | **Contratos versionados** (campo `version` del sobre) | E3 | `shared/events.js` | ✅ | Hay que mantener versiones en paralelo |
| Modificabilidad | **Aplazar la decisión** (canales activos por configuración) | E3 | `shared/config.js` | ✅ | Más combinaciones que probar |
| Disponibilidad | **Reintento idempotente** (id determinista + creación atómica en Lua + marca de entrega por canal) | E1 | `services/alerts/index.js`, `services/notifications/index.js` | ✅ | Disciplina de código; ventana residual de duplicado |

---

## 3.4 Cómo se derivó el diseño (procedimiento ADD)

Un driver a la vez, del más importante al menos: en cada paso se elige la parte a refinar, las tácticas, las
responsabilidades/interfaces y **se verifica qué se degradó**.

| Paso | Driver | Parte refinada | Tácticas | Responsabilidades / interfaces | Verificación y qué se degradó |
|---|---|---|---|---|---|
| 1 | **D1** ninguna alerta se pierde | El camino alerta → notificación | Intermediario durable, reintento, DLQ, idempotencia | Alertas **publica** `alert.raised`; Notificaciones confirma (XACK) **solo** tras entregar | E1 ✅. Se degradó: consistencia inmediata y aparecen duplicados |
| 2 | **D2** la ingesta no depende de nadie | Separación Ingesta / consumidores | Procesos separados + asíncrono | Ingesta solo conoce el bus y el contrato `location.reported` | E1 ✅ (`202` con consumidores caídos). Se degradó: simplicidad operativa |
| 3 | **S1** lecturas auténticas | Borde de la ingesta | Autenticar, nonce, auditar | Ingesta valida *antes* de publicar; el `cowId` lo fija el servidor | E2 ✅. Se degradó: latencia y tolerancia a relojes desviados |
| 4 | **M1** nuevo canal sin tocar el resto | Servicio de notificaciones | Encapsular, aplazar la decisión, contratos versionados | Interfaz `send(msg)` por canal; canales por configuración | E3 ✅. Se degradó: una capa más |
| 5 | **P1** crecer 10× | Ingesta y consumidores | Asíncrono, lotes, réplicas por grupo | Nombre único por réplica; cooldown atómico | E4 ✅ hasta 1 000 lecturas/s. Se degradó: costo |

Se detiene aquí porque los drivers de la parte alta del árbol (D1, D2, S1, M1) quedaron atendidos. Quedan sin atender
a propósito H1 (negociada) y las hojas de importancia media/baja que se resuelven programando (O1).
