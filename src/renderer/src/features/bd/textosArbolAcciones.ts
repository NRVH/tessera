// =============================================================================
// Textos de lo que hace el lateral de BD sobre sus filas: las entradas de los menús contextuales,
// los diálogos de confirmación y de nombre, y los avisos de las acciones (`arbolMenu`,
// `DbArbolDialogos`, `DbArbolAcciones`, `DbArbolNavegacion`). Español e inglés con las mismas
// claves; se leen al usarse, nunca al cargar el módulo.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txArbolAcciones = crearTextos(
  {
    // --- cabecera ---
    tituloCabecera: 'Bases de datos',
    nuevaConexionSinPuntos: 'Nueva conexión',
    nuevaConsolaTitulo: (alias: string | null, acorde: string) =>
      `Nueva consola${alias !== null ? ` en ${alias}` : ''} (${acorde})`,
    refrescarAlias: (alias: string) => `Refrescar ${alias}`,
    refrescarTodo: 'Refrescar todo',
    nadaDesplegado: 'No hay ningún elemento desplegado',
    // --- menús ---
    nuevaConsola: 'Nueva consola',
    refrescar: 'Refrescar',
    basesVisibles: 'Bases visibles…',
    esquemasVisibles: 'Esquemas visibles…',
    editarConexion: 'Editar conexión…',
    probando: 'Probando…',
    probarConexion: 'Probar conexión',
    desconectar: 'Desconectar',
    eliminarConexion: 'Eliminar conexión…',
    abrir: 'Abrir',
    renombrar: 'Renombrar…',
    eliminarConsola: 'Eliminar consola…',
    abrirDatos: (acorde: string) => `Abrir datos (${acorde})`,
    verDefinicion: 'Ver definición',
    copiarCualificado: 'Copiar nombre cualificado',
    verDdl: 'Ver DDL',
    abrirFuente: (acorde: string) => `Abrir fuente (${acorde})`,
    filtrarClaves: 'Filtrar claves…',
    quitarFiltro: 'Quitar el filtro',
    filtrarPorTipo: 'Filtrar por tipo',
    nuevaClave: 'Nueva clave…',
    borrarPorPatron: 'Borrar claves por patrón…',
    filtrarPorPrefijo: (prefijo: string) => `Filtrar por ${prefijo}*`,
    copiarPrefijo: 'Copiar prefijo',
    borrarClavesPrefijo: (prefijo: string) => `Borrar las claves ${prefijo}*…`,
    abrirConAcorde: (acorde: string) => `Abrir (${acorde})`,
    copiarNombre: 'Copiar nombre',
    nuevaConexion: 'Nueva conexión…',
    plegarTodo: 'Contraer todo',
    // --- diálogos ---
    tituloEliminarConexion: (alias: string) => `¿Eliminar la conexión «${alias}»?`,
    eliminar: 'Eliminar',
    tituloEliminarConsola: (nombre: string) => `¿Eliminar la consola «${nombre}»?`,
    consolaALaPapelera: (nombre: string) => `«${nombre}.sql» se moverá a la papelera y podrá recuperarse desde ella.`,
    tituloRenombrar: 'Renombrar consola',
    etiquetaNombre: 'Nombre',
    renombrarBoton: 'Renombrar',
    filtrarClavesDe: (base: string) => `Filtrar claves de ${base}`,
    patronOTexto: 'Patrón o texto',
    filtrar: 'Filtrar',
    pistaFiltro:
      'Si el texto contiene * ? [ ] se interpreta como patrón (por ejemplo, usuario:*). Sin comodines, se busca el texto en cualquier parte del nombre. Si el campo queda vacío, se quita el filtro.',
    cancelar: 'Cancelar',
    // --- acciones ---
    noSePudoCopiar: (m: string) => `No se pudo copiar: ${m}`,
    noSePudoRefrescar: (m: string) => `No se pudo refrescar: ${m}`,
    probandoAlias: (alias: string) => `Probando ${alias}…`,
    instalarCliente: 'Instalar cliente…',
    txFallidasRevertidas: 'Transacciones fallidas revertidas',
    txSinConfirmar: '¿Qué hacer con las transacciones sin confirmar?',
    desconectarConCambios: (alias: string, nombres: readonly string[], soloRevertir: boolean) =>
      `${alias} tiene cambios sin confirmar` +
      (nombres.length > 0 ? ` en ${nombres.join(', ')}` : '') +
      (soloRevertir
        ? '. Para desconectar, primero debe revertirlos.'
        : '. Para desconectar, primero debe confirmarlos o revertirlos.'),
    noSePudoDesconectar: (alias: string, m: string) => `No se pudo desconectar ${alias}: ${m}`,
    noSePudoEliminarAlias: (alias: string, m: string) => `No se pudo eliminar ${alias}: ${m}`,
    txConsolaSinConfirmar: '¿Qué hacer con la transacción sin confirmar?',
    consolaConCambios: (nombre: string) =>
      `«${nombre}» tiene cambios sin confirmar. Antes de eliminarla, decida qué hacer con ellos.`,
    noSePudoEliminarConsola: (nombre: string, m: string) => `No se pudo eliminar «${nombre}»: ${m}`,
    // --- navegación ---
    noSePudoResolverSinonimo: (objeto: string, m: string) => `No se pudo resolver el sinónimo ${objeto}: ${m}`,
    sinonimoSinDatos: (objeto: string, tipo: string, destino: string) =>
      `El sinónimo ${objeto} apunta a ${tipo} ${destino}, que no tiene datos que abrir.`,
    noSePudieronCargarClaves: (m: string) => `No se pudieron cargar más claves: ${m}`,
    noEsBaseDeArchivo: (nombre: string) =>
      `«${nombre}» no parece un archivo de base de datos que Tessera pueda abrir.`,
    noSePudoGuardarOrden: (m: string) => `No se pudo guardar el orden: ${m}`
  },
  {
    tituloCabecera: 'Databases',
    nuevaConexionSinPuntos: 'New connection',
    nuevaConsolaTitulo: (alias: string | null, acorde: string) =>
      `New console${alias !== null ? ` on ${alias}` : ''} (${acorde})`,
    refrescarAlias: (alias: string) => `Refresh ${alias}`,
    refrescarTodo: 'Refresh all',
    nadaDesplegado: 'Nothing is expanded',
    nuevaConsola: 'New console',
    refrescar: 'Refresh',
    basesVisibles: 'Visible databases…',
    esquemasVisibles: 'Visible schemas…',
    editarConexion: 'Edit connection…',
    probando: 'Testing…',
    probarConexion: 'Test connection',
    desconectar: 'Disconnect',
    eliminarConexion: 'Delete connection…',
    abrir: 'Open',
    renombrar: 'Rename…',
    eliminarConsola: 'Delete console…',
    abrirDatos: (acorde: string) => `Open data (${acorde})`,
    verDefinicion: 'View definition',
    copiarCualificado: 'Copy qualified name',
    verDdl: 'View DDL',
    abrirFuente: (acorde: string) => `Open source (${acorde})`,
    filtrarClaves: 'Filter keys…',
    quitarFiltro: 'Remove filter',
    filtrarPorTipo: 'Filter by type',
    nuevaClave: 'New key…',
    borrarPorPatron: 'Delete keys by pattern…',
    filtrarPorPrefijo: (prefijo: string) => `Filter by ${prefijo}*`,
    copiarPrefijo: 'Copy prefix',
    borrarClavesPrefijo: (prefijo: string) => `Delete ${prefijo}* keys…`,
    abrirConAcorde: (acorde: string) => `Open (${acorde})`,
    copiarNombre: 'Copy name',
    nuevaConexion: 'New connection…',
    plegarTodo: 'Collapse all',
    tituloEliminarConexion: (alias: string) => `Delete the connection “${alias}”?`,
    eliminar: 'Delete',
    tituloEliminarConsola: (nombre: string) => `Delete the console “${nombre}”?`,
    consolaALaPapelera: (nombre: string) => `“${nombre}.sql” will be moved to the trash. You can restore it from there.`,
    tituloRenombrar: 'Rename console',
    etiquetaNombre: 'Name',
    renombrarBoton: 'Rename',
    filtrarClavesDe: (base: string) => `Filter keys in ${base}`,
    patronOTexto: 'Pattern or text',
    filtrar: 'Filter',
    pistaFiltro:
      'Use * ? [ ] for a pattern (user:*). Without wildcards, Tessera searches for the text anywhere in the name. Leave it empty to remove the filter.',
    cancelar: 'Cancel',
    noSePudoCopiar: (m: string) => `Could not copy: ${m}`,
    noSePudoRefrescar: (m: string) => `Could not refresh: ${m}`,
    probandoAlias: (alias: string) => `Testing ${alias}…`,
    instalarCliente: 'Install client…',
    txFallidasRevertidas: 'Failed transactions rolled back',
    txSinConfirmar: 'What should happen to the uncommitted transactions?',
    desconectarConCambios: (alias: string, nombres: readonly string[], soloRevertir: boolean) =>
      `${alias} has uncommitted changes` +
      (nombres.length > 0 ? ` in ${nombres.join(', ')}` : '') +
      (soloRevertir ? '. Roll them back to disconnect.' : '. Commit or roll them back to disconnect.'),
    noSePudoDesconectar: (alias: string, m: string) => `Could not disconnect ${alias}: ${m}`,
    noSePudoEliminarAlias: (alias: string, m: string) => `Could not delete ${alias}: ${m}`,
    txConsolaSinConfirmar: 'What should happen to the uncommitted transaction?',
    consolaConCambios: (nombre: string) =>
      `“${nombre}” has uncommitted changes. Choose what to do with them before deleting it.`,
    noSePudoEliminarConsola: (nombre: string, m: string) => `Could not delete “${nombre}”: ${m}`,
    noSePudoResolverSinonimo: (objeto: string, m: string) => `Could not resolve the synonym ${objeto}: ${m}`,
    sinonimoSinDatos: (objeto: string, tipo: string, destino: string) =>
      `The synonym ${objeto} points to ${tipo} ${destino}, which has no data to open.`,
    noSePudieronCargarClaves: (m: string) => `Could not load more keys: ${m}`,
    noEsBaseDeArchivo: (nombre: string) =>
      `“${nombre}” does not look like a database file that Tessera can open.`,
    noSePudoGuardarOrden: (m: string) => `Could not save the order: ${m}`
  }
)
