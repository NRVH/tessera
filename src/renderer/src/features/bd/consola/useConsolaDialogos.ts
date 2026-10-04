// =============================================================================
// Diálogos de la consola SQL como promesas que contesta el pane: confirmar, resolver
// una transacción y pedir los valores de los parámetros del lote. Una pregunta cada
// vez: la segunda se da por cancelada en vez de apilar velos. Pieza de `useConsola`.
// =============================================================================

import { useCallback } from 'react'
import type { DbBinds, DbEstadoSesion, DbResolverTx } from '../../../../../shared/db-explorador-ipc'
import type { Sentencia } from '../../../../../shared/sql/divisorSql'
import {
  bindsPorSentencia,
  clavesSinValor,
  parametrosDeLote,
  recordarValores,
  sentenciasConParametros,
  textoDialogoParametros,
  valoresIniciales,
  type AccionParametros,
  type CampoParametro
} from './parametrosConsola'
import { contextoTxPendiente } from './produccionConsola'
import type { DialogoConsola, OpcionesCorrer } from './tiposConsola'
import type { NucleoConsola } from './useConsolaNucleo'

/** Texto de una confirmación (el pane la pinta con `ConfirmDialog`). */
export interface PreguntaConsola {
  titulo: string
  mensaje: string
  confirmar: string
  peligro: boolean
}

type BindsDelLote = ReadonlyArray<DbBinds | undefined>

/** Las preguntas que la consola puede hacer al usuario. */
export interface DialogosConsola {
  pedirConfirmacion: (d: PreguntaConsola) => Promise<boolean>
  pedirResolucionTx: (s: DbEstadoSesion | null, contexto: string) => Promise<DbResolverTx | null>
  /** Los binds de cada sentencia de `ss` (de `fuente`); null = canceló y no se ejecuta NADA. */
  bindsDelLote: (ss: readonly Sentencia[], fuente: string, accion: AccionParametros, o: OpcionesCorrer) => Promise<BindsDelLote | null>
}

type Piezas = Pick<NucleoConsola, 'r' | 'setDialogo'>

/** Abre un diálogo si no hay otro ni se desmontó el hook; si no, contesta `vacio` en el acto. */
function preguntar<T>({ r, setDialogo }: Piezas, vacio: T, armar: (cerrarCon: (v: T) => void) => DialogoConsola): Promise<T> {
  return new Promise<T>((resolve) => {
    if (r.dialogoRef.current || r.desmontadoRef.current) {
      resolve(vacio)
      return
    }
    const d = armar((v) => {
      r.dialogoRef.current = null
      setDialogo(null)
      resolve(v)
    })
    r.dialogoRef.current = d
    setDialogo(d)
  })
}

/** Los valores de los parámetros: los pide al usuario y recuerda lo usado para la próxima vez. */
function pedirParametros(
  p: Piezas,
  campos: CampoParametro[],
  sentencias: number,
  accion: AccionParametros,
  fijos?: DbBinds
): Promise<DbBinds | null> {
  const { r } = p
  return preguntar<DbBinds | null>(p, null, (cerrarCon) => ({
    tipo: 'parametros',
    campos,
    iniciales: valoresIniciales(campos, r.valoresParamRef.current, fijos),
    mensaje: textoDialogoParametros(sentencias, accion),
    accion,
    dialecto: r.estadoRef.current.dialecto,
    alias: r.conexionRef.current.alias,
    resolver: (binds) => {
      cerrarCon(binds)
      if (binds) r.valoresParamRef.current = recordarValores(r.valoresParamRef.current, binds)
    }
  }))
}

/** Si `fijos` ya cubre todos los parámetros no se pregunta; si no, el diálogo. */
async function bindsDe(
  p: Piezas,
  ss: readonly Sentencia[],
  fuente: string,
  accion: AccionParametros,
  o: OpcionesCorrer
): Promise<BindsDelLote | null> {
  const { r } = p
  if (o.binds) return o.binds
  const par = parametrosDeLote(fuente, ss, r.estadoRef.current.dialecto)
  if (par.campos.length === 0) return ss.map(() => undefined)
  let valores: DbBinds | null
  if (o.fijos && clavesSinValor(par, o.fijos).length === 0) {
    valores = o.fijos
    r.valoresParamRef.current = recordarValores(r.valoresParamRef.current, o.fijos)
  } else {
    valores = await pedirParametros(p, par.campos, sentenciasConParametros(par), accion, o.fijos)
  }
  if (!valores) return null
  return bindsPorSentencia(par, valores)
}

/** Las preguntas de la consola; el pane las contesta llamando a su `resolver`. */
export function useDialogosConsola(n: NucleoConsola): DialogosConsola {
  const { r, setDialogo } = n
  const pedirConfirmacion = useCallback(
    (d: PreguntaConsola): Promise<boolean> =>
      preguntar<boolean>({ r, setDialogo }, false, (cerrarCon) => ({ tipo: 'confirmar', ...d, resolver: cerrarCon })),
    [r, setDialogo]
  )
  const pedirResolucionTx = useCallback(
    (s: DbEstadoSesion | null, contexto: string): Promise<DbResolverTx | null> =>
      preguntar<DbResolverTx | null>({ r, setDialogo }, null, (cerrarCon) => {
        const tx = s ? s.tx : 'pendiente'
        const c = r.conexionRef.current
        return {
          tipo: 'tx',
          tx,
          sentencias: s ? s.sentenciasEnTx : 0,
          // En producción su «Confirmar (Commit)» es un COMMIT: el texto lo dice.
          contexto: contextoTxPendiente(contexto, { alias: c.alias, entorno: c.entorno, tx }),
          resolver: cerrarCon
        }
      }),
    [r, setDialogo]
  )
  const bindsDelLote = useCallback(
    (ss: readonly Sentencia[], fuente: string, accion: AccionParametros, o: OpcionesCorrer) =>
      bindsDe({ r, setDialogo }, ss, fuente, accion, o),
    [r, setDialogo]
  )
  return { pedirConfirmacion, pedirResolucionTx, bindsDelLote }
}
