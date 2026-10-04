// =============================================================================
// Un paso del lote de la consola de MongoDB: envía una sentencia, pregunta si el main la
// rechaza por producción, y pinta el resultado en el margen y en la Salida. El renderer no
// clasifica: una escritura en producción vuelve `motivo: 'produccion'` y se pregunta POR
// sentencia rechazada, con la misma confirmación de la consola SQL.
// Sin React: lo llama `useEjecucionDocs`, que es quien tiene el bucle.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { DbDocResultado } from '../../../../../shared/db-documentos-ipc'
import { confirmacionLoteProduccion, textoRechazoProduccion } from '../consola/produccionConsola'
import {
  etiquetaPosicion,
  textoCancelada,
  textoEco,
  textoError,
  type IrAPosicion,
  type NuevaEntrada
} from '../consola/salidaConsola'
import { textoResultadoDocs, verboSentencia, type SentenciaShell } from './consolaDocs'
import type { MarcasConsolaDocs } from './monacoConsolaDocs'
import { uuid, type EnCurso, type PeticionDialogo } from './consolaComun'

/** Cómo termina un paso: seguir con la siguiente, parar (con o sin fallo) o salir sin tocar nada. */
export type ResultadoPaso = 'sigue' | 'para' | 'fallo' | 'salir'

/** Lo que el paso necesita del panel: callbacks y refs de lo que leen las esperas. */
export interface DepsLote {
  anotar: (n: NuevaEntrada[]) => void
  enviar: (s: SentenciaShell, peticionId: string, confirmado: boolean) => Promise<DbRespuesta<DbDocResultado>>
  pedirConfirmacion: (d: PeticionDialogo) => Promise<boolean>
  aplicarResultado: (r: DbDocResultado) => void
  cambiarEnCurso: (e: EnCurso | null) => void
  irAlSalida: () => void
  baseRef: React.MutableRefObject<string | null>
  conexionRef: React.MutableRefObject<DbConnection>
  desmontadoRef: React.MutableRefObject<boolean>
}

/** El lote que corre: sus marcas, sus sentencias y su id. */
export interface LoteDocs {
  marcas: MarcasConsolaDocs
  sentencias: SentenciaShell[]
  id: number
}

/** Marca como canceladas las sentencias desde `k0` hasta el final. */
export function cancelarDesde(lote: LoteDocs, k0: number): void {
  for (let k = k0; k < lote.sentencias.length; k++) lote.marcas.estado(k, 'cancelada')
}

function tipoDeEntrada(res: DbDocResultado): 'afectadas' | 'filas' | 'info' {
  if (res.tipo === 'escritura') return 'afectadas'
  return res.tipo === 'documentos' ? 'filas' : 'info'
}

function pintarExito(d: DepsLote, lote: LoteDocs, i: number, res: DbDocResultado): void {
  lote.marcas.estado(i, 'ok', textoResultadoDocs(res))
  d.aplicarResultado(res)
  d.anotar([{ tipo: tipoDeEntrada(res), texto: textoResultadoDocs(res) }])
  // Los avisos del clasificador (JavaScript de servidor: `$where`, `$function`…).
  if (res.tipo !== 'base' && res.avisos) d.anotar(res.avisos.map((texto) => ({ tipo: 'aviso' as const, texto })))
}

function irAlError(lote: LoteDocs, i: number, s: SentenciaShell, posicion: number | null): IrAPosicion | undefined {
  if (posicion === null) return undefined
  const pos = lote.marcas.posicion(posicion)
  return {
    loteId: lote.id,
    sentencia: i,
    desplazamiento: Math.max(0, posicion - s.desde),
    etiqueta: etiquetaPosicion(pos ? { linea: pos.lineNumber, columna: pos.column } : null)
  }
}

function pintarFallo(d: DepsLote, lote: LoteDocs, i: number, s: SentenciaShell, error: DbErrorSql): void {
  const posicion = typeof error.posicion === 'number' ? error.posicion : null
  const mensaje = error.motivo === 'produccion' ? textoRechazoProduccion(error) : textoError(error)
  lote.marcas.error(i, mensaje, error.codigo ?? null, posicion)
  const ir = irAlError(lote, i, s, posicion)
  d.anotar([{ tipo: 'error', texto: mensaje, ...(ir ? { ir } : {}) }])
  d.irAlSalida()
}

function pintarError(d: DepsLote, lote: LoteDocs, i: number, s: SentenciaShell, error: DbErrorSql, inicio: number): ResultadoPaso {
  let resultado: ResultadoPaso = 'para'
  if (error.motivo === 'cancelada') {
    lote.marcas.estado(i, 'cancelada')
    d.anotar([{ tipo: 'aviso', texto: textoCancelada(Date.now() - inicio) }])
  } else {
    resultado = 'fallo'
    pintarFallo(d, lote, i, s, error)
  }
  cancelarDesde(lote, i + 1)
  return resultado
}

/** Pregunta con la MISMA confirmación que la consola SQL; el main es la segunda barrera. */
function confirmarProduccion(d: DepsLote, s: SentenciaShell): Promise<boolean> {
  const c = d.conexionRef.current
  const t = confirmacionLoteProduccion({ alias: c.alias, total: 1, escrituras: [{ indice: 0, verbo: verboSentencia(s.texto) }] })
  return d.pedirConfirmacion({ ...t, peligro: true })
}

/** Ejecuta la sentencia `i` del lote y dice cómo sigue el bucle. */
export async function ejecutarSentencia(d: DepsLote, lote: LoteDocs, i: number): Promise<ResultadoPaso> {
  const s = lote.sentencias[i]
  const total = lote.sentencias.length
  const inicio = Date.now()
  const peticionId = uuid()
  d.cambiarEnCurso({ id: lote.id, total, indice: i, inicio, peticionId })
  lote.marcas.estado(i, 'corriendo')
  d.anotar([{ tipo: 'eco', texto: textoEco(d.baseRef.current, s.texto) }])
  let r = await d.enviar(s, peticionId, false)
  if (!r.ok && r.error.motivo === 'produccion' && !d.desmontadoRef.current) {
    if (!(await confirmarProduccion(d, s))) {
      lote.marcas.estado(i, 'cancelada', 'No se envió')
      d.anotar([{ tipo: 'info', texto: textoRechazoProduccion(r.error) }])
      cancelarDesde(lote, i + 1)
      return 'para'
    }
    const otra = uuid()
    d.cambiarEnCurso({ id: lote.id, total, indice: i, inicio: Date.now(), peticionId: otra })
    r = await d.enviar(s, otra, true)
  }
  if (d.desmontadoRef.current) return 'salir'
  if (!r.ok) return pintarError(d, lote, i, s, r.error, inicio)
  pintarExito(d, lote, i, r.valor)
  return 'sigue'
}
