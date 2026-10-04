# La actualización de los agentes nativos la orquesta el renderer con la API de cada pane

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/{actualizacionNativa,planActualizacion,tipos}.ts`

## Contexto

Actualizar un CLI nativo obliga a reiniciar sus sesiones vivas en su conversación. El «Reiniciar»
del pane ya sabe qué conversación reanudar, qué bases hay montadas y cómo dejar la UI coherente;
el main sabe versiones, la orden de instalación, el candado por agente y parar un lote a la vez.

## Decisión

- El renderer orquesta y cada pane publica su API; el main no relanza (sería otra definición de
  «reiniciar un agente»). El pane se localiza por `sessionId()` y `hostMode()` leídos en el
  momento, nunca por la clave del target: con la misma clave puede correr otra sesión.
- Tres fases: A instala con las sesiones vivas; B (el ejecutable vivo bloquea la carpeta) prepara
  los panes y la parada va DENTRO de `instalar`, con el candado tomado; C relanza de tres en tres.
- La compuerta se pasa con una foto FRESCA (`comprobar()` + `planificar()`), y ese plan fija el
  conjunto a reiniciar: nunca crece, salvo con lo que el main haya parado.
- Decide el re-sondeo, no el resultado de instalar: sólo se reinicia lo que corre algo más viejo.
- Las paradas se relanzan SIEMPRE, aunque la instalación falle. Esperar tu respuesta bloquea igual
  que trabajar (la parada teclearía `^C`), pero se cuenta aparte porque el remedio es otro.
- Antes de parar en C se vuelve a mirar cada sesión: se salta si trabaja, espera respuesta o tiene
  un borrador NUEVO (el que ya estaba se avisó y se confirmó).
- Las inciertas (`instalar` rompió en B) pasan por `detener([id])`: `ocupada` = el main sí las
  paró. Relanzarlas vivas teclea `exit` y mata ptys a la vez, la causa del cierre con 0xC0000005.
- `ejecutar` no rechaza nunca; el `finally` suelta todo pane preparado. `ok` es falso si aborta.
- Lo planeado que no se reinició sale como «saltada» con su motivo.

## Consecuencias

- Cambiar la parada del main a «rechazar por borrador» cerraría la ventana que queda en C.

## Descartes

- Relanzar todas a la vez: un pico de CPU que congela el equipo; en serie, eterno.
- Parar en C con una sola llamada por lote: una sesión ocupada impedía reiniciar todas.
