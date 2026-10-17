# Lo que se pinta sale del modelo de pestañas y solo lo que pide sin decir su proyecto espera al backend confirmado

- **Estado:** vigente
- **Ámbito:** `features/pestanas/useTabs.ts` (`objetivoVisto`, `objetivoGit`), `tabsModel.ts` (`selectObjetivoGit`), `useSincronizacionBackend.ts`, `features/git/useEstadoGit.ts`

## Contexto

El cambio de perfil o de proyecto es síncrono en el modelo de pestañas, pero el backend tarda en
re-apuntarse (`setFilesRoot`, `setActiveProject`), y `confirmedTarget` solo se fija después. Una
pantalla que pinta desde el confirmado enseña durante ese rato el proyecto o el perfil anterior,
mientras las demás ya enseñan el nuevo: dos perfiles mezclados en la misma pantalla.

## Decisión

- Qué se PINTA sale del modelo, en el mismo commit que el clic y sin IPC: `objetivoVisto` (perfil y
  proyecto) para todo lo que cuelga de un proyecto (explorador, pestañas del editor, columna del
  agente, terminal, mosaico) y `objetivoGit` para la vista de git.
- Las peticiones de archivos y de git no esperan: llevan su proyecto y el main las atiende en él
  (`workspace/peticiones-de-archivos-con-su-proyecto.md`). Para que el main ya lo conozca, el
  anclaje se envía en un efecto de LAYOUT, antes que los efectos de los hijos.
- Solo lo que pide contra la raíz anclada sin decir su proyecto (búsqueda, montar bases, abrir desde
  fuera, los avisos del vigilante) sigue exigiendo el confirmado, que se fija cuando terminaron los
  re-apuntados.
- Los objetivos son DERIVADOS y no recordados: una memoria por perfil habría que invalidarla a mano
  al cerrar o renombrar un proyecto; derivándolos, `closeProject` ya quita la entrada.
- `repos: null` («escaneo en vuelo») y `repos: []` («sin repos») no se colapsan.

## Consecuencias

- No pintar desde el confirmado: vuelve el fotograma del perfil anterior.
- Las decoraciones de git del explorador salen del mapa de estado de ESTE objetivo y se recuerdan
  por proyecto: mientras el mapa es aún del anterior se enseñan las del proyecto que se ve, nunca
  las del otro.
- El explorador se ancla a la contenedora y no sigue al repo; git sigue al repo.

## Descartes

- Una memoria de objetivos por perfil: exige invalidación manual y se desincroniza.
- Esperar al confirmado para pintar con una pantalla de carga: el cambio deja de ser instantáneo.
- Purgar cachés de git de los repos que salen de la lista al cerrar un proyecto: ya están
  acotadas por su cuenta, y dos perfiles pueden tener abierto el mismo `repoHostPath`.
