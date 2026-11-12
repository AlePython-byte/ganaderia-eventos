# 6 · Guía de sustentación (7 min de defensa + 3 de preguntas)

> El profesor lo dice claro: la IA escribe documentación impecable sobre decisiones que no se tomaron, y eso se nota en
> treinta segundos de conversación. **Esta guía es para estudiar, no para leer en voz alta.** Cada integrante debe poder
> explicar con sus propias palabras *por qué* y *qué descartamos*. Ensayen con cronómetro.

La nota que "más distingue" es defender las **alternativas descartadas**. Si solo van a memorizar una cosa: las tres
tablas de "Alternativas consideradas" de los ADR.

## Guion de 7 minutos

| Min | Qué se dice | Qué se muestra |
|---|---|---|
| 0:00–0:45 | **El dominio y el problema.** Collares IoT en ganado; una alerta perdida es una vaca perdida; las redes rurales y los proveedores de correo fallan | `docs/04-c4.md`, diagrama de nivel 1 |
| 0:45–2:00 | **Drivers.** Árbol de utilidad: dos hojas (A, A) —ninguna alerta se pierde y la ingesta no depende de nadie—; una negociada (H1: alta disponibilidad del bus). Origen: operación rural y proveedores externos | `docs/01-drivers.md`, el árbol |
| 2:00–3:00 | **Estilo y contextos.** Orientado a eventos; cuatro contextos nuevos más Gestión que no se parte; señal de cada frontera | Diagrama C4 nivel 2 |
| 3:00–5:30 | **Demo en vivo** (comandos abajo) | Terminal con `docker compose up` ya corriendo |
| 5:30–6:30 | **Qué descartamos y qué empeoró** (ADR-0001, 0002, 0003) | `docs/adr/` |
| 6:30–7:00 | **Riesgos abiertos** y cierre | `docs/05-riesgos.md` |

## Demo en vivo (2 min 30 s)

Antes de empezar: `docker compose up --build` ya corriendo y `docker compose ps` con todo en *healthy*. **Prueben esto la noche anterior.** Ojo con `--no-deps`: sin él, `docker compose run` vuelve a arrancar el servicio que detuvieron.

```bash
# 1. Todo en un comando: historia completa, con verificaciones (45 s)
docker compose run --rm --no-deps tools demo

# 2. Falla de un servicio: no se pierde nada (45 s)
docker compose stop notifications
docker compose run --rm --no-deps tools send exit
docker compose run --rm --no-deps tools status       # la alerta existe, la entrega está pendiente
docker compose start notifications
docker compose run --rm --no-deps tools status       # ya entregada

# 3. Ataque (20 s)
docker compose run --rm --no-deps tools attack replay
```

Si el tiempo aprieta: el paso 1 solo ya demuestra evento + dos consumidores + seguridad. El paso 2 es el que más impresiona porque muestra el *por qué* de la arquitectura.

## Las cuatro preguntas publicadas

### 1 · "¿Qué driver justifica esta decisión, y de dónde salió ese driver?"

- **Estilo orientado a eventos →** D1 (ninguna alerta se pierde) y D2 (la ingesta sigue aceptando). Salen de dos restricciones del dominio: la conectividad rural intermitente (R3) y los proveedores externos que fallan (R4). No de "es moderno".
- **Redis Streams →** el driver es que el bus **conserve** los eventos y permita reintentos, más la restricción de laptops de 8 GB y arranque con un comando.
- **Al menos una vez + idempotencia →** D1: perder una alerta es peor que recibirla dos veces.
- **HMAC + nonce →** S1, que sale de la restricción R1 (el protocolo de los collares ya existe) y de que el endpoint está abierto a Internet.

### 2 · "¿Qué alternativa descartaron aquí, y por qué?"

| Decisión | Alternativa descartada | Por qué (honesto) |
|---|---|---|
| Estilo | **Monolito modular con eventos internos y outbox** *(la más fuerte)* | Cubre D1 con un solo despliegue, pero comparte proceso: si se satura, cae también la ingesta (D2). **Si D2 no existiera, la elegiríamos** |
| Estilo | Monolito en capas | Simple y con 475 pruebas, pero falla en bloque |
| Estilo | Microservicios síncronos | Acopla la disponibilidad: si notificaciones cae, la cadena entera falla |
| Bus | RabbitMQ | Sólida; pesó la curva de aprendizaje y que un mensaje confirmado no se puede releer |
| Bus | Kafka | Demasiado peso operativo y de RAM para el volumen; **es el camino si crecemos** |
| Bus | Outbox en PostgreSQL | Cargaría la base transaccional con cada lectura y agrega latencia por sondeo |
| Entrega | A lo sumo una vez | Una caída a mitad de proceso pierde la alerta |
| Entrega | Exactamente una vez | El proveedor de correo no participa en transacciones; se logra con idempotencia |

### 3 · "¿Qué atributo empeoró con esta decisión, y por qué es aceptable?"

- **Simplicidad operativa** (la que más). Son 4 servicios y un bus para un equipo de 3. **Reconozcan que el curso advierte esto:** los microservicios compran autonomía de despliegue entre equipos, y aquí hay un solo equipo. Es aceptable porque lo que compramos es aislamiento de fallas, y lo mitigan el README, un comando y los logs con `correlationId`.
- **Consistencia inmediata.** La alerta llega unos milisegundos o segundos después. Aceptable porque "a tiempo" para ubicar ganado es segundos, no milisegundos (supuesto que deben confirmar con el negocio).
- **Duplicados posibles.** Aceptable porque una alerta duplicada es molesta y una perdida es grave; está documentada la ventana en la que ocurre.
- **Durabilidad del bus.** Un único Redis; ver R1.

### 4 · "Si el negocio creciera diez veces, ¿qué parte de este diseño se rompería primero?"

Hay una respuesta **medida** y una **razonada**; distínganlas.

- **Medido:** con el supuesto de 1 000 collares cada 30 s (≈ 33 lecturas/s), 10× son ≈ 330/s. En el esqueleto, a 500/s la aceptación tuvo p95 de 12 ms, el atraso del consumidor de alertas p95 de 3 ms y el backlog quedó en cero. A 1 000/s p95 de 35 ms. **A 2 000/s lo primero que se degradó fue la latencia de aceptación de la ingesta** (p95 782 ms), sin errores y con los consumidores al día. *Salvedad:* 2 vCPU compartidos con el generador de carga, así que no sabemos cuánto es la ingesta y cuánto el generador.
- **Razonado (no medido), en orden de lo que se rompería primero:**
  1. **Redis**, por ser único: memoria, ancho de banda y punto único de falla (R1). Salida: réplicas, o Kafka si la carga lo exige.
  2. **El estado de Alertas y Seguimiento en Redis:** no es donde debería vivir; habría que moverlo a PostgreSQL por servicio.
  3. **El orden por vaca** si se escalan réplicas de un mismo grupo; Kafka con clave por vaca lo resolvería.
  4. **Los límites del proveedor de correo**, no nuestros.
- **Lo que no se rompería:** la ingesta y los consumidores **escalan por réplicas** (verificado con dos réplicas de Alertas sin duplicados).

## Preguntas difíciles que probablemente caerán

**"Si tienen un solo equipo, ¿por qué separar en servicios?"**
Porque el driver no es la autonomía de despliegue sino el aislamiento de fallas (D2). Lo admitimos como la peor consecuencia del ADR-0001. Si D2 no existiera, un monolito modular con outbox sería la mejor opción.

**"¿No es esto sobre-ingeniería para el volumen real?"**
Posiblemente para hoy, sí: con unas decenas de collares el monolito actual bastaría. Elegimos esto porque el trabajo pide una arquitectura derivada de drivers de calidad, y D1/D2 son requisitos de confiabilidad, no de volumen. Lo decimos con esas palabras.

**"¿Por qué el esqueleto no usa la API Spring Boot?"**
Un esqueleto delgado demuestra la estructura, no el negocio completo. Los secretos y la geocerca vienen de una semilla; en el diseño objetivo los consulta a Gestión (flechas punteadas del C4). Está dicho en el README.

**"En los drivers dicen que no se pierde la alerta si falla el proveedor de IA. ¿Dónde está la IA en el esqueleto?"**
No está: el esqueleto cubre el camino crítico (ingesta → alertas → notificaciones) y lo demostramos con el proveedor de correo. La IA es un *enriquecimiento* y el diseño la pone como un consumidor más de `alert.raised`, así que su falla no puede bloquear el aviso. El backend actual ya la tiene con proveedor intercambiable y *fallback* heurístico. Digan claramente que es diseño y no esqueleto.

**"¿Por qué Seguimiento es un contexto?"**
Es la frontera más débil y lo sabemos: lo separa el vocabulario y es la base de `COLLAR_OFFLINE`. Su valor inmediato es demostrar dos consumidores del mismo evento. Si no se necesita, es lo primero que se fusiona con Alertas.

**"¿Qué pasa si Redis se cae?"**
La ingesta responde `503` en milisegundos (medido), el sistema se recupera solo al volver (medido) y con AOF matar el proceso no perdió eventos (43 497/43 497). **Lo que no sabemos:** una caída de la máquina (hasta ~1 s con `everysec`) ni qué hace el firmware con el `503`. Es el riesgo R1 y está abierto.

**"¿Cómo saben que la seguridad funciona?"**
Cinco ataques rechazados sin publicar eventos y seis pruebas unitarias de firma y ventana. **Lo que no probamos:** limitación de tasa (existe en el backend, no en el esqueleto).

## Frases que conviene no decir

- "Elegimos eventos porque es lo más moderno / escalable." *(No traza a un driver.)*
- "Con microservicios no se pierde nada." *(Hay duplicados, y lo documentamos.)*
- "Está probado con Docker" *(salvo que de verdad lo corran la noche anterior).*
- "Aguanta 2 000 lecturas por segundo." *(Se midió en un entorno compartido; es orientativo.)*

## Lista de la noche anterior

- [ ] `docker compose up --build` corre en **tu** laptop sin errores y `docker compose ps` muestra todo *healthy*.
- [ ] `docker compose run --rm --no-deps tools demo` termina con ✅.
- [ ] El escenario de `stop notifications` funciona tal como está en el guion.
- [ ] Docker Desktop abierto y la imagen ya construida (para no depender del Wi-Fi del salón).
- [ ] Los tres integrantes pueden responder las cuatro preguntas sin mirar este documento.
- [ ] Diagramas C4 abiertos en una pestaña (las imágenes están en `docs/img/`).
