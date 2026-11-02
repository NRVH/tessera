// =============================================================================
// Textos de la barra de la consola SQL: los botones de icono, el control de transacción
// (modo, Commit, Rollback y sus `title`) y el selector de esquema. Sin JSX: los leen
// `barraTx.ts`, `esquemaConsola.ts` y `BotonesBarraConsola.tsx`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txBarraConsola = crearTextos(
  {
    esperar: 'Espera a que termine la ejecución',
    soloLectura: 'La conexión es de solo lectura',
    txArchivo:
      'Mientras esta transacción siga abierta, el archivo queda bloqueado: otras aplicaciones pueden no poder escribir en él. Confirma o revierte cuando acabes.',
    modoAuto: 'Tx: Auto',
    modoManual: 'Tx: Manual',
    txPendienteN: (n: number) => `Tx pendiente (${n})`,
    txPendiente: 'Tx pendiente',
    txAbierta: 'Tx abierta',
    txFallida: 'Tx fallida: haz Rollback',
    confirmarCommit: 'Confirmar (Commit)',
    commitFallida: 'La transacción falló: solo se puede revertir',
    commitNinguna: 'No hay transacción que confirmar',
    revertirRollback: 'Revertir (Rollback)',
    rollbackNinguna: 'No hay transacción que revertir',
    tituloModoAuto: 'Transacción: Auto. Pulsa para Manual',
    tituloModoManual: 'Transacción: Manual. Pulsa para Auto',
    // Botones de icono
    ejecutarTitulo: 'Ejecutar la sentencia del cursor o la selección',
    ejecutar: 'Ejecutar',
    ejecutarTodoTitulo: 'Ejecutar todo',
    ejecutarTodo: 'Ejecutar todo',
    o: ' o ',
    detener: 'Detener',
    nadaEnEjecucion: 'No hay nada en ejecución',
    explicarTitulo: 'Explicar el plan de la sentencia del cursor o de la selección (sin ejecutarla)',
    explicar: 'Explicar plan',
    historial: 'Historial de consultas',
    txAutomatica: 'Transacción automática',
    txManual: 'Transacción manual',
    // Esquema
    esquemaConexionDe: (porDefecto: string) => `Esquema de la conexión (${porDefecto})`,
    esquemaConexion: 'Esquema de la conexión',
    esquemaEsperar: 'Espera a que termine la ejecución para cambiar el esquema',
    esquemaActual: (actual: string) => `Esquema: ${actual}. Pulsa para cambiar`,
    esquemaConsola: 'Esquema de la consola. Pulsa para cambiar'
  },
  {
    esperar: 'Wait for the execution to finish',
    soloLectura: 'The connection is read-only',
    txArchivo:
      'While this transaction is open, the file stays locked and other applications may not be able to write to it. Commit or roll back when you finish.',
    modoAuto: 'Tx: Auto',
    modoManual: 'Tx: Manual',
    txPendienteN: (n: number) => `Tx pending (${n})`,
    txPendiente: 'Tx pending',
    txAbierta: 'Tx open',
    txFallida: 'Tx failed: roll back',
    confirmarCommit: 'Commit',
    commitFallida: 'The transaction failed and can only be rolled back',
    commitNinguna: 'No transaction to commit',
    revertirRollback: 'Roll back',
    rollbackNinguna: 'No transaction to roll back',
    tituloModoAuto: 'Transaction mode: Auto. Click to switch to Manual',
    tituloModoManual: 'Transaction mode: Manual. Click to switch to Auto',
    ejecutarTitulo: 'Run the selection or the statement at the cursor',
    ejecutar: 'Run',
    ejecutarTodoTitulo: 'Run all',
    ejecutarTodo: 'Run all',
    o: ' or ',
    detener: 'Stop',
    nadaEnEjecucion: 'Nothing is running',
    explicarTitulo: 'Show the execution plan for the selection or the statement at the cursor, without running it',
    explicar: 'Explain plan',
    historial: 'Query history',
    txAutomatica: 'Automatic transaction',
    txManual: 'Manual transaction',
    esquemaConexionDe: (porDefecto: string) => `Connection schema (${porDefecto})`,
    esquemaConexion: 'Connection schema',
    esquemaEsperar: 'Wait for the execution to finish before changing the schema',
    esquemaActual: (actual: string) => `Schema: ${actual}. Click to change`,
    esquemaConsola: 'Console schema. Click to change'
  }
)
