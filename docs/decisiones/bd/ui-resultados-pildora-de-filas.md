# El recuento de filas es una píldora flotante que cuenta bajo demanda y reúne «Traer todas» y la exportación

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/PildoraFilas.tsx`, `textoPildora` en `panesBd.ts`

## Contexto

La rejilla de datos y cada pestaña de resultado de la consola enseñan cuántas filas hay y si
el servidor tiene más. Lo que se ve no es siempre todo, y averiguar el total puede costar mucho.

## Decisión

- «500 filas» con todo cargado; «500+ filas» si el servidor tiene más, y entonces se puede
  pulsar para contarlas; «500 de 12 345» tras contar; «Contando…» mientras cuenta. El «+» dice
  de un vistazo que lo que se ve no es todo.
- Contar es BAJO DEMANDA, nunca automático: un COUNT(*) sobre cien millones de filas en una
  réplica por VPN puede tardar minutos, y casi nunca hace falta para leer la primera página.
- «sin orden estable» (sin ORDER BY ni clave primaria): el paginado no garantiza páginas
  estables, y una fila repetida o saltada al cargar más tiene que tener una explicación visible.
- Cuando ya no se puede leer más (cursor cerrado, sesión perdida, tope de memoria) lo dice, y
  ofrece «Volver a ejecutar» solo si eso lo arregla: con el tope de memoria no.
- «Traer todas» y la exportación viven aquí: son el mismo asunto (cuántas filas hay y cuántas
  tienes) y es donde se mira cuando algo tarda. Mientras trae, «Trayendo filas… 12 500» y
  «Detener» (lo traído se queda). La exportación es tarea del main (la tabla entera, no lo
  cargado), pero se enseña en la pestaña que la lanzó: la barra de estado es de la app.
- Los dos «Detener» se distinguen por `title` y nombre accesible: un lector de pantalla no
  adivina cuál es cuál por la posición.
- Flota sobre la esquina con `--bg-modal`, la familia de lo que flota: un pie gastaría una fila
  en cada pestaña de resultado, que ya van apretadas bajo el editor.
- Sus botones llevan texto: son contenido (un estado que cambia), no cromo que se repite; la
  regla de «icono sin texto» de las barras no aplica.

## Consecuencias

La píldora tapa unas celdas de la esquina, que el desplazamiento destapa.
