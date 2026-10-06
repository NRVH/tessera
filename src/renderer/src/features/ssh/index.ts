// =============================================================================
// API pública de la feature de conexiones SSH para las demás features: el store (conexiones,
// grupos, diálogos, el lanzador y el riel), el lanzador de la cabecera, el riel de pantalla
// completa con su conmutador y cómo se decide, los diálogos, el icono del servidor y cómo se escribe
// el destino de una conexión. La carga desde el main la compone solo App.tsx y está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md). Solo importa el icono de `features/sftp`: las
// pestañas SSH y SFTP son de las terminales, que le inyectan lo que abre cada una.
// =============================================================================
export { useStoreSsh, accionesSsh, datosDePerfil, conexionPorId, SIN_DATOS_SSH } from './store'
export type { EstadoSsh, DialogoSsh, DatosPerfilSsh } from './store'
export { LanzadorSsh, type PropsLanzadorSsh } from './LanzadorSsh'
export { BotonRielSsh } from './BotonRielSsh'
export { RielConexionesSsh, type PropsRielConexionesSsh } from './RielConexionesSsh'
export { useRielSsh, enfocarRielSsh, type RielSsh } from './useRielSsh'
export { ID_LANZADOR_SSH } from './rielSsh'
export type { DatosListaConexionesSsh } from './ListaConexionesSsh'
export { DialogosSsh } from './DialogosSsh'
export { IconoServidor, IconoServidorNuevo } from './iconosSsh'
export { destinoSsh } from './listaSsh'
