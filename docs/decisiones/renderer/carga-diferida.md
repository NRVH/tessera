# El aviso de carga es de cada panel, sale a los 250 ms, avisa de que tarda a los 5 s y se queda al menos 300 ms

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/cargaDiferida.ts` (y `test-carga-diferida.mts`), `useCargaDiferida.ts`, `IndicadorCarga.tsx` (`IndicadorCarga`, `EsperaCarga`), `indicadorCarga.css`, `textosCarga.ts`, y sus usos en `features/git/` (`CambiosPorRepo.tsx`, `CuerpoRepo.tsx`, `ArbolRamas.tsx`, `ListaCommits.tsx`, `HistorialArchivo.tsx`, `ArchivosDelCommit.tsx`), `features/explorador/` (`FileTree.tsx`, `piezasArbol.tsx`) y `features/bd/` (`FilaArbolContenido.tsx`, `DbArbolCuerpo.tsx`, `consola/EstadoCargaPopover.tsx`)

## Contexto

Volver a un perfil o a un proyecto ya visto no carga nada: sus piezas siguen montadas
([vivos-y-ocultos.md](vivos-y-ocultos.md)). Lo que de verdad espera es otra cosa: la primera
apertura, un repo grande, un montaje lento o una base remota con la red caída, donde «Conectando…»
puede quedarse 15-30 s. Un «Cargando…» que aparece en el acto parpadea en lo rápido y, en lo lento,
no distingue una espera normal de una que no va a acabar.

## Decisión

- Cada panel anuncia su propia carga, solo mientras sus datos no están; un cambio de perfil no
  tiene aviso propio.
- Por tiempo desde que empieza la espera: nada antes de 250 ms; el aviso discreto hasta los 5 s;
  después, «Está tardando más de lo habitual…», con el motivo si se sabe (los repos leídos de los
  que hay, que la base aún no responde). Visible, se queda al menos 300 ms.
- La regla es un modelo puro: dado el inicio, el fin y el instante, la fase y cuándo cambia, para
  programar un solo temporizador sin sondeos. El hook guarda las marcas, las ajusta durante el
  render al cambiar `cargando` y calcula la fase en ese mismo render (sin fotograma con la fase
  vieja ni aviso tardío tras un fin cercano a los 250 ms); el temporizador solo fuerza el render; `EsperaCarga` ocupa el sitio del
  contenido mientras toca y `IndicadorCarga` pinta una fase. Una carga que vuelve con el aviso aún a
  la vista continúa la anterior.
- La caja del aviso existe desde que empieza la espera, vacía hasta los 250 ms: el sitio no salta al
  aparecer el texto y el lector de pantalla (`role="status"`, `aria-live="polite"`) lo anuncia. Las filas de árbol, que ya van dentro de una
  opción de lista, usan `sinAnuncio` y no llevan ni rol ni región viva. En la variante `fila` el
  texto va en su propio elemento para que la elipsis funcione dentro de un contenedor flex.
- El mínimo visible solo se cumple donde el aviso sigue montado al llegar los datos (el estado de un
  panel). Donde el padre lo quita con ellos (las filas «Cargando…» de un árbol virtual, la línea de
  carga de un repo, la lista de un popover), se va en el acto: retenerlo obligaría a esconder datos
  en el modelo de cada árbol. Donde lo que llega pide más datos (la lista de repos con cambios) o
  empieza su propia carga (el repo único, que pasa a leer sus cambios), tampoco se retiene.

## Consecuencias

- Un panel con carga usa `EsperaCarga` (o el hook con `IndicadorCarga` si la lista vive aparte, como
  la del Git·Log, que mientras el aviso se ve no recibe filas ni revela índices).
- La clase del sitio no cambia (`tree-row muted`, `git-state`…), así que lo que busca una carga en
  curso la encuentra también en sus primeros 250 ms, aún vacía.
- Un e2e que espera el texto de carga lo ve solo pasados 250 ms.
- Dos cargas encadenadas en piezas distintas (detectar el repo y leer sus cambios) cuentan cada
  una la suya.
- Una fila de árbol que sale de la ventana virtual y vuelve empieza su espera de cero: recordarla
  exigiría estado fuera del componente por cada fila, para un caso raro.
- Con un error a la vista no se pinta el aviso, ni siquiera su mínimo visible; y mientras el aviso
  ocupa la lista de commits, el teclado de la lista no actúa.

## Descartes

- Un aviso o un esqueleto global al cambiar de perfil: volver cuesta unas décimas y los datos están
  en memoria; sería un parpadeo, y ocultaría lo que ya se ve.
- Esqueletos por panel: dibujan una forma que no es la de los datos y saltan al llegar; una línea
  de texto no promete nada que luego cambie.
- Un temporizador que sondee cada pocos ms: el modelo sabe cuándo es el próximo cambio.
