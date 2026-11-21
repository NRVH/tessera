// =============================================================================
// Textos del árbol de BD que arman las funciones puras de `filasArbolBd*.ts`: etiquetas de carpetas,
// tooltips de conexión y de ajenas, avisos de área vacía, diálogo de transacciones y de eliminar.
// Español e inglés con las mismas claves; se leen al usarse (`txFilasArbol()`), nunca al cargar.
// Sin JSX ni DOM: lo cargan las pruebas con `node`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txFilasArbol = crearTextos(
  {
    carpeta: {
      tabla: 'tablas',
      vista: 'vistas',
      vistaMaterializada: 'vistas materializadas',
      tablaForanea: 'tablas foráneas',
      tablaVirtual: 'tablas virtuales',
      rutina: 'rutinas',
      paquete: 'paquetes',
      secuencia: 'secuencias',
      sinonimo: 'sinónimos',
      tipoObjeto: 'tipos de objeto',
      tipoColeccion: 'tipos de colección',
      tipo: 'tipos',
      disparador: 'disparadores',
      evento: 'eventos'
    },
    parte: {
      columnas: 'columnas',
      indices: 'índices',
      restricciones: 'restricciones'
    },
    // --- filasArbolBd ---
    entorno: 'Entorno: ',
    soloLecturaAgentes: 'Solo lectura para los agentes',
    produccionEntreParentesis: 'producción',
    secretoIlegible: (almacen: string) =>
      'La contraseña guardada no se puede descifrar en este equipo. Se cifró con ' +
      `${almacen}, que la vincula al usuario y al equipo donde se guardó. Vuelva a escribirla.`,
    sinContrasena: 'Sin contraseña guardada.',
    subtipoSombra: 'Tabla interna de una tabla virtual: la mantiene el motor, no se edita.',
    subtipoSistema: 'Tabla interna del motor.',
    subtipoSinRowid: 'WITHOUT ROWID: se identifica por su clave primaria.',
    instalarCliente: 'Instalar cliente…',
    reescribirContrasena: 'Volver a escribir la contraseña',
    reintentar: 'Reintentar',
    // --- filasArbolBdTextos ---
    y: 'y',
    citado: (s: string) => `"${s}"`,
    unoMas: '1 más',
    masN: (n: number) => `${n} más`,
    consolaALaPapelera: (nombre: string) => `Su consola "${nombre}" se moverá a la papelera.`,
    consolasALaPapelera: (n: number) => `Sus ${n} consolas se moverán a la papelera.`,
    eliminarConexion: (alias: string) =>
      `Se eliminará "${alias}" y su contraseña guardada. No se puede deshacer; la base de datos no se modifica.`,
    desmontarDeTodos: 'Se desmontará de todos los proyectos donde esté montada.',
    desmontarDe: (lista: string) => `Se desmontará de ${lista}.`,
    revertirSinConfirmar: (lista: string) => `Se revertirán los cambios sin confirmar de ${lista}.`,
    descartarUnCambio: 'Se descartará 1 cambio sin enviar de sus pestañas de datos.',
    descartarCambios: (n: number) => `Se descartarán ${n} cambios sin enviar de sus pestañas de datos.`,
    // --- filasArbolBdAvisos ---
    tituloSoloAjenas: 'Ninguna conexión que esta versión pueda abrir',
    pistaSoloAjenas:
      'Esta versión no puede abrir las conexiones del árbol; cada una indica el motivo y se conserva sin cambios. ' +
      'Actualice Tessera si proceden de una versión más reciente, o cree una conexión nueva aquí.',
    vacioMontajeConAjenas: (titulo: string) =>
      `${titulo}: la vista Bases de datos muestra atenuadas las conexiones de este perfil, ` +
      'cada una con su motivo. Cree allí una conexión para montarla.',
    vacioMontajeSinConexiones: 'Este perfil no tiene conexiones. Añádalas en la vista Bases de datos.',
    tituloFormatoAjeno: 'No se puede usar el registro de conexiones',
    notaFormatoAjeno:
      'Mientras tanto no se muestra ninguna conexión ni se pueden crear, pero no se pierde nada: ' +
      'el archivo no se modifica y se conservan las bases montadas en los proyectos.',
    motivoFormatoAjeno: 'No disponible: no se puede usar el registro de conexiones',
    notaMontajeFormatoAjeno:
      'Las bases montadas aquí se conservan tal cual: vuelven a estar disponibles en cuanto ' +
      'Tessera pueda leer el registro.',
    abrePerfil: 'Abra un perfil para usar las bases de datos',
    sinConexionesTodavia: 'Todavía no hay conexiones',
    consolaNoDisponible: (motor: string) => `La consola de ${motor} todavía no está disponible en esta versión.`,
    sinConexionesTitulo: 'Sin conexiones',
    sinConexionesPista: 'Cree la primera conexión para explorar sus datos.',
    // --- filasArbolBdAjenas ---
    textoAjena: 'Requiere una versión más nueva de Tessera',
    textoAjenaForma: 'Esta versión no reconoce cómo está guardada',
    deOtroPerfil: 'una conexión de otro perfil',
    comparteConEliminada: 'Compartía el identificador con una conexión eliminada',
    comparteCon: (otra: string) => `Comparte el identificador con ${otra}`,
    explicaEliminada:
      'Compartía el identificador con una conexión eliminada: Tessera lee las conexiones al ' +
      'iniciarse y hasta entonces sigue tratándola como repetida; reinicie Tessera para ' +
      'usarla. Se conserva sin cambios.',
    explicaComparte: (otra: string) =>
      `Comparte el identificador con ${otra}: esta versión no puede distinguirlas, y cualquier acción ` +
      `realizada con ese identificador también afecta a la otra. Se conserva sin cambios; elimine la que no necesite.`,
    explicaMotor: (texto: string) =>
      `${texto}: la creó una versión más reciente, y esta no conoce su motor ni puede ` +
      'abrirla. Se conserva sin cambios; actualice Tessera para usarla.',
    explicaForma: (texto: string) =>
      `${texto}: puede proceder de una versión más reciente de Tessera (actualice Tessera ` +
      'para usarla) o de una edición manual del archivo. Se conserva sin cambios.',
    eliminarConexionMenu: 'Eliminar conexión…',
    motorEtiqueta: (motor: string) => `Motor: ${motor}`,
    salidaMontaje: 'El agente no puede usarla con esta versión; aquí solo se puede desmontar.',
    salidaArbol: 'Si ya no la necesita, elimínela: es la única acción que esta versión puede realizar con ella.',
    salidaArbolRepetida: 'Si ya no la necesita, elimínela.',
    eliminarNoToca: (otra: string) => `Eliminarla no toca ${otra}: ni sus montajes ni sus consolas.`,
    compartidaNoSeToca: (otra: string) =>
      `"${otra}" comparte su identificador y no se modifica: sus montajes y sus consolas siguen.`,
    desmontarDeEstePerfil: 'Se desmontará de los proyectos de este perfil donde esté montada.',
    otroPerfilNoSeToca:
      'La conexión de otro perfil que comparte su identificador no se modifica: ni sus montajes ni sus consolas.',
    eliminarAjena: (alias: string) =>
      `Se eliminará "${alias}" y su contraseña guardada, si tiene. No se puede deshacer; la base de datos no se modifica.`,
    esConexionDe: (motor: string, explicacion: string) => `Es una conexión de ${motor}. ${explicacion}`,
    eliminarSoloSiNoQuieres: 'Elimínela solo si ya no la necesita.',
    // --- filasArbolBdSesiones ---
    unaConsola: 'una consola',
    pestanasDatos: 'las pestañas de datos',
    elArbol: 'el árbol',
    revertirTodas: 'Revertir todas',
    revertir: 'Revertir',
    confirmarTodas: 'Confirmar todas',
    confirmar: 'Confirmar',
    confirmarFallidaUna: 'Confirmar (la fallida se revierte)',
    confirmarFallidasVarias: 'Confirmar (las fallidas se revierten)',
    notaUnaFallo: (total: number) =>
      `1 de las ${total} transacciones falló y se revertirá aunque se confirmen las demás: una transacción fallida solo se puede revertir.`,
    notaVariasFallan: (fallidas: number, total: number) =>
      `${fallidas} de las ${total} transacciones fallaron y se revertirán aunque se confirmen las demás: una transacción fallida solo se puede revertir.`,
    revertidaUna: (alias: string, quien: string) =>
      `${alias}: se confirmó lo pendiente y se revirtió la transacción fallida${quien}.`,
    revertidasVarias: (alias: string, n: number, quien: string) =>
      `${alias}: se confirmó lo pendiente y se revirtieron las ${n} transacciones fallidas${quien}.`,
    soloRevertirVarias: (n: number) =>
      `Las ${n} transacciones fallaron, y una transacción fallida solo se puede revertir.`,
    soloRevertirUna: 'La transacción falló: solo se puede revertir.',
    desconectarSinSeleccion: 'Seleccione una conexión (o un elemento de ella) para desconectarla',
    desconectar: 'Desconectar',
    desconectarAlias: (alias: string) => `Desconectar ${alias}`,
    noConectada: (alias: string) => `${alias} no está conectada`
  },
  {
    carpeta: {
      tabla: 'tables',
      vista: 'views',
      vistaMaterializada: 'materialized views',
      tablaForanea: 'foreign tables',
      tablaVirtual: 'virtual tables',
      rutina: 'routines',
      paquete: 'packages',
      secuencia: 'sequences',
      sinonimo: 'synonyms',
      tipoObjeto: 'object types',
      tipoColeccion: 'collection types',
      tipo: 'types',
      disparador: 'triggers',
      evento: 'events'
    },
    parte: {
      columnas: 'columns',
      indices: 'indexes',
      restricciones: 'constraints'
    },
    entorno: 'Environment: ',
    soloLecturaAgentes: 'Read-only for agents',
    produccionEntreParentesis: 'production',
    secretoIlegible: (almacen: string) =>
      'The saved password cannot be decrypted on this computer. It was encrypted with ' +
      `${almacen}, which ties it to the user and computer where it was saved. Enter it again.`,
    sinContrasena: 'No saved password.',
    subtipoSombra: 'Internal table of a virtual table, maintained by the engine. It cannot be edited.',
    subtipoSistema: 'Internal engine table.',
    subtipoSinRowid: 'WITHOUT ROWID: identified by its primary key.',
    instalarCliente: 'Install client…',
    reescribirContrasena: 'Enter the password again',
    reintentar: 'Retry',
    y: 'and',
    citado: (s: string) => `"${s}"`,
    unoMas: '1 more',
    masN: (n: number) => `${n} more`,
    consolaALaPapelera: (nombre: string) => `Its console "${nombre}" will be moved to the trash.`,
    consolasALaPapelera: (n: number) => `Its ${n} consoles will be moved to the trash.`,
    eliminarConexion: (alias: string) =>
      `"${alias}" and its saved password will be deleted. This cannot be undone. The database itself is not affected.`,
    desmontarDeTodos: 'It will be unmounted from every project where you mounted it.',
    desmontarDe: (lista: string) => `It will be unmounted from ${lista}.`,
    revertirSinConfirmar: (lista: string) => `Uncommitted changes in ${lista} will be rolled back.`,
    descartarUnCambio: '1 unsubmitted change in its data tabs will be discarded.',
    descartarCambios: (n: number) => `${n} unsubmitted changes in its data tabs will be discarded.`,
    tituloSoloAjenas: 'No connections this version can open',
    pistaSoloAjenas:
      'This version cannot open the connections in the tree; each one shows why. They are kept as they are. ' +
      'Update Tessera if they come from a newer version, or create a new one here.',
    vacioMontajeConAjenas: (titulo: string) =>
      `${titulo}: the Databases view shows this profile’s connections dimmed, ` +
      'each with its reason. Create one there to mount it.',
    vacioMontajeSinConexiones: 'This profile has no connections. Add them in the Databases view.',
    tituloFormatoAjeno: 'The connection registry cannot be used',
    notaFormatoAjeno:
      'In the meantime, no connections are shown and none can be created, but nothing is lost: ' +
      'the file is not modified, and the databases mounted in projects are kept.',
    motivoFormatoAjeno: 'Unavailable: the connection registry cannot be used',
    notaMontajeFormatoAjeno:
      'The databases mounted here are kept as they are: they become available again as soon as ' +
      'Tessera can read the registry.',
    abrePerfil: 'Open a profile to use databases',
    sinConexionesTodavia: 'No connections yet',
    consolaNoDisponible: (motor: string) => `The ${motor} console is not available in this version yet.`,
    sinConexionesTitulo: 'No connections',
    sinConexionesPista: 'Create the first one to explore your data.',
    textoAjena: 'Requires a newer version of Tessera',
    textoAjenaForma: 'This version does not recognize how it is stored',
    deOtroPerfil: 'a connection from another profile',
    comparteConEliminada: 'It shared its identifier with a deleted connection',
    comparteCon: (otra: string) => `It shares its identifier with ${otra}`,
    explicaEliminada:
      'It shared its identifier with a deleted connection. Tessera reads connections at ' +
      'startup and treats it as a duplicate until then, so restart Tessera to ' +
      'use it. It is kept as it is.',
    explicaComparte: (otra: string) =>
      `It shares its identifier with ${otra}: this version cannot tell them apart, and any action ` +
      `on that identifier also affects the other one. It is kept as it is; delete it if you do not need it.`,
    explicaMotor: (texto: string) =>
      `${texto}: it was created by a newer version, and this one does not know its engine or how ` +
      'to open it. It is kept as it is; update Tessera to use it.',
    explicaForma: (texto: string) =>
      `${texto}: it may come from a newer version of Tessera (update ` +
      'to use it) or from a manual edit of the file. It is kept as it is, untouched.',
    eliminarConexionMenu: 'Delete connection…',
    motorEtiqueta: (motor: string) => `Engine: ${motor}`,
    salidaMontaje: 'The agent cannot use it with this version; here it can only be unmounted.',
    salidaArbol: 'If you no longer want it, delete it; that is the only action this version can take on it.',
    salidaArbolRepetida: 'If you no longer want it, delete it.',
    eliminarNoToca: (otra: string) => `Deleting it does not affect ${otra} or its mounts and consoles.`,
    compartidaNoSeToca: (otra: string) =>
      `"${otra}" shares its identifier and is not affected: its mounts and consoles are kept.`,
    desmontarDeEstePerfil: 'It will be unmounted from the projects in this profile where you mounted it.',
    otroPerfilNoSeToca:
      'The connection from another profile that shares its identifier is not affected, nor are its mounts or consoles.',
    eliminarAjena: (alias: string) =>
      `"${alias}" and its saved password, if any, will be deleted. This cannot be undone. The database itself is not affected.`,
    esConexionDe: (motor: string, explicacion: string) => `It is a ${motor} connection. ${explicacion}`,
    eliminarSoloSiNoQuieres: 'Delete it only if you no longer want it.',
    unaConsola: 'a console',
    pestanasDatos: 'the data tabs',
    elArbol: 'the tree',
    revertirTodas: 'Roll back all',
    revertir: 'Roll back',
    confirmarTodas: 'Commit all',
    confirmar: 'Commit',
    confirmarFallidaUna: 'Commit (the failed one is rolled back)',
    confirmarFallidasVarias: 'Commit (the failed ones are rolled back)',
    notaUnaFallo: (total: number) =>
      `1 of the ${total} transactions failed and will be rolled back even if you commit: a failed transaction can only be rolled back.`,
    notaVariasFallan: (fallidas: number, total: number) =>
      `${fallidas} of the ${total} transactions failed and will be rolled back even if you commit: a failed transaction can only be rolled back.`,
    revertidaUna: (alias: string, quien: string) =>
      `${alias}: the pending changes were committed and the failed transaction was rolled back${quien}.`,
    revertidasVarias: (alias: string, n: number, quien: string) =>
      `${alias}: the pending changes were committed and the ${n} failed transactions were rolled back${quien}.`,
    soloRevertirVarias: (n: number) =>
      `All ${n} transactions failed, and a failed transaction can only be rolled back.`,
    soloRevertirUna: 'The transaction failed and can only be rolled back.',
    desconectarSinSeleccion: 'Select a connection (or an item inside it) to disconnect it',
    desconectar: 'Disconnect',
    desconectarAlias: (alias: string) => `Disconnect ${alias}`,
    noConectada: (alias: string) => `${alias} is not connected`
  }
)
