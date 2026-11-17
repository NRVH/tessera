// =============================================================================
// Acciones de git sobre archivos desde la ventana: descartar, preparar, quitar de
// preparados e ignorar, sueltas y en lote. Un éxito sube los ticks; descartar
// además cierra o recarga las pestañas afectadas. Un lote: un tick y un aviso.
// Cada juego de acciones es de UN proyecto (`raiz`): el main las corre en sus repos aunque el
// ancla ya esté en otro (`ServicioGit.paraRaiz`).
// =============================================================================
import { useCallback } from 'react'
import { notifyError } from '../../comun/notificaciones'
import { esDiffEditable } from './modelo/editabilidadDiff'
import { avanzarWorktree } from './store'
import { txGit } from './textos.ts'
import { subirTokens, useStoreEditor, type EditorApp } from '../editor'

/** Acciones de git de un proyecto que pasan a PanelGit y al explorador. */
export interface AccionesGit {
  descartarCambiosDeRuta: (ruta: string) => Promise<void>
  prepararRuta: (ruta: string) => Promise<void>
  quitarRutaDelIndice: (ruta: string) => Promise<void>
  prepararVariasRutas: (rutas: string[]) => Promise<void>
  quitarVariasRutasDelIndice: (rutas: string[]) => Promise<void>
  descartarVariasRutas: (rutas: string[]) => Promise<void>
  ignorarRutas: (rutas: string[], local: boolean) => Promise<void>
}

/** Las acciones de git del proyecto `raiz`; quien las use las memoriza por su raíz. */
export type AccionesGitDe = (raiz: string) => AccionesGit

type Editor = Pick<EditorApp, 'pestanasEditor' | 'claveEditorActivo' | 'clavePane' | 'cerrarPestana'>

/** Aviso ÚNICO para los fallos de un lote («No se pudieron preparar 2 de 10»). */
function avisarFallos(titulo: string, fallos: readonly { ruta: string; error?: string }[], total: number): void {
  if (fallos.length === 0) return
  const detalle = fallos
    .slice(0, 5)
    .map((f) => `${f.ruta}${f.error ? `: ${f.error}` : ''}`)
    .join('\n')
  const t = txGit()
  const resto = fallos.length > 5 ? `\n${t.masFallos(fallos.length - 5)}` : ''
  notifyError(t.fallosLote(titulo, fallos.length, total), `${detalle}${resto}`)
}

/** Recarga en UNA actualización las pestañas (archivo y diff editable) de las rutas dadas. */
function useRecargarPestanas(editor: Editor): (rutas: ReadonlySet<string>) => void {
  const { claveEditorActivo, clavePane } = editor
  const pestanas = editor.pestanasEditor.pestanas
  return useCallback(
    (rutas: ReadonlySet<string>): void => {
      if (rutas.size === 0 || claveEditorActivo === null) return
      useStoreEditor.setState((s) => {
        const abiertos = pestanas.filter(
          (t) =>
            (t.pane.tipo === 'file' && rutas.has(t.id)) ||
            (t.pane.tipo === 'diff' && esDiffEditable(t.pane.destino) && rutas.has(t.pane.destino.despues.ruta))
        )
        if (abiertos.length === 0) return {}
        return { tokensRecarga: subirTokens(s.tokensRecarga, abiertos.map((t) => clavePane(claveEditorActivo, t.id))) }
      })
    },
    [claveEditorActivo, pestanas, clavePane]
  )
}

/** Lo que necesitan las acciones de fuera: cerrar pestañas y recargar las afectadas. */
interface Efectos {
  cerrar: (id: string) => void
  recargar: (rutas: ReadonlySet<string>) => void
}

/** Descarta un archivo; la confirmación (revertir o borrar) la pide el main. */
async function descartar(raiz: string, ruta: string, ef: Efectos): Promise<void> {
  try {
    const resultado = await window.tessera.git.descartarCambios(raiz, ruta)
    if (!resultado.ok) {
      // Sin `error` es que el usuario canceló la confirmación: no hay nada que avisar.
      if (resultado.error) {
        console.error('[app] discard falló:', resultado.error)
        notifyError(txGit().noSePudieronDescartar, resultado.error)
      }
      return
    }
    avanzarWorktree()
    // Borrado del disco: fuera su pestaña y la de su diff del árbol de trabajo.
    if (resultado.estabaSinSeguimiento) {
      ef.cerrar(ruta)
      ef.cerrar(`diff:WORKTREE:${ruta}`)
      return
    }
    ef.recargar(new Set([ruta]))
  } catch (err) {
    console.error('[app] discard falló:', err)
    notifyError(txGit().noSePudieronDescartar, err)
  }
}

/** Prepara o quita de preparados un archivo. */
async function prepararUno(raiz: string, ruta: string, preparar: boolean): Promise<void> {
  const t = txGit()
  const titulo = preparar ? t.noSePudoPreparar : t.noSePudoQuitar
  try {
    const resultado = preparar ? await window.tessera.git.prepararArchivo(raiz, ruta) : await window.tessera.git.quitarArchivoDelIndice(raiz, ruta)
    if (!resultado.ok) {
      if (resultado.error) {
        console.error(preparar ? '[app] stage falló:' : '[app] unstage falló:', resultado.error)
        notifyError(titulo, resultado.error)
      }
      return
    }
    avanzarWorktree()
  } catch (err) {
    console.error(preparar ? '[app] stage falló:' : '[app] unstage falló:', err)
    notifyError(titulo, err)
  }
}

/** Preparar y quitar de preparados en lote. */
async function prepararLote(raiz: string, rutas: string[], preparar: boolean): Promise<void> {
  if (rutas.length === 0) return
  const t = txGit()
  try {
    const res = preparar ? await window.tessera.git.prepararArchivos(raiz, rutas) : await window.tessera.git.quitarArchivosDelIndice(raiz, rutas)
    avisarFallos(
      preparar ? t.algunosNoPreparados : t.algunosNoQuitados,
      res.filter((r) => !r.ok),
      rutas.length
    )
    avanzarWorktree()
  } catch (err) {
    console.error(preparar ? '[app] stage en lote falló:' : '[app] unstage en lote falló:', err)
    notifyError(preparar ? t.noSePudieronPreparar : t.noSePudieronQuitar, err)
  }
}

/** Descarta varios archivos con UNA confirmación. */
async function descartarLote(raiz: string, rutas: string[], ef: Efectos): Promise<void> {
  if (rutas.length === 0) return
  try {
    const res = await window.tessera.git.descartarCambiosVarios(raiz, rutas)
    // Cierres agrupados antes de tocar los tokens.
    for (const r of res) {
      if (r.estado !== 'borrado') continue
      ef.cerrar(r.ruta)
      ef.cerrar(`diff:WORKTREE:${r.ruta}`)
    }
    ef.recargar(new Set(res.filter((r) => r.estado === 'revertido').map((r) => r.ruta)))
    // 'cancelado' no es un error: el usuario dijo que no.
    avisarFallos(txGit().algunosNoDescartados, res.filter((r) => r.estado === 'error'), rutas.length)
    avanzarWorktree()
  } catch (err) {
    console.error('[app] descarte en lote falló:', err)
    notifyError(txGit().noSePudieronDescartar, err)
  }
}

/** Excluir de git: `.gitignore` (se commitea) o `.git/info/exclude` (local); la carpeta la decide el main. */
async function ignorar(raiz: string, rutas: string[], local: boolean): Promise<void> {
  if (rutas.length === 0) return
  const t = txGit()
  try {
    const res = local
      ? await window.tessera.git.ignorarEnExclusionLocal(raiz, rutas)
      : await window.tessera.git.ignorarEnGitignore(raiz, rutas)
    if (res.error) {
      notifyError(t.noSePudoEscribirExclusiones, res.error)
    } else if (res.omitidos.length > 0) {
      notifyError(t.algunosNoIgnorados, t.resumenIgnorados(res.ignorados.length, res.omitidos.length))
    }
    avanzarWorktree()
  } catch (err) {
    console.error('[app] ignorar falló:', err)
    notifyError(t.noSePudoEscribirExclusiones, err)
  }
}

/** Las acciones de git de la ventana, por proyecto. */
export function useAccionesGit(editor: Editor): AccionesGitDe {
  const recargar = useRecargarPestanas(editor)
  const { cerrarPestana: cerrar } = editor
  return useCallback(
    (raiz: string): AccionesGit => {
      const ef: Efectos = { cerrar, recargar }
      return {
        descartarCambiosDeRuta: (ruta) => descartar(raiz, ruta, ef),
        prepararRuta: (ruta) => prepararUno(raiz, ruta, true),
        quitarRutaDelIndice: (ruta) => prepararUno(raiz, ruta, false),
        prepararVariasRutas: (rutas) => prepararLote(raiz, rutas, true),
        quitarVariasRutasDelIndice: (rutas) => prepararLote(raiz, rutas, false),
        descartarVariasRutas: (rutas) => descartarLote(raiz, rutas, ef),
        ignorarRutas: (rutas, local) => ignorar(raiz, rutas, local)
      }
    },
    [cerrar, recargar]
  )
}
