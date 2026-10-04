// =============================================================================
// useArrastreProyectos: reordenar las pestañas de proyecto de un perfil arrastrándolas.
// Soltar una encima de otra la deja en su sitio (la misma regla que los perfiles), con
// una raya del lado donde caerá. Solo acepta un arrastre propio y del perfil en el que
// empezó, y arrastrar no activa el proyecto. Lo llama `ProjectTabs`.
// Depende de util/reorderByDrag.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from 'react'
import { ladoDeSoltar, reorderByDrag, type LadoSoltar } from '../../util/reorderByDrag'
import type { OpenProject } from './tabsModel'

/**
 * Tipo propio del arrastre, en minúsculas (así lo devuelve el navegador en `types`). Nunca
 * `text/plain`: el editor o una terminal lo aceptarían y pegarían lo que llevara.
 */
const TIPO_ARRASTRE = 'application/x-tessera-proyecto'

/** El gesto en curso: qué pestaña viaja y en qué perfil empezó. */
interface Gesto {
  ruta: string
  perfil: string
}

/** Dónde caería lo arrastrado: sobre qué pestaña y de qué lado. */
export interface DestinoArrastre {
  ruta: string
  lado: LadoSoltar
}

/** Estado del arrastre de proyectos y un manejador por evento, para cada pestaña. */
export interface ArrastreProyectos {
  /** La pestaña que viaja (se atenúa), o null. */
  arrastrada: string | null
  destino: DestinoArrastre | null
  alEmpezar: (ruta: string, e: DragEvent) => void
  alPasarSobre: (ruta: string, e: DragEvent) => void
  alSalir: (ruta: string, e: DragEvent) => void
  alSoltar: (ruta: string, e: DragEvent) => void
  alTerminar: () => void
}

/** Lo que leen los manejadores en el render en curso. */
interface Contexto {
  gestoRef: MutableRefObject<Gesto | null>
  rutas: string[]
  perfil: string | null
  destino: DestinoArrastre | null
  setDestino: Dispatch<SetStateAction<DestinoArrastre | null>>
}

/**
 * El gesto, si es un arrastre de una pestaña de ESTA banda (un archivo arrastrado no lo
 * es) y el perfil sigue siendo el del momento en que empezó; si no, null.
 */
function gestoVigente(c: Contexto, e: DragEvent): Gesto | null {
  const gesto = c.gestoRef.current
  if (gesto === null || gesto.perfil !== c.perfil) return null
  return Array.from(e.dataTransfer.types).includes(TIPO_ARRASTRE) ? gesto : null
}

function pasarSobre(c: Contexto, ruta: string, e: DragEvent): void {
  const gesto = gestoVigente(c, e)
  if (gesto === null) return
  // Es nuestro: que no lo atienda también lo que haya debajo de la banda.
  e.stopPropagation()
  const lado = ladoDeSoltar(c.rutas, gesto.ruta, ruta)
  // Donde soltar no mueve nada, ni raya ni permiso de soltar (el cursor lo dice).
  if (lado === null) {
    if (c.destino !== null) c.setDestino(null)
    return
  }
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  if (c.destino?.ruta !== ruta || c.destino.lado !== lado) c.setDestino({ ruta, lado })
}

/**
 * `dragleave` también salta al pasar a un hijo de la pestaña: sin la guarda, la raya parpadea.
 * Se decide con el destino VIGENTE y no con el de este render: al cruzar de una pestaña a
 * otra, el `dragover` de la nueva puede haber llegado antes, y se borraría su raya.
 */
function salir(c: Contexto, ruta: string, e: DragEvent): void {
  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
  c.setDestino((previo) => (previo?.ruta === ruta ? null : previo))
}

/** Escucha el fin del arrastre en la ventana; devuelve la baja. */
function finEnVentana(fin: () => void): () => void {
  window.addEventListener('dragend', fin)
  window.addEventListener('drop', fin)
  return () => {
    window.removeEventListener('dragend', fin)
    window.removeEventListener('drop', fin)
  }
}

/** Arrastre para reordenar las pestañas de proyecto de `perfil` (ver la cabecera). */
export function useArrastreProyectos(
  projects: readonly OpenProject[],
  perfil: string | null,
  onReorder: (perfil: string, rutas: string[]) => void
): ArrastreProyectos {
  // El gesto vive en un ref (se lee en cada `dragover`, decenas por segundo) y en estado
  // solo para atenuar la pestaña; el destino es estado porque se pinta.
  const gestoRef = useRef<Gesto | null>(null)
  const [gesto, setGesto] = useState<Gesto | null>(null)
  const [destino, setDestino] = useState<DestinoArrastre | null>(null)

  const alTerminar = useCallback((): void => {
    gestoRef.current = null
    setGesto(null)
    setDestino(null)
  }, [])

  // El `dragend` de una pestaña que sigue montada burbujea hasta la ventana, y un `drop`
  // en cualquier sitio también: se limpia desde ahí por si el soltar cae fuera de la banda.
  useEffect(() => {
    if (gesto === null) return
    return finEnVentana(alTerminar)
  }, [gesto, alTerminar])

  // Si el perfil cambia a mitad del gesto, la pestaña arrastrada se desmonta y su `dragend`
  // ya no llega a nadie: el gesto se da por terminado aquí, o reaparecería atenuada al volver.
  const vigente = gesto !== null && gesto.perfil === perfil
  useEffect(() => {
    if (gesto !== null && !vigente) alTerminar()
  }, [gesto, vigente, alTerminar])
  const c: Contexto = {
    gestoRef,
    rutas: projects.map((p) => p.projectHostPath),
    perfil,
    destino,
    setDestino
  }

  return {
    arrastrada: vigente ? gesto.ruta : null,
    destino: vigente ? destino : null,
    alEmpezar: (ruta, e) => {
      if (perfil === null) {
        e.preventDefault()
        return
      }
      gestoRef.current = { ruta, perfil }
      setGesto(gestoRef.current)
      e.dataTransfer.effectAllowed = 'move'
      // Una marca, no la ruta: la ruta vive en el ref y así no sale de la ventana si el
      // gesto acaba en otra aplicación.
      e.dataTransfer.setData(TIPO_ARRASTRE, '1')
    },
    alPasarSobre: (ruta, e) => pasarSobre(c, ruta, e),
    alSalir: (ruta, e) => salir(c, ruta, e),
    alSoltar: (ruta, e) => {
      const vivo = gestoVigente(c, e)
      if (gestoRef.current === null) return
      e.preventDefault()
      e.stopPropagation()
      alTerminar()
      if (vivo === null) return
      const orden = reorderByDrag(c.rutas, vivo.ruta, ruta)
      if (orden !== null) onReorder(vivo.perfil, orden)
    },
    alTerminar
  }
}
