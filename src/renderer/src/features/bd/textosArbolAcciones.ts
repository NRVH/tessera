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
    nadaDesplegado: 'No hay nada desplegado',
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
    soloTipo: (tipo: string) => `Solo ${tipo}`,
    nuevaClave: 'Nueva clave…',
    borrarPorPatron: 'Borrar claves por patrón…',
    filtrarPorPrefijo: (prefijo: string) => `Filtrar por ${prefijo}*`,
    copiarPrefijo: 'Copiar prefijo',
    borrarClavesPrefijo: (prefijo: string) => `Borrar las claves ${prefijo}*…`,
    abrirConAcorde: (acorde: string) => `Abrir (${acorde})`,
    copiarNombre: 'Copiar nombre',
    nuevaConexion: 'Nueva conexión…',
    plegarTodo: 'Plegar todo',
    // --- diálogos ---
    tituloEliminarConexion: 'Eliminar conexión',
    eliminar: 'Eliminar',
    tituloEliminarConsola: 'Eliminar consola',
    consolaALaPapelera: (nombre: string) => `«${nombre}.sql» irá a la papelera; podrás recuperarla desde allí.`,
    tituloRenombrar: 'Renombrar consola',
    etiquetaNombre: 'Nombre',
    renombrarBoton: 'Renombrar',
    filtrarClavesDe: (base: string) => `Filtrar claves de ${base}`,
    patronOTexto: 'Patrón o texto',
    filtrar: 'Filtrar',
    pistaFiltro:
      'Con * ? [ ] es un patrón (usuario:*). Sin comodines se busca el texto en cualquier parte del nombre. Vacío quita el filtro.',
    cancelar: 'Cancelar',
    // --- acciones ---
    noSePudoCopiar: (m: string) => `No se pudo copiar: ${m}`,
    noSePudoRefrescar: (m: string) => `No se pudo refrescar: ${m}`,
    probandoAlias: (alias: string) => `Probando ${alias}…`,
    instalarCliente: 'Instalar cliente…',
    txFallidasRevertidas: 'Transacciones fallidas revertidas',
    txSinConfirmar: 'Transacciones sin confirmar',
    desconectarConCambios: (alias: string, nombres: readonly string[], soloRevertir: boolean) =>
      `${alias} tiene cambios sin confirmar` +
      (nombres.length > 0 ? ` en ${nombres.join(', ')}` : '') +
      (soloRevertir ? '. Para desconectar hay que revertirlos.' : '. Para desconectar hay que confirmarlos o revertirlos.'),
    noSePudoDesconectar: (alias: string, m: string) => `No se pudo desconectar ${alias}: ${m}`,
    noSePudoEliminarAlias: (alias: string, m: string) => `No se pudo eliminar ${alias}: ${m}`,
    txConsolaSinConfirmar: 'Transacción sin confirmar',
    consolaConCambios: (nombre: string) =>
      `«${nombre}» tiene cambios sin confirmar. Elige qué hacer con ellos antes de eliminarla.`,
    noSePudoEliminarConsola: (nombre: string, m: string) => `No se pudo eliminar «${nombre}»: ${m}`,
    // --- navegación ---
    noSePudoResolverSinonimo: (objeto: string, m: string) => `No se pudo resolver el sinónimo ${objeto}: ${m}`,
    sinonimoSinDatos: (objeto: string, tipo: string, destino: string) =>
      `El sinónimo ${objeto} apunta a ${tipo} ${destino}, que no tiene datos que abrir.`,
    noSePudieronCargarClaves: (m: string) => `No se pudieron cargar más claves: ${m}`,
    noEsBaseDeArchivo: (nombre: string) =>
      `«${nombre}» no parece una base de datos de archivo que Tessera sepa abrir.`,
    noSePudoGuardarOrden: (m: string) => `No se pudo guardar el orden: ${m}`
  },
  {
    tituloCabecera: 'Databases',
    nuevaConexionSinPuntos: 'New connection',
    nuevaConsolaTitulo: (alias: string | null, acorde: string) =>
      `New console${alias !== null ? ` in ${alias}` : ''} (${acorde})`,
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
    soloTipo: (tipo: string) => `Only ${tipo}`,
    nuevaClave: 'New key…',
    borrarPorPatron: 'Delete keys by pattern…',
    filtrarPorPrefijo: (prefijo: string) => `Filter by ${prefijo}*`,
    copiarPrefijo: 'Copy prefix',
    borrarClavesPrefijo: (prefijo: string) => `Delete the ${prefijo}* keys…`,
    abrirConAcorde: (acorde: string) => `Open (${acorde})`,
    copiarNombre: 'Copy name',
    nuevaConexion: 'New connection…',
    plegarTodo: 'Collapse all',
    tituloEliminarConexion: 'Delete connection',
    eliminar: 'Delete',
    tituloEliminarConsola: 'Delete console',
    consolaALaPapelera: (nombre: string) => `“${nombre}.sql” will go to the trash; you can recover it from there.`,
    tituloRenombrar: 'Rename console',
    etiquetaNombre: 'Name',
    renombrarBoton: 'Rename',
    filtrarClavesDe: (base: string) => `Filter keys of ${base}`,
    patronOTexto: 'Pattern or text',
    filtrar: 'Filter',
    pistaFiltro:
      'With * ? [ ] it is a pattern (user:*). Without wildcards the text is searched anywhere in the name. Empty removes the filter.',
    cancelar: 'Cancel',
    noSePudoCopiar: (m: string) => `Could not copy: ${m}`,
    noSePudoRefrescar: (m: string) => `Could not refresh: ${m}`,
    probandoAlias: (alias: string) => `Testing ${alias}…`,
    instalarCliente: 'Install client…',
    txFallidasRevertidas: 'Failed transactions rolled back',
    txSinConfirmar: 'Uncommitted transactions',
    desconectarConCambios: (alias: string, nombres: readonly string[], soloRevertir: boolean) =>
      `${alias} has uncommitted changes` +
      (nombres.length > 0 ? ` in ${nombres.join(', ')}` : '') +
      (soloRevertir ? '. To disconnect they must be rolled back.' : '. To disconnect they must be committed or rolled back.'),
    noSePudoDesconectar: (alias: string, m: string) => `Could not disconnect ${alias}: ${m}`,
    noSePudoEliminarAlias: (alias: string, m: string) => `Could not delete ${alias}: ${m}`,
    txConsolaSinConfirmar: 'Uncommitted transaction',
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
