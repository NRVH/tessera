// =============================================================================
// Las preguntas previas al cierre de las consolas de MongoDB y de Redis: detener lo que corre
// y avisar de un conflicto con el disco. Sin React, para probarlas bajo `node`
// (`consola/test-archivo-consola.mts`); las usan `useCierreConsolaDocs` y `useCierreConsolaClaves`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { ESPERA_STOP_MS } from '../consola/vivoConsola.ts'
import type { Dialogo, EnCurso, PeticionDialogo } from './consolaComun.ts'
import { txConsolaComun } from './textosConsolaComun.ts'

type Ref<T> = React.MutableRefObject<T>

/** Lo que necesita `confirmarCierre` del estado de una consola. */
export interface EstadoCierreConsola {
  pedirConfirmacion: (d: PeticionDialogo) => Promise<boolean>
  dialogoRef: Ref<Dialogo | null>
  consolaRef: Ref<{ nombre: string }>
  enCursoRef: Ref<EnCurso | null>
  conflictoRef: Ref<{ texto: string } | null>
}

/** Una pregunta previa al cierre: detener lo que corre, o cerrar perdiendo cambios por un conflicto. */
export type PreguntaCierre = 'detener' | 'conflicto'

/**
 * Lo que `confirmarCierre` preguntaría ahora. Sin ninguna, el llamador no la invoca y el cierre
 * sigue en el mismo turno; por eso es la única fuente de esa condición.
 */
export function preguntasDeCierre(e: Pick<EstadoCierreConsola, 'enCursoRef' | 'conflictoRef'>): PreguntaCierre[] {
  const preguntas: PreguntaCierre[] = []
  if (e.enCursoRef.current !== null) preguntas.push('detener')
  if (e.conflictoRef.current !== null) preguntas.push('conflicto')
  return preguntas
}

/**
 * Las preguntas previas al cierre: «¿Detener y cerrar?» si corre algo (y se espera a que pare)
 * y el aviso de un conflicto con el disco. false = el usuario no quiso cerrar.
 */
export async function confirmarCierre(e: EstadoCierreConsola, detener: () => void): Promise<boolean> {
  if (e.dialogoRef.current) return false
  const nombre = e.consolaRef.current.nombre
  if (preguntasDeCierre(e).includes('detener')) {
    const ok = await e.pedirConfirmacion({
      titulo: txConsolaComun().detenerYCerrarTitulo,
      mensaje: txConsolaComun().detenerYCerrarMensaje(nombre),
      confirmar: txConsolaComun().detenerYCerrar,
      peligro: true
    })
    if (!ok) return false
    detener()
    // Tanto como el Stop antes de ofrecer «Forzar».
    const hasta = Date.now() + ESPERA_STOP_MS
    while (e.enCursoRef.current && Date.now() < hasta) await new Promise((r) => setTimeout(r, 100))
  }
  if (preguntasDeCierre(e).includes('conflicto')) {
    return e.pedirConfirmacion({
      titulo: txConsolaComun().archivoCambio,
      mensaje: txConsolaComun().conflictoMensaje(nombre),
      confirmar: txConsolaComun().cerrarSinGuardar,
      peligro: true
    })
  }
  return true
}
