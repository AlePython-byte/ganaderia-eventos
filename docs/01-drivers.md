# 1 · Drivers arquitectónicos y árbol de utilidad

> Pieza del entregable: **Drivers priorizados** (árbol de utilidad con hojas marcadas por importancia y dificultad; restricciones identificadas).

## El sistema en cinco líneas

Ganadería 4.0 monitorea ganado con collares IoT: cada collar reporta posición GPS y batería; el sistema detecta
incidentes (salida de geocerca, batería baja, collar sin señal), genera alertas y avisa a los operadores de la finca.
Hay cuatro tipos de usuario con permisos distintos: Administrador, Supervisor, Técnico y Operador. Ya existe un backend Spring Boot (gestión de vacas, collares, usuarios, reportes, IA, correo). Este diseño define la
arquitectura del **camino de monitoreo en tiempo real** (ingesta → alertas → notificaciones), que es donde están
los drivers difíciles.

## Los cuatro tipos de drivers

### Funciones primarias (las que estresan el sistema o son el corazón del negocio)

| # | Función | Por qué es primaria |
|---|---|---|
| F1 | Recibir lecturas firmadas de los collares | Es el punto de entrada de **todo** el sistema y está expuesto a Internet |
| F2 | Evaluar reglas y generar alertas (geocerca, batería) | Es el valor del negocio: avisar a tiempo |
| F3 | Notificar la alerta a los operadores por varios canales | Cruza un sistema externo que falla (correo/SMS) |
| F4 | Consultar la última posición y las alertas de una vaca | Lo usan todos los roles |

### Restricciones (no se priorizan: se cumplen)

| # | Restricción | Tipo | Quién la sabe |
|---|---|---|---|
| R1 | Los collares se autentican con HMAC-SHA256 + timestamp + nonce (protocolo ya definido en el backend existente) | Técnica | Quien mantiene el backend |
| R2 | El backend Spring Boot / PostgreSQL existente (gestión, usuarios, reportes) **no se reescribe** | Técnica | Equipo |
| R3 | Conectividad rural intermitente: un collar puede reintentar, reenviar la misma lectura o enviarlas con retraso → **duplicados y desorden son normales** | Operación | Dominio ganadero |
| R4 | El correo/SMS dependen de proveedores externos (Resend, etc.) sin SLA propio: **van a fallar** | Externa | Operaciones |
| R5 | Un solo equipo de 3 personas despliega todo | Organizacional | Equipo |
| R6 | Plazo: sustentación el 12 o el 19 de noviembre; el esqueleto debe arrancar con un comando | Negocio | Profesor |
| R7 | Las laptops de desarrollo y de demo tienen 8 GB de RAM | Técnica | Equipo |

### Preocupaciones del arquitecto (nadie las pide, hay que resolverlas)

| # | Preocupación | Cómo se atiende |
|---|---|---|
| P1 | Despliegue | `docker compose up --build` levanta todo |
| P2 | Pruebas | 19 pruebas unitarias + demo que verifica de punta a punta |
| P3 | Monitoreo y diagnóstico | Logs JSON con `correlationId`/`causationId`; `GET /health`; lag por consumidor |
| P4 | Incorporar a alguien nuevo | README con mapa decisión → código |

### Atributos de calidad (se negocian y se priorizan)

Ver el árbol de abajo.

## Árbol de utilidad

La **importancia** la asigna el negocio (el dueño de la finca y sus operadores); la **dificultad** la asigna el equipo
técnico. Escala A (alta) · M (media) · B (baja). Cada hoja apunta a un escenario completo en
[`02-escenarios.md`](02-escenarios.md).

```
Utilidad de Ganadería 4.0
│
├── Disponibilidad
│   ├── D1 · Ninguna alerta crítica se pierde aunque falle el proveedor de correo o de IA (o un servicio) .. (A, A)  → E1
│   └── D2 · La ingesta sigue aceptando lecturas aunque otros servicios estén caídos o lentos ............. (A, A)  → E1
│
├── Seguridad
│   └── S1 · Solo entran lecturas auténticas, frescas y no repetidas ...................................... (A, M)  → E2
│
├── Modificabilidad
│   └── M1 · Agregar canales de notificación, tipos de alerta o proveedores de IA sin tocar el núcleo ..... (A, M)  → E3
│
├── Rendimiento / escalabilidad
│   └── P1 · Absorber 10× la carga actual manteniendo la aceptación rápida y las alertas al día ........... (M, M)  → E4
│
├── Observabilidad
│   └── O1 · Rastrear una alerta hasta la lectura que la causó ............................................ (M, B)
│
└── Disponibilidad avanzada
    └── H1 · Bus de eventos con réplicas y conmutación automática (alta disponibilidad multi-nodo) ........ (B, A)
```

### Cómo se leen los cuadrantes

| Cuadrante | Hojas | Qué hacemos con ellas |
|---|---|---|
| **Alta importancia, alta dificultad** · aquí vive la arquitectura | **D1, D2** | Determinan el estilo (ADR-001) y las tácticas de confiabilidad (ADR-003) |
| Alta importancia, dificultad media | S1, M1 | Se resuelven con tácticas conocidas (autenticar, intermediario, encapsular); se diseñan con cuidado |
| Importancia media, dificultad media | P1 | Se verifica con una prueba de carga; condiciona la respuesta a "¿qué pasa con 10×?" |
| Importancia media, dificultad baja | O1 | Se hace programando (ids de correlación). No cambia la estructura |
| **Baja importancia, alta dificultad** | **H1** | **Se negocia quitarlo.** Replicar y conmutar el bus es trabajo caro que hoy a nadie le importa; queda declarado como riesgo R1 |

Dos hojas en (A, A) y una (B, A) negociada: el árbol discrimina. Si todo hubiera quedado en (A, A) no habríamos priorizado.

## Los tres drivers que determinan la arquitectura

1. **D1 + D2 · Confiabilidad de las alertas y aislamiento de fallas** (A, A). Una alerta crítica no se pierde aunque falle el proveedor de correo o de IA. Se origina en R3 y R4: las redes y los proveedores externos fallan, y una alerta perdida es una vaca perdida.
2. **S1 · Seguridad de la ingesta** (A, M). Se origina en R1 y F1: el endpoint está abierto a Internet y quien lo falsifica puede ocultar o inventar incidentes.
3. **M1 · Modificabilidad** (A, M): agregar canales de notificación, proveedores de IA o tipos de alerta sin tocar el núcleo. El propio backend declara que el SMS no está implementado y las reglas de alerta crecen con el negocio; son los cambios previsibles más probables.

> **Origen de cada driver (pregunta 1 de la sustentación):** D1/D2 salen de las restricciones R3 y R4 (la operación rural y los proveedores externos); S1 de R1 y F1; M1 del SMS pendiente que el backend actual declara como limitación.

## Supuestos que hay que validar con el negocio

- Escala de referencia: **1 000 collares reportando cada 30 s ≈ 33 lecturas/s**. Es un supuesto del equipo, no un dato medido; "10×" significa ≈ 330 lecturas/s.
- "Alerta a tiempo" se tomó como **segundos**, no milisegundos: para ubicar ganado no se necesita tiempo real estricto. Eso es lo que permite aceptar consistencia eventual.
