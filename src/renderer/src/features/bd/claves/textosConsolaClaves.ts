// =============================================================================
// Textos de la consola de Redis: la barra, el registro de salida, el selector de base, las acciones del
// editor, las líneas de error de la respuesta y las confirmaciones de forzar y de un comando peligroso.
// Sin JSX: los leen `consolaClaves.ts`, `loteClaves.ts`, `monacoConsolaClaves.ts`, `useEjecucionClaves.ts`
// y los componentes de la consola. Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txConsolaClaves = crearTextos(
  {
    // --- barra ---
    ejecutarCursor: (acorde: string) => `Ejecutar el comando del cursor o las líneas seleccionadas · ${acorde}`,
    ejecutar: 'Ejecutar',
    ejecutarTodoTitulo: (acordes: readonly string[]) => `Ejecutar todos los comandos · ${acordes.join(' o ')}`,
    ejecutarTodo: 'Ejecutar todo',
    detenerTitulo: (acorde: string) => `Detener · ${acorde}`,
    detener: 'Detener',
    nadaEnEjecucion: 'No hay nada en ejecución',
    historialTitulo: (acorde: string) => `Historial de comandos · ${acorde}`,
    historial: 'Historial de comandos',
    esperaParaCambiarBase: 'Espera a que termine la ejecución para cambiar la base',
    baseCambiar: (base: string) => `Base: ${base}. Pulsa para cambiar`,
    baseDeLaConsola: (base: string) => `Base de la consola: ${base}`,
    soloBase0: 'Cluster: solo existe la base 0',
    baseActual: (base: string) => `Base actual: ${base} (también la cambia «SELECT n»)`,
    // --- panes ---
    noSePudoLeer: (e: string) => `No se pudo leer la consola: ${e}`,
    cargando: 'Cargando…',
    repartoAria: 'Reparto entre la consola y los resultados',
    pistaSinComando: 'Coloca el cursor en un comando o selecciona líneas',
    // --- registro ---
    salida: 'Salida',
    salidaTitulo: 'Salida: cada comando con su respuesta',
    salidaVacia: 'La salida ya está vacía',
    limpiarSalida: 'Limpiar la salida',
    salidaAria: 'Salida de la consola',
    resultadosAria: 'Resultados de la consola',
    sinSalida: 'Sin salida',
    sinSalidaPista: (ejecutar: string, todo: string) =>
      `${ejecutar} ejecuta el comando de la línea del cursor o las líneas seleccionadas; ${todo}, todos. Un comando por línea; las que empiezan por # son comentarios.`,
    // --- selector de base ---
    bases: 'Bases',
    baseDeLaConsolaEn: (alias: string) => `Base de la consola en ${alias}`,
    filtrarBases: 'Filtrar bases (3 o db3)',
    pistaSelector: 'Enter elige · Esc cancela · también «SELECT n»',
    conteoClaves: (n: number) => (n === 1 ? '1 clave' : `${n} claves`),
    // --- acciones del editor ---
    accionEjecutar: 'Ejecutar comando o líneas seleccionadas',
    accionEjecutarTodo: 'Ejecutar todos los comandos',
    accionDetener: 'Detener',
    accionHistorial: 'Historial de comandos…',
    // --- respuesta ---
    cambioBase: (base: number) => `Base de la consola: db${base}`,
    lineaMas: 'línea más',
    lineasMas: 'líneas más',
    sinMostrar: (cantidad: string) => `… ${cantidad} sin mostrar`,
    errorDesconocido: 'Error desconocido',
    errorSintaxis: 'Error de sintaxis',
    noSeEnvio: (m: string) => `No se envió: ${m}`,
    noSeEnvioMarca: 'No se envió',
    elComando: 'el comando',
    seEjecutaraEn: (alias: string, produccion: boolean, base: number) =>
      `Se ejecutará en «${alias}»${produccion ? ', una conexión de PRODUCCIÓN,' : ''} sobre la base db${base}.`,
    ejecutarVerboTitulo: (verbo: string) => `¿Ejecutar ${verbo}?`,
    ejecutarVerbo: (verbo: string) => `Ejecutar ${verbo}`,
    escritura: 'Escritura',
    // --- forzar ---
    forzarEtiqueta: 'Forzar (cierra la conexión con el servidor)',
    forzarTitulo: '¿Forzar el cierre de la conexión?',
    forzarMensaje: (alias: string) =>
      `Se cerrará la conexión con «${alias}»: lo que esté corriendo se corta, y un MULTI abierto en sus consolas se descarta.`,
    forzar: 'Forzar'
  },
  {
    ejecutarCursor: (acorde: string) => `Run the command at the cursor or the selected lines · ${acorde}`,
    ejecutar: 'Run',
    ejecutarTodoTitulo: (acordes: readonly string[]) => `Run all commands · ${acordes.join(' or ')}`,
    ejecutarTodo: 'Run all',
    detenerTitulo: (acorde: string) => `Stop · ${acorde}`,
    detener: 'Stop',
    nadaEnEjecucion: 'Nothing is running',
    historialTitulo: (acorde: string) => `Command history · ${acorde}`,
    historial: 'Command history',
    esperaParaCambiarBase: 'Wait for the execution to finish to change the database',
    baseCambiar: (base: string) => `Database: ${base}. Click to change`,
    baseDeLaConsola: (base: string) => `Console database: ${base}`,
    soloBase0: 'Cluster: only database 0 exists',
    baseActual: (base: string) => `Current database: ${base} (“SELECT n” also changes it)`,
    noSePudoLeer: (e: string) => `Could not read the console: ${e}`,
    cargando: 'Loading…',
    repartoAria: 'Split between the console and the results',
    pistaSinComando: 'Place the cursor on a command or select lines',
    salida: 'Output',
    salidaTitulo: 'Output: each command with its response',
    salidaVacia: 'The output is already empty',
    limpiarSalida: 'Clear the output',
    salidaAria: 'Console output',
    resultadosAria: 'Console results',
    sinSalida: 'No output',
    sinSalidaPista: (ejecutar: string, todo: string) =>
      `${ejecutar} runs the command on the cursor line or the selected lines; ${todo} runs all of them. One command per line; lines starting with # are comments.`,
    bases: 'Databases',
    baseDeLaConsolaEn: (alias: string) => `Console database on ${alias}`,
    filtrarBases: 'Filter databases (3 or db3)',
    pistaSelector: 'Enter selects · Esc cancels · also “SELECT n”',
    conteoClaves: (n: number) => (n === 1 ? '1 key' : `${n} keys`),
    accionEjecutar: 'Run command or selected lines',
    accionEjecutarTodo: 'Run all commands',
    accionDetener: 'Stop',
    accionHistorial: 'Command history…',
    cambioBase: (base: number) => `Console database: db${base}`,
    lineaMas: 'more line',
    lineasMas: 'more lines',
    sinMostrar: (cantidad: string) => `… ${cantidad} not shown`,
    errorDesconocido: 'Unknown error',
    errorSintaxis: 'Syntax error',
    noSeEnvio: (m: string) => `Not sent: ${m}`,
    noSeEnvioMarca: 'Not sent',
    elComando: 'the command',
    seEjecutaraEn: (alias: string, produccion: boolean, base: number) =>
      `It will run on “${alias}”${produccion ? ', a PRODUCTION connection,' : ''} on database db${base}.`,
    ejecutarVerboTitulo: (verbo: string) => `Run ${verbo}?`,
    ejecutarVerbo: (verbo: string) => `Run ${verbo}`,
    escritura: 'Write',
    forzarEtiqueta: 'Force (closes the connection to the server)',
    forzarTitulo: 'Force the connection to close?',
    forzarMensaje: (alias: string) =>
      `The connection to “${alias}” will be closed: whatever is running is cut off, and an open MULTI in its consoles is discarded.`,
    forzar: 'Force'
  }
)
