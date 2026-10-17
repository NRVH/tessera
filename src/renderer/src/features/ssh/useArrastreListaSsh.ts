// =============================================================================
// El arrastre de conexiones en el riel SSH: se arrastra la selección (o solo la fila, si no estaba marcada), una
// cabecera o una conexión de un grupo son destino de ese grupo, y la zona «Nuevo grupo…» lo crea con ellas
// dentro. Solo vale el arrastre propio (no archivos). Lo puro (qué se lleva, adónde va, qué cambia) vive en
// `seleccionListaSsh.ts`. El fin del arrastre se escucha también en la ventana: la fila de origen puede salir de
// la lista virtual a mitad del gesto, y entonces su `dragend` no llega.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { notify } from '../../comun/notifications'
import { mensajeDeErrorSsh } from './erroresSsh'
import { txSsh } from './textos.ts'
import type { FilaLista } from './listaSsh'
import { cuantasConexiones, destinoDeFila, grupoIdDeDestino, idsDelArrastre, idsQueCambian, type SeleccionSsh } from './seleccionListaSsh'
import { accionesSsh, type DatosPerfilSsh } from './store'

/** El tipo del arrastre propio: un arrastre sin él (archivos, texto) no es de la lista. */
const TIPO_ARRASTRE = 'application/x-tessera-ssh'

/** El destino «Nuevo grupo…»: no es un grupo. */
export const DESTINO_NUEVO = '__nuevo__'

/** Lo que el arrastre necesita de la lista. */
export interface EntradaArrastreSsh {
  perfilId: string
  datos: DatosPerfilSsh
  filas: readonly FilaLista[]
  seleccion: SeleccionSsh
  visibles: readonly string[]
  fijarSeleccion: (s: SeleccionSsh) => void
  /** Las conexiones que se arrastran, o `null` si no hay arrastre: con él, la lista enseña «Sin grupo» aunque esté vacío. */
  arrastre: string[] | null
  fijarArrastre: (ids: string[] | null) => void
}

/** La imagen del arrastre de varias: «3 conexiones» en una pastilla, en vez de la fila de una sola. */
function imagenDeVarias(ev: DragEvent, n: number): void {
  const el = document.createElement('div')
  el.className = 'ssh-arrastre-fantasma'
  el.textContent = cuantasConexiones(n)
  document.body.appendChild(el)
  ev.dataTransfer.setDragImage(el, 12, 12)
  // La imagen se toma al empezar: el nodo ya no hace falta en el siguiente fotograma.
  setTimeout(() => el.remove(), 0)
}

/** Pasa las conexiones al grupo `destino` y, si el main no puede, lo dice. */
async function mover(perfilId: string, ids: string[], destino: string): Promise<void> {
  try {
    await window.tessera.ssh.mover({ ids, profileId: perfilId, grupoId: grupoIdDeDestino(destino) })
  } catch (err) {
    notify('error', txSsh().noSePudieronMover, mensajeDeErrorSsh(err))
  }
}

/**
 * Llama a `fin` cuando el arrastre acaba aunque el `dragend` de la fila de origen se perdiera con ella: durante un
 * arrastre la ventana no recibe `mousemove`, así que el primero que llega con el botón soltado es que el gesto acabó.
 */
function useFinDelArrastre(arrastrando: boolean, fin: () => void): void {
  useEffect(() => {
    if (!arrastrando) return
    const alMover = (ev: MouseEvent): void => {
      if (ev.buttons === 0) fin()
    }
    window.addEventListener('mousemove', alMover)
    window.addEventListener('dragend', fin, true)
    return () => {
      window.removeEventListener('mousemove', alMover)
      window.removeEventListener('dragend', fin, true)
    }
  }, [arrastrando, fin])
}

/** El arrastre del riel: sus manejadores y el destino sobre el que se está (para marcarlo). */
export function useArrastreListaSsh(e: EntradaArrastreSsh) {
  const [destino, setDestino] = useState<string | null>(null)
  const { arrastre, fijarArrastre } = e
  const terminar = useCallback((): void => {
    fijarArrastre(null)
    setDestino(null)
  }, [fijarArrastre])
  useFinDelArrastre(arrastre !== null, terminar)

  const grupos = new Set(e.datos.grupos.map((g) => g.id))
  /** Lo que cambiaría soltando en `d`: nada si no hay arrastre propio o todas están ya ahí. */
  const cambian = (d: string | null): string[] => (arrastre === null || d === null ? [] : d === DESTINO_NUEVO ? arrastre : idsQueCambian(arrastre, d, e.datos.conexiones, grupos))

  const alEmpezar = (id: string, ev: DragEvent): void => {
    const ids = idsDelArrastre(e.seleccion, e.visibles, id)
    ev.dataTransfer.setData(TIPO_ARRASTRE, ids.join('\n'))
    ev.dataTransfer.effectAllowed = 'move'
    if (ids.length > 1) imagenDeVarias(ev, ids.length)
    // Lo que cambia la lista (marcar, «Sin grupo», la zona de «Nuevo grupo…») va FUERA del `dragstart`: tocar el
    // DOM dentro de él hace que el motor aborte el arrastre recién empezado.
    setTimeout(() => {
      if (!e.seleccion.ids.has(id)) e.fijarSeleccion({ ids: new Set([id]), ancla: id })
      fijarArrastre(ids)
    }, 0)
  }
  /** Sobre la fila `indice` (o sobre «Nuevo grupo…» con `DESTINO_NUEVO`): se acepta si algo cambiaría. */
  const alSobrevolar = (d: string | null, ev: DragEvent): void => {
    if (arrastre === null || !ev.dataTransfer.types.includes(TIPO_ARRASTRE)) return
    if (cambian(d).length === 0) {
      ev.dataTransfer.dropEffect = 'none'
      setDestino(null)
      return
    }
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
    setDestino(d)
  }
  const alSoltar = (d: string | null, ev: DragEvent): void => {
    const ids = cambian(d)
    terminar()
    if (ids.length === 0 || d === null) return
    ev.preventDefault()
    if (d === DESTINO_NUEVO) accionesSsh.nuevoGrupoCon(e.perfilId, ids)
    else void mover(e.perfilId, ids, d)
  }
  return {
    arrastrando: arrastre !== null,
    destino,
    alEmpezar,
    alTerminar: terminar,
    /** Los manejadores de soltar de la fila `indice`. */
    soltarEnFila: (indice: number) => {
      const d = destinoDeFila(e.filas, indice)
      return { onDragOver: (ev: DragEvent) => alSobrevolar(d, ev), onDrop: (ev: DragEvent) => alSoltar(d, ev) }
    },
    soltarEnNuevo: { onDragOver: (ev: DragEvent) => alSobrevolar(DESTINO_NUEVO, ev), onDrop: (ev: DragEvent) => alSoltar(DESTINO_NUEVO, ev) },
    /** Fuera de la lista ya no hay destino. */
    alSalir: () => setDestino(null)
  }
}

export type ArrastreListaSsh = ReturnType<typeof useArrastreListaSsh>
