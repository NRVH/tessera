// =============================================================================
// Los hooks de lectura de la pestaña de clave: pedir la clave y sus páginas con un
// `peticionId` que Stop puede cancelar, vigilar el ciclo de vida (indicadores, cancelar al
// cerrar, «Detener» en el cuerpo si tarda) y la cuenta atrás del TTL. Los usa `DbClavePane`.
// Decisiones: docs/decisiones/bd/ui-claves-pestana.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbKvBytes, DbKvValor } from '../../../../../shared/db-claves-ipc'
import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { describirError, errorDeInvoke } from '../panesBd'
import { notify } from '../../../comun/notifications'
import { nuevaPeticion } from '../documentos/utilPanes'
import { ELEMENTOS_POR_PAGINA, acumularValor, siguienteDe, ttlRestante } from './visorClaves'

/** Tras cuánto se ofrece «Detener» también en el cuerpo (en la barra está siempre). */
const DETENER_EN_CUERPO_MS = 800

async function pedirValor(
  conexionId: string,
  base: number,
  clave: DbKvBytes,
  desde: string | undefined,
  id: string
): Promise<DbRespuesta<DbKvValor>> {
  try {
    return await window.tessera.dbClaves.valor({
      conexionId,
      base,
      clave,
      ...(desde !== undefined ? { desde } : {}),
      cuantos: ELEMENTOS_POR_PAGINA,
      peticionId: id
    })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}

function cancelarLecturas(conexionId: string, ids: readonly (string | null)[]): void {
  for (const id of ids) {
    if (id) void window.tessera.dbExplorador.cancelar({ rol: 'datos', conexionId, peticionId: id }).catch(() => undefined)
  }
}

export interface LecturaClave {
  valor: DbKvValor | null
  leidoEn: number
  cargando: boolean
  cargandoMas: boolean
  error: DbErrorSql | null
  detenida: boolean
  leer: () => Promise<void>
  cargarMas: () => Promise<void>
  detener: () => void
  peticionRef: React.MutableRefObject<string | null>
  masRef: React.MutableRefObject<string | null>
  montadoRef: React.MutableRefObject<boolean>
}

/** Lee la clave (en el primer `visible`, y cuando se pide) y sus páginas siguientes. */
export function useLecturaClave(conexionId: string, base: number, bytesClave: DbKvBytes, visible: boolean): LecturaClave {
  const [valor, setValor] = useState<DbKvValor | null>(null)
  const [leidoEn, setLeidoEn] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState<DbErrorSql | null>(null)
  const [detenida, setDetenida] = useState(false)
  const peticionRef = useRef<string | null>(null)
  const masRef = useRef<string | null>(null)
  const montadoRef = useRef(true)
  const haSidoVisibleRef = useRef(false)

  const leer = useCallback(async (): Promise<void> => {
    const id = nuevaPeticion('clave')
    peticionRef.current = id
    masRef.current = null
    setCargando(true)
    setCargandoMas(false)
    setError(null)
    setDetenida(false)
    const r = await pedirValor(conexionId, base, bytesClave, undefined, id)
    if (peticionRef.current !== id || !montadoRef.current) return
    peticionRef.current = null
    setCargando(false)
    if (!r.ok) {
      if (r.error.motivo === 'cancelada') setDetenida(true)
      else setError(r.error)
      return
    }
    setValor(r.valor)
    setLeidoEn(Date.now())
  }, [conexionId, base, bytesClave])

  const cargarMas = useCallback(async (): Promise<void> => {
    const actual = valor
    const desde = actual ? siguienteDe(actual.contenido) : null
    if (!actual || desde === null || masRef.current || peticionRef.current) return
    const id = nuevaPeticion('clave-mas')
    masRef.current = id
    setCargandoMas(true)
    const r = await pedirValor(conexionId, base, bytesClave, desde, id)
    if (masRef.current !== id || !montadoRef.current) return
    masRef.current = null
    setCargandoMas(false)
    if (!r.ok) {
      if (r.error.motivo !== 'cancelada') notify('error', 'No se pudieron leer más elementos', describirError(r.error, 'leer la clave').detalle)
      return
    }
    setValor((prev) => (prev ? acumularValor(prev, r.valor) : r.valor))
    setLeidoEn(Date.now())
  }, [valor, conexionId, base, bytesClave])

  const detener = (): void => cancelarLecturas(conexionId, [peticionRef.current, masRef.current])

  // Primera vez que se ve: la lectura. Antes, nada (contrato de `propsBd`).
  useEffect(() => {
    if (!visible || haSidoVisibleRef.current) return
    haSidoVisibleRef.current = true
    void leer()
  }, [visible, leer])

  return { valor, leidoEn, cargando, cargandoMas, error, detenida, leer, cargarMas, detener, peticionRef, masRef, montadoRef }
}

/** Lo que la vigilancia lee de las props vivas (siempre las últimas). */
export interface PropsVigilancia {
  conexion: { id: string }
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
}

/**
 * Cancela lo que esté en vuelo al cerrar la pestaña, publica los indicadores y devuelve si la
 * lectura tarda (para ofrecer «Detener» también en el cuerpo).
 */
export function useVigilanciaClave(l: LecturaClave, props: React.MutableRefObject<PropsVigilancia>): boolean {
  const { cargando, cargandoMas, error, peticionRef, masRef, montadoRef } = l
  const [lento, setLento] = useState(false)

  useEffect(() => {
    montadoRef.current = true
    // La conexión se lee al cerrar, no al montar: es la última que llegó por props.
    const conexionActual = (): string => props.current.conexion.id
    return () => {
      montadoRef.current = false
      cancelarLecturas(conexionActual(), [peticionRef.current, masRef.current])
      peticionRef.current = null
      masRef.current = null
    }
  }, [montadoRef, peticionRef, masRef, props])

  useEffect(() => {
    if (!cargando) {
      setLento(false)
      return
    }
    const t = window.setTimeout(() => setLento(true), DETENER_EN_CUERPO_MS)
    return () => window.clearTimeout(t)
  }, [cargando])

  useEffect(() => {
    const s = new Set<IndicadorPestana>()
    if (cargando || cargandoMas) s.add('cargando')
    if (error) s.add('error')
    props.current.onIndicador(s)
  }, [cargando, cargandoMas, error, props])

  return lento
}

/** Los ms que le quedan a la clave, con cuenta atrás solo a la vista y si caduca. */
export function useTtlClave(valor: DbKvValor | null, leidoEn: number, visible: boolean): number | null {
  const [ahora, setAhora] = useState(() => Date.now())
  const caduca = valor !== null && valor.ttlMs !== null
  useEffect(() => {
    if (!visible || !caduca) return
    setAhora(Date.now())
    const t = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [visible, caduca, leidoEn])
  return valor ? ttlRestante(valor.ttlMs, leidoEn, Math.max(ahora, leidoEn)) : null
}
