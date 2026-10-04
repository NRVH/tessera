# El pie del agente enseña las ventanas de uso que trae la cuenta, sin dar ninguna por supuesta

- **Estado:** vigente
- **Ámbito:** `src/main/usage/ventanasUso.ts`, `features/agentes/UsageBars.tsx`, `formatoUso.ts`, la escalera `@container agentfooter` de `styles.css`

## Contexto

La línea compacta del pie enseñaba siempre las dos primeras ventanas (`5h` y `7d`). Claude Code
lleva dos límites semanales (el general y el de un modelo, hoy Fable), y el segundo solo se veía
al desplegar. Qué límites hay depende del plan y cambia: un modelo deja de tener el suyo, aparece
otro, o todo se homologa en uno.

## Decisión

- Se pinta LO QUE LA CUENTA TRAE, en su orden. En Claude Code, cada entrada de `limits[]` con
  porcentaje es una ventana; su periodo sale de `group` (`session` → 5h, `weekly` → 7d) y su nombre
  de `scope` (modelo o superficie) o, sin `scope`, de lo que su `kind` diga tras el grupo. Un grupo
  que no se conoce se pinta con su nombre. En Codex, `primary` y `secondary` y, detrás, cualquier
  otra clave de `rate_limits` con forma de ventana.
- La línea compacta enseña TODAS; el desplegable también, con nombre largo («Semanal Fable»).
- El ancho lo gobierna la escalera del pie según cuántas hay (`data-ventanas`: 2, 3, 4 o más):
  primero ceden las micro-barras, después las últimas ventanas ENTERAS, y sesión y semanal
  aguantan hasta el corte de siempre. Con tres caben todas desde el ancho mínimo de la columna
  (330 px). Como red, una ventana que no cabe entera salta a una fila oculta: nunca se corta.

## Consecuencias

- Un límite nuevo aparece sin tocar código, con el nombre que le dé el agente (puede salir en inglés).
- Con cuatro o más ventanas, una columna estrecha enseña solo las primeras; el resto, al desplegar.
- `TESSERA_USO_CLAUDE` desvía el endpoint para las pruebas de interfaz, solo a `127.0.0.1`, y la
  petición desviada NO lleva el token de la cuenta. Los anchos están medidos en Windows.

## Descartes

- Una lista fija de ventanas conocidas (sesión, semanal, Fable): esconde justo lo que cambia.
- Medir con JavaScript cuántas caben: la escalera de CSS ya existía y no añade un observador por pane.
