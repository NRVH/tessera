# El panel de Log nunca pregunta sin decir de quién y solo pinta lo del repo que muestra

- **Estado:** vigente
- **Ámbito:** `features/git/useCargaLog.ts`, `useSincronizacionLog.ts`, `modelo/repoDePeticion.ts`

## Contexto

El panel se monta bajo demanda y su identidad (proyecto y repo) sale del perfil que se mira, por
delante del backend, que se re-apunta después. Con `repo === undefined` el backend contesta con el
repo que tenga apuntado en ese instante; con un repo ajeno al anclado contesta VACÍO, y ese vacío
no se distingue de un repo recién creado. Sin más, el panel enseñaba ramas y commits de otro
perfil bajo la cabecera del nuevo, con `fatal: bad object` al pinchar uno, o se quedaba en
«Cargando» para siempre.

## Decisión

- Toda petición lleva repo (`repoDePeticion`: el elegido o la contenedora), nunca `undefined`.
- `anclado` es el permiso para PEDIR, no para pintar. Los cargadores lo leen por ref (si entrara
  en su identidad, cada anclaje resetearía filtros y selección); la reconciliación y el tinte lo
  llevan por valor, porque son quienes despiertan cuando sube.
- Lista y repo se aplican JUNTOS (`aplicarCommits`, `setBranches`) y solo se pinta lo del repo
  actual; lo demás es «cargando». Un contador por petición hace que gane la última emitida.
- Al cambiar de repo el estado se adopta durante el render, con un guardián propio
  (`repoAjustado`) y no `repoDeCommits`, para que con la caché caliente no exista el frame
  «Cargando». La selección se olvida ahí: en el commit intermedio la memoria del cursor escribiría
  el hash del repo viejo bajo la clave del nuevo, y ese repo perdería su cursor.
- La reconciliación compara lista contra repo y vuelve a pedir si no hay nada en vuelo ni fallo
  previo (`repoEnVueloRef`, `repoFallidoRef`): es la red que hace imposible el colgado.
- Un vacío de rechazo ni se cachea ni se aplica; recargar no purga sin anclaje; un `commitTick`
  sin anclaje se aplaza con el repo al que pertenecía y se reproduce al anclar.
- Los efectos de sincronización van en este orden y no se reordenan; los de recarga por tick
  llevan deps acotadas a propósito (`eslint-disable` con motivo): otras crearían un doble fetch.

## Descartes

- Rechazar `repo === undefined` en el backend: es legítimo en las peticiones por ruta.
- Meter la reconciliación en el efecto de cambio de repo: resetearía los filtros con cada
  respuesta aplicada.
- Una bandera booleana para el tick pendiente: se cobraría en el siguiente repo que anclara.
