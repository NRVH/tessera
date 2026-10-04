// =============================================================================
// Prueba de cómo se ve una fila del lateral de BD, en puro (node src/renderer/src/features/bd/test-fila-arbol-modelo.mts):
// el tooltip de cada tipo de fila (y los que no llevan), las clases en su orden (selección,
// atenuadas, inválida, producción, arrastre) con sus mitades negativas, la sangría de hojas
// y contenedores, y la pista «… para abrir» por plataforma.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================
import { clasesDeFila, pistaAbrirDe, sangriaDeFila, tooltipDeFila } from './FilaArbolModelo.ts'
import { tooltipAjena, tooltipConexion, type FilaArbol } from './filasArbolBd.ts'
import { etiquetaAbrirNodo } from '../../util/atajos.ts'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

/** Una fila con lo mínimo de su tipo: la prueba solo lee lo que el modelo mira. */
function fila(kind: string, resto: Record<string, unknown> = {}): FilaArbol {
  return { kind, key: `k-${kind}`, depth: 0, ...resto } as unknown as FilaArbol
}

const conexion: DbConnection = {
  id: 'C1',
  profileId: 'P',
  alias: 'ventas',
  motor: 'oracle',
  host: '10.0.0.1',
  port: 1521,
  database: 'ORCL',
  user: 'scott',
  tieneSecreto: true,
  readonly: false
}
const PISTA = 'Doble clic para abrir'

hr('(1) pista para abrir')
{
  const win = pistaAbrirDe('windows')
  const mac = pistaAbrirDe('mac')
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
  check('Windows: el acorde de la plataforma, con mayúscula', win === `${cap(etiquetaAbrirNodo('windows'))} para abrir` && win.startsWith('Doble clic'), win)
  check('Mac: el suyo', mac === `${cap(etiquetaAbrirNodo('mac'))} para abrir`, mac)
}

hr('(2) tooltips por tipo')
{
  const objeto = fila('objeto', {
    esquema: 'HR',
    objeto: { esquema: 'HR', nombre: 'SUMA', tipo: 'rutina', firma: 'a NUMBER', estado: 'invalido', comentario: 'suma dos' }
  })
  check('objeto: tipo, nombre con firma, inválido, comentario y la pista', tooltipDeFila(objeto, PISTA) === 'Rutina HR.SUMA(a NUMBER)\nInválido: no compila\nsuma dos\nDoble clic para abrir', j(tooltipDeFila(objeto, PISTA)))
  const secuencia = fila('objeto', { esquema: 'HR', objeto: { esquema: 'HR', nombre: 'S', tipo: 'secuencia' } })
  check('NEGATIVO: lo que no se abre no lleva la pista', tooltipDeFila(secuencia, PISTA) === 'Secuencia HR.S', j(tooltipDeFila(secuencia, PISTA)))
  const columna = fila('columna', { columna: { nombre: 'ID', tipo: 'NUMBER', nullable: false, porDefecto: '0', pk: 1, comentario: 'clave' } })
  check('columna: NOT NULL, por defecto, clave primaria y comentario', tooltipDeFila(columna, PISTA) === 'ID NUMBER NOT NULL\nPor defecto: 0\nClave primaria (1)\nclave', j(tooltipDeFila(columna, PISTA)))
  const consola = fila('consola', { consola: { rutaRelativa: 'consolas/a.sql' } })
  check('consola: su ruta y la pista', tooltipDeFila(consola, PISTA) === 'consolas/a.sql\nDoble clic para abrir', j(tooltipDeFila(consola, PISTA)))
  const clave = fila('kv-clave', { nombre: 'usuario:1', clave: { tipo: 'hash', ttlMs: null } })
  check('clave: nombre, tipo y sin caducidad', (tooltipDeFila(clave, PISTA) ?? '').startsWith('usuario:1\n') && (tooltipDeFila(clave, PISTA) ?? '').includes('Sin caducidad'), j(tooltipDeFila(clave, PISTA)))
  check('base de claves: solo con filtro', tooltipDeFila(fila('kv-base', { indice: 0, patron: '' }), PISTA) === undefined && (tooltipDeFila(fila('kv-base', { indice: 0, patron: 'u*' }), PISTA) ?? '').endsWith('· filtrada por u*'), 'ok')
  check('carpeta de claves: singular y plural', (tooltipDeFila(fila('kv-carpeta', { prefijo: 'u:', cuenta: 1 }), PISTA) ?? '').endsWith('1 clave cargada') && (tooltipDeFila(fila('kv-carpeta', { prefijo: 'u:', cuenta: 2 }), PISTA) ?? '').endsWith('2 claves cargadas'), 'ok')
  check('«Cargar más»: su nota, o nada', tooltipDeFila(fila('kv-mas', { vista: { nota: 'van 10' } }), PISTA) === 'van 10' && tooltipDeFila(fila('kv-mas', { vista: { nota: null } }), PISTA) === undefined, 'ok')
  check('error: su mensaje; cargando: nada', tooltipDeFila(fila('placeholder', { variante: 'error', mensaje: 'falló' }), PISTA) === 'falló' && tooltipDeFila(fila('placeholder', { variante: 'loading' }), PISTA) === undefined, 'ok')
  check('conexión y ajena: los de `filasArbolBd`', tooltipDeFila(fila('conexion', { conexion }), PISTA) === tooltipConexion(conexion), 'ok')
  const ajena = { id: 'X', alias: 'rara', motor: 'cassandra', profileId: 'P' } as unknown as DbConexionAjena
  check('ajena', tooltipDeFila(fila('ajena', { ajena }), PISTA) === tooltipAjena(ajena), 'ok')
  check('NEGATIVO: un esquema no lleva tooltip', tooltipDeFila(fila('esquema', { esquema: 'HR' }), PISTA) === undefined, 'ok')
}

hr('(3) clases y sangría')
{
  const con = fila('conexion', { conexionId: 'C1', conexion: { ...conexion, entorno: 'produccion' }, expandida: false })
  check('conexión de producción seleccionada, en su orden', clasesDeFila(con, true, null) === 'tree-row db-fila db-fila-conexion active db-fila-produccion', clasesDeFila(con, true, null))
  check('arrastrando otra sobre ella: drop-over', clasesDeFila(con, false, { id: 'C2', sobre: 'C1' }).endsWith('db-fila-produccion drop-over'), clasesDeFila(con, false, { id: 'C2', sobre: 'C1' }))
  check('NEGATIVO: sobre sí misma no es drop-over, es arrastrando', clasesDeFila(con, false, { id: 'C1', sobre: 'C1' }).endsWith('db-fila-produccion arrastrando'), clasesDeFila(con, false, { id: 'C1', sobre: 'C1' }))
  check('error y cargando', clasesDeFila(fila('placeholder', { variante: 'error' }), false, null).endsWith('db-fila-error') && clasesDeFila(fila('placeholder', { variante: 'loading' }), false, null).endsWith('muted'), 'ok')
  check('esquema del sistema o PUBLIC: atenuado', clasesDeFila(fila('esquema', { sistema: false, pseudo: true }), false, null).endsWith('atenuada'), 'ok')
  check('NEGATIVO: esquema normal, sin atenuar', clasesDeFila(fila('esquema', { sistema: false, pseudo: false }), false, null) === 'tree-row db-fila db-fila-esquema', 'ok')
  check('base sin acceso: atenuada', clasesDeFila(fila('base', { sistema: false, accesible: false }), false, null).endsWith('atenuada'), 'ok')
  const interno = fila('objeto', { objeto: { nombre: 't', tipo: 'tabla', estado: 'invalido', subtipo: 'sombra' } })
  check('objeto inválido e interno: las dos, en orden', clasesDeFila(interno, false, null).endsWith('db-fila-objeto invalido atenuada'), clasesDeFila(interno, false, null))
  check('sangría: contenedor en 0 = 8; hoja en 2 = 46; ajena = hoja', sangriaDeFila(con) === 8 && sangriaDeFila(fila('columna', { depth: 2 })) === 46 && sangriaDeFila(fila('ajena')) === 22, 'ok')
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
