# El estado de git se acumula por generación, se pide en perezoso y se cachea con dos topes

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/modelo/{estadoRepos,cacheEstadoRepos,cacheGit,rutasArchivo}.ts`

## Contexto

Una contenedora puede tener cientos de repos y el watcher dispara un refresco por ráfaga de
escritura (una compilación toca miles de archivos): pedir el estado de todos cada vez eran cientos
de procesos de git. Además el panel de historial se monta y desmonta al abrir y cerrar la franja.

## Decisión

- Carga perezosa: por debajo de 50 repos se piden todos; por encima, lo visible más el activo, y
  el resto llega al hacerse visible. Por eso el `overscan` de la lista y el margen de prefetch son
  el mismo número: lo montado es lo pedido.
- El estado se acumula por repo en un mapa y se descarta por GENERACIÓN (cambiar de proyecto la
  sube; gana la última petición emitida, no la última en contestar). Reemplazar la lista con lo
  último que llegó borraría lo sabido de los demás. Una respuesta idéntica devuelve el mismo
  objeto: con cientos de repos, uno nuevo por goteo repintaría todo.
- Una ráfaga del watcher invalida solo el repo tocado (el primer tramo de la ruta); si desbordó
  el tope, se revisa todo. Lo sabido se conserva mientras llega la respuesta.
- La siembra al volver a un perfil es por OBJETIVO, no un mapa global: la señal «no se sabe nada»
  es `mapa.size === 0`, y con entradas ajenas pasaría a decir «se sabe, y no hay cambios». Solo
  se siembra por debajo del umbral perezoso. Su clave no lleva el tick y usa NUL como separador
  (`|` es legal en una ruta de macOS).
- Las cachés del historial viven a nivel de módulo y solo guardan la vista SIN filtrar de cada
  (repo, rama): los filtros se aplican en cliente y desalojarían lo que sí importa.
- DOS topes: 32 entradas y 60 000 commits. «Cargar todo» hace que una entrada sea el repo entero
  (~30 MB por 60 000, medido: 2000 commits ≈ 592 KB en JSON). Nunca se desaloja la recién
  escrita. Todo borrado pasa por `borrarCommits` para no perder la cuenta.
- El cursor recordado es por repo y `purgarRepo` no lo toca: cada commit lo purga y el commit
  que mirabas casi siempre sigue; la comprobación de existencia cubre el rebase.
- Invalidación por señal (commit, HEAD/refs movido, recargar a mano), no por tiempo.

## Consecuencias

- Cachear el resultado filtrado, o subir las ranuras sin el tope de commits, es una fuga lenta.
