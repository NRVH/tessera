// =============================================================================
// useConexionesBd: las conexiones del registro (conocidas y AJENAS, de
// `db.listCompleta`) de los perfiles que la vista de bases de datos necesita ahora:
// el activo y los que tienen alguna pestaña abierta. Se recargan con `db.onChanged`,
// descartan respuestas viejas por generación y conservan la identidad si nada cambia.
// Decisiones: docs/decisiones/bd/ui-area-conexiones-y-sesiones.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import { notify, notifyError } from '../../comun/notifications'

/**
 * ¿Ya se avisó en esta sesión de que el registro se recuperó del `.bak`? De MÓDULO y no un
 * `ref`: el registro es uno para todos los perfiles, y un remontaje no es otra sesión.
 */
let recuperacionAvisada = false

export interface ConexionesBd {
  /** Conexiones ya leídas, por perfil, en el orden del registro. */
  porPerfil: ReadonlyMap<string, readonly DbConnection[]>
  /**
   * Las AJENAS de cada perfil (las que esta versión no sabe abrir), en el orden en que
   * las da el main (el `orden` que les puso la versión que las creó). Siempre tiene una
   * entrada para cada perfil que ya tiene la suya en `porPerfil` (llegan juntas).
   */
  ajenasPorPerfil: ReadonlyMap<string, readonly DbConexionAjena[]>
  /**
   * El aviso de los perfiles cuyo registro vino con un FORMATO que esta versión no
   * reconoce (`DbListaConexiones.aviso`): solo tienen entrada esos. Entonces sus listas
   * están vacías porque no se entiende el archivo, no porque no haya conexiones, y la UI
   * enseña este texto en vez de «Sin conexiones».
   */
  avisoFormatoPorPerfil: ReadonlyMap<string, string>
  /** ¿Ese perfil aún no tiene respuesta del registro? (false sin perfil). */
  cargando: (perfilId: string | null) => boolean
  /** Vuelve a leer un perfil, o todos los de interés si no se indica. */
  recargar: (perfilId?: string) => void
}

const SIN_CONEXIONES: readonly DbConnection[] = []
const SIN_AJENAS: readonly DbConexionAjena[] = []

/** Las dos listas y el aviso de formato, en UN estado: se aplican a la vez (ver el ADR). */
interface Registro {
  conexiones: ReadonlyMap<string, readonly DbConnection[]>
  ajenas: ReadonlyMap<string, readonly DbConexionAjena[]>
  avisos: ReadonlyMap<string, string>
}

/** Lo de UN perfil (lo que trae `listCompleta`): sus dos listas y el aviso, o null. */
interface ListasPerfil {
  conexiones: readonly DbConnection[]
  ajenas: readonly DbConexionAjena[]
  aviso: string | null
}

/**
 * Pone `valor` en el perfil del mapa; devuelve el MISMO mapa si ya estaba igual (misma
 * serialización), para que la identidad solo cambie cuando cambia algo que se ve.
 */
function conValor<T>(mapa: ReadonlyMap<string, readonly T[]>, perfilId: string, valor: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const antes = mapa.get(perfilId)
  if (antes !== undefined && JSON.stringify(antes) === JSON.stringify(valor)) return mapa
  const next = new Map(mapa)
  next.set(perfilId, valor)
  return next
}

/**
 * Pone o quita el aviso del perfil; devuelve el MISMO mapa si no cambia, por lo mismo que
 * `conValor`. Solo tienen entrada los perfiles CON aviso: `has` es la marca.
 */
function conAviso(mapa: ReadonlyMap<string, string>, perfilId: string, aviso: string | null): ReadonlyMap<string, string> {
  if (aviso === null ? !mapa.has(perfilId) : mapa.get(perfilId) === aviso) return mapa
  const next = new Map(mapa)
  if (aviso === null) next.delete(perfilId)
  else next.set(perfilId, aviso)
  return next
}

/** El mapa sin los perfiles que ya no interesan; el MISMO si no sobraba ninguno. */
function soloInteres<T>(mapa: ReadonlyMap<string, T>, interes: ReadonlySet<string>): ReadonlyMap<string, T> {
  let sobra = false
  for (const k of mapa.keys()) {
    if (!interes.has(k)) {
      sobra = true
      break
    }
  }
  if (!sobra) return mapa
  const next = new Map<string, T>()
  for (const [k, v] of mapa) if (interes.has(k)) next.set(k, v)
  return next
}

/**
 * Clave estable de una lista de perfiles: sin duplicados y en orden. La comparte
 * `useConsolasBd`, que decide con ella lo mismo (cuándo cambió el interés).
 */
export function claveDe(perfiles: readonly string[]): string {
  return [...new Set(perfiles.filter((p) => p !== ''))].sort().join(',')
}

/**
 * Lee las listas de un perfil y las aplica A LA VEZ, solo si esta petición sigue siendo la
 * última de su perfil (`generaciones`). Un fallo avisa una vez por perfil (`avisados`) y
 * deja lo que había o, si no había nada, vacío: es el fin de «cargando».
 */
function cargarPerfil(
  perfilId: string,
  generaciones: Map<string, number>,
  avisados: Set<string>,
  setRegistro: (f: (prev: Registro) => Registro) => void
): void {
  const gen = (generaciones.get(perfilId) ?? 0) + 1
  generaciones.set(perfilId, gen)
  /** Pone las dos listas y el aviso del perfil; el MISMO estado si nada cambió. */
  const aplicar = (listas: (prev: Registro) => ListasPerfil): void => {
    if (generaciones.get(perfilId) !== gen) return
    setRegistro((prev) => {
      const { conexiones: c, ajenas: a, aviso: av } = listas(prev)
      const conexiones = conValor(prev.conexiones, perfilId, c)
      const ajenas = conValor(prev.ajenas, perfilId, a)
      const avisos = conAviso(prev.avisos, perfilId, av)
      if (conexiones === prev.conexiones && ajenas === prev.ajenas && avisos === prev.avisos) return prev
      return { conexiones, ajenas, avisos }
    })
  }
  void window.tessera.db.listCompleta(perfilId).then(
    (lista) => {
      avisados.delete(perfilId)
      if (!lista.formatoAjeno && lista.recuperado !== undefined && !recuperacionAvisada) {
        recuperacionAvisada = true
        notify('warn', 'Conexiones recuperadas de la copia de respaldo', lista.recuperado)
      }
      aplicar(() => ({
        conexiones: lista.conexiones,
        ajenas: lista.ajenas,
        aviso: lista.formatoAjeno ? lista.aviso : null
      }))
    },
    (err: unknown) => {
      console.error('[db] no se pudieron leer las conexiones:', err)
      if (!avisados.has(perfilId)) {
        avisados.add(perfilId)
        notifyError('No se pudieron leer las conexiones', err)
      }
      // Las dos listas por igual, porque vienen de una lectura y fallan juntas; y el
      // aviso también: un fallo de lectura no dice que el formato se arreglara.
      aplicar((prev) => ({
        conexiones: prev.conexiones.get(perfilId) ?? SIN_CONEXIONES,
        ajenas: prev.ajenas.get(perfilId) ?? SIN_AJENAS,
        aviso: prev.avisos.get(perfilId) ?? null
      }))
    }
  )
}

/** Conexiones conocidas y ajenas de los perfiles de interés, recargadas con `db.onChanged`. */
export function useConexionesBd(perfilesInteres: readonly string[]): ConexionesBd {
  const clave = claveDe(perfilesInteres)
  const [registro, setRegistro] = useState<Registro>(() => ({ conexiones: new Map(), ajenas: new Map(), avisos: new Map() }))
  /** Generación en vuelo por perfil: solo cuenta la respuesta de la última petición. */
  const generacionRef = useRef(new Map<string, number>())
  /** Perfiles que interesan AHORA (lo lee el suscriptor, que se registra una vez). */
  const interesRef = useRef<string[]>([])
  interesRef.current = clave ? clave.split(',') : []
  /** Perfiles cuyo fallo de lectura ya se avisó (un toast por perfil, no uno por recarga). */
  const avisadosRef = useRef(new Set<string>())

  const cargar = useCallback(
    (perfilId: string) => cargarPerfil(perfilId, generacionRef.current, avisadosRef.current, setRegistro),
    []
  )

  // Al cambiar el conjunto de interés: se leen los nuevos y se sueltan los que sobran.
  useEffect(() => {
    const interes = clave ? clave.split(',') : []
    const set = new Set(interes)
    setRegistro((prev) => {
      const conexiones = soloInteres(prev.conexiones, set)
      const ajenas = soloInteres(prev.ajenas, set)
      const avisos = soloInteres(prev.avisos, set)
      if (conexiones === prev.conexiones && ajenas === prev.ajenas && avisos === prev.avisos) return prev
      return { conexiones, ajenas, avisos }
    })
    for (const perfilId of interes) cargar(perfilId)
  }, [clave, cargar])

  // El registro cambió (alta, edición, baja, prueba, reorden, una ajena borrada): se
  // relee todo lo de interés. Registrado UNA vez; lee la lista por ref.
  useEffect(
    () =>
      window.tessera.db.onChanged(() => {
        for (const perfilId of interesRef.current) cargar(perfilId)
      }),
    [cargar]
  )

  const porPerfil = registro.conexiones
  const ajenasPorPerfil = registro.ajenas
  const avisoFormatoPorPerfil = registro.avisos
  const cargando = useCallback(
    (perfilId: string | null) => perfilId !== null && !porPerfil.has(perfilId),
    [porPerfil]
  )
  const recargar = useCallback(
    (perfilId?: string) => {
      if (perfilId !== undefined) cargar(perfilId)
      else for (const p of interesRef.current) cargar(p)
    },
    [cargar]
  )

  return useMemo(
    () => ({ porPerfil, ajenasPorPerfil, avisoFormatoPorPerfil, cargando, recargar }),
    [porPerfil, ajenasPorPerfil, avisoFormatoPorPerfil, cargando, recargar]
  )
}
