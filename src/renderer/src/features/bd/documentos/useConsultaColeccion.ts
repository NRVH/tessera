// =============================================================================
// Los hooks de consulta de la pestaña de colección: el estado de lo pedido y lo aplicado, la
// consulta y «Cargar más» con su `peticionId` cancelable, y el ciclo de vida (primera
// consulta al verse, cancelar al cerrar, foco en el campo con error). Los llama `DbColeccionPane`
// en este orden; cada uno recibe el estado del anterior y no crea estado que otro necesite.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbDocCampoMuestra, DbDocDocumento } from '../../../../../shared/db-documentos-ipc'
import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbFiltroGuiado } from '../../../../../shared/filtroGuiado'
import {
  BARRA_DOCS_VACIA,
  CONSULTA_INICIAL,
  camposDeConsulta,
  destinoDelError,
  esCampoBarra,
  unirColumnas,
  type BarraDocs,
  type CampoBarra,
  type ConsultaColeccion,
  type ModoFiltroDocs
} from './coleccionDocs'
import type { IndicadorPestana } from '../dbTabsModel'
import { errorDeInvoke, textoError } from '../panesBd'
import { nuevaPeticion } from './utilPanes'
import { notify } from '../../../comun/notifications'

export interface Pagina {
  documentos: DbDocDocumento[]
  columnas: string[]
  ms: number
}

type RespuestaPagina = DbRespuesta<{ lector: string | null; documentos: DbDocDocumento[]; columnas: string[]; ms: number }>

/** Lo que estos hooks leen de las props vivas (siempre las últimas). */
export interface PropsVivasColeccion {
  conexion: { id: string }
  filasPorPagina: number
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
}

/**
 * Todo el estado de la consulta. `modo` es la barra que SE VE; `aplicado`, lo último que
 * funcionó; `pedidaRef`, lo último pedido (de ahí parte el siguiente clic en la cabecera).
 */
export interface EstadoConsulta {
  modo: ModoFiltroDocs
  setModo: (m: ModoFiltroDocs) => void
  escrito: BarraDocs
  setEscrito: React.Dispatch<React.SetStateAction<BarraDocs>>
  guiadoEscrito: DbFiltroGuiado
  setGuiadoEscrito: (f: DbFiltroGuiado) => void
  aplicado: ConsultaColeccion
  setAplicado: (c: ConsultaColeccion) => void
  aplicadoRef: React.MutableRefObject<ConsultaColeccion>
  pedidaRef: React.MutableRefObject<ConsultaColeccion>
  errorGuiado: { condicion: number | null; mensaje: string } | null
  setErrorGuiado: (e: { condicion: number | null; mensaje: string } | null) => void
  /** Los campos de la muestra (`$sample`) para las columnas de la barra guiada; null = aún no. */
  muestra: DbDocCampoMuestra[] | null
  setMuestra: (m: DbDocCampoMuestra[] | null) => void
  pagina: Pagina | null
  setPagina: React.Dispatch<React.SetStateAction<Pagina | null>>
  hayMas: boolean
  setHayMas: (v: boolean) => void
  cargando: boolean
  setCargando: (v: boolean) => void
  cargandoMas: boolean
  setCargandoMas: (v: boolean) => void
  error: DbErrorSql | null
  setError: (e: DbErrorSql | null) => void
  errorCampo: DbErrorSql | null
  setErrorCampo: (e: DbErrorSql | null) => void
  detenida: boolean
  setDetenida: (v: boolean) => void
  peticionRef: React.MutableRefObject<string | null>
  masRef: React.MutableRefObject<string | null>
  lectorRef: React.MutableRefObject<string | null>
  montadoRef: React.MutableRefObject<boolean>
  haSidoVisibleRef: React.MutableRefObject<boolean>
  inputs: Record<CampoBarra, React.RefObject<HTMLInputElement>>
}

/** El estado de la consulta (ver `EstadoConsulta`). */
export function useEstadoConsulta(): EstadoConsulta {
  const [modo, setModo] = useState<ModoFiltroDocs>('guiado')
  const [escrito, setEscrito] = useState<BarraDocs>(BARRA_DOCS_VACIA)
  const [guiadoEscrito, setGuiadoEscrito] = useState<DbFiltroGuiado>(CONSULTA_INICIAL.guiado)
  const [aplicado, setAplicado] = useState<ConsultaColeccion>(CONSULTA_INICIAL)
  const aplicadoRef = useRef<ConsultaColeccion>(CONSULTA_INICIAL)
  const pedidaRef = useRef<ConsultaColeccion>(CONSULTA_INICIAL)
  const [errorGuiado, setErrorGuiado] = useState<EstadoConsulta['errorGuiado']>(null)
  const [muestra, setMuestra] = useState<DbDocCampoMuestra[] | null>(null)
  const [pagina, setPagina] = useState<Pagina | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState<DbErrorSql | null>(null)
  const [errorCampo, setErrorCampo] = useState<DbErrorSql | null>(null)
  const [detenida, setDetenida] = useState(false)
  const peticionRef = useRef<string | null>(null)
  const masRef = useRef<string | null>(null)
  const lectorRef = useRef<string | null>(null)
  const montadoRef = useRef(true)
  const haSidoVisibleRef = useRef(false)
  const inputs = {
    filtro: useRef<HTMLInputElement>(null),
    proyeccion: useRef<HTMLInputElement>(null),
    orden: useRef<HTMLInputElement>(null)
  }
  return {
    modo, setModo, escrito, setEscrito, guiadoEscrito, setGuiadoEscrito, aplicado, setAplicado, aplicadoRef, pedidaRef,
    errorGuiado, setErrorGuiado, muestra, setMuestra, pagina, setPagina, hayMas, setHayMas,
    cargando, setCargando, cargandoMas, setCargandoMas, error, setError, errorCampo, setErrorCampo, detenida, setDetenida,
    peticionRef, masRef, lectorRef, montadoRef, haSidoVisibleRef, inputs
  }
}

function cerrarLectorDe(lector: string | null): void {
  if (lector) void window.tessera.dbDocumentos.lectorCerrar(lector).catch(() => undefined)
}

async function pedirPagina(conexionId: string, base: string, coleccion: string, c: ConsultaColeccion, max: number, id: string): Promise<RespuestaPagina> {
  try {
    return await window.tessera.dbDocumentos.consultar({ conexionId, base, coleccion, ...camposDeConsulta(c), maxDocumentos: max, peticionId: id })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}

async function pedirMas(lector: string, max: number, id: string): Promise<RespuestaPagina> {
  try {
    return await window.tessera.dbDocumentos.lectorMas({ lector, maxDocumentos: max, peticionId: id })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}

/** A dónde va el error de una consulta: detenida, la barra guiada, un campo de la barra JSON o la tabla. */
function anotarFallo(e: Pick<EstadoConsulta, 'setDetenida' | 'setErrorGuiado' | 'setErrorCampo' | 'setError'>, error: DbErrorSql, c: ConsultaColeccion): void {
  const destino = destinoDelError(error, c.modo)
  if (error.motivo === 'cancelada') e.setDetenida(true)
  else if (destino.tipo === 'guiado') e.setErrorGuiado({ condicion: destino.condicion, mensaje: textoError(error) })
  else if (destino.tipo === 'campo') e.setErrorCampo(error)
  else e.setError(error)
}

export interface Consultar {
  consultar: (c: ConsultaColeccion) => Promise<void>
}

/** La consulta de una página: cierra el cursor anterior, pide y aplica solo si aún se espera. */
export function useConsultar(e: EstadoConsulta, conexionId: string, base: string, coleccion: string, propsRef: React.MutableRefObject<PropsVivasColeccion>): Consultar {
  const { lectorRef, peticionRef, pedidaRef, masRef, montadoRef, aplicadoRef } = e
  const { setCargando, setCargandoMas, setError, setErrorCampo, setErrorGuiado, setDetenida, setAplicado, setHayMas, setPagina } = e

  const cerrarLector = useCallback((): void => {
    const l = lectorRef.current
    lectorRef.current = null
    cerrarLectorDe(l)
  }, [lectorRef])

  const consultar = useCallback(
    async (c: ConsultaColeccion): Promise<void> => {
      cerrarLector()
      const id = nuevaPeticion('coleccion')
      peticionRef.current = id
      pedidaRef.current = c
      masRef.current = null
      setCargando(true)
      setCargandoMas(false)
      setError(null)
      setErrorCampo(null)
      setErrorGuiado(null)
      setDetenida(false)
      const r = await pedirPagina(conexionId, base, coleccion, c, propsRef.current.filasPorPagina, id)
      // Una respuesta que ya nadie espera (otra consulta, la pestaña cerrada) cierra lo suyo.
      if (peticionRef.current !== id || !montadoRef.current) {
        if (r.ok) cerrarLectorDe(r.valor.lector)
        return
      }
      peticionRef.current = null
      setCargando(false)
      if (!r.ok) {
        // Lo pedido no llegó a aplicarse: el siguiente clic en la cabecera parte de lo aplicado.
        pedidaRef.current = aplicadoRef.current
        anotarFallo({ setDetenida, setErrorGuiado, setErrorCampo, setError }, r.error, c)
        return
      }
      lectorRef.current = r.valor.lector
      aplicadoRef.current = c
      setAplicado(c)
      setHayMas(r.valor.lector !== null)
      setPagina({ documentos: r.valor.documentos, columnas: r.valor.columnas, ms: r.valor.ms })
    },
    // Las refs y los setters de `e` son estables: la identidad cambia solo con el destino.
    [conexionId, base, coleccion, cerrarLector, propsRef, lectorRef, peticionRef, pedidaRef, masRef, montadoRef, aplicadoRef, setCargando, setCargandoMas, setError, setErrorCampo, setErrorGuiado, setDetenida, setAplicado, setHayMas, setPagina]
  )
  return { consultar }
}

/** «Cargar más»: la página siguiente del cursor abierto; un fallo deja de pedir hasta Refrescar. */
export function useCargarMas(e: EstadoConsulta, propsRef: React.MutableRefObject<PropsVivasColeccion>): () => Promise<void> {
  const { lectorRef, masRef, peticionRef, montadoRef, setCargandoMas, setHayMas, setPagina } = e
  return useCallback(async (): Promise<void> => {
    const lector = lectorRef.current
    if (!lector || masRef.current || peticionRef.current) return
    const id = nuevaPeticion('coleccion-mas')
    masRef.current = id
    setCargandoMas(true)
    const r = await pedirMas(lector, propsRef.current.filasPorPagina, id)
    if (masRef.current !== id || !montadoRef.current) return
    masRef.current = null
    setCargandoMas(false)
    if (!r.ok) {
      // Se deja de pedir más (si no, el final a la vista lo reintentaría en cada pintado).
      if (r.error.motivo !== 'cancelada') notify('error', 'No se pudieron leer más documentos', textoError(r.error))
      setHayMas(false)
      const l = lectorRef.current
      lectorRef.current = null
      cerrarLectorDe(l)
      return
    }
    const v = r.valor
    lectorRef.current = v.lector
    setHayMas(v.lector !== null)
    setPagina((prev) =>
      prev
        ? { documentos: [...prev.documentos, ...v.documentos], columnas: unirColumnas(prev.columnas, v.columnas), ms: prev.ms + v.ms }
        : { documentos: v.documentos, columnas: v.columnas, ms: v.ms }
    )
  }, [lectorRef, masRef, peticionRef, montadoRef, setCargandoMas, setHayMas, setPagina, propsRef])
}

/** Cancela las peticiones de datos `ids` de una conexión. */
export function cancelarPeticiones(conexionId: string, ids: readonly (string | null)[]): void {
  for (const id of ids) {
    if (id) void window.tessera.dbExplorador.cancelar({ rol: 'datos', conexionId, peticionId: id }).catch(() => undefined)
  }
}

/**
 * El ciclo de vida, en este orden: la primera consulta (con la muestra de campos) la primera
 * vez que se ve; cancelar y cerrar el cursor al cerrar la pestaña; el foco en el campo de la
 * barra JSON que tiene el error.
 */
export function useCicloConsulta(
  e: EstadoConsulta,
  visible: boolean,
  consultar: Consultar['consultar'],
  ids: { conexionId: string; base: string; coleccion: string },
  propsRef: React.MutableRefObject<PropsVivasColeccion>
): void {
  const { conexionId, base, coleccion } = ids
  const { haSidoVisibleRef, montadoRef, setMuestra, peticionRef, masRef, lectorRef, errorCampo, inputs } = e

  // Antes de verse, nada (contrato de `propsBd`). Si la muestra no se puede leer (una vista
  // sin permiso de `$sample`), las columnas salen de la página.
  useEffect(() => {
    if (!visible || haSidoVisibleRef.current) return
    haSidoVisibleRef.current = true
    void consultar(CONSULTA_INICIAL)
    void window.tessera.dbDocumentos
      .detalle({ conexionId, base, coleccion })
      .then((r) => {
        if (r.ok && montadoRef.current) setMuestra(r.valor.campos)
      })
      .catch(() => undefined)
  }, [visible, consultar, conexionId, base, coleccion, haSidoVisibleRef, montadoRef, setMuestra])

  useEffect(() => {
    montadoRef.current = true
    // La conexión se lee al cerrar, no al montar: es la última que llegó por props.
    const conexionActual = (): string => propsRef.current.conexion.id
    return () => {
      montadoRef.current = false
      cancelarPeticiones(conexionActual(), [peticionRef.current, masRef.current])
      peticionRef.current = null
      masRef.current = null
      const l = lectorRef.current
      lectorRef.current = null
      cerrarLectorDe(l)
    }
  }, [montadoRef, propsRef, peticionRef, masRef, lectorRef])

  // El foco va a ESE campo con el cursor en la posición del error, solo si la pestaña se ve:
  // robar el foco desde una de fondo sería peor.
  useEffect(() => {
    if (!visible || !errorCampo || !esCampoBarra(errorCampo.campo)) return
    const el = inputs[errorCampo.campo].current
    if (!el) return
    el.focus()
    const pos = Math.max(0, Math.min(el.value.length, errorCampo.posicion ?? el.value.length))
    el.setSelectionRange(pos, Math.min(el.value.length, pos + 1))
    // Solo cuando cambia el error o la pestaña se ve; `inputs` son refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorCampo, visible])
}
