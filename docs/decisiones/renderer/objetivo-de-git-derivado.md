# Lo que se pinta sale del modelo de pestañas y lo que se pide espera al backend confirmado

- **Estado:** vigente
- **Ámbito:** `features/pestanas/tabsModel.ts` (`selectObjetivoGit`, `backendAnclado`), `useSincronizacionBackend.ts`

## Contexto

La vista de git derivaba toda su identidad de `confirmedTarget`, que solo se fija DESPUÉS del
viaje que re-apunta el backend. El cambio de perfil sí es síncrono, así que durante esa ventana
la vista se pintaba entera, y coherente, contra el repo del perfil anterior: era el parpadeo.
Además `NucleoGit.ctxForRepo` RECHAZA un repo fuera de la contenedora anclada y contesta vacío:
adelantar una petición no da datos de otro repo, da una lista vacía indistinguible de «repo sin
commits».

## Decisión

- Qué se PINTA: `selectObjetivoGit`, derivado del estado del modelo del perfil mostrado. Síncrono,
  sin IPC, cambia en el mismo commit que el clic en la pestaña.
- Qué se PIDE: `backendAnclado(objetivo, confirmado)` sigue exigiendo el objetivo confirmado, y
  solo se fija (`fijarConfirmado`) cuando terminaron los re-apuntados pendientes (`setFilesRoot` y
  `setActiveProject`): el backend ya apunta al proyecto antes de que los hijos lean.
- El objetivo es DERIVADO y no recordado: una memoria por perfil habría que invalidarla a mano al
  cerrar o renombrar un proyecto; derivándolo, `closeProject` ya quita la entrada.
- `repos: null` («escaneo en vuelo») y `repos: []` («sin repos») no se colapsan.

## Consecuencias

- No fundir los dos objetivos en uno: se vuelve al parpadeo o a peticiones vacías.
- El explorador se ancla a la contenedora y no sigue al repo; git sigue al repo.

## Descartes

- Una memoria de objetivos por perfil: exige invalidación manual y se desincroniza.
- Purgar cachés de git de los repos que salen de la lista al cerrar un proyecto: ya están
  acotadas por su cuenta, y dos perfiles pueden tener abierto el mismo `repoHostPath`.
