// =============================================================================
// Un paso del lote de la consola de Redis: envía un comando, pregunta lo que el main devolvió
// sin enviar (peligroso y producción, de uno en uno) y pinta el resultado en el margen y en
// el registro. El renderer no clasifica comandos: manda el texto y decide el main. Sin
// React: lo llama `useEjecucionClaves`, que es quien tiene el bucle.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbKvResultado } from '../../../../../shared/db-claves-ipc'
import { etiquetaPosicion, textoCancelada, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola'
import { uuid, type EnCurso } from '../documentos/consolaComun'
import type { MarcasConsolaDocs } from '../documentos/monacoConsolaDocs'
import {
  CODIGO_SINTAXIS,
  agregarComando,
  baseTrasResultado,
  formatearRespuesta,
  lineaDeError,
  lineaNoEnviado,
  salidaCruda,
  terminarComando,
  textoCambioBase,
  textoMs,
  type ComandoConsola,
  type EstadoComando,
  type LineaRespuesta,
  type RegistroConsola,
  type TonoLinea
} from './consolaClaves'
import type { Confirmaciones } from './useEstadoConsolaClaves'

/** Largo del detalle de la respuesta en el hover del ✓. */
const MAX_HOVER = 120

/** Cómo termina un paso: seguir con el siguiente, parar (con o sin fallo) o salir sin tocar nada. */
export type ResultadoPaso = 'sigue' | 'para' | 'fallo' | 'salir'

type Enviar = (c: ComandoConsola, peticionId: string, conf: Confirmaciones) => Promise<DbRespuesta<DbKvResultado>>

/** Lo que el paso necesita del panel: callbacks y refs de lo que leen las esperas. */
export interface DepsLote {
  actualizarRegistro: (f: (r: RegistroConsola) => RegistroConsola) => void
  anotar: (n: { tono: TonoLinea; texto: string; accion?: AccionSalida }) => void
  enviar: Enviar
  confirmarRechazo: (c: ComandoConsola, error: DbErrorSql, conf: Confirmaciones) => Promise<boolean | null>
  cambiarEnCurso: (e: EnCurso | null) => void
  cambiarBase: (b: number) => void
  baseRef: React.MutableRefObject<number>
  desmontadoRef: React.MutableRefObject<boolean>
}

/** El lote que corre: sus marcas, sus comandos y su id. */
export interface LoteClaves {
  marcas: MarcasConsolaDocs
  comandos: ComandoConsola[]
  id: number
}

type FinComando = { estado: Exclude<EstadoComando, 'corriendo'>; ms: number | null; lineas: LineaRespuesta[]; ir?: IrAPosicion }

/** Marca como cancelados los comandos desde `k0` hasta el final. */
export function cancelarDesde(lote: LoteClaves, k0: number): void {
  for (let k = k0; k < lote.comandos.length; k++) lote.marcas.estado(k, 'cancelada')
}

/** El detalle del ✓ de un comando: la primera línea de su respuesta, recortada. */
function detalleHover(lineas: readonly LineaRespuesta[], ms: number): string {
  const primera = lineas[0]?.texto ?? ''
  const corta = primera.length > MAX_HOVER ? primera.slice(0, MAX_HOVER - 1) + '…' : primera
  const t = textoMs(ms)
  return corta ? `${corta} · ${t}` : t
}

function terminar(d: DepsLote, entrada: number, fin: FinComando): void {
  d.actualizarRegistro((r) => terminarComando(r, entrada, fin))
}

function pintarExito(d: DepsLote, lote: LoteClaves, i: number, entrada: number, c: ComandoConsola, res: DbKvResultado): void {
  const lineas = formatearRespuesta(res.respuesta, salidaCruda(c.texto))
  // Un error ANIDADO (el de un comando dentro de un EXEC) no para: el EXEC se ejecutó.
  lote.marcas.estado(i, 'ok', detalleHover(lineas, res.ms))
  terminar(d, entrada, { estado: 'ok', ms: res.ms, lineas })
  const nueva = baseTrasResultado(d.baseRef.current, res)
  if (nueva !== d.baseRef.current) {
    d.cambiarBase(nueva)
    d.anotar({ tono: 'tenue', texto: textoCambioBase(nueva) })
  }
}

function irAlError(lote: LoteClaves, i: number, c: ComandoConsola, error: DbErrorSql, posicion: number | null): IrAPosicion | undefined {
  if (posicion !== null) {
    const pos = lote.marcas.posicion(posicion)
    return {
      loteId: lote.id,
      sentencia: i,
      desplazamiento: Math.max(0, posicion - c.desde),
      etiqueta: etiquetaPosicion(pos ? { linea: pos.lineNumber, columna: pos.column } : null)
    }
  }
  return error.codigo === CODIGO_SINTAXIS ? { loteId: lote.id, sentencia: i, desplazamiento: 0, etiqueta: etiquetaPosicion(null) } : undefined
}

function pintarFallo(d: DepsLote, lote: LoteClaves, i: number, entrada: number, c: ComandoConsola, error: DbErrorSql): void {
  const linea = lineaDeError(error)
  const posicion = typeof error.posicion === 'number' ? error.posicion : null
  const codigo = error.codigo && !error.codigo.startsWith('TESSERA-') ? error.codigo : null
  lote.marcas.error(i, linea.texto, codigo, posicion)
  const ir = irAlError(lote, i, c, error, posicion)
  terminar(d, entrada, { estado: 'error', ms: null, lineas: [linea], ...(ir ? { ir } : {}) })
}

function pintarError(d: DepsLote, lote: LoteClaves, i: number, entrada: number, c: ComandoConsola, error: DbErrorSql, inicio: number): ResultadoPaso {
  let resultado: ResultadoPaso = 'para'
  if (error.motivo === 'cancelada') {
    const ms = Date.now() - inicio
    lote.marcas.estado(i, 'cancelada')
    terminar(d, entrada, { estado: 'cancelada', ms, lineas: [{ texto: textoCancelada(ms), tono: 'aviso' }] })
  } else {
    resultado = 'fallo'
    pintarFallo(d, lote, i, entrada, c, error)
  }
  cancelarDesde(lote, i + 1)
  return resultado
}

/** Abre la entrada del comando en el registro y devuelve su id (hace falta en el mismo tick). */
function abrirEntrada(d: DepsLote, c: ComandoConsola): number {
  let entrada = 0
  d.actualizarRegistro((r) => {
    const a = agregarComando(r, { base: d.baseRef.current, texto: c.texto }, Date.now())
    entrada = a.id
    return a.registro
  })
  return entrada
}

/** Ejecuta el comando `i` del lote y dice cómo sigue el bucle. */
export async function ejecutarComando(d: DepsLote, lote: LoteClaves, i: number): Promise<ResultadoPaso> {
  const c = lote.comandos[i]
  const total = lote.comandos.length
  let inicio = Date.now()
  let peticionId = uuid()
  d.cambiarEnCurso({ id: lote.id, total, indice: i, inicio, peticionId })
  lote.marcas.estado(i, 'corriendo')
  const entrada = abrirEntrada(d, c)
  const conf: Confirmaciones = { confirmado: false, confirmadoPeligroso: false }
  let r = await d.enviar(c, peticionId, conf)
  let rechazado = false
  // Peligroso y producción se preguntan de uno en uno (el main devuelve el primero que salta);
  // como mucho, dos vueltas.
  while (!r.ok && !d.desmontadoRef.current) {
    const decision = await d.confirmarRechazo(c, r.error, conf)
    if (decision === null) break
    if (!decision) {
      rechazado = true
      break
    }
    inicio = Date.now()
    peticionId = uuid()
    d.cambiarEnCurso({ id: lote.id, total, indice: i, inicio, peticionId })
    r = await d.enviar(c, peticionId, conf)
  }
  if (d.desmontadoRef.current) return 'salir'
  if (!r.ok && rechazado) {
    lote.marcas.estado(i, 'cancelada', 'No se envió')
    terminar(d, entrada, { estado: 'cancelada', ms: null, lineas: [lineaNoEnviado(r.error)] })
    cancelarDesde(lote, i + 1)
    return 'para'
  }
  if (!r.ok) return pintarError(d, lote, i, entrada, c, r.error, inicio)
  pintarExito(d, lote, i, entrada, c, r.valor)
  return 'sigue'
}
