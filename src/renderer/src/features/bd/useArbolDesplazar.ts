// =============================================================================
// Llevar la lista del lateral de BD hasta una fila (teclado, «Mostrar en el árbol», alta
// nueva) y saltar a la primera coincidencia al buscar. Hooks que llama `DbArbol` en su
// orden: el desplazamiento y el revelado antes que las peticiones, la búsqueda después.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { primeraCoincidencia, type FilaArbol } from './filasArbolBd'
import type { DbArbolProps } from './propsBd'
import type { DesplazarArbol } from './DbArbolTipos'

/** El desplazamiento pendiente de la lista, y cómo pedirlo. */
export function useArbolDesplazar(
  filas: readonly FilaArbol[],
  onSeleccion: DbArbolProps['onSeleccion'],
  revelar: DbArbolProps['revelar']
): DesplazarArbol {
  const [desplazar, setDesplazar] = useState<DesplazarArbol['desplazar']>(null)
  const tokenDesplazar = useRef(0)

  const idxDesplazar = desplazar ? filas.findIndex((f) => f.key === desplazar.clave) : -1
  // En cuanto la fila existe y la lista ya se movió (su efecto corre antes que este),
  // se olvida: si no, cada recarga que la cambiara de índice volvería a mover el
  // scroll por debajo del usuario.
  useEffect(() => {
    if (desplazar && idxDesplazar >= 0) setDesplazar(null)
  }, [desplazar, idxDesplazar])

  function llevarA(clave: string): void {
    setDesplazar({ clave, token: ++tokenDesplazar.current })
  }

  function moverA(i: number): void {
    if (i < 0 || i >= filas.length) return
    onSeleccion(filas[i].key)
    llevarA(filas[i].key)
  }

  // «Mostrar en el árbol»: `useDbVista` ya desplegó los antepasados; aquí se espera a que la
  // fila exista (puede estar cargando) y se lleva la lista hasta ella.
  const tokenRevelar = revelar?.token
  useEffect(() => {
    if (revelar) llevarA(revelar.clave)
    // Solo cuando llega una petición NUEVA (el token), no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenRevelar])

  return { desplazar, idxDesplazar, llevarA, moverA }
}

/** Al teclear, el cursor salta a la primera coincidencia si no estaba ya en una. */
export function useArbolBusqueda(
  busqueda: string | null,
  filaSel: FilaArbol | null,
  filas: readonly FilaArbol[],
  moverA: (i: number) => void
): void {
  useEffect(() => {
    if (!busqueda) return
    if (filaSel && filaSel.coincidencia !== undefined) return
    const i = primeraCoincidencia(filas)
    if (i >= 0) moverA(i)
    // `moverA` cambia en cada render; lo que importa es el texto y las filas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, filas])
}
