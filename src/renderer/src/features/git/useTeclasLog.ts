// =============================================================================
// Teclado del panel de Log: la lista de commits y el árbol de archivos del commit, con
// el Ctrl+C de copiar el hash compartido por las dos. Sin wrap en los extremos.
// Lo llama `useEstadoLog`; el estado sale de `useSeleccionLog` y `useAperturaLog`.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import { useCallback } from 'react'
import { esAtajoCopiarHash } from './modelo/atajoCopiarHash'
import { siguienteFilaAbrible } from './modelo/autoAbrir'
import type { FilaArbol } from './modelo/arbolArchivos'
import { revelarIndice, type FilasElevadas, type SeleccionLog } from './useSeleccionLog'
import type { AperturaLog } from './useAperturaLog'
import type { Commit, FileChange } from '../../../../shared/git-ipc'

type Tecla = React.KeyboardEvent<HTMLDivElement>

/** Carpeta contenedora de una ruta POSIX, o null si está en la raíz. */
function rutaPadre(ruta: string): string | null {
  const i = ruta.lastIndexOf('/')
  return i <= 0 ? null : ruta.slice(0, i)
}

/**
 * ¿Hay una selección de texto viva que TOQUE a este contenedor? Se mide por intersección
 * de rangos y no por el ancla: con Ctrl+A el ancla cae en `<body>`, fuera de la raíz, y
 * el atajo machacaría la selección del usuario.
 */
function haySeleccionEn(raiz: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim() === '') return false
  for (let i = 0; i < sel.rangeCount; i++) {
    if (sel.getRangeAt(i).intersectsNode(raiz)) return true
  }
  return false
}

interface ContextoCommits {
  n: number
  indiceSeleccionado: number
  hashSeleccionado: string | null
  irAlCommit: (indice: number) => void
  cancelarAuto: () => void
  setPeticionAuto: SeleccionLog['setPeticionAuto']
}

function teclaFlechaCommits(e: Tecla, c: ContextoCommits): void {
  e.preventDefault()
  const delta = e.key === 'ArrowDown' ? 1 : -1
  // Sin selección, la primera flecha entra por el extremo que corresponde.
  const destino = c.indiceSeleccionado < 0 ? (delta === 1 ? 0 : c.n - 1) : c.indiceSeleccionado + delta
  if (destino < 0 || destino >= c.n) return
  c.irAlCommit(destino)
}

function manejarTeclaCommits(e: Tecla, c: ContextoCommits): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    teclaFlechaCommits(e, c)
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    c.irAlCommit(e.key === 'Home' ? 0 : c.n - 1)
  } else if (e.key === 'Enter' && c.hashSeleccionado !== null) {
    // «Sé lo que quiero»: cancela la espera y abre ya.
    const hash = c.hashSeleccionado
    e.preventDefault()
    c.cancelarAuto()
    c.setPeticionAuto((p) => ({ hash, token: (p?.token ?? 0) + 1, origen: 'manual' }))
  }
}

interface ContextoArchivos {
  filas: readonly FilaArbol[]
  cambios: ReadonlyMap<string, FileChange>
  commit: Commit
  /** Índice de la fila con el cursor, o -1. */
  actual: number
  setRevelarArchivo: SeleccionLog['setRevelarArchivo']
  setRutaSeleccionada: SeleccionLog['setRutaSeleccionada']
  cancelarAuto: () => void
  programarApertura: AperturaLog['programarApertura']
  abrirDiff: AperturaLog['abrirDiff']
  alternarCarpetaRef: SeleccionLog['alternarCarpetaRef']
}

/** Mueve el cursor a `destino`; si es un archivo, programa su apertura. */
function irA(destino: number, c: ContextoArchivos): void {
  const nodo = c.filas[destino].nodo
  c.setRevelarArchivo(revelarIndice(destino))
  c.setRutaSeleccionada(nodo.ruta)
  c.cancelarAuto()
  if (nodo.tipo !== 'archivo') return
  const change = c.cambios.get(nodo.ruta)
  // El mismo temporizador que la lista de commits: una flecha aquí cancela su apertura.
  // Moverse es vista previa, como en los commits: a pantalla completa no abre nada.
  if (change) c.programarApertura(c.commit, change, 'auto')
}

/** Lleva el cursor a la carpeta que contiene a `ruta`, cancelando la apertura pendiente. */
function irAlPadre(ruta: string, c: ContextoArchivos): void {
  const padre = rutaPadre(ruta)
  if (padre === null) return
  const idx = c.filas.findIndex((f) => f.nodo.ruta === padre)
  if (idx < 0) return
  c.cancelarAuto()
  c.setRevelarArchivo(revelarIndice(idx))
  c.setRutaSeleccionada(padre)
}

function teclaFlechaArchivos(e: Tecla, c: ContextoArchivos): void {
  e.preventDefault()
  const dir = e.key === 'ArrowDown' ? 1 : -1
  // Sin cursor se entra por el extremo que corresponda, con la MISMA función.
  const desde = c.actual < 0 ? (dir === 1 ? -1 : c.filas.length) : c.actual
  const destino = siguienteFilaAbrible(c.filas, desde, dir)
  if (destino !== null) irA(destino, c)
}

function teclaExtremoArchivos(e: Tecla, c: ContextoArchivos): void {
  e.preventDefault()
  const destino =
    e.key === 'Home'
      ? siguienteFilaAbrible(c.filas, -1, 1)
      : siguienteFilaAbrible(c.filas, c.filas.length, -1)
  if (destino !== null) irA(destino, c)
}

function teclaEnterArchivos(e: Tecla, c: ContextoArchivos): void {
  e.preventDefault()
  if (c.actual < 0) return
  const nodo = c.filas[c.actual].nodo
  if (nodo.tipo === 'carpeta') {
    c.alternarCarpetaRef.current?.(nodo.ruta)
    return
  }
  const change = c.cambios.get(nodo.ruta)
  if (change) {
    c.cancelarAuto()
    c.abrirDiff(c.commit, change, 'manual')
  }
}

/** `→` despliega, `←` pliega; sobre algo ya plegado (o un archivo) `←` sube al padre. */
function teclaHorizontalArchivos(e: Tecla, c: ContextoArchivos): void {
  if (c.actual < 0) return
  const fila = c.filas[c.actual]
  e.preventDefault()
  if (fila.nodo.tipo !== 'carpeta') {
    if (e.key === 'ArrowLeft') irAlPadre(fila.nodo.ruta, c)
    return
  }
  const desplegar = e.key === 'ArrowRight'
  if (desplegar !== fila.expandida) {
    c.alternarCarpetaRef.current?.(fila.nodo.ruta)
    return
  }
  if (!desplegar) irAlPadre(fila.nodo.ruta, c)
}

function manejarTeclaArchivos(e: Tecla, c: ContextoArchivos): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') teclaFlechaArchivos(e, c)
  else if (e.key === 'Home' || e.key === 'End') teclaExtremoArchivos(e, c)
  else if (e.key === 'Enter') teclaEnterArchivos(e, c)
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') teclaHorizontalArchivos(e, c)
}

/**
 * El Ctrl+C de copiar el hash, entero y en un solo sitio: lo comparten los dos teclados.
 * Devuelve `true` si se hizo cargo de la tecla. `revelar` solo desde la lista de commits.
 */
function useAtajoCopiarHash(p: {
  commitSeleccionado: Commit | null
  indiceSeleccionado: number
  copiarHashDeCommit: (hash: string) => void
  setRevelar: SeleccionLog['setRevelar']
}): (e: Tecla, revelar: boolean) => boolean {
  const { commitSeleccionado, indiceSeleccionado, copiarHashDeCommit, setRevelar } = p
  return useCallback(
    (e: Tecla, revelar: boolean): boolean => {
      if (!esAtajoCopiarHash(e)) return false
      // `commitSeleccionado` y no el hash: un filtro no limpia la selección. Sin commit a
      // la vista, o con texto seleccionado, el Ctrl+C es del navegador.
      if (commitSeleccionado === null || haySeleccionEn(e.currentTarget)) return false
      e.preventDefault()
      if (revelar && indiceSeleccionado >= 0) setRevelar(revelarIndice(indiceSeleccionado))
      copiarHashDeCommit(commitSeleccionado.hash)
      return true
    },
    [commitSeleccionado, indiceSeleccionado, copiarHashDeCommit, setRevelar]
  )
}

/** Teclado del árbol de archivos del commit vigente. */
function useTeclasArchivos(p: {
  sel: SeleccionLog
  commitSeleccionado: Commit | null
  filasVigentes: FilasElevadas | null
  apertura: AperturaLog
  intentarCopiarHash: (e: Tecla, revelar: boolean) => boolean
}): (e: Tecla) => void {
  const { sel, commitSeleccionado, filasVigentes, apertura, intentarCopiarHash } = p
  const { rutaSeleccionada, cancelarAuto, setRevelarArchivo, setRutaSeleccionada, alternarCarpetaRef } = sel
  const { abrirDiff, programarApertura } = apertura
  return useCallback(
    (e: Tecla): void => {
      // Va ANTES de las guardas: el flujo normal trae el foco aquí y el atajo no puede
      // apagarse mientras el árbol carga.
      if (intentarCopiarHash(e, false)) return
      const commit = commitSeleccionado
      if (!filasVigentes || !commit || filasVigentes.filas.length === 0) return
      const { filas, cambios } = filasVigentes
      const actual = filas.findIndex((f) => f.nodo.ruta === rutaSeleccionada)
      manejarTeclaArchivos(e, {
        filas,
        cambios,
        commit,
        actual,
        setRevelarArchivo,
        setRutaSeleccionada,
        cancelarAuto,
        programarApertura,
        abrirDiff,
        alternarCarpetaRef
      })
    },
    [
      filasVigentes,
      commitSeleccionado,
      rutaSeleccionada,
      abrirDiff,
      programarApertura,
      cancelarAuto,
      intentarCopiarHash,
      setRevelarArchivo,
      setRutaSeleccionada,
      alternarCarpetaRef
    ]
  )
}

/** Teclado de la lista de commits y del árbol de archivos. */
export function useTeclasLog(p: {
  sel: SeleccionLog
  visibles: readonly Commit[] | null
  commitSeleccionado: Commit | null
  filasVigentes: FilasElevadas | null
  indiceSeleccionado: number
  apertura: AperturaLog
  copiarHashDeCommit: (hash: string) => void
}): { teclasCommits: (e: Tecla) => void; teclasArchivos: (e: Tecla) => void } {
  const { sel, visibles, commitSeleccionado, filasVigentes, indiceSeleccionado, apertura } = p
  const { hashSeleccionado, setRevelar, cancelarAuto, setPeticionAuto } = sel
  const { seleccionarCommit } = apertura

  const irAlCommit = useCallback(
    (indice: number): void => {
      if (!visibles || indice < 0 || indice >= visibles.length) return
      setRevelar(revelarIndice(indice))
      seleccionarCommit(visibles[indice].hash, true)
    },
    [visibles, seleccionarCommit, setRevelar]
  )
  const intentarCopiarHash = useAtajoCopiarHash({
    commitSeleccionado,
    indiceSeleccionado,
    copiarHashDeCommit: p.copiarHashDeCommit,
    setRevelar
  })

  const teclasCommits = useCallback(
    (e: Tecla): void => {
      const n = visibles?.length ?? 0
      if (n === 0) return
      if (intentarCopiarHash(e, true)) return
      manejarTeclaCommits(e, { n, indiceSeleccionado, hashSeleccionado, irAlCommit, cancelarAuto, setPeticionAuto })
    },
    [visibles, indiceSeleccionado, irAlCommit, hashSeleccionado, cancelarAuto, intentarCopiarHash, setPeticionAuto]
  )

  const teclasArchivos = useTeclasArchivos({
    sel,
    commitSeleccionado,
    filasVigentes,
    apertura,
    intentarCopiarHash
  })
  return { teclasCommits, teclasArchivos }
}
