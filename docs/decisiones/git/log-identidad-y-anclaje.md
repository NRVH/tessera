# El panel de Log nunca pregunta sin decir de quién y solo pinta lo del repo que muestra

- **Estado:** vigente
- **Ámbito:** `features/git/useCargaLog.ts`, `useSincronizacionLog.ts`, `modelo/repoDePeticion.ts`

## Contexto

El panel se monta bajo demanda y su identidad (proyecto y repo) sale del perfil que se mira, en el
mismo commit que el clic. Las respuestas llegan tarde y en cualquier orden: al cambiar de repo o de
perfil puede volver la lista del anterior, y pintarla bajo la cabecera del nuevo enseñaba ramas y
commits ajenos, con `fatal: bad object` al pinchar uno, o dejaba el panel en «Cargando».

## Decisión

- Toda petición lleva su proyecto (`raiz`) y su repo (`repoDePeticion`: el elegido o la
  contenedora), nunca `undefined`. El main la atiende en ese proyecto aunque el ancla esté en otro
  (`workspace/peticiones-de-archivos-con-su-proyecto.md`), así que el panel pide en cuanto los
  conoce: no espera al proyecto confirmado, y lo que responde se cachea y se aplica sin más guarda.
- Lista y repo se aplican JUNTOS (`aplicarCommits`, `setBranches`) y solo se pinta lo del repo
  actual; lo demás es «cargando». Un contador por petición hace que gane la última emitida.
- Al cambiar de repo el estado se adopta durante el render, con un guardián propio
  (`repoAjustado`) y no `repoDeCommits`, para que con la caché caliente no exista el frame
  «Cargando». La selección se olvida ahí: en el commit intermedio la memoria del cursor escribiría
  el hash del repo viejo bajo la clave del nuevo, y ese repo perdería su cursor. La rama del
  filtro también se olvida (la resuelve el backend); el autor, la fecha y las ramas cerradas a mano
  son del repo y vuelven como se dejaron (`modelo/vistaLogPorRepo.ts`, `useFiltrosDelRepo`).
- La reconciliación compara lista contra repo y vuelve a pedir si no hay nada en vuelo ni fallo
  previo (`repoEnVueloRef`, `repoFallidoRef`): es la red que hace imposible el colgado. Un fallo se
  enseña y no se reintenta solo hasta cambiar de repo o recargar.
- Los efectos de sincronización van en este orden y no se reordenan; el de recarga por
  `commitTick` lleva deps acotadas a propósito (`eslint-disable` con motivo): otras crearían un
  doble fetch.

## Descartes

- Rechazar `repo === undefined` en el backend: es legítimo en las peticiones por ruta.
- Meter la reconciliación en el efecto de cambio de repo: resetearía los filtros con cada
  respuesta aplicada.
- Esperar al proyecto confirmado para pedir: añade un viaje al main a cada cambio y obliga a
  aplazar ticks y recargas, cuando la petición ya dice de quién es.
