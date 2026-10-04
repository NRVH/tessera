// =============================================================================
// Abrir diffs desde el panel de Log: apertura manual y con antirrebote, selección de
// commit y de archivo, atención a la petición automática y la copia del hash con su acuse.
// Los llama `useEstadoLog`; el estado de selección viene de `useSeleccionLog`.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTO_ABRIR_MS } from './constantesLog'
import { primeraFilaAbrible } from './modelo/autoAbrir'
import type { FilaArbol } from './modelo/arbolArchivos'
import { resolveDiffTarget } from './modelo/resolveDiffTarget'
import { notifyError } from '../../comun/notifications'
import { revelarIndice, type FilasElevadas, type OrigenApertura, type SeleccionLog } from './useSeleccionLog'
import type { DiffTarget } from '../editor'
import type { Commit, FileChange } from '../../../../shared/git-ipc'

export interface AperturaLog {
  /** El origen viaja hasta `onOpenDiff`: a pantalla completa solo abre lo `'manual'`. */
  abrirDiff: (commit: Commit, change: FileChange, origen: OrigenApertura) => void
  /** Doble clic o Enter: cancela la apertura pendiente y abre YA. */
  abrirDiffManual: (commit: Commit, change: FileChange) => void
  /** Programa la apertura de UN archivo con el antirrebote compartido. */
  programarApertura: (commit: Commit, change: FileChange, origen: OrigenApertura) => void
  /** Recibe las filas del árbol del commit; estable, va en las deps del efecto que las eleva. */
  recibirFilas: (
    hash: string,
    filas: readonly FilaArbol[],
    cambios: ReadonlyMap<string, FileChange>
  ) => void
  /** Selecciona un commit; `abrir` distingue el gesto de los cambios de selección sin gesto. */
  seleccionarCommit: (hash: string, abrir: boolean) => void
}

/**
 * Selecciona un commit; con `abrir` pide abrir su primer archivo tras el antirrebote. El
 * temporizador es UNO para las dos listas: una flecha en los archivos cancela la del commit.
 */
function useSeleccionarCommit(sel: SeleccionLog): AperturaLog['seleccionarCommit'] {
  const { cancelarAuto, autoTimerRef, contadorAutoRef } = sel
  const { setHashSeleccionado, setRutaSeleccionada, setPeticionAuto } = sel
  const pedirAutoApertura = useCallback(
    (hash: string): void => {
      cancelarAuto()
      autoTimerRef.current = setTimeout(() => {
        autoTimerRef.current = null
        setPeticionAuto({ hash, token: ++contadorAutoRef.current, origen: 'auto' })
      }, AUTO_ABRIR_MS)
    },
    [cancelarAuto, autoTimerRef, contadorAutoRef, setPeticionAuto]
  )
  return useCallback(
    (hash: string, abrir: boolean): void => {
      setHashSeleccionado(hash)
      setRutaSeleccionada(null)
      if (abrir) pedirAutoApertura(hash)
      else cancelarAuto()
    },
    [pedirAutoApertura, cancelarAuto, setHashSeleccionado, setRutaSeleccionada]
  )
}

/** Aperturas de diff y selección de commit. */
export function useAperturaLog(
  onOpenDiff: (target: DiffTarget, origen: OrigenApertura) => void,
  sel: SeleccionLog,
  revelarRutaPendienteRef: { current: string | null }
): AperturaLog {
  const { cancelarAuto, autoTimerRef } = sel
  const { setRutaSeleccionada, setFilasArchivos, setRevelarArchivo } = sel
  const abrirDiff = useCallback(
    (commit: Commit, change: FileChange, origen: OrigenApertura): void => {
      setRutaSeleccionada(change.path)
      onOpenDiff(resolveDiffTarget(commit.hash, commit.parents[0] ?? null, change), origen)
    },
    [onOpenDiff, setRutaSeleccionada]
  )
  const abrirDiffManual = useCallback(
    (commit: Commit, change: FileChange): void => {
      cancelarAuto()
      abrirDiff(commit, change, 'manual')
    },
    [abrirDiff, cancelarAuto]
  )
  const programarApertura = useCallback(
    (commit: Commit, change: FileChange, origen: OrigenApertura): void => {
      cancelarAuto()
      autoTimerRef.current = setTimeout(() => {
        autoTimerRef.current = null
        abrirDiff(commit, change, origen)
      }, AUTO_ABRIR_MS)
    },
    [abrirDiff, cancelarAuto, autoTimerRef]
  )
  const recibirFilas = useCallback(
    (hash: string, filas: readonly FilaArbol[], cambios: ReadonlyMap<string, FileChange>): void => {
      setFilasArchivos({ hash, filas, cambios })
      // Segunda mitad de la restauración: el archivo que estabas mirando, de un solo uso
      // (plegar una carpeta vuelve a notificar y entonces esto es inerte).
      const ruta = revelarRutaPendienteRef.current
      if (ruta === null) return
      revelarRutaPendienteRef.current = null
      const indice = filas.findIndex((f) => f.nodo.ruta === ruta)
      if (indice >= 0) setRevelarArchivo(revelarIndice(indice))
    },
    [setFilasArchivos, setRevelarArchivo, revelarRutaPendienteRef]
  )
  const seleccionarCommit = useSeleccionarCommit(sel)
  return { abrirDiff, abrirDiffManual, programarApertura, recibirFilas, seleccionarCommit }
}

/** Commit seleccionado entre los visibles, filas vigentes de su árbol e índice del cursor. */
export function useDerivadosSeleccion(
  visibles: readonly Commit[] | null,
  sel: SeleccionLog
): {
  commitSeleccionado: Commit | null
  filasVigentes: FilasElevadas | null
  indiceSeleccionado: number
} {
  const { hashSeleccionado, filasArchivos } = sel
  const commitSeleccionado = useMemo(
    () => visibles?.find((c) => c.hash === hashSeleccionado) ?? null,
    [visibles, hashSeleccionado]
  )
  // Solo valen las filas elevadas del commit que sigue seleccionado.
  const filasVigentes = useMemo(
    () => (filasArchivos && filasArchivos.hash === hashSeleccionado ? filasArchivos : null),
    [filasArchivos, hashSeleccionado]
  )
  // Derivado: un índice guardado se desalinearía al filtrar `visibles` bajo él.
  const indiceSeleccionado = useMemo(
    () =>
      hashSeleccionado === null ? -1 : (visibles?.findIndex((c) => c.hash === hashSeleccionado) ?? -1),
    [visibles, hashSeleccionado]
  )
  return { commitSeleccionado, filasVigentes, indiceSeleccionado }
}

/** Clic simple sobre un archivo del commit: mueve el cursor Y programa su diff. */
export function useSeleccionarArchivo(p: {
  sel: SeleccionLog
  filasVigentes: FilasElevadas | null
  commitSeleccionado: Commit | null
  programarApertura: AperturaLog['programarApertura']
}): (ruta: string) => void {
  const { sel, filasVigentes, commitSeleccionado, programarApertura } = p
  const { setRutaSeleccionada, cancelarAuto } = sel
  return useCallback(
    (ruta: string): void => {
      setRutaSeleccionada(ruta)
      const change = filasVigentes?.cambios.get(ruta)
      if (!commitSeleccionado || !change) {
        cancelarAuto()
        return
      }
      // El clic en un archivo es un gesto explícito, aunque espere el antirrebote.
      programarApertura(commitSeleccionado, change, 'manual')
    },
    [filasVigentes, commitSeleccionado, programarApertura, cancelarAuto, setRutaSeleccionada]
  )
}

/**
 * Atiende la petición de apertura automática en cuanto hay filas del commit pedido. El
 * token se CONSUME, pero solo tras comprobar que el commit está en `visibles`.
 */
export function useAutoApertura(p: {
  sel: SeleccionLog
  filasVigentes: FilasElevadas | null
  visibles: readonly Commit[] | null
  abrirDiff: AperturaLog['abrirDiff']
}): void {
  const { sel, filasVigentes, visibles, abrirDiff } = p
  const { peticionAuto, tokenAtendidoRef } = sel
  useEffect(() => {
    if (!peticionAuto || !filasVigentes || filasVigentes.hash !== peticionAuto.hash) return
    if (peticionAuto.token === tokenAtendidoRef.current) return
    const commit = visibles?.find((c) => c.hash === peticionAuto.hash)
    // Sin el commit todavía (refetch o filtro en vuelo) no se consume: se reintenta.
    if (!commit) return
    tokenAtendidoRef.current = peticionAuto.token
    const fila = primeraFilaAbrible(filasVigentes.filas)
    // Un commit con solo carpetas y empaquetados no abre nada.
    if (!fila || fila.nodo.tipo !== 'archivo') return
    const change = filasVigentes.cambios.get(fila.nodo.ruta)
    if (change) abrirDiff(commit, change, peticionAuto.origen)
  }, [peticionAuto, filasVigentes, visibles, abrirDiff, tokenAtendidoRef])
}

/**
 * Hash cuya copia se está confirmando (icono en verde): UNO para toda la vista, aquí y no
 * en cada fila, porque las filas se desmontan al salir de la ventana virtual. Copia el
 * hash COMPLETO por el portapapeles del main y mueve el cursor sin abrir nada.
 */
export function useCopiaHash(
  hashSeleccionado: string | null,
  seleccionarCommit: AperturaLog['seleccionarCommit']
): { hashCopiado: string | null; copiarHashDeCommit: (hash: string) => void } {
  const [hashCopiado, setHashCopiado] = useState<string | null>(null)
  const copiaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ¿Sigue montado? Sin esto, una copia que resuelve tras desmontar armaría un
  // temporizador que nadie cancela.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      if (copiaTimerRef.current) clearTimeout(copiaTimerRef.current)
    }
  }, [])
  const copiarHashDeCommit = useCallback(
    (hash: string): void => {
      // Si ya está seleccionado no se toca: reseleccionar borraría el cursor del árbol.
      if (hash !== hashSeleccionado) seleccionarCommit(hash, false)
      window.tessera.clipboard
        .write(hash)
        .then(() => {
          if (!montadoRef.current) return
          setHashCopiado(hash)
          if (copiaTimerRef.current) clearTimeout(copiaTimerRef.current)
          copiaTimerRef.current = setTimeout(() => setHashCopiado(null), 1400)
        })
        .catch((err) => {
          notifyError('No se pudo copiar el hash', err)
          if (!montadoRef.current) return
          // Apaga también el acuse anterior: no pueden verse a la vez el check y el aviso.
          if (copiaTimerRef.current) clearTimeout(copiaTimerRef.current)
          copiaTimerRef.current = null
          setHashCopiado(null)
        })
    },
    [hashSeleccionado, seleccionarCommit]
  )
  return { hashCopiado, copiarHashDeCommit }
}
