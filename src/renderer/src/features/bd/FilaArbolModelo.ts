// =============================================================================
// Lo que decide cómo se ve una fila del lateral de BD, en PURO: su tooltip (una TABLA por
// tipo de fila), sus clases (atenuada, inválida, producción, arrastre) y su sangría. Lo
// usa `FilaArbol.tsx`; se prueba con `node` (test-fila-arbol-modelo.mts): imports con
// extensión, sin JSX ni DOM.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { etiquetaAbrirNodo } from '../../util/atajos.ts'
import { ETIQUETA_TIPO_OBJETO } from './dbTabsModel.ts'
import { kindAbreTipo } from './arbolBd.ts'
import { esContenedorArbol, objetoInterno, textoSubtipo, tooltipAjena, tooltipConexion, type FilaArbol } from './filasArbolBd.ts'
import { etiquetaBaseClaves } from './arbolClaves.ts'
import { etiquetaTipo, ttlLegible } from './claves/visorClaves.ts'
import type { Plataforma } from '../../../../shared/plataforma'

type FilaDe<K extends FilaArbol['kind']> = Extract<FilaArbol, { kind: K }>

/** La conexión que se arrastra para reordenar y sobre cuál está. */
interface ArrastreFila {
  id: string
  sobre: string | null
}

/** «Doble clic para abrir» (o el acorde de la plataforma), con mayúscula inicial. */
export function pistaAbrirDe(plataforma: Plataforma): string {
  const acorde = etiquetaAbrirNodo(plataforma)
  return `${acorde.charAt(0).toUpperCase()}${acorde.slice(1)} para abrir`
}

function tooltipObjeto(fila: FilaDe<'objeto'>, pistaAbrir: string): string {
  const o = fila.objeto
  const lineas = [`${ETIQUETA_TIPO_OBJETO[o.tipo]} ${fila.esquema}.${o.nombre}${o.firma !== undefined ? `(${o.firma})` : ''}`]
  const sub = textoSubtipo(o)
  if (sub) lineas.push(sub)
  if (o.estado === 'invalido') lineas.push('Inválido: no compila')
  if (o.comentario) lineas.push(o.comentario)
  if (kindAbreTipo(o.tipo) !== null) lineas.push(pistaAbrir)
  return lineas.join('\n')
}

function tooltipColumna(fila: FilaDe<'columna'>): string {
  const col = fila.columna
  const lineas = [`${col.nombre} ${col.tipo}${col.nullable ? '' : ' NOT NULL'}`]
  if (col.porDefecto) lineas.push(`Por defecto: ${col.porDefecto}`)
  if (col.pk !== null) lineas.push(`Clave primaria (${col.pk})`)
  if (col.comentario) lineas.push(col.comentario)
  return lineas.join('\n')
}

/** Una clave: su nombre entero, su tipo y su TTL (el del SCAN: el visor da el de ahora). */
function tooltipKvClave(fila: FilaDe<'kv-clave'>, pistaAbrir: string): string {
  const k = fila.clave
  const ttl = k.ttlMs === null ? 'Sin caducidad' : `Caduca en ${ttlLegible(k.ttlMs)}`
  return `${fila.nombre}\n${etiquetaTipo(k.tipo, k.tipoServidor)} · ${ttl}\n${pistaAbrir}`
}

type Tooltip<K extends FilaArbol['kind']> = (fila: FilaDe<K>, pistaAbrir: string) => string | undefined

const TOOLTIP_POR_TIPO: { [K in FilaArbol['kind']]?: Tooltip<K> } = {
  conexion: (f) => tooltipConexion(f.conexion),
  ajena: (f) => tooltipAjena(f.ajena),
  objeto: tooltipObjeto,
  columna: tooltipColumna,
  consola: (f, pistaAbrir) => `${f.consola.rutaRelativa}\n${pistaAbrir}`,
  'kv-clave': tooltipKvClave,
  'kv-base': (f) => (f.patron !== '' ? `${etiquetaBaseClaves(f.indice)} · filtrada por ${f.patron}` : undefined),
  'kv-carpeta': (f) => `${f.prefijo}* · ${f.cuenta.toLocaleString('es-ES')} ${f.cuenta === 1 ? 'clave cargada' : 'claves cargadas'}`,
  'kv-mas': (f) => f.vista.nota ?? undefined,
  placeholder: (f) => (f.variante === 'error' ? f.mensaje : undefined)
}

/** El `title` de la fila, o undefined si no lleva. */
export function tooltipDeFila(fila: FilaArbol, pistaAbrir: string): string | undefined {
  const tooltip = TOOLTIP_POR_TIPO[fila.kind] as Tooltip<FilaArbol['kind']> | undefined
  return tooltip ? tooltip(fila as never, pistaAbrir) : undefined
}

function clasesObjeto(f: FilaDe<'objeto'>): string[] {
  const clases: string[] = []
  if (f.objeto.estado === 'invalido') clases.push('invalido')
  // Objetos internos del motor (sombra de fts5/rtree, `sqlite_*`): atenuados, como un
  // esquema del sistema.
  if (objetoInterno(f.objeto)) clases.push('atenuada')
  return clases
}

function clasesConexion(f: FilaDe<'conexion'>, arrastre: ArrastreFila | null): string[] {
  const clases: string[] = []
  // Producción: la fila entera va teñida de rojo, además de su franja.
  if (f.conexion.entorno === 'produccion') clases.push('db-fila-produccion')
  if (arrastre?.sobre === f.conexionId && arrastre.id !== f.conexionId) clases.push('drop-over')
  if (arrastre?.id === f.conexionId) clases.push('arrastrando')
  return clases
}

type Clases<K extends FilaArbol['kind']> = (fila: FilaDe<K>, arrastre: ArrastreFila | null) => string[]

const CLASES_POR_TIPO: { [K in FilaArbol['kind']]?: Clases<K> } = {
  placeholder: (f) => [f.variante === 'error' ? 'db-fila-error' : 'muted'],
  esquema: (f) => (f.sistema || f.pseudo ? ['atenuada'] : []),
  // Las bases del sistema (master, model, msdb, tempdb) y las sin acceso, igual.
  base: (f) => (f.sistema || !f.accesible ? ['atenuada'] : []),
  objeto: clasesObjeto,
  conexion: clasesConexion
}

/** Las clases de la fila: las comunes, `active` y las de su tipo, en ese orden. */
export function clasesDeFila(fila: FilaArbol, seleccionada: boolean, arrastre: ArrastreFila | null): string {
  const clases = ['tree-row', 'db-fila', `db-fila-${fila.kind}`]
  if (seleccionada) clases.push('active')
  const propias = CLASES_POR_TIPO[fila.kind] as Clases<FilaArbol['kind']> | undefined
  if (propias) clases.push(...propias(fila as never, arrastre))
  return clases.join(' ')
}

/** Sangría de la fila. Una hoja (también una ajena) deja el hueco del chevron. */
export function sangriaDeFila(fila: FilaArbol): number {
  const hoja = !esContenedorArbol(fila)
  return 8 + fila.depth * 12 + (hoja ? 14 : 0)
}
