// =============================================================================
// Textos del área central de BD y de lo que la rodea (`DbArea`, `DbAreaPanes`, la tira de pestañas,
// `MarcaEntorno`, las consolas y los avisos de `useBdApp`, `useConexionesBd`, `useMontajesBd` y
// `useEspaciosDatos`). Español e inglés con las mismas claves; se leen al usarse, nunca al cargar el
// módulo. Sin JSX ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txArea = crearTextos(
  {
    // --- panes ---
    pestanaNoDisponible: 'Pestaña no disponible',
    pestanaSqlNoSql: 'Esta pestaña es de SQL y la conexión no lo es.',
    noEsDeDocumentos: 'Esta conexión no es de documentos.',
    noEsDeClaves: 'Esta conexión no es de claves.',
    laPestanaDeDatos: 'la pestaña de datos',
    elAreaDeBd: 'el área de bases de datos',
    nuevaConexion: 'Nueva conexión…',
    sinPerfilTitulo: 'Sin perfil activo',
    sinPerfilPista: 'Abre un perfil para ver sus conexiones.',
    ningunaTablaTitulo: 'Ninguna tabla abierta',
    ningunaTablaPista: (abrir: string, nuevaConsola: string) =>
      `Abre una tabla o una vista del árbol con ${abrir}, o una consola SQL con ${nuevaConsola}.`,
    // --- área ---
    renombrarConsola: 'Renombrar consola',
    nombreDeLaConsola: 'Nombre de la consola',
    renombrar: 'Renombrar',
    // --- tira ---
    ejecutando: 'Ejecutando…',
    cargando: 'Cargando…',
    txPendiente: 'Transacción pendiente',
    sinEnviar: 'Cambios sin enviar',
    sesionPerdida: 'Sesión perdida',
    error: 'Error',
    cerrarNombre: (nombre: string) => `Cerrar ${nombre}`,
    cerrar: 'Cerrar',
    cerrarOtras: 'Cerrar otras',
    cerrarIzquierda: 'Cerrar a la izquierda',
    cerrarDerecha: 'Cerrar a la derecha',
    cerrarTodas: 'Cerrar todas',
    mostrarEnArbol: 'Mostrar en el árbol',
    renombrarConsolaPuntos: 'Renombrar consola…',
    tiraAria: 'Pestañas de bases de datos',
    // --- marca de entorno, panes de datos y consola ---
    entorno: 'Entorno: ',
    entornoDe: (nombre: string) => `Entorno: ${nombre}`,
    datosDe: (nombre: string) => `Datos de ${nombre}`,
    consolaNombre: (nombre: string) => `Consola ${nombre}`,
    repartoConsolaResultados: 'Reparto entre la consola y los resultados',
    // --- avisos de los hooks ---
    noSePudoCrearConsola: 'No se pudo crear la consola',
    noSePudoEscribirTextoInicial: 'No se pudo escribir el texto inicial de la consola',
    nuevaConsola: 'Nueva consola',
    conexionesRecuperadas: 'Conexiones recuperadas de la copia de respaldo',
    noSePudieronLeerConexiones: 'No se pudieron leer las conexiones',
    montadaEnProyecto: (alias: string) => `«${alias}» montada en el proyecto`,
    yaEstabaEnConexiones: 'Ya estaba en Conexiones. ',
    seAnadioAConexiones: 'Se añadió a Conexiones. ',
    agenteConsultaSoloLeer: 'El agente puede consultarla con tdb, solo para leer.',
    agenteConsulta: 'El agente puede consultarla con tdb.',
    noSePudoMontar: 'No se pudo montar la base de datos',
    noSePudoPrepararAgenteDatos: 'No se pudo preparar el agente de datos'
  },
  {
    pestanaNoDisponible: 'Tab not available',
    pestanaSqlNoSql: 'This tab is for SQL and the connection is not.',
    noEsDeDocumentos: 'This connection is not a document connection.',
    noEsDeClaves: 'This connection is not a key-value connection.',
    laPestanaDeDatos: 'the data tab',
    elAreaDeBd: 'the databases area',
    nuevaConexion: 'New connection…',
    sinPerfilTitulo: 'No active profile',
    sinPerfilPista: 'Open a profile to see its connections.',
    ningunaTablaTitulo: 'No table open',
    ningunaTablaPista: (abrir: string, nuevaConsola: string) =>
      `Open a table or a view from the tree with ${abrir}, or an SQL console with ${nuevaConsola}.`,
    renombrarConsola: 'Rename console',
    nombreDeLaConsola: 'Console name',
    renombrar: 'Rename',
    ejecutando: 'Running…',
    cargando: 'Loading…',
    txPendiente: 'Pending transaction',
    sinEnviar: 'Unsubmitted changes',
    sesionPerdida: 'Session lost',
    error: 'Error',
    cerrarNombre: (nombre: string) => `Close ${nombre}`,
    cerrar: 'Close',
    cerrarOtras: 'Close others',
    cerrarIzquierda: 'Close to the left',
    cerrarDerecha: 'Close to the right',
    cerrarTodas: 'Close all',
    mostrarEnArbol: 'Show in tree',
    renombrarConsolaPuntos: 'Rename console…',
    tiraAria: 'Database tabs',
    entorno: 'Environment: ',
    entornoDe: (nombre: string) => `Environment: ${nombre}`,
    datosDe: (nombre: string) => `Data of ${nombre}`,
    consolaNombre: (nombre: string) => `Console ${nombre}`,
    repartoConsolaResultados: 'Split between the console and the results',
    noSePudoCrearConsola: 'Could not create the console',
    noSePudoEscribirTextoInicial: 'Could not write the console’s initial text',
    nuevaConsola: 'New console',
    conexionesRecuperadas: 'Connections recovered from the backup copy',
    noSePudieronLeerConexiones: 'Could not read the connections',
    montadaEnProyecto: (alias: string) => `“${alias}” mounted in the project`,
    yaEstabaEnConexiones: 'It was already in Connections. ',
    seAnadioAConexiones: 'It was added to Connections. ',
    agenteConsultaSoloLeer: 'The agent can query it with tdb, read-only.',
    agenteConsulta: 'The agent can query it with tdb.',
    noSePudoMontar: 'Could not mount the database',
    noSePudoPrepararAgenteDatos: 'Could not prepare the data agent'
  }
)
