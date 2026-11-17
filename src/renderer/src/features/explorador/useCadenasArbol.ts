// =============================================================================
// Cadenas de carpetas del árbol: el estado que las guarda y los dos efectos que las
// cargan (por carpeta visible y al refrescar). Hooks de `ArbolArchivos`, llamados desde
// `useArbol` en este orden: el orden de los efectos forma parte de su contrato.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { EntradaArchivo } from '../../../../shared/archivos-ipc'
import { ColaConcurrencia, esCancelada } from '../../../../shared/colaConcurrencia'
import { entradasConCadena, necesitaCadena, podarCadenas, type InfoCadena, type FilaAplanada } from './aplanarArbol'

/** Cadenas cargadas, sus errores y los registros que comparten los dos efectos de carga. */
export interface EstadoCadenas {
  /** Contenedora del proyecto del árbol: cada `listarDirectorio` va a ella. */
  raiz: string
  /** Cadena compactada y sus hijos, por ruta del primer segmento. */
  cadenas: Map<string, InfoCadena>
  setCadenas: React.Dispatch<React.SetStateAction<Map<string, InfoCadena>>>
  /** Fallo de listado, por ruta del primer segmento. */
  erroresCadena: Map<string, string>
  setErroresCadena: React.Dispatch<React.SetStateAction<Map<string, string>>>
  /** Carpetas cuyo `listarDirectorio` está en vuelo. */
  cadenasCargando: MutableRefObject<Set<string>>
  /** Tope del abanico de `listarDirectorio` de todo el árbol. */
  colaIndexado: ColaConcurrencia
  /** false solo tras el desmontaje real del árbol. */
  montadoRef: MutableRefObject<boolean>
}

/** Sigue la cadena de carpetas de único hijo-carpeta desde `entrada` y la fusiona en una fila. */
async function cargarCadena(raiz: string, entrada: EntradaArchivo): Promise<InfoCadena> {
  const listar = (ruta: string): Promise<EntradaArchivo[]> => window.tessera.files.listarDirectorio({ raiz, ruta })
  // Un contenedor (.jar, .war…) es su propia fila: no se compacta con lo que tiene dentro.
  if (entrada.contenedor != null) {
    return { segmentos: [entrada], hijos: await listar(entrada.ruta) }
  }
  const segmentos = [entrada]
  let hijos = await listar(entrada.ruta)
  while (hijos.length === 1 && hijos[0].tipo === 'dir') {
    segmentos.push(hijos[0])
    hijos = await listar(hijos[0].ruta)
  }
  return { segmentos, hijos }
}

/** Estado de las cadenas y el aviso de que el árbol sigue montado. */
export function useEstadoCadenas(raiz: string): EstadoCadenas {
  const [cadenas, setCadenas] = useState<Map<string, InfoCadena>>(new Map())
  const [erroresCadena, setErroresCadena] = useState<Map<string, string>>(new Map())
  const cadenasCargando = useRef<Set<string>>(new Set())
  // Inicialización perezosa: el argumento de `useRef` se evalúa en cada render.
  const colaRef = useRef<ColaConcurrencia | null>(null)
  if (colaRef.current === null) colaRef.current = new ColaConcurrencia(8)
  // Evita que una marca `cancelado` por efecto se active en cada re-ejecución y deje
  // carpetas «cargando…» para siempre. Un dato que llega se aplica mientras el árbol viva.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])
  return { raiz, cadenas, setCadenas, erroresCadena, setErroresCadena, cadenasCargando, colaIndexado: colaRef.current, montadoRef }
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Carga perezosa: por cada carpeta visible cuya cadena aún no se conoce, la pide. Al
 * llegar cambia `cadenas`, se re-aplana y el efecto vuelve a correr para el nivel siguiente.
 */
export function useCargaPerezosa(cad: EstadoCadenas, filas: FilaAplanada[]): void {
  const { raiz, cadenas, erroresCadena, setCadenas, setErroresCadena, cadenasCargando, colaIndexado, montadoRef } = cad
  useEffect(() => {
    for (const fila of filas) {
      if (!necesitaCadena(fila)) continue
      const ruta = fila.entrada.ruta
      if (cadenas.has(ruta) || erroresCadena.has(ruta) || cadenasCargando.current.has(ruta)) continue
      cadenasCargando.current.add(ruta)
      colaIndexado
        .correr(() => cargarCadena(raiz, fila.entrada))
        .then((c) => {
          cadenasCargando.current.delete(ruta)
          if (!montadoRef.current) return
          setCadenas((prev) => (prev.has(ruta) ? prev : new Map(prev).set(ruta, c)))
        })
        .catch((err: unknown) => {
          cadenasCargando.current.delete(ruta)
          // Cancelada por una ráfaga nueva: no es un fallo de la carpeta.
          if (!montadoRef.current || esCancelada(err)) return
          setErroresCadena((prev) => new Map(prev).set(ruta, mensajeDe(err)))
        })
    }
  }, [raiz, filas, cadenas, erroresCadena, colaIndexado, cadenasCargando, montadoRef, setCadenas, setErroresCadena])
}

/**
 * Refresco (watcher o CRUD): re-lista en sitio las cadenas de las carpetas visibles y poda
 * del caché las de ramas colapsadas, que se recargan frescas al re-expandir.
 */
export function useRefrescoCadenas(cad: EstadoCadenas, filas: FilaAplanada[], tokenRefresco: number): void {
  const { raiz, setCadenas, setErroresCadena, cadenasCargando, colaIndexado } = cad
  useEffect(() => {
    if (tokenRefresco === 0) return
    // Tira el abanico de la ráfaga anterior que no llegó a arrancar; lo que ya está en
    // vuelo se deja terminar. `cadenasCargando` no se vacía: lo comparten los dos efectos y
    // vaciarlo dejaba pedir dos veces la misma carpeta.
    colaIndexado.cancelarPendientes()
    const visibles = entradasConCadena(filas)
    setCadenas((prev) => podarCadenas(prev, visibles))
    setErroresCadena(new Map())
    let cancelado = false
    for (const [ruta, entrada] of visibles) {
      // Se apunta antes de encolar: mientras viva la petición, el efecto perezoso no la repite.
      cadenasCargando.current.add(ruta)
      colaIndexado
        .correr(() => cargarCadena(raiz, entrada))
        .then((c) => {
          cadenasCargando.current.delete(ruta)
          if (!cancelado) setCadenas((prev) => new Map(prev).set(ruta, c))
        })
        .catch((err: unknown) => {
          cadenasCargando.current.delete(ruta)
          // Una cancelación no es un fallo: pintarla como error dejaría el árbol en rojo en un build.
          if (cancelado || esCancelada(err)) return
          setErroresCadena((prev) => new Map(prev).set(ruta, mensajeDe(err)))
        })
    }
    return () => {
      cancelado = true
    }
    // Solo en cambios de tokenRefresco: lee `filas` por cierre y no debe re-disparar con `setCadenas`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenRefresco])
}
