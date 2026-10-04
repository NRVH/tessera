// =============================================================================
// La sesión de una consola SQL vista desde el renderer: el estado que manda el main,
// el indicador de la pestaña, el modo de transacción, COMMIT/ROLLBACK y el esquema.
// Qué confirma en producción lo dice `produccionConsola` (compartido con el main).
// Pieza de `useConsola`. Decisiones: docs/decisiones/bd/transacciones-produccion-y-manual.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DbEstadoSesion, DbResolverTx, DbTxModo } from '../../../../../shared/db-explorador-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import {
  ejecutando as hayEjecucion,
  estadoBarraTx,
  indicadoresConsola,
  pasoAAutoRequiereResolver,
  type BarraTx
} from './estadoConsola'
import { commitPideConfirmacion, confirmacionCommitProduccion, modoTxPorDefecto } from './produccionConsola'
import { textoError } from './salidaConsola'
import type { RefsConsola } from './tiposConsola'
import type { DialogosConsola, PreguntaConsola } from './useConsolaDialogos'
import type { NucleoConsola } from './useConsolaNucleo'
import { respuestaDeError } from '../documentos/consolaComun'
import { mismosIndicadores } from './vivoConsola'

/** El estado de sesión (evento del main o consulta al montar) y el indicador de la pestaña. */
export function useSesionConsola(n: NucleoConsola): void {
  const { r, api, perfilId, consolaId, despachar, estado, cargado, errorCarga } = n
  useEffect(() => {
    let vivo = true
    let llegoEvento = false
    const quitar = api.onSesion((s) => {
      if (s.ref.rol !== 'consola' || s.ref.perfilId !== perfilId || s.ref.consolaId !== consolaId) return
      llegoEvento = true
      despachar({ tipo: 'sesion', sesion: s, ahora: Date.now() })
    })
    api
      .estadoConsola(perfilId, consolaId)
      .then((s) => {
        // Si ya llegó un evento, es más nuevo que esta consulta: no se pisa.
        if (vivo && !llegoEvento) despachar({ tipo: 'sesion', sesion: s, ahora: Date.now() })
      })
      .catch(() => undefined)
    return () => {
      vivo = false
      quitar()
    }
  }, [api, perfilId, consolaId, despachar])

  const indicadores = useMemo(() => {
    const s = indicadoresConsola(estado)
    if (!cargado && errorCarga === null) s.add('cargando')
    return s
  }, [estado, cargado, errorCarga])
  const ultimoIndicadorRef = useRef<ReadonlySet<IndicadorPestana> | null>(null)
  useEffect(() => {
    if (mismosIndicadores(ultimoIndicadorRef.current, indicadores)) return
    ultimoIndicadorRef.current = indicadores
    r.onIndicadorRef.current(indicadores)
  }, [indicadores, r])
}

/** La barra de AHORA: sin sesión, el modo en que arrancará (Manual en producción). */
function barraDe(r: RefsConsola): BarraTx {
  return estadoBarraTx(r.estadoRef.current.sesion, {
    soloLectura: r.soloLecturaRef.current,
    ejecutando: hayEjecucion(r.estadoRef.current),
    modoSinSesion: modoTxPorDefecto(r.conexionRef.current.entorno, r.soloLecturaRef.current, r.txInicialRef.current)
  })
}

type Piezas = Pick<NucleoConsola, 'r' | 'api' | 'perfilId' | 'consolaId' | 'despachar' | 'salida'>

async function alternarModo(p: Piezas, pedirResolucionTx: DialogosConsola['pedirResolucionTx']): Promise<void> {
  const { r } = p
  if (r.txEnCursoRef.current) return
  const b = barraDe(r)
  if (!b.puedeCambiarModo) return
  const destino: DbTxModo = b.modo === 'auto' ? 'manual' : 'auto'
  const s = r.estadoRef.current.sesion
  let resolver: DbResolverTx | undefined
  if (destino === 'auto' && pasoAAutoRequiereResolver(s)) {
    const res = await pedirResolucionTx(s, 'Para pasar a Tx Auto hay que confirmarla o revertirla antes.')
    if (!res) return
    resolver = res
  }
  r.txEnCursoRef.current = true
  try {
    // `txInicial`: la misma con la que se pinta la barra, por si esto CREA la sesión.
    const res = await p.api
      .modoTx(p.perfilId, p.consolaId, destino, resolver, r.txInicialRef.current)
      .catch((err: unknown) => respuestaDeError<DbEstadoSesion>(err))
    if (res.ok) p.despachar({ tipo: 'sesion', sesion: res.valor, ahora: Date.now() })
    else p.salida('error', textoError(res.error))
  } finally {
    r.txEnCursoRef.current = false
  }
}

/** La pregunta del COMMIT en producción, con el alias y lo que hay en la transacción. */
function preguntaCommit(r: RefsConsola): PreguntaConsola {
  const c = r.conexionRef.current
  return {
    ...confirmacionCommitProduccion({ alias: c.alias, sentenciasEnTx: r.estadoRef.current.sesion?.sentenciasEnTx ?? 0 }),
    peligro: true
  }
}

/** Mientras se preguntaba pudo cambiar todo: se vuelve a mirar la barra de AHORA. */
function commitSigue(r: RefsConsola, ok: boolean): boolean {
  return ok && !r.desmontadoRef.current && barraDe(r).puedeCommit && !r.txEnCursoRef.current
}

async function hacerTx(
  p: Piezas,
  op: 'commit' | 'rollback',
  pedirConfirmacion: DialogosConsola['pedirConfirmacion']
): Promise<void> {
  const { r } = p
  if (r.txEnCursoRef.current) return
  const b = barraDe(r)
  if (op === 'commit' ? !b.puedeCommit : !b.puedeRollback) return
  // El ROLLBACK no pregunta: no escribe. El `await` de la pregunta va AQUÍ (no en una
  // función `async` aparte): la guarda se suelta y se vuelve a tomar en el mismo turno.
  let confirmado = false
  if (op === 'commit' && commitPideConfirmacion(r.conexionRef.current.entorno)) {
    r.txEnCursoRef.current = true
    let ok = false
    try {
      ok = await pedirConfirmacion(preguntaCommit(r))
    } finally {
      r.txEnCursoRef.current = false
    }
    if (!commitSigue(r, ok)) return
    confirmado = true
  }
  r.txEnCursoRef.current = true
  const t0 = performance.now()
  try {
    const res = await p.api
      .tx(p.perfilId, p.consolaId, op, confirmado || undefined, r.txInicialRef.current)
      .catch((err: unknown) => respuestaDeError<DbEstadoSesion>(err))
    p.despachar({ tipo: 'tx', op, respuesta: res, ms: performance.now() - t0, ahora: Date.now() })
  } finally {
    r.txEnCursoRef.current = false
  }
}

/** Modo de transacción, COMMIT y ROLLBACK de la barra. */
export function useTxConsola(n: NucleoConsola, dialogos: DialogosConsola) {
  const { r, api, perfilId, consolaId, despachar, salida } = n
  const { pedirConfirmacion, pedirResolucionTx } = dialogos
  const alternarModoTx = useCallback(
    (): Promise<void> => alternarModo({ r, api, perfilId, consolaId, despachar, salida }, pedirResolucionTx),
    [api, perfilId, consolaId, pedirResolucionTx, despachar, salida, r]
  )
  const hacer = useCallback(
    (op: 'commit' | 'rollback'): Promise<void> =>
      hacerTx({ r, api, perfilId, consolaId, despachar, salida }, op, pedirConfirmacion),
    [api, perfilId, consolaId, despachar, salida, pedirConfirmacion, r]
  )
  const commit = useCallback(() => void hacer('commit'), [hacer])
  const rollback = useCallback(() => void hacer('rollback'), [hacer])
  return { alternarModoTx, commit, rollback }
}

type PiezasEsquema = Piezas & Pick<NucleoConsola, 'setEsquemaElegido' | 'setCambiandoEsquema'>

/** Nunca con un lote en curso: el esquema cambiaría entre dos sentencias del mismo lote. */
async function fijarEsquema(p: PiezasEsquema, esquema: string | null): Promise<void> {
  const { r } = p
  if (r.cambiandoEsquemaRef.current || hayEjecucion(r.estadoRef.current) || r.desmontadoRef.current) return
  r.cambiandoEsquemaRef.current = true
  p.setCambiandoEsquema(true)
  try {
    // Fijar el esquema de una consola sin sesión la CREA: con el modo de la barra.
    const res = await p.api
      .esquemaConsola(p.perfilId, p.consolaId, esquema, r.txInicialRef.current)
      .catch((err: unknown) => respuestaDeError<DbEstadoSesion>(err))
    if (r.desmontadoRef.current) return
    if (res.ok) {
      p.setEsquemaElegido(esquema)
      r.esquemaElegidoRef.current = esquema
      p.despachar({ tipo: 'sesion', sesion: res.valor, ahora: Date.now() })
    } else {
      p.salida('error', `No se pudo cambiar el esquema: ${textoError(res.error)}`)
    }
  } finally {
    r.cambiandoEsquemaRef.current = false
    if (!r.desmontadoRef.current) p.setCambiandoEsquema(false)
  }
}

/** El selector de esquema de la barra. */
export function useElegirEsquema(n: NucleoConsola): (esquema: string | null) => Promise<void> {
  const { r, api, perfilId, consolaId, despachar, salida, setEsquemaElegido, setCambiandoEsquema } = n
  return useCallback(
    (esquema: string | null): Promise<void> =>
      fijarEsquema({ r, api, perfilId, consolaId, despachar, salida, setEsquemaElegido, setCambiandoEsquema }, esquema),
    [api, perfilId, consolaId, despachar, salida, r, setEsquemaElegido, setCambiandoEsquema]
  )
}
