# La vista de Cambios es una lista plana de cuatro secciones, con marcas por sección y menú con objetivo fijo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/{GitPanel,CambiosPorRepo,CuerpoRepo,entradasMenuCambios}.tsx`, `useMarcasCambios.ts`, `useListaCambios.ts`, `modelo/{seccionesCambios,estadoRepos}.ts`

## Contexto

Descartar, preparar y excluir escriben en el repo del usuario, y se lanzan desde una selección
con casillas que puede cruzar repos. Lo que la fila, el menú y el botón de lote creen que está
marcado tiene que ser exactamente lo que el backend recibe.

## Decisión

- Cuatro secciones, las de `git status`: Conflictos, Preparados, Cambios y Sin versionar. Un
  archivo en conflicto sale de las demás (se resuelve, no se descarta: descartar no se ofrece
  ahí, lo revertiría a HEAD sin confirmar); uno preparado y modificado aparece en Preparados y en
  Cambios, con la letra de su eje en cada una. Lista plana con la carpeta en gris tras el
  nombre, no árbol: aquí importa qué cambió, no la forma del repo.
- El reparto en secciones (`dividirSecciones`) es UN módulo puro que comparten la lista y la
  lista virtual de repos, que necesita el alto de una sección antes de montarla: con dos copias
  el scroll saltaría.
- Las marcas viven en el padre de todos los repos, con clave `${seccion} ${ruta}`. La sección va
  en la clave porque un archivo MM está en dos listas y marcarlo en una no marca la otra; el repo
  no, porque las rutas ya son únicas entre repos.
- Al refrescar se PODAN las claves que ya no existen (con la misma regla que reparte las
  secciones) y se devuelve el mismo Set si no cayó ninguna: vaciar la selección sería hostil, y
  un Set nuevo por refresco entraría en bucle de render.
- El menú calcula su objetivo AL ABRIRSE: una fila marcada actúa sobre toda la selección de su
  sección, una sin marcar solo sobre ella. Abrir actúa siempre sobre la fila sola. La clave de
  la lista no depende de `marcadas`: si dependiera, cada clic reconstruiría la lista.
- Con varios repos, la lista solo trae los que tienen cambios o un error (`reposConCambios`): los
  limpios no ocupan sitio, y sus ramas siguen en la vista del historial. Con la carga perezosa
  (más de `UMBRAL_PEREZOSO` repos) se enseñan todos, como antes: esa carga pide lo que se ve, así
  que un repo escondido por limpio no se volvería a pedir al ensuciarse, y cada refresco (que vacía
  los estados) haría aparecer y desaparecer la lista hasta pedir todos los repos.
- Dentro de un repo de esa lista, «Cambios» va sin su cabecera cuando es la única sección
  (`soloCambios`): solo repetiría el conteo del repo. Sus botones de lote pasan a la cabecera del
  repo y ocupan el sitio del conteo y la rama mientras hay marcas, para no recortar el nombre. La
  cabecera lleva una casilla de tres estados que marca todos los archivos del repo, y cada
  archivo enseña su carpeta contada desde su repo (`prefijo` de `RepoStatus`, relativo a la
  contenedora). El alto de la sección (`alturaSeccionExpandida`) descuenta la cabecera omitida
  con la misma regla, o la lista virtual se desalinearía.

## Consecuencias

- Cambiar la regla de secciones o de claves válidas sin tocar las dos a la vez poda marcas
  legítimas o deja marcas huérfanas sobre las que el lote actuaría. El cuerpo del panel se
  remonta al cambiar de proyecto (`key`): sin eso, una marca sobrevive por clave y
  "Descartar 1" actúa sobre un archivo que nadie marcó.

## Descartes

- Un árbol de carpetas en Cambios, y tres secciones (lo no rastreado ensuciaba Cambios).
