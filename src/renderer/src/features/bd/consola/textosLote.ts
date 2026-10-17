// =============================================================================
// Textos de la consola SQL antes y mientras corre un lote: los peligros (DML sin WHERE), la
// confirmación de producción, el progreso de la barra, las pistas y el diálogo de «Forzar».
// Sin JSX; los leen `decisionLote.ts`, `produccionConsola.ts` y `vivoConsola.ts`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txLote = crearTextos(
  {
    // Peligros
    laSentencia: 'La sentencia',
    sinWhere: (verbo: string) => `${verbo} sin WHERE: afecta a todas las filas de la tabla`,
    truncate: (verbo: string) => `${verbo}: vacía la tabla entera`,
    dropObjeto: (verbo: string) => `${verbo}: borra el objeto`,
    tituloPeligro: (verbo: string) => `¿Ejecutar ${verbo} sin WHERE?`,
    tituloPeligros: '¿Ejecutar sentencias sin WHERE?',
    mensajePeligros: (alias: string, cuerpo: string) => `En ${alias}:\n\n${cuerpo}`,
    ejecutarDeTodosModos: 'Ejecutar de todos modos',
    // Producción
    ejecutarEnProduccion: 'Ejecutar en producción',
    confirmarCommit: 'Confirmar (Commit)',
    verboSentencia: 'Sentencia',
    escribeUna: (verbos: string) => `La sentencia escribe: ${verbos}.`,
    escribenTodas: (total: number, verbos: string) => `Las ${total} sentencias escriben: ${verbos}.`,
    escribeUnaDe: (total: number, verbos: string) => `Escribe 1 de las ${total} sentencias: ${verbos}.`,
    escribenAlgunas: (n: number, total: number, verbos: string) =>
      `Escriben ${n} de las ${total} sentencias: ${verbos}.`,
    esProduccion: (alias: string) => `«${alias}» es una conexión de producción.`,
    ddlConfirma: (motor: string, cuantas: string) =>
      `En ${motor}, un DDL hace COMMIT de lo pendiente: los cambios sin confirmar de esta consola${cuantas} ` +
      'quedarán confirmados y ya no se podrán revertir.',
    bloqueUno: 'Este bloque contiene un COMMIT',
    bloqueDeLote: 'Un bloque del lote contiene un COMMIT',
    bloquesDeLote: (n: number) => `${n} bloques del lote contienen un COMMIT`,
    efectoSinPendientes:
      'lo escrito hasta ese punto queda confirmado sin pasar por la confirmación del COMMIT, y ya no se podrá revertir.',
    efectoConPendientes: (cuantas: string) =>
      `confirma también los cambios sin confirmar de esta consola${cuantas} sin pasar por la confirmación del COMMIT, y ya no se podrán revertir.`,
    sujetoEfecto: (sujeto: string, efecto: string) => `${sujeto}: ${efecto}`,
    tituloEjecutarProd: (alias: string) => `Producción: ¿ejecutar en ${alias}?`,
    tituloConfirmarProd: (alias: string) => `Producción: ¿confirmar en ${alias}?`,
    commitProd: (alias: string, cuantas: string) =>
      `«${alias}» es una conexión de producción.\n\n` +
      `El COMMIT hace definitivos los cambios pendientes de esta consola${cuantas}.`,
    contextoProd: (contexto: string, alias: string) =>
      `${contexto}\n«${alias}» es una conexión de producción: «Confirmar (Commit)» hace definitivos los cambios.`,
    noSeConfirmo: (motivo: string) => `No se confirmó: ${motivo}`,
    // Progreso y pistas
    pistaVariasPlan: 'Explicar el plan es de UNA sentencia: deja el cursor en una o selecciona solo una',
    pistaYaFormateado:
      'Nada que cambiar: ya estaba formateado, o es algo que el formateador deja como está (PL/SQL, comandos…)',
    deteniendo: 'Deteniendo…',
    obteniendoPlan: 'Obteniendo el plan',
    ejecutandoDe: (n: number, total: number) => `Ejecutando ${n} de ${total}`,
    ejecutando: 'Ejecutando',
    txFallida: 'La transacción de la consola falló: solo se puede revertir.',
    txSinConfirmarN: (cant: string) => `La consola tiene una transacción sin confirmar (${cant}).`,
    txSinConfirmar: 'La consola tiene una transacción sin confirmar.',
    otraConsola: 'una consola de otro perfil',
    sesionDatos: 'la sesión de datos',
    // Forzar
    cabezaConexion: (alias: string) =>
      `Se cerrará la conexión con ${alias} (todas sus sesiones) y el servidor revertirá lo que no esté confirmado.`,
    vacioConexion: 'No hay transacciones sin confirmar en esta conexión.',
    cabezaConsola: (alias: string) =>
      `Se cerrará la sesión de esta consola con ${alias} y se revertirá lo que no esté confirmado en ella. Las demás consolas y pestañas de la conexión siguen como están.`,
    vacioConsola: 'Esta consola no tiene transacciones sin confirmar.',
    sePerderan: 'Se perderán:',
    lineaSinConfirmarN: (nombre: string, cant: string) => `· ${nombre}: ${cant} sin confirmar`,
    lineaFallida: (nombre: string) => `· ${nombre}: transacción fallida`,
    lineaAbierta: (nombre: string) => `· ${nombre}: transacción abierta (solo lecturas)`,
    lineaSinConfirmar: (nombre: string) => `· ${nombre}: transacción sin confirmar`
  },
  {
    laSentencia: 'The statement',
    sinWhere: (verbo: string) => `${verbo} without WHERE: affects every row in the table`,
    truncate: (verbo: string) => `${verbo}: empties the whole table`,
    dropObjeto: (verbo: string) => `${verbo}: deletes the object`,
    tituloPeligro: (verbo: string) => `Run ${verbo} without WHERE?`,
    tituloPeligros: 'Run statements without WHERE?',
    mensajePeligros: (alias: string, cuerpo: string) => `On ${alias}:\n\n${cuerpo}`,
    ejecutarDeTodosModos: 'Run anyway',
    ejecutarEnProduccion: 'Run in production',
    confirmarCommit: 'Commit',
    verboSentencia: 'Statement',
    escribeUna: (verbos: string) => `The statement writes: ${verbos}.`,
    escribenTodas: (total: number, verbos: string) => `All ${total} statements write: ${verbos}.`,
    escribeUnaDe: (total: number, verbos: string) => `1 of the ${total} statements writes: ${verbos}.`,
    escribenAlgunas: (n: number, total: number, verbos: string) =>
      `${n} of the ${total} statements write: ${verbos}.`,
    esProduccion: (alias: string) => `“${alias}” is a production connection.`,
    ddlConfirma: (motor: string, cuantas: string) =>
      `In ${motor}, a DDL statement commits what is pending: this console’s uncommitted changes${cuantas} ` +
      'will be committed and can no longer be rolled back.',
    bloqueUno: 'This block contains a COMMIT',
    bloqueDeLote: 'A block in the batch contains a COMMIT',
    bloquesDeLote: (n: number) => `${n} blocks in the batch contain a COMMIT`,
    efectoSinPendientes:
      'everything written up to that point is committed without going through the COMMIT confirmation, and can no longer be rolled back.',
    efectoConPendientes: (cuantas: string) =>
      `it also commits this console’s uncommitted changes${cuantas} without going through the COMMIT confirmation, and they can no longer be rolled back.`,
    sujetoEfecto: (sujeto: string, efecto: string) => `${sujeto}: ${efecto}`,
    tituloEjecutarProd: (alias: string) => `Production: run on ${alias}?`,
    tituloConfirmarProd: (alias: string) => `Production: commit on ${alias}?`,
    commitProd: (alias: string, cuantas: string) =>
      `“${alias}” is a production connection.\n\n` +
      `COMMIT makes this console’s pending changes final${cuantas}.`,
    contextoProd: (contexto: string, alias: string) =>
      `${contexto}\n“${alias}” is a production connection: “Commit” makes the changes final.`,
    noSeConfirmo: (motivo: string) => `Not committed: ${motivo}`,
    pistaVariasPlan: 'Explaining a plan works on ONE statement: leave the cursor in one or select only one',
    pistaYaFormateado:
      'Nothing to change: it was already formatted, or it is something the formatter leaves as is (PL/SQL, commands…)',
    deteniendo: 'Stopping…',
    obteniendoPlan: 'Getting the plan',
    ejecutandoDe: (n: number, total: number) => `Running ${n} of ${total}`,
    ejecutando: 'Running',
    txFallida: 'The console’s transaction failed: it can only be rolled back.',
    txSinConfirmarN: (cant: string) => `The console has an uncommitted transaction (${cant}).`,
    txSinConfirmar: 'The console has an uncommitted transaction.',
    otraConsola: 'a console from another profile',
    sesionDatos: 'the data session',
    cabezaConexion: (alias: string) =>
      `The connection to ${alias} (all its sessions) will be closed and the server will roll back anything uncommitted.`,
    vacioConexion: 'There are no uncommitted transactions on this connection.',
    cabezaConsola: (alias: string) =>
      `This console’s session with ${alias} will be closed and anything uncommitted in it will be rolled back. The connection’s other consoles and tabs are left as they are.`,
    vacioConsola: 'This console has no uncommitted transactions.',
    sePerderan: 'These will be lost:',
    lineaSinConfirmarN: (nombre: string, cant: string) => `· ${nombre}: ${cant} uncommitted`,
    lineaFallida: (nombre: string) => `· ${nombre}: failed transaction`,
    lineaAbierta: (nombre: string) => `· ${nombre}: open transaction (reads only)`,
    lineaSinConfirmar: (nombre: string) => `· ${nombre}: uncommitted transaction`
  }
)
