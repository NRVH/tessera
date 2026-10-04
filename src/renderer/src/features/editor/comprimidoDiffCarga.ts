// =============================================================================
// Peticiones del diff de un comprimido al main: comparar el contenedor y pedir el contenido de
// la entrada elegida. Cada una devuelve su limpieza para el efecto que la lanza.
// Lo usan `useComparacionComprimido` y `useContenidoEntrada`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  CompararResult,
  EntradaResult,
  LadoComprimido
} from '../../../../shared/comprimidos-ipc'
import { comoPedir } from './comprimidoDiffModelo'

/** Antirrebote del contenido: más largo que el del historial porque al otro lado puede haber dos JVM. */
const PEDIR_MS = 250

/** Espera antes de RE-comparar por el watcher; agrupa las ráfagas de un `mvn package`. */
const RECOMPARAR_MS = 400

interface EntradaComparar {
  lados: { antes: LadoComprimido; despues: LadoComprimido }
  dentro: string[]
  peticionRef: MutableRefObject<number>
  /** Nivel al que corresponde la comparación en pantalla. */
  nivelMostradoRef: MutableRefObject<string | null>
  seleccionadaRef: MutableRefObject<string | null>
  setCargando: Dispatch<SetStateAction<boolean>>
  setComparacion: Dispatch<SetStateAction<CompararResult | null>>
  setSeleccionada: Dispatch<SetStateAction<string | null>>
}

/**
 * Lanza la comparación de un nivel. La primera de un nivel va ya y enseña «Comparando…»; las
 * del watcher se agrupan y no lo enseñan, para no parpadear el diff que se está leyendo.
 */
export function iniciarComparacion(e: EntradaComparar): () => void {
  const { lados, dentro, peticionRef, nivelMostradoRef, seleccionadaRef } = e
  let vivo = true
  let temporizador: ReturnType<typeof setTimeout> | null = null
  const mia = ++peticionRef.current
  const nivel = dentro.join('!/')
  const primeraVez = nivelMostradoRef.current !== nivel
  if (primeraVez) e.setCargando(true)

  const pedir = (): void => {
    temporizador = null
    void window.tessera.comprimidos
      .comparar({ antes: lados.antes, despues: lados.despues, dentro })
      .then((res) => {
        if (!vivo || mia !== peticionRef.current) return
        nivelMostradoRef.current = nivel
        e.setComparacion(res)
        e.setCargando(false)
        // La entrada elegida se conserva si sigue estando; la auto-elección es para ABRIR el
        // contenedor. Nunca se auto-elige un contenedor: entrar en un .jar anidado es decisión.
        const sigueAhi =
          seleccionadaRef.current !== null &&
          res.entradas.some((x) => x.nombre === seleccionadaRef.current)
        if (!sigueAhi) {
          const primera = res.entradas.find((x) => !x.contenedor)
          e.setSeleccionada(primera?.nombre ?? null)
        }
      })
      .catch((err: unknown) => {
        if (!vivo || mia !== peticionRef.current) return
        e.setComparacion({
          entradas: [],
          iguales: 0,
          truncado: false,
          avisos: [],
          error: err instanceof Error ? err.message : String(err)
        })
        e.setCargando(false)
      })
  }

  if (primeraVez) pedir()
  else temporizador = setTimeout(pedir, RECOMPARAR_MS)

  return () => {
    vivo = false
    if (temporizador !== null) clearTimeout(temporizador)
  }
}

interface EntradaContenido {
  lados: { antes: LadoComprimido; despues: LadoComprimido }
  dentro: string[]
  nombre: string
  paneKey: string
  temporizadorRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  tokenRef: MutableRefObject<number>
  setContenido: Dispatch<SetStateAction<EntradaResult | null>>
  setPidiendo: Dispatch<SetStateAction<boolean>>
  cancelar: () => void
}

/** Pide, con antirrebote, el contenido de la entrada elegida. Devuelve la cancelación. */
export function pedirContenidoEntrada(e: EntradaContenido): (() => void) | undefined {
  const { lados, dentro, nombre, paneKey, temporizadorRef, tokenRef } = e
  const como = comoPedir(nombre)
  if (como === null) {
    e.setContenido(null)
    return
  }
  e.setPidiendo(true)
  temporizadorRef.current = setTimeout(() => {
    temporizadorRef.current = null
    const token = ++tokenRef.current
    void window.tessera.comprimidos
      .entrada({ antes: lados.antes, despues: lados.despues, dentro, nombre, como, paneKey, token })
      .then((res) => {
        // El `token` descarta una entrada anterior de ESTE pane; `descartado` lo dice el main
        // cuando ni llegó a hacer el trabajo.
        if (res.token !== tokenRef.current || res.descartado) return
        e.setContenido(res)
        e.setPidiendo(false)
      })
      .catch(() => {
        if (tokenRef.current !== token) return
        e.setContenido(null)
        e.setPidiendo(false)
      })
  }, PEDIR_MS)
  return e.cancelar
}
