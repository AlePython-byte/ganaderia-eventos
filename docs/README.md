# Diseño documentado · Ganadería 4.0

Cada pieza que pide el profesor y dónde está. El diseño y el esqueleto (carpeta raíz) se califican juntos.

| Pieza del entregable | Archivo |
|---|---|
| Drivers priorizados (árbol de utilidad, restricciones) | [`01-drivers.md`](01-drivers.md) |
| Escenarios (4, completos, con entorno y medida) | [`02-escenarios.md`](02-escenarios.md) |
| Estilo elegido y qué sacrifica | [`03-estilo-contextos-tacticas.md`](03-estilo-contextos-tacticas.md) §3.1 |
| Contextos delimitados y la señal de cada frontera | [`03-estilo-contextos-tacticas.md`](03-estilo-contextos-tacticas.md) §3.2 |
| Tácticas aplicadas, contra qué escenario y qué degradan | [`03-estilo-contextos-tacticas.md`](03-estilo-contextos-tacticas.md) §3.3 y §3.4 (ADD) |
| Diagramas C4, niveles 1 y 2 | [`04-c4.md`](04-c4.md) · imágenes en `img/` |
| Tres ADR con alternativas descartadas y consecuencias | [`adr/0001`](adr/0001-arquitectura-orientada-a-eventos.md) · [`adr/0002`](adr/0002-redis-streams-como-bus.md) · [`adr/0003`](adr/0003-entrega-al-menos-una-vez-e-idempotencia.md) |
| Riesgos (con lo que habría que verificar) | [`05-riesgos.md`](05-riesgos.md) |
| Guía para la sustentación | [`06-guia-de-sustentacion.md`](06-guia-de-sustentacion.md) |

Cómo arrancar el esqueleto: ver el [`README.md`](../README.md) de la raíz.

**Convención de evidencia.** Todo número de estos documentos que aparece como "verificado" salió de una ejecución real
del esqueleto; lo que no se pudo medir está marcado como **no verificado**.
