// =============================================================================
// Las pestañas de resultado de la consola SQL: «cargar más», «Contar» y «Traer todas»
// leen del lector de la consola con su `peticionId` GUARDADO (lo que ■ y el desmontaje
// cancelan), y cada pestaña es un dueño del presupuesto GLOBAL de celdas, que puede
// pedirle soltar lo que va tras su primera página. Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/ui-consola-lote-stop-y-cierre.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbPagina, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { registroCeldas, type DuenoRejilla } from '../rejilla/presupuestoCeldas'
import { motivoTopeTraerTodas, siguientePaso } from '../rejilla/traerTodas'
import type { AccionPestana } from './estadoConsola'
import { textoError } from './salidaConsola'
import type { ApiExplorador, Caja, RefsConsola } from './tiposConsola'
import type { NucleoConsola } from './useConsolaNucleo'
import { respuestaDeError, uuid } from '../documentos/consolaComun'
import { cancelacionesDetener } from './vivoConsola'

type Conjunto = ReadonlySet<string>
type Lector = Parameters<ApiExplorador['leerMas']>[0]
type Quitar = (ref: Caja<Conjunto>, poner: (s: Conjunto) => void, id: string) => void

/** Lo que está en vuelo en las pestañas de resultado y cómo quitarlo. */
export interface EnVueloConsola {
  cargandoMas: Conjunto
  setCargandoMas: (s: Conjunto) => void
  contando: Conjunto
  setContando: (s: Conjunto) => void
  totales: Readonly<Record<string, number>>
  quitarDeEnVuelo: Quitar
}

/** Pestaña activa, cuándo se vio cada una (para soltar memoria) y lectores por cerrar. */
export function useUsoResultados(n: NucleoConsola, visible: boolean) {
  const { r, api, estado, despachar } = n
  const pestana = useCallback((accion: AccionPestana, id: string): void => despachar({ tipo: 'pestana', accion, id }), [despachar])
  // Se apunta al empezar a verse y al dejar de verse (otra pestaña o la consola oculta).
  useEffect(() => {
    if (!visible) return
    const activa = estado.resultados.activa
    const uso = r.usoRef.current
    uso.set(activa, performance.now())
    return () => {
      uso.set(activa, performance.now())
    }
  }, [estado.resultados.activa, visible, r])
  // Los lectores de las pestañas sustituidas o cerradas se cierran en el main.
  useEffect(() => {
    const ls = estado.lectoresPorCerrar
    if (ls.length === 0) return
    despachar({ tipo: 'drenarLectores' })
    for (const l of ls) api.cerrarLector(l).catch(() => undefined)
  }, [api, estado.lectoresPorCerrar, despachar])
  return pestana
}

type PiezasVuelo = Pick<NucleoConsola, 'r' | 'api' | 'despachar' | 'salida'> &
  Pick<EnVueloConsola, 'setCargandoMas' | 'setContando' | 'quitarDeEnVuelo'> & {
    setTotales: (f: (t: Readonly<Record<string, number>>) => Readonly<Record<string, number>>) => void
  }

function pedirMas(p: PiezasVuelo, id: string): void {
  const { r } = p
  const res = r.estadoRef.current.resultados.resultados[id]
  if (!res || !res.lector) return
  const lector = res.lector
  // Con «Traer todas» en marcha las páginas las pide él (romperían la continuidad del `desde`).
  if (r.cargandoMasRef.current.has(id) || r.trayendoRef.current.has(id)) return
  // Si la página no cabe en el presupuesto GLOBAL ni soltando rejillas ocultas, no se pide.
  const pagina = r.filasPorPaginaRef.current
  if (!registroCeldas.cabe(pagina * res.columnas.length)) return
  r.cargandoMasRef.current = new Set(r.cargandoMasRef.current).add(id)
  p.setCargandoMas(r.cargandoMasRef.current)
  const peticionId = uuid()
  r.masEnVueloRef.current.set(id, peticionId)
  p.api
    .leerMas(lector, pagina, peticionId)
    .catch((err: unknown) => respuestaDeError<never>(err))
    .then((pg) => {
      // Fuera del mapa = la soltó `liberarResultado` (o el desmontaje): ya no encaja.
      if (r.desmontadoRef.current || r.masEnVueloRef.current.get(id) !== peticionId) return
      if (pg.ok) p.despachar({ tipo: 'pagina', id, pagina: pg.valor })
      else p.despachar({ tipo: 'lectorCerrado', id, motivo: textoError(pg.error) })
    })
    .finally(() => {
      // Solo si sigue siendo la suya: quien la sacó del mapa ya limpió.
      if (r.masEnVueloRef.current.get(id) !== peticionId) return
      r.masEnVueloRef.current.delete(id)
      p.quitarDeEnVuelo(r.cargandoMasRef, p.setCargandoMas, id)
    })
}

function pedirConteo(p: PiezasVuelo, id: string): void {
  const { r } = p
  const res = r.estadoRef.current.resultados.resultados[id]
  if (!res || !res.lector || r.contandoRef.current.has(id)) return
  const lector = res.lector
  r.contandoRef.current = new Set(r.contandoRef.current).add(id)
  p.setContando(r.contandoRef.current)
  const peticionId = uuid()
  r.conteosEnVueloRef.current.set(id, peticionId)
  p.api
    .contar(lector, peticionId)
    .catch((err: unknown) => respuestaDeError<number>(err))
    .then((c) => {
      if (r.desmontadoRef.current || r.conteosEnVueloRef.current.get(id) !== peticionId) return
      if (c.ok) p.setTotales((t) => ({ ...t, [id]: c.valor }))
      // Un conteo detenido con ■ no es un error: lo pidió el usuario.
      else if (c.error.motivo !== 'cancelada') p.salida('error', `No se pudieron contar las filas: ${textoError(c.error)}`)
    })
    .finally(() => {
      if (r.conteosEnVueloRef.current.get(id) !== peticionId) return
      r.conteosEnVueloRef.current.delete(id)
      p.quitarDeEnVuelo(r.contandoRef, p.setContando, id)
    })
}

/** «Cargar más» y «Contar», con sus espejos síncronos. */
export function useEnVueloConsola(n: NucleoConsola) {
  const { r, api, despachar, salida } = n
  const [cargandoMas, setCargandoMas] = useState<Conjunto>(() => r.cargandoMasRef.current)
  const [contando, setContando] = useState<Conjunto>(() => r.contandoRef.current)
  const [totales, setTotales] = useState<Readonly<Record<string, number>>>({})
  const quitarDeEnVuelo = useCallback<Quitar>(
    (ref, poner, id) => {
      if (!ref.current.has(id)) return
      const sig = new Set(ref.current)
      sig.delete(id)
      ref.current = sig
      if (!r.desmontadoRef.current) poner(sig)
    },
    [r]
  )
  const cargarMas = useCallback(
    (id: string): void =>
      pedirMas({ r, api, despachar, salida, setCargandoMas, setContando, setTotales, quitarDeEnVuelo }, id),
    [api, despachar, quitarDeEnVuelo, r, salida]
  )
  const contar = useCallback(
    (id: string): void =>
      pedirConteo({ r, api, despachar, salida, setCargandoMas, setContando, setTotales, quitarDeEnVuelo }, id),
    [api, salida, quitarDeEnVuelo, r, despachar]
  )
  const enVuelo: EnVueloConsola = { cargandoMas, setCargandoMas, contando, setContando, totales, quitarDeEnVuelo }
  return { enVuelo, cargarMas, contar }
}

/** Suelta lo que va tras la primera página de UN resultado; antes cancela lo que siga leyendo. */
function liberar(
  p: Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'despachar'>,
  v: Pick<EnVueloConsola, 'quitarDeEnVuelo' | 'setCargandoMas' | 'setContando'>,
  resId: string
): void {
  const { r } = p
  const mas = r.masEnVueloRef.current.get(resId)
  const conteo = r.conteosEnVueloRef.current.get(resId)
  r.masEnVueloRef.current.delete(resId)
  r.conteosEnVueloRef.current.delete(resId)
  const cancelaciones = cancelacionesDetener({
    perfilId: p.perfilId,
    consolaId: p.consolaId,
    conexionId: r.conexionRef.current.id,
    ejecucionId: null,
    masEnVuelo: mas ? [mas] : [],
    conteosEnVuelo: conteo ? [conteo] : []
  })
  for (const c of cancelaciones) p.api.cancelar(c).catch(() => undefined)
  v.quitarDeEnVuelo(r.cargandoMasRef, v.setCargandoMas, resId)
  v.quitarDeEnVuelo(r.contandoRef, v.setContando, resId)
  // SÍNCRONO: al volver, `estadoRef` ya tiene las celdas nuevas, que es lo que mide el registro.
  p.despachar({ tipo: 'liberar', id: resId })
}

/** Un dueño del registro de celdas por pestaña de resultado (el registro solo MIDE). */
function duenoDe(r: RefsConsola, instancia: string, resId: string, liberarRef: Caja<(id: string) => void>): DuenoRejilla {
  const medir = (): { filas: number; primera: number; cols: number } => {
    const res = r.estadoRef.current.resultados.resultados[resId]
    if (!res || !res.datos) return { filas: 0, primera: 0, cols: 0 }
    return { filas: res.datos.filas.length, primera: res.filasPrimeraPagina, cols: res.columnas.length }
  }
  return {
    id: `consola:${instancia}:${resId}`,
    celdas: () => {
      const m = medir()
      return m.filas * m.cols
    },
    celdasPrimeraPagina: () => {
      const m = medir()
      return Math.min(m.primera, m.filas) * m.cols
    },
    visible: () => r.visibleRef.current && r.estadoRef.current.resultados.activa === resId,
    ultimoUso: () => r.usoRef.current.get(resId) ?? 0,
    liberar: () => liberarRef.current(resId)
  }
}

/** Alta y baja de las pestañas en el presupuesto GLOBAL de celdas. */
export function usePresupuestoConsola(n: NucleoConsola, visible: boolean, v: EnVueloConsola): void {
  const { r, api, perfilId, consolaId, despachar, estado } = n
  const { quitarDeEnVuelo, setCargandoMas, setContando } = v
  const liberarResultado = useCallback(
    (resId: string): void =>
      liberar({ r, api, perfilId, consolaId, despachar }, { quitarDeEnVuelo, setCargandoMas, setContando }, resId),
    [api, perfilId, consolaId, despachar, quitarDeEnVuelo, r, setCargandoMas, setContando]
  )
  const liberarRef = useRef(liberarResultado)
  liberarRef.current = liberarResultado
  // Id de ESTA instancia: con dos montajes de la misma consola a la vez no se pisan.
  const [instancia] = useState(uuid)
  const bajasRef = useRef(new Map<string, () => void>())
  const duenoResultado = useCallback((resId: string) => duenoDe(r, instancia, resId, liberarRef), [instancia, r])
  // Alta de los nuevos, baja de los que se fueron, y aviso: cambiaron filas, activa o visibilidad.
  useEffect(() => {
    const bajas = bajasRef.current
    const vivos = new Set(Object.keys(estado.resultados.resultados))
    for (const [id, baja] of bajas) {
      if (vivos.has(id)) continue
      baja()
      bajas.delete(id)
    }
    for (const id of vivos) {
      if (!bajas.has(id)) bajas.set(id, registroCeldas.registrar(duenoResultado(id)))
    }
    registroCeldas.avisar()
  }, [estado.resultados, visible, duenoResultado])
  // Al desmontar, todos fuera: una consola cerrada no ocupa presupuesto.
  useEffect(() => {
    const bajas = bajasRef.current
    return () => {
      for (const baja of bajas.values()) baja()
      bajas.clear()
    }
  }, [])
}

type PiezasTraer = Pick<NucleoConsola, 'r' | 'api' | 'despachar'> &
  Pick<EnVueloConsola, 'setCargandoMas' | 'quitarDeEnVuelo'> & {
    publicarTrayendo: () => void
    setTopes: (f: (t: Readonly<Record<string, string>>) => Readonly<Record<string, string>>) => void
  }

/** Marca la página de «Traer todas» como en vuelo (■ la alcanza por su `peticionId`). */
function empezarPagina(p: PiezasTraer, id: string): string {
  const { r } = p
  const peticionId = uuid()
  r.masEnVueloRef.current.set(id, peticionId)
  r.cargandoMasRef.current = new Set(r.cargandoMasRef.current).add(id)
  p.setCargandoMas(r.cargandoMasRef.current)
  return peticionId
}

/** Aplica la página que llegó; false = se para (lo traído se queda). */
function aplicarPagina(p: PiezasTraer, id: string, peticionId: string, pg: DbRespuesta<DbPagina>): boolean {
  const { r } = p
  // Fuera del mapa = la soltó `liberarResultado` o el desmontaje: se para.
  const mia = r.masEnVueloRef.current.get(id) === peticionId
  if (mia) {
    r.masEnVueloRef.current.delete(id)
    p.quitarDeEnVuelo(r.cargandoMasRef, p.setCargandoMas, id)
  }
  if (r.desmontadoRef.current || !mia) return false
  if (!pg.ok) {
    // Detener (el suyo o ■) no es un error.
    if (pg.error.motivo !== 'cancelada') p.despachar({ tipo: 'lectorCerrado', id, motivo: textoError(pg.error) })
    return false
  }
  p.despachar({ tipo: 'pagina', id, pagina: pg.valor })
  return true
}

/**
 * La siguiente página que pedir, o null si se para. Cuántas pedir y cuándo parar lo decide
 * `traerTodas.ts`, el mismo que usa la pestaña de datos.
 */
function siguientePagina(p: PiezasTraer, id: string, control: { detenido: boolean }): { lector: Lector; filas: number } | null {
  const { r } = p
  if (r.desmontadoRef.current) return null
  const res = r.estadoRef.current.resultados.resultados[id]
  if (!res || !res.datos) return null
  const paso = siguientePaso(
    { hayMas: res.datos.hayMas && res.lector !== null, detenido: control.detenido, columnas: res.columnas.length },
    registroCeldas
  )
  if (paso.tipo === 'tope') {
    const filas = res.datos.filas.length
    if (!r.desmontadoRef.current) p.setTopes((t) => ({ ...t, [id]: motivoTopeTraerTodas(filas) }))
    return null
  }
  if (paso.tipo !== 'pedir' || res.lector === null) return null
  return { lector: res.lector, filas: paso.filas }
}

// Un solo `await` por página y aquí mismo: una función `async` intermedia metería un turno
// de microtarea entre aplicar una página y pedir la siguiente, que el bucle no tenía.
async function traerTodasDe(p: PiezasTraer, id: string): Promise<void> {
  const { r } = p
  if (r.trayendoRef.current.has(id)) return
  const control = { detenido: false }
  r.trayendoRef.current.set(id, control)
  p.publicarTrayendo()
  p.setTopes((t) => {
    if (!(id in t)) return t
    const sig = { ...t }
    delete sig[id]
    return sig
  })
  try {
    // Una página de «cargar más» en vuelo se deja llegar: la siguiente empieza donde acabe.
    while (r.cargandoMasRef.current.has(id)) {
      if (r.desmontadoRef.current || control.detenido) return
      await new Promise<void>((res) => setTimeout(res, 50))
    }
    for (;;) {
      const sig = siguientePagina(p, id, control)
      if (!sig) return
      const peticionId = empezarPagina(p, id)
      let pg: DbRespuesta<DbPagina>
      try {
        pg = await p.api.leerMas(sig.lector, sig.filas, peticionId)
      } catch (err) {
        pg = respuestaDeError<DbPagina>(err)
      }
      if (!aplicarPagina(p, id, peticionId, pg)) return
    }
  } finally {
    r.trayendoRef.current.delete(id)
    p.publicarTrayendo()
  }
}

/** «Traer todas» de un resultado, su Detener y los topes de memoria que enseña la píldora. */
export function useTraerTodas(n: NucleoConsola, v: EnVueloConsola) {
  const { r, api, despachar, estado } = n
  const { setCargandoMas, quitarDeEnVuelo } = v
  const [trayendo, setTrayendo] = useState<Conjunto>(() => new Set())
  const [topes, setTopes] = useState<Readonly<Record<string, string>>>({})
  const publicarTrayendo = useCallback((): void => {
    if (!r.desmontadoRef.current) setTrayendo(new Set(r.trayendoRef.current.keys()))
  }, [r])
  const traerTodas = useCallback(
    (id: string): Promise<void> =>
      traerTodasDe({ r, api, despachar, setCargandoMas, quitarDeEnVuelo, publicarTrayendo, setTopes }, id),
    [api, despachar, publicarTrayendo, quitarDeEnVuelo, r, setCargandoMas]
  )
  const detenerTraerTodas = useCallback(
    (id: string): void => {
      const c = r.trayendoRef.current.get(id)
      if (!c) return
      c.detenido = true
      const pid = r.masEnVueloRef.current.get(id)
      if (pid) api.cancelar({ rol: 'datos', conexionId: r.conexionRef.current.id, peticionId: pid }).catch(() => undefined)
    },
    [api, r]
  )
  // Los topes de resultados que ya no existen (sustituidos por otro lote) se olvidan.
  useEffect(() => {
    setTopes((t) => {
      const vivos = estado.resultados.resultados
      const fuera = Object.keys(t).filter((k) => !(k in vivos))
      if (fuera.length === 0) return t
      const sig = { ...t }
      for (const k of fuera) delete sig[k]
      return sig
    })
  }, [estado.resultados.resultados])
  return { trayendo, topes, traerTodas, detenerTraerTodas }
}
