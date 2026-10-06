#!/usr/bin/env node
// =============================================================================
// Prueba del registro de conexiones (`registroConexiones.ts` y `ConnectionStore.ts`): «lo que no
// entiendo, no lo toco», escrituras todo o nada, formato ajeno, archivo roto y `.bak`, borrado ceñido
// al perfil, validación por motor y los canales de `DbController` con un `ipc` de mentira.
// (node src/main/db/test-registro-conexiones.mts  ·  npm run test:db-registro)
// Usa el `ConnectionStore` real con un cifrado de mentira y un gancho que resuelve los imports sin
// extensión; cada sección se anuncia con su `hr(...)`.
// =============================================================================

import { register } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { esWindows, plataformaActual } from '../../shared/plataforma.ts'
import { DB_CHANNELS, olvidarEnPerfilTrasBorrar, type DbConexionBorrada, type DbConnection, type DbConnectionInput } from '../../shared/db-ipc.ts'
import type { Entrada, Registro } from './registroConexiones.ts'
import type { EntradaConexion } from './controlador/validacionConexion.ts'
// Puro y con extensiones explícitas: no necesita el gancho de abajo.
import { avisosDeDescartados, construirEntornoHost, registroParaDescartes } from './hostEnv.ts'
import { huellaDestino } from './huellaDestino.ts'
import { limpiarDestinoBd } from '../../shared/destinoBd.ts'
import { IDS_MOTORES, descriptor, esDeClaves } from '../../shared/motores/index.ts'

// Cifrado de mentira: «cifrar» es anteponer ENC:, y un blob sin ese prefijo es ilegible (como una
// contraseña DPAPI de otra máquina).
const cifradoFalso = {
  disponible: () => true,
  cifrar: (s: string) => Buffer.from('ENC:' + s, 'utf-8'),
  descifrar: (b: Buffer) => {
    const t = Buffer.from(b).toString('utf-8')
    if (!t.startsWith('ENC:')) throw new Error('ilegible')
    return t.slice(4)
  }
}
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { ConnectionStore: ConnectionStoreReal } = await import('./ConnectionStore.ts')
const { registrarIpcBd } = await import('./ipc.ts')
/** El registro real con el cifrado de mentira: así cada caso construye el store como siempre. */
class ConnectionStore extends ConnectionStoreReal {
  constructor(opciones: { storePath: string }) {
    super({ ...opciones, cifrado: cifradoFalso })
  }
}
const reg = await import('./registroConexiones.ts')
/** Sin ventana ni diálogos: `DbController` solo los usa para avisar y para abrir selectores. */
const eventosNulos = { emitir: () => {}, hayDestino: () => false }
const dialogosNulos = {} as never

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
/** Un FAIL y no un proceso caído: con el código de antes, `ajenas` ni existe. */
function intentar<T>(f: () => T): { ok: true; valor: T } | { ok: false; error: string } {
  try {
    return { ok: true, valor: f() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

type Crudo = Record<string, unknown>
type Doc = { version?: unknown; connections: unknown[]; [k: string]: unknown }

const dir = mkdtempSync(path.join(tmpdir(), 'tessera-registro-'))
let n = 0
/** Un registro nuevo en disco con ese contenido (objeto o texto tal cual). */
function archivo(contenido: unknown): string {
  const ruta = path.join(dir, `db-connections-${++n}.json`)
  writeFileSync(ruta, typeof contenido === 'string' ? contenido : JSON.stringify(contenido, null, 2))
  return ruta
}
const disco = (ruta: string): Doc => JSON.parse(readFileSync(ruta, 'utf-8'))
const de = (doc: Doc, id: string): Crudo | undefined =>
  doc.connections.find((c): c is Crudo => typeof c === 'object' && c !== null && (c as Crudo).id === id)
const ids = (doc: Doc): unknown[] => doc.connections.map((c) => (typeof c === 'object' && c !== null ? (c as Crudo).id : c))
const enc = (s: string): string => Buffer.from('ENC:' + s, 'utf-8').toString('base64')
/** El formulario tal como lo rellena la UI a partir del DTO (sin contraseña = conservar). */
function formDe(dto: DbConnection, cambios: Partial<DbConnectionInput> = {}): DbConnectionInput {
  return {
    profileId: dto.profileId,
    alias: dto.alias,
    motor: dto.motor,
    host: dto.host,
    port: dto.port,
    database: dto.database,
    sid: dto.sid,
    user: dto.user,
    readonly: dto.readonly,
    entorno: dto.entorno,
    notas: dto.notas,
    ...cambios
  }
}

// El escenario MEDIDO (sección 1).
const ORA = { id: 'ora-1', profileId: 'p1', alias: 'ORA-QA', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'ADM', readonly: true, orden: 0, secretEnc: enc('pw'), colorFuturo: '#c0392b' }
const LITE = { id: 'lite-1', profileId: 'p1', alias: 'Local SQLite', motor: 'sqlite', ruta: 'C:/datos/app.db', readonly: true, orden: 1 }
const PG = { id: 'pg-1', profileId: 'p1', alias: 'PG-STG', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', user: 'u', readonly: true, entorno: 'staging', orden: 2 }
const MSSQL = { id: 'mssql-1', profileId: 'p1', alias: 'SQLSRV', motor: 'mysql', host: '127.0.0.1', port: 1433, database: 'master', user: 'sa', readonly: true, orden: 3, instancia: 'SQLEXPRESS' }
const MEDIDO = { version: 2, connections: [ORA, LITE, PG, MSSQL] }

hr('(1) El fallo medido, invertido: la primera escritura ya no borra nada')
{
  const ruta = archivo(MEDIDO)
  const store = new ConnectionStore({ storePath: ruta })
  const lista = store.list('p1')
  check('list solo devuelve las que entiende (Oracle y PG)', JSON.stringify(lista.map((c) => c.id)) === '["ora-1","pg-1"]', JSON.stringify(lista.map((c) => c.id)))
  const ora = lista.find((c) => c.id === 'ora-1') as unknown as Crudo | undefined
  const pg = lista.find((c) => c.id === 'pg-1')
  check(
    'NEGATIVO: el DTO no enseña el campo futuro ni el entorno que no entiende',
    ora !== undefined && !('colorFuturo' in ora) && pg !== undefined && pg.entorno === undefined,
    JSON.stringify({ ora: Object.keys(ora ?? {}), pgEntorno: pg?.entorno })
  )
  const aj = intentar(() => (store as unknown as { ajenas(p: string): unknown[] }).ajenas('p1'))
  check(
    'ajenas(p1) enseña la SQLite y la SQL Server con su alias y su motor',
    aj.ok &&
      JSON.stringify(aj.valor) ===
        JSON.stringify([
          { id: 'lite-1', profileId: 'p1', alias: 'Local SQLite', motor: 'sqlite' },
          { id: 'mssql-1', profileId: 'p1', alias: 'SQLSRV', motor: 'mysql' }
        ]),
    aj.ok ? JSON.stringify(aj.valor) : aj.error
  )
  check('el disco sigue intacto antes de escribir', JSON.stringify(disco(ruta)) === JSON.stringify(MEDIDO), 'igual')

  const escribio = store.marcarVerificada('ora-1', null, 1700000000000)
  const d = disco(ruta)
  check('marcarVerificada (la escritura rutinaria del explorador) escribe', escribio === true, String(escribio))
  check('tras marcarVerificada, la SQLite y la SQL Server siguen, TAL CUAL', JSON.stringify(de(d, 'lite-1')) === JSON.stringify(LITE) && JSON.stringify(de(d, 'mssql-1')) === JSON.stringify(MSSQL), JSON.stringify(ids(d)))
  check('y en su sitio (el orden del archivo se conserva)', JSON.stringify(ids(d)) === '["ora-1","lite-1","pg-1","mssql-1"]', JSON.stringify(ids(d)))
  check('version NO baja (sigue en 2)', d.version === 2, String(d.version))
  check("la PG conserva entorno:'staging' en disco", de(d, 'pg-1')?.entorno === 'staging', JSON.stringify(de(d, 'pg-1')))
  check('la Oracle conserva su campo futuro', de(d, 'ora-1')?.colorFuturo === '#c0392b', JSON.stringify(de(d, 'ora-1')))

  const dto = store.get('ora-1')!
  store.update('ora-1', formDe(dto, { alias: 'ORA-QA2' }))
  const d2 = disco(ruta)
  check('update desde el formulario conserva el campo futuro', de(d2, 'ora-1')?.colorFuturo === '#c0392b' && de(d2, 'ora-1')?.alias === 'ORA-QA2', JSON.stringify(de(d2, 'ora-1')))
  check('update tampoco toca las ajenas ni baja la versión', !!de(d2, 'lite-1') && !!de(d2, 'mssql-1') && d2.version === 2, JSON.stringify(ids(d2)))

  store.setDriver('ora-1', 'oracle-ic-19')
  store.reorder('p1', ['pg-1', 'ora-1'])
  const bak = existsSync(ruta + '.bak') ? disco(ruta + '.bak') : { connections: [] }
  check('tras setDriver y reorder, el .bak TAMBIÉN las conserva', !!de(bak, 'lite-1') && !!de(bak, 'mssql-1'), JSON.stringify(ids(bak)))
  const d3 = disco(ruta)
  check('reorder no toca el orden de las ajenas', de(d3, 'lite-1')?.orden === 1 && de(d3, 'mssql-1')?.orden === 3 && de(d3, 'pg-1')?.orden === 0, JSON.stringify(d3.connections.map((c) => [(c as Crudo).id, (c as Crudo).orden])))

  // 'mysql' sirve de ejemplo de un motor que el registro no conoce.
  const cr = intentar(() => store.create({ profileId: 'p1', alias: 'nueva', motor: 'mysql' as never, host: 'x', port: 1, user: 'u', readonly: true }))
  check('crear una de motor mysql sigue fallando con «Motor desconocido»', !cr.ok && cr.error.includes('Motor desconocido'), cr.ok ? 'creó' : cr.error)

  const otra = new ConnectionStore({ storePath: ruta })
  check(
    'un store nuevo sobre el mismo archivo ve lo mismo (ida y vuelta)',
    JSON.stringify(otra.list('p1')) === JSON.stringify(store.list('p1')) && JSON.stringify(otra.ajenas('p1')) === JSON.stringify(store.ajenas('p1')),
    JSON.stringify(otra.ajenas('p1').map((a) => a.id))
  )
}

hr('(2) El store con ajenas: borrar, podar, dar de alta, secretos')
{
  const K1 = { id: 'b-k1', profileId: 'p1', alias: 'Uno', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true, orden: 0 }
  const A1 = { id: 'b-a1', profileId: 'p1', alias: 'Alta', motor: 'sqlite', ruta: 'x.db', orden: 7, secretEnc: enc('secreto-ajeno') }
  const K2 = { id: 'b-k2', profileId: 'p2', alias: 'DeP2', motor: 'oracle', host: 'h', port: 1521, sid: 'S', user: 'u', readonly: true }
  const A2 = { id: 'b-a2', profileId: 'p2', alias: 'SqliteP2', motor: 'sqlite', ruta: 'y.db' }
  const HUERFANA = { id: 'b-sinperfil', alias: 'huérfana', motor: 'sqlite' }
  const A3 = { id: 'b-a3', profileId: 'p1', motor: 42 }
  const K3 = { id: 'b-k3', profileId: 'p1', alias: 'Puerto texto', motor: 'oracle', host: 'h', port: '1521', sid: 'S', user: 'u' }
  const ruta = archivo({ version: 2, grupos: [{ nombre: 'Ventas', ids: ['b-a1'] }], connections: [K1, A1, K2, A2, null, 'basura', HUERFANA, A3, K3] })
  const store = new ConnectionStore({ storePath: ruta })

  check('list(p1): solo la conocida (una forma que no se reconoce también es ajena)', JSON.stringify(store.list('p1').map((c) => c.id)) === '["b-k1"]', JSON.stringify(store.list('p1').map((c) => c.id)))
  const aj = store.ajenas('p1')
  check(
    'ajenas(p1): por su orden y luego alias; alias y motor ilegibles caen al id y a «desconocido»',
    JSON.stringify(aj) ===
      JSON.stringify([
        { id: 'b-a1', profileId: 'p1', alias: 'Alta', motor: 'sqlite' },
        { id: 'b-a3', profileId: 'p1', alias: 'b-a3', motor: 'desconocido' },
        { id: 'b-k3', profileId: 'p1', alias: 'Puerto texto', motor: 'oracle' }
      ]),
    JSON.stringify(aj)
  )
  check('NEGATIVO: las de otro perfil no salen en ajenas(p1)', !aj.some((a) => a.id === 'b-a2'), JSON.stringify(store.ajenas('p2')))

  const antes = readFileSync(ruta, 'utf-8')
  check('NEGATIVO: get() no ve una ajena', store.get('b-a1') === undefined, 'undefined')
  check('NEGATIVO: el secreto de una ajena no se sirve (ni a secretOf ni al pty)', store.secretOf('b-a1') === null && !store.secretsForProfile('p1').some((s) => s.id === 'b-a1'), JSON.stringify(store.secretsForProfile('p1')))
  check('NEGATIVO: marcarVerificada sobre una ajena no escribe', store.marcarVerificada('b-a1', null) === false, 'false')
  store.setDriver('b-a1', 'x')
  const up = intentar(() => store.update('b-a1', { profileId: 'p1', alias: 'Alta', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }))
  check('NEGATIVO: una ajena no se edita («desconocida»)', !up.ok && up.error.includes('Conexión desconocida'), up.ok ? 'editó' : up.error)
  const esq = intentar(() => store.setEsquemasVisibles('b-a1', { modo: 'todos' }))
  check('NEGATIVO: ni se le fijan esquemas', !esq.ok, esq.ok ? 'fijó' : esq.error)
  check('y nada de eso tocó el disco', readFileSync(ruta, 'utf-8') === antes, 'igual')

  const choque = intentar(() => store.create({ profileId: 'p1', alias: '  alta ', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }))
  check('el alias de una ajena también choca (tdb la ve y la UI la enseña)', !choque.ok && choque.error.includes('ya tiene una conexión llamada "Alta"'), choque.ok ? 'creó' : choque.error)
  const nueva = store.create({ profileId: 'p1', alias: 'Nueva', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true })
  const d = disco(ruta)
  check('una nueva nace DETRÁS de todas, ajenas incluidas (orden 8 y no 1)', de(d, nueva.id)?.orden === 8, String(de(d, nueva.id)?.orden))
  check('y al final del archivo, sin mover a nadie', ids(d)[ids(d).length - 1] === nueva.id && JSON.stringify(ids(d).slice(0, -1)) === JSON.stringify(['b-k1', 'b-a1', 'b-k2', 'b-a2', null, 'basura', 'b-sinperfil', 'b-a3', 'b-k3']), JSON.stringify(ids(d)))
  check('la raíz ajena (grupos) sobrevive a la escritura', JSON.stringify(d.grupos) === JSON.stringify([{ nombre: 'Ventas', ids: ['b-a1'] }]), JSON.stringify(d.grupos))

  store.pruneProfiles(new Set(['p1']))
  const dp = disco(ruta)
  check('pruneProfiles poda también las AJENAS del perfil borrado', !de(dp, 'b-a2') && !de(dp, 'b-k2'), JSON.stringify(ids(dp)))
  check(
    'NEGATIVO: y conserva lo que no es de nadie que se sepa (null, basura, sin perfil)',
    dp.connections.includes(null) && dp.connections.includes('basura') && !!de(dp, 'b-sinperfil'),
    JSON.stringify(ids(dp))
  )

  const r = intentar(() => store.remove('b-a3'))
  check('remove borra una ajena y devuelve su perfil', r.ok && r.valor === 'p1' && !de(disco(ruta), 'b-a3') && !store.ajenas('p1').some((a) => a.id === 'b-a3'), r.ok ? String(r.valor) : r.error)
  const trasBorrar = readFileSync(ruta, 'utf-8')
  const r2 = store.remove('no-existe')
  check('NEGATIVO: borrar un id que no existe devuelve null y no escribe', r2 === null && readFileSync(ruta, 'utf-8') === trasBorrar, String(r2))
  check('remove de una conocida devuelve su perfil, como siempre', store.remove('b-k1') === 'p1' && !de(disco(ruta), 'b-k1'), 'p1')
}

hr('(3) Valores gobernados que no se entienden, y lo que SÍ se gobierna')
{
  const OPACA = {
    id: 'c-o1', profileId: 'p1', alias: 'Opaca', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'ADM', readonly: true, orden: 0,
    secretEnc: enc('pw'), verificadaEn: 1700000000000,
    entorno: 'staging', esquemas: { modo: 'patron', patron: 'V%' }, introspeccion: { totalEsquemas: 'muchos' }
  }
  const MOTOR = { id: 'c-o3', profileId: 'p1', alias: 'CambiaMotor', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'ADM', readonly: true, esquemas: { modo: 'patron', patron: 'V%' } }
  const ILEGIBLE = { id: 'c-o2', profileId: 'p1', alias: 'SinSecreto', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true, secretoIlegible: true }
  // Con `__proto__` como clave PROPIA (así lo crea JSON.parse): asignada clave a clave
  // cambiaría el prototipo en vez de guardarse, y no volvería al disco.
  const GOB = JSON.parse(
    '{"id":"c-o4","profileId":"p1","alias":"Gobernada","motor":"postgres","host":"h","port":5432,"database":"d","user":"u","readonly":true,' +
      `"secretEnc":"${enc('pw')}","verificadaEn":1,"notas":"n","entorno":"produccion","__proto__":{"clave":"futura"}}`
  ) as Crudo
  const ruta = archivo({ version: 1, connections: [OPACA, MOTOR, ILEGIBLE, GOB] })
  const store = new ConnectionStore({ storePath: ruta })

  const dto = store.get('c-o1')!
  check(
    'el DTO no enseña un entorno, unos esquemas ni una introspección que no entiende',
    dto.entorno === undefined && dto.esquemas === undefined && dto.introspeccion === undefined && dto.tieneSecreto && dto.verificada === true,
    JSON.stringify(dto)
  )
  const dtoIlegible = store.get('c-o2')! as unknown as Crudo
  check('NEGATIVO: un `secretoIlegible` escrito en disco no llega al DTO como si fuera nuestro', !('secretoIlegible' in dtoIlegible), JSON.stringify(dtoIlegible))

  store.marcarVerificada('c-o1', 'oracle-ic-19')
  let o1 = de(disco(ruta), 'c-o1')!
  check(
    'una escritura rutinaria los conserva en disco tal cual',
    o1.entorno === 'staging' && JSON.stringify(o1.esquemas) === JSON.stringify(OPACA.esquemas) && JSON.stringify(o1.introspeccion) === JSON.stringify(OPACA.introspeccion),
    JSON.stringify(o1)
  )
  check('y el `secretoIlegible` ajeno sigue en su registro', de(disco(ruta), 'c-o2')?.secretoIlegible === true, JSON.stringify(de(disco(ruta), 'c-o2')))

  store.update('c-o1', formDe(store.get('c-o1')!, { alias: 'Opaca2' }))
  o1 = de(disco(ruta), 'c-o1')!
  check(
    'update sin tocarlos (el formulario no trae entorno): se conservan los tres, y la verificación',
    o1.entorno === 'staging' && JSON.stringify(o1.esquemas) === JSON.stringify(OPACA.esquemas) && JSON.stringify(o1.introspeccion) === JSON.stringify(OPACA.introspeccion) && o1.verificadaEn === 1700000000000,
    JSON.stringify(o1)
  )
  store.update('c-o1', formDe(store.get('c-o1')!, { user: 'OTRO' }))
  o1 = de(disco(ruta), 'c-o1')!
  check(
    'cambiar el usuario retira la introspección que no entiende (regla de siempre), y conserva esquemas y entorno',
    !('introspeccion' in o1) && JSON.stringify(o1.esquemas) === JSON.stringify(OPACA.esquemas) && o1.entorno === 'staging',
    JSON.stringify(o1)
  )
  store.update('c-o1', formDe(store.get('c-o1')!, { entorno: 'pruebas' }))
  check('elegir un entorno conocido lo sustituye', de(disco(ruta), 'c-o1')?.entorno === 'pruebas' && store.get('c-o1')?.entorno === 'pruebas', String(de(disco(ruta), 'c-o1')?.entorno))
  store.update('c-o1', formDe(store.get('c-o1')!, { entorno: undefined }))
  check('NEGATIVO: y quitarlo después deja «sin entorno»: el \'staging\' NO resucita', !('entorno' in de(disco(ruta), 'c-o1')!), JSON.stringify(de(disco(ruta), 'c-o1')))
  store.setEsquemasVisibles('c-o1', { modo: 'todos' })
  check('fijar esquemas entendidos sustituye a los que no se entendían', JSON.stringify(de(disco(ruta), 'c-o1')?.esquemas) === '{"modo":"todos"}' && store.get('c-o1')?.esquemas?.modo === 'todos', JSON.stringify(de(disco(ruta), 'c-o1')?.esquemas))
  store.setIntrospeccion('c-o1', { totalEsquemas: 3, esquemaPorDefecto: 'ADM', en: 5 })
  check('y el main refresca la introspección con una entendida', JSON.stringify(de(disco(ruta), 'c-o1')?.introspeccion) === '{"totalEsquemas":3,"esquemaPorDefecto":"ADM","en":5}', JSON.stringify(de(disco(ruta), 'c-o1')?.introspeccion))

  store.update('c-o3', formDe(store.get('c-o3')!, { motor: 'postgres', port: 5432, database: 'app' }))
  check('cambiar el motor retira unos esquemas que no entiende (regla de siempre)', !('esquemas' in de(disco(ruta), 'c-o3')!), JSON.stringify(de(disco(ruta), 'c-o3')))
  const o3Mismo = { ...MOTOR, id: 'c-o5', alias: 'MismoMotor' }
  const ruta2 = archivo({ connections: [o3Mismo] })
  const store2 = new ConnectionStore({ storePath: ruta2 })
  store2.update('c-o5', formDe(store2.get('c-o5')!, { host: 'primario.lan' }))
  check('con el mismo motor se conservan aunque cambie el servidor', JSON.stringify(de(disco(ruta2), 'c-o5')?.esquemas) === JSON.stringify(MOTOR.esquemas), JSON.stringify(de(disco(ruta2), 'c-o5')))

  // NEGATIVO del lado contrario: lo que esta versión GOBIERNA se puede quitar de verdad.
  // Conservar "lo que había en disco" a ciegas haría que una contraseña borrada, una
  // verificación retirada o unas notas vaciadas volvieran desde el crudo.
  store.setVerificada('c-o4', false)
  check('NEGATIVO: retirar la verificación la quita del disco', !('verificadaEn' in de(disco(ruta), 'c-o4')!), JSON.stringify(de(disco(ruta), 'c-o4')))
  store.update('c-o4', { ...formDe(store.get('c-o4')!, { notas: '', entorno: undefined }), password: '' })
  const o4 = de(disco(ruta), 'c-o4')!
  check('NEGATIVO: borrar la contraseña, vaciar las notas y quitar un entorno conocido los quitan del disco', !('secretEnc' in o4) && !('notas' in o4) && !('entorno' in o4), JSON.stringify(o4))
  const proto = Object.getOwnPropertyDescriptor(o4, '__proto__')?.value as Crudo | undefined
  check('una clave futura llamada `__proto__` sobrevive a update como clave propia', proto?.clave === 'futura', JSON.stringify(proto))
  const dtoGob = store.get('c-o4')!
  check('NEGATIVO: y no llega al DTO', !Object.prototype.hasOwnProperty.call(dtoGob, '__proto__') && Object.getPrototypeOf(dtoGob) === Object.prototype, Object.keys(dtoGob).join(','))
}

hr('(4) Formato ajeno, BOM y .bak')
{
  const texto = JSON.stringify({ version: 3, connections: { 'x-1': { alias: 'Futura', motor: 'duckdb' } } }, null, 2)
  const ruta = archivo(texto)
  const store = new ConnectionStore({ storePath: ruta })
  check('`connections` que no es lista: no hay nada que listar', store.list('p1').length === 0 && store.ajenas('p1').length === 0, 'vacío')
  // la lista vacía era la ÚNICA señal, y la poda de montajes del
  // arranque la tomaba por «el perfil no tiene conexiones» y desmontaba las bases de
  // todos los proyectos. El store lo dice aparte, para quien cuenta con esa lista.
  check('y el store lo DICE (`formatoAjeno`): la lista vacía no es «no hay conexiones»', store.formatoAjeno === true, String(store.formatoAjeno))
  const cr = intentar(() => store.create({ profileId: 'p1', alias: 'Nueva', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }))
  check('dar de alta falla diciendo por qué (versión más nueva), en vez de destruir el archivo', !cr.ok && cr.error.includes('versión más nueva de Tessera'), cr.ok ? 'creó' : cr.error)
  check('NEGATIVO: la alta fallida no queda viva en memoria', store.list('p1').length === 0, JSON.stringify(store.list('p1').map((c) => c.alias)))
  store.pruneProfiles(new Set())
  check('y el archivo sigue byte a byte (ni la alta ni la poda lo tocaron)', readFileSync(ruta, 'utf-8') === texto, 'igual')

  const conBom = archivo('\uFEFF' + JSON.stringify({ connections: [{ ...ORA, id: 'bom-1', alias: 'DEL-PRIMARIO' }] }))
  writeFileSync(conBom + '.bak', JSON.stringify({ connections: [{ ...ORA, id: 'bom-1', alias: 'DEL-BAK' }] }))
  const sb = new ConnectionStore({ storePath: conBom })
  check('un primario con BOM (Bloc de notas) se lee, no se cambia por el .bak', sb.list('p1')[0]?.alias === 'DEL-PRIMARIO', String(sb.list('p1')[0]?.alias))

  const corrupto = archivo('{ esto no es JSON')
  writeFileSync(corrupto + '.bak', JSON.stringify({ connections: [{ ...ORA, id: 'bak-1', alias: 'RESCATADA' }] }))
  const sc = new ConnectionStore({ storePath: corrupto })
  check('un primario corrupto recurre al .bak (criterio de siempre)', sc.list('p1')[0]?.alias === 'RESCATADA', String(sc.list('p1')[0]?.alias))

  // Un JSON LEGIBLE cuya raíz no es
  // un objeto —una lista CON entradas— o con una `version` que no es un número se leía
  // como registro VACÍO y escribible, así que la primera alta sobrescribía el archivo
  // entero con `{ version: 1, connections: [nueva] }`: todo lo de dentro, perdido, y la
  // versión bajada. Con el código de antes, las cuatro primeras dan FAIL.
  const ALTA = { profileId: 'p1', alias: 'Nueva', motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }
  for (const [que, contenido] of [
    ['una raíz que es una LISTA con entradas', JSON.stringify([ORA, PG], null, 2)],
    ['una `version` que no es un número ("2")', JSON.stringify({ version: '2', connections: [ORA, PG] }, null, 2)]
  ] as const) {
    const r = archivo(contenido)
    const s = new ConnectionStore({ storePath: r })
    const alta = intentar(() => s.create(ALTA))
    check(
      `${que}: dar de alta falla diciendo por qué (versión más nueva o edición a mano)`,
      !alta.ok && alta.error.includes('versión más nueva de Tessera') && alta.error.includes('a mano'),
      alta.ok ? 'CREÓ' : alta.error
    )
    check(`${que}: y el archivo sigue byte a byte`, readFileSync(r, 'utf-8') === contenido, readFileSync(r, 'utf-8').slice(0, 120))
    check(`${que}: no se lista nada (no se sabe qué forma tienen sus entradas)`, s.list('p1').length === 0 && s.ajenas('p1').length === 0, JSON.stringify(s.list('p1').map((c) => c.id)))
    check(`${que}: y el store lo dice (\`formatoAjeno\`)`, s.formatoAjeno === true, String(s.formatoAjeno))
  }
  // NEGATIVO: un registro que sí se lee —con BOM, rescatado del .bak, o vacío a mano— no
  // se anuncia como ajeno (quien lo consulta dejaría de podar lo que sí es basura).
  const vacioAMano = new ConnectionStore({ storePath: archivo('[]') })
  check(
    'NEGATIVO: `formatoAjeno` es false en lo que sí se lee (BOM, .bak, `[]`)',
    sb.formatoAjeno === false && sc.formatoAjeno === false && vacioAMano.formatoAjeno === false,
    JSON.stringify([sb.formatoAjeno, sc.formatoAjeno, vacioAMano.formatoAjeno])
  )

  // EL CONTRATO DE `LIST_COMPLETA`: la marca tiene que LLEGAR al
  // renderer, con el aviso que enseña. Sin ella, la poda de arranque desmontaba las bases
  // de todos los proyectos y la UI decía «Sin conexiones». `listaCompleta` es lo que
  // responde el handler, tal cual.
  const futuro = new ConnectionStore({ storePath: archivo(JSON.stringify({ version: '2', connections: [ORA, PG] })) })
  const lc = futuro.listaCompleta('p1')
  check(
    'listaCompleta con formato ajeno: listas vacías, `formatoAjeno: true` y el aviso del main',
    lc.formatoAjeno === true && lc.aviso === reg.MENSAJE_FORMATO_AJENO && lc.conexiones.length === 0 && lc.ajenas.length === 0,
    JSON.stringify(lc)
  )
  check(
    'el aviso nombra el archivo y los DOS orígenes (versión más nueva y edición a mano)',
    reg.MENSAJE_FORMATO_AJENO.includes('db-connections.json') &&
      reg.MENSAJE_FORMATO_AJENO.includes('versión más nueva') &&
      reg.MENSAJE_FORMATO_AJENO.includes('a mano'),
    reg.MENSAJE_FORMATO_AJENO
  )
  // Y QUÉ HACER tras corregirlo a mano: el store lee
  // el registro UNA vez, al construirse, así que el arreglo no se ve hasta reiniciar, y el
  // aviso tiene que decirlo o quien arregla el archivo cree que no sirvió. La premisa se
  // fija aquí: si algún día el store relee el archivo, esta comprobación falla y el
  // mensaje tiene que dejar de pedir el reinicio.
  const rutaFuturo = archivo(JSON.stringify({ version: '2', connections: [ORA] }))
  const leidoUnaVez = new ConnectionStore({ storePath: rutaFuturo })
  writeFileSync(rutaFuturo, JSON.stringify({ version: 1, connections: [ORA] }))
  check(
    'premisa: el store no relee el archivo corregido (sigue con el formato ajeno hasta reiniciar)',
    leidoUnaVez.formatoAjeno === true && leidoUnaVez.list('p1').length === 0,
    JSON.stringify(leidoUnaVez.listaCompleta('p1'))
  )
  check(
    'por eso el aviso manda a corregirlo y REINICIAR Tessera',
    reg.MENSAJE_FORMATO_AJENO.includes('corrígelo') && reg.MENSAJE_FORMATO_AJENO.includes('reinicia Tessera'),
    reg.MENSAJE_FORMATO_AJENO
  )
  const lcBien = sc.listaCompleta('p1')
  check(
    'NEGATIVO: listaCompleta de un registro que sí se lee: `formatoAjeno: false`, sin aviso, y sus conexiones',
    lcBien.formatoAjeno === false && lcBien.aviso === undefined && lcBien.conexiones.map((c) => c.alias).join() === 'RESCATADA',
    JSON.stringify({ formatoAjeno: lcBien.formatoAjeno, aviso: lcBien.aviso, alias: lcBien.conexiones.map((c) => c.alias) })
  )

  // Un archivo de CERO bytes no es JSON: cuenta como ilegible, igual que uno corrupto,
  // y el store recurre al .bak. Es la decisión escrita en `leerRegistro`: cero bytes
  // puede ser una edición a mano o una escritura truncada por otro programa, y de las dos
  // lecturas se elige la que no pierde nada (resucitar desde el .bak se deshace borrando;
  // lo contrario no se deshace).
  const cero = archivo('')
  writeFileSync(cero + '.bak', JSON.stringify({ connections: [{ ...ORA, id: 'cero-1', alias: 'DEL-BAK' }] }))
  check('un primario de CERO bytes cuenta como ilegible: recurre al .bak', new ConnectionStore({ storePath: cero }).list('p1')[0]?.alias === 'DEL-BAK', 'DEL-BAK')
  const ceroSolo = archivo('')
  const altaCero = intentar(() => new ConnectionStore({ storePath: ceroSolo }).create(ALTA))
  check('y sin .bak, vacío y escribible (no hay nada que perder)', altaCero.ok && disco(ceroSolo).connections.length === 1, altaCero.ok ? 'creó' : altaCero.error)
}

hr('(5) El módulo puro')
{
  const texto = JSON.stringify(MEDIDO, null, 2)
  const r = reg.leerRegistro(texto)!
  check('leerRegistro separa conocidas y ajenas en su orden', r.entradas.map((e) => e.tipo).join(',') === 'conocida,ajena,conocida,ajena' && r.version === 2, r.entradas.map((e) => e.tipo).join(','))
  // El VALOR, no el orden de las claves DENTRO de una conocida: lo que esta versión no
  // entiende va detrás de lo que sí (el 'staging' de la PG pasa al final), y a ningún
  // lector de JSON le importa. Las AJENAS sí salen con sus claves en el mismo orden
  // (sección 1: se comparan como texto).
  const canonico = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonico)
      : typeof v === 'object' && v !== null
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico((v as Crudo)[k])]))
        : v
  const ida = JSON.stringify(canonico(JSON.parse(reg.serializarRegistro(r))))
  check('ida y vuelta: serializar lo leído da el MISMO valor JSON', ida === JSON.stringify(canonico(MEDIDO)), ida.slice(0, 160))

  const version = (v: unknown): number => reg.leerRegistro(JSON.stringify({ version: v, connections: [] }))!.version
  check('version: la leída si es mayor; nunca por debajo de la propia', version(7) === 7 && version(2) === 2 && version(0) === 1 && version(-5) === 1, `${version(7)} ${version(2)} ${version(0)} ${version(-5)}`)
  check(
    'version ausente o null: la propia, y escribible',
    reg.leerRegistro('{"connections":[]}')!.version === reg.VERSION_REGISTRO && version(null) === reg.VERSION_REGISTRO && !reg.leerRegistro('{"version":null,"connections":[]}')!.formatoAjeno,
    String(version(null))
  )
  // una `version` que no es un número era «la propia» (1) y se escribía
  // así, con lo que la regla «version nunca baja» se rompía y el archivo se reescribía
  // como si fuera de la 1. No se entiende qué formato declara: no se toca.
  for (const v of ['2', '2.0', { mayor: 2 }, true, [2]]) {
    const leido = reg.leerRegistro(JSON.stringify({ version: v, connections: [ORA] }))!
    check(
      `NEGATIVO: version ${JSON.stringify(v)} no se entiende: formato ajeno, y serializar se niega`,
      leido.formatoAjeno && leido.entradas.length === 0 && !intentar(() => reg.serializarRegistro(leido)).ok,
      JSON.stringify({ formatoAjeno: leido.formatoAjeno, version: leido.version, entradas: leido.entradas.length })
    )
  }
  check('NEGATIVO: version 1e400 (Infinity al parsear) tampoco es un número que se entienda', reg.leerRegistro('{"version":1e400,"connections":[]}')!.formatoAjeno, 'formatoAjeno')

  check('JSON ilegible: null (el store recurre al .bak)', reg.leerRegistro('{ nada') === null, 'null')
  check('cero bytes o solo espacios: ilegible, null (el store recurre al .bak)', reg.leerRegistro('') === null && reg.leerRegistro(' \n') === null, 'null')
  for (const t of ['[]', 'null', '{}', '{"connections":null}']) {
    const v = reg.leerRegistro(t)!
    check(`${t}: vacío y ESCRIBIBLE (no hay nada que perder; quien lo vació a mano manda)`, v.entradas.length === 0 && !v.formatoAjeno, JSON.stringify(v))
  }
  // el resto de raíces LEGIBLES que no son un objeto contaban también
  // como vacías, y la primera alta las sobrescribía. Una lista con entradas puede ser el
  // formato de una versión futura; un número, un texto o un booleano no son un registro
  // que se sepa escribir. Ninguna es la forma de «vaciarlo a mano».
  for (const t of ['[{"id":"x","motor":"sqlite"}]', '[null]', '7', '0', '"db-connections"', '""', 'true', 'false']) {
    const v = reg.leerRegistro(t)!
    check(
      `NEGATIVO: ${t}: legible pero sin forma de registro, formato ajeno (no se escribe encima)`,
      v !== null && v.formatoAjeno && v.entradas.length === 0 && !intentar(() => reg.serializarRegistro(v)).ok,
      JSON.stringify(v)
    )
  }
  check('`connections` que no es lista: formato ajeno, y serializar se niega', (() => {
    const v = reg.leerRegistro('{"connections":{"a":1}}')!
    return v.formatoAjeno && !intentar(() => reg.serializarRegistro(v)).ok
  })(), 'formatoAjeno')

  const raro = reg.leerRegistro(JSON.stringify({ connections: [null, 'basura', 7, [1], { id: 'x' }], extra: { a: 1 } }))!
  const vuelta = JSON.parse(reg.serializarRegistro(raro)) as Doc
  check('entradas que no son objetos, o sin forma, se conservan en su sitio', JSON.stringify(vuelta.connections) === JSON.stringify([null, 'basura', 7, [1], { id: 'x' }]), JSON.stringify(vuelta.connections))
  check('y las claves de la raíz también', JSON.stringify(vuelta.extra) === '{"a":1}', JSON.stringify(vuelta))

  check('describirAjena: sin id o sin perfil no se lista', reg.describirAjena({ id: 'x' }) === null && reg.describirAjena({ profileId: 'p' }) === null && reg.describirAjena(null) === null && reg.describirAjena({ id: '', profileId: 'p' }) === null, 'null')
  check(
    'describirAjena: alias en blanco cae al id; motor no texto cae a «desconocido»',
    JSON.stringify(reg.describirAjena({ id: 'i', profileId: 'p', alias: '  ', motor: 3 })) === JSON.stringify({ id: 'i', profileId: 'p', alias: 'i', motor: reg.MOTOR_ILEGIBLE }),
    JSON.stringify(reg.describirAjena({ id: 'i', profileId: 'p', alias: '  ', motor: 3 }))
  )

  const ordenes = reg.leerRegistro(JSON.stringify({ connections: [
    { ...ORA, id: 'o-k', orden: 2 },
    { id: 'o-a', profileId: 'p1', alias: 'A', motor: 'sqlite', orden: 9 },
    { id: 'o-b', profileId: 'p2', alias: 'B', motor: 'sqlite', orden: 50 },
    { ...PG, id: 'o-sin', orden: undefined }
  ] }))!
  check('siguienteOrden cuenta las ajenas del perfil (y no las de otro)', reg.siguienteOrden(ordenes, 'p1') === 10, String(reg.siguienteOrden(ordenes, 'p1')))
  check('siguienteOrden de un perfil vacío: 0; con una conocida sin orden: 0 (regla de siempre)', reg.siguienteOrden(ordenes, 'p9') === 0 && reg.siguienteOrden(reg.leerRegistro(JSON.stringify({ connections: [{ ...PG, orden: undefined }] }))!, 'p1') === 0, 'ok')

  // Consolidación: en cuanto el registro decide una clave, el valor no entendido que
  // guardaba el resto deja de conservarse. Si no, volvería el día que el registro la
  // perdiera EN SU SITIO (hoy nadie la quita así; el test fija la regla para quien lo haga).
  const c = reg.leerRegistro(JSON.stringify({ connections: [{ ...ORA, esquemas: { modo: 'patron' } }] }))!
  const e = c.entradas[0] as import('./registroConexiones.ts').EntradaConocida
  e.registro.esquemas = { modo: 'todos' }
  reg.serializarRegistro(c)
  delete e.registro.esquemas
  const sinEsquemas = JSON.parse(reg.serializarRegistro(c)) as Doc
  check('NEGATIVO: un valor no entendido sustituido por uno entendido no resucita', !('esquemas' in (sinEsquemas.connections[0] as Crudo)), JSON.stringify(sinEsquemas.connections[0]))
}

hr('(6) lo que se ENTIENDE pero se normaliza, y el orden al reordenar')
{
  // Claves FUTURAS DENTRO de unos esquemas y de una foto que esta versión sí entiende.
  // Normalizar es reconstruir (`{ modo, porDefecto, esquemas }` y nada más), así que
  // la primera escritura rutinaria las tiraba: el mismo fallo de las ajenas, un nivel
  // más abajo. Y una lista más larga que el tope de esta versión se truncaba en disco.
  const ESQ = { modo: 'lista', porDefecto: true, esquemas: ['A', 'B'], patrones: ['V%'] }
  const FOTO = { totalEsquemas: 3, esquemaPorDefecto: 'A', en: 1, totalBases: 2 }
  const TODOS = { modo: 'todos', excluir: ['SYS'] }
  const LARGA = { modo: 'lista', porDefecto: false, esquemas: Array.from({ length: 2100 }, (_, i) => `E${i}`) }
  const N1 = { id: 'n-1', profileId: 'p1', alias: 'Anidada', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'ADM', readonly: true, orden: 0, esquemas: ESQ, introspeccion: FOTO }
  const N2 = { id: 'n-2', profileId: 'p1', alias: 'Todos', motor: 'postgres', host: 'pg', port: 5432, database: 'd', user: 'u', readonly: true, orden: 1, esquemas: TODOS }
  const N3 = { id: 'n-3', profileId: 'p1', alias: 'Larga', motor: 'postgres', host: 'pg', port: 5432, database: 'd', user: 'u', readonly: true, orden: 2, esquemas: LARGA }
  const ruta = archivo({ version: 2, connections: [N1, N2, N3] })
  const store = new ConnectionStore({ storePath: ruta })

  const dto = store.get('n-1')!
  check(
    'NEGATIVO: el DTO los ve NORMALIZADOS (sin la clave futura)',
    JSON.stringify(dto.esquemas) === '{"modo":"lista","porDefecto":true,"esquemas":["A","B"]}' && JSON.stringify(dto.introspeccion) === '{"totalEsquemas":3,"esquemaPorDefecto":"A","en":1}',
    JSON.stringify({ e: dto.esquemas, i: dto.introspeccion })
  )
  check('y la lista larga, con el tope de esta versión', store.get('n-3')?.esquemas?.modo === 'lista' && (store.get('n-3')!.esquemas as { esquemas: string[] }).esquemas.length === 2000, 'tope')

  store.marcarVerificada('n-2', null, 1)
  let d = disco(ruta)
  check(
    'una escritura rutinaria (de OTRA conexión) conserva las claves anidadas tal cual',
    JSON.stringify(de(d, 'n-1')?.esquemas) === JSON.stringify(ESQ) && JSON.stringify(de(d, 'n-1')?.introspeccion) === JSON.stringify(FOTO),
    JSON.stringify({ e: de(d, 'n-1')?.esquemas, i: de(d, 'n-1')?.introspeccion })
  )
  check('también dentro de un «todos»', JSON.stringify(de(d, 'n-2')?.esquemas) === JSON.stringify(TODOS), JSON.stringify(de(d, 'n-2')?.esquemas))
  check('y la lista más larga que el tope no se trunca en disco', (de(d, 'n-3')?.esquemas as { esquemas: string[] }).esquemas.length === 2100, String((de(d, 'n-3')?.esquemas as { esquemas: string[] }).esquemas.length))

  store.marcarVerificada('n-1', 'oracle-ic-19', 1)
  store.setIntrospeccion('n-1', { totalEsquemas: 3, esquemaPorDefecto: 'A', en: 99 })
  store.update('n-1', formDe(store.get('n-1')!, { alias: 'Anidada2' }))
  d = disco(ruta)
  check(
    'marcarla, refrescar la foto SIN cambios y editar el alias también las conservan',
    de(d, 'n-1')?.alias === 'Anidada2' && JSON.stringify(de(d, 'n-1')?.esquemas) === JSON.stringify(ESQ) && JSON.stringify(de(d, 'n-1')?.introspeccion) === JSON.stringify(FOTO),
    JSON.stringify(de(d, 'n-1'))
  )
  check('y el DTO sigue viéndolos normalizados tras la edición', JSON.stringify(store.get('n-1')?.esquemas) === '{"modo":"lista","porDefecto":true,"esquemas":["A","B"]}', JSON.stringify(store.get('n-1')?.esquemas))

  // NEGATIVOS: en cuanto alguien fija OTRO valor, se escribe el nuevo (sin la clave de
  // antes); y las reglas de siempre siguen retirándolos.
  store.setEsquemasVisibles('n-1', { modo: 'lista', porDefecto: false, esquemas: ['C'] })
  store.setIntrospeccion('n-1', { totalEsquemas: 4, esquemaPorDefecto: 'A', en: 5 })
  d = disco(ruta)
  check(
    'NEGATIVO: fijar otros esquemas y otra foto escribe los nuevos (la clave anidada se va)',
    JSON.stringify(de(d, 'n-1')?.esquemas) === '{"modo":"lista","porDefecto":false,"esquemas":["C"]}' && JSON.stringify(de(d, 'n-1')?.introspeccion) === '{"totalEsquemas":4,"esquemaPorDefecto":"A","en":5}',
    JSON.stringify({ e: de(d, 'n-1')?.esquemas, i: de(d, 'n-1')?.introspeccion })
  )
  store.update('n-2', formDe(store.get('n-2')!, { motor: 'oracle', port: 1521, database: 'QA' }))
  check('NEGATIVO: cambiar el motor sigue retirando los esquemas (con su clave anidada)', !('esquemas' in de(disco(ruta), 'n-2')!), JSON.stringify(de(disco(ruta), 'n-2')))

  // En el módulo puro: una mutación EN EL SITIO del valor normalizado también cuenta
  // como cambio (la comparación es por valor, no por identidad).
  const pr = reg.leerRegistro(JSON.stringify({ connections: [N1] }))!
  const e0 = pr.entradas[0] as import('./registroConexiones.ts').EntradaConocida
  ;(e0.registro.esquemas as { esquemas: string[] }).esquemas.push('Z')
  const trasMutar = (JSON.parse(reg.serializarRegistro(pr)) as Doc).connections[0] as Crudo
  check('NEGATIVO: mutar el valor en el sitio escribe el mutado', JSON.stringify(trasMutar.esquemas) === '{"modo":"lista","porDefecto":true,"esquemas":["A","B","Z"]}', JSON.stringify(trasMutar.esquemas))

  // REORDENAR con ajenas: las conocidas no pueden tomar el `orden` de una ajena (el
  // empate que `siguienteOrden` ya evita al dar de alta). Antes se numeraban 0..n-1.
  const RA = { id: 'r-a', profileId: 'p1', alias: 'A', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', orden: 0 }
  const RB = { id: 'r-b', profileId: 'p1', alias: 'B', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', orden: 2 }
  const RC = { id: 'r-c', profileId: 'p1', alias: 'C', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', orden: 4 }
  const AJ1 = { id: 'r-x', profileId: 'p1', alias: 'X', motor: 'sqlite', orden: 1 }
  const AJ3 = { id: 'r-y', profileId: 'p1', alias: 'Y', motor: 'sqlite', orden: 3 }
  const AJOTRO = { id: 'r-z', profileId: 'p2', alias: 'Z', motor: 'sqlite', orden: 0 }
  const rutaR = archivo({ connections: [RA, AJ1, RB, AJ3, RC, AJOTRO] })
  const sr = new ConnectionStore({ storePath: rutaR })
  sr.reorder('p1', ['r-c', 'r-a', 'r-b'])
  const dr = disco(rutaR)
  const ordenes = Object.fromEntries(dr.connections.map((c) => [(c as Crudo).id, (c as Crudo).orden]))
  check(
    'reorder: las conocidas llenan los huecos de las ajenas (0, 2, 4) en el orden pedido',
    ordenes['r-c'] === 0 && ordenes['r-a'] === 2 && ordenes['r-b'] === 4,
    JSON.stringify(ordenes)
  )
  check('y las ajenas se quedan con el suyo', ordenes['r-x'] === 1 && ordenes['r-y'] === 3 && ordenes['r-z'] === 0, JSON.stringify(ordenes))
  check('el orden que ve la UI es el pedido', JSON.stringify(sr.list('p1').map((c) => c.id)) === '["r-c","r-a","r-b"]', JSON.stringify(sr.list('p1').map((c) => c.id)))
  check(
    'huecosDeOrden: salta los de las ajenas del perfil, no los de otro; sin ajenas es 0..n-1',
    JSON.stringify(reg.huecosDeOrden(reg.leerRegistro(JSON.stringify({ connections: [AJ1, AJ3, AJOTRO] }))!, 'p1', 4)) === '[0,2,4,5]' &&
      JSON.stringify(reg.huecosDeOrden(reg.registroVacio(), 'p1', 3)) === '[0,1,2]',
    JSON.stringify(reg.huecosDeOrden(reg.leerRegistro(JSON.stringify({ connections: [AJ1, AJ3, AJOTRO] }))!, 'p1', 4))
  )
}

hr('(7) Mover la conexión a otro servidor retira lo que no se gobierna')
{
  // por la cadena REAL (`update` → `editarConocida` → `conservarAlEditar`
  // → `separarConocida`), que es donde las claves futuras viajan por el `resto`. Una
  // versión más nueva guardó en la PG un túnel y una CA DEL SERVIDOR (db-a); aquí el
  // usuario la mueve a db-b. Antes sobrevivían, y la versión nueva conectaba a db-b por
  // el bastión de db-a y con su CA. La regla y su porqué, en `conservarAlEditar.ts`.
  const FUT = {
    id: 'd-1', profileId: 'p1', alias: 'Futura', motor: 'postgres', host: 'db-a', port: 5432, database: 'app', user: 'u', readonly: true, orden: 0,
    tunelSsh: { host: 'bastion-a' }, ssl: { ca: 'CA-de-db-a' }
  }
  const ruta = archivo({ version: 2, connections: [FUT] })
  const store = new ConnectionStore({ storePath: ruta })
  store.update('d-1', formDe(store.get('d-1')!, { user: 'otro', database: 'app2', alias: 'Futura2' }))
  let d1 = de(disco(ruta), 'd-1')!
  check(
    'cambiar base, usuario y alias (MISMO servidor) conserva el túnel y la CA',
    JSON.stringify(d1.tunelSsh) === '{"host":"bastion-a"}' && JSON.stringify(d1.ssl) === '{"ca":"CA-de-db-a"}' && d1.alias === 'Futura2',
    JSON.stringify(d1)
  )
  store.update('d-1', formDe(store.get('d-1')!, { host: 'db-b' }))
  d1 = de(disco(ruta), 'd-1')!
  check('NEGATIVO: cambiar el host los retira del disco (no se pegan al servidor nuevo)', !('tunelSsh' in d1) && !('ssl' in d1) && d1.host === 'db-b' && d1.orden === 0, JSON.stringify(d1))
}

hr('(8) Un registro que NO SE PUEDE LEER no se sobrescribe')
{
  // EL FALLO: con el principal ROTO (una coma de más, editado a mano) y sin `.bak` que
  // sirva, la lectura caía en `registroVacio()`, que es escribible, y la primera escritura
  // rutinaria ponía `{ version: 1, connections: [...] }` en su lugar: el archivo del
  // usuario, perdido, y sin `.bak` que lo recordara. Se prueba con el store REAL y las
  // escrituras que de verdad ocurren (el alta, `marcarVerificada` al abrir una sesión, el
  // driver, la verificación, el orden, el borrado y la poda de perfiles). Se avisa y no se toca.
  const ROTO = '{\n  "version": 1,\n  "connections": [\n    ' + JSON.stringify({ ...ORA, alias: 'A-MANO' }) + ',\n  ]\n}\n'
  const ALTA = { profileId: 'p1', alias: 'Nueva', motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }
  /** Todas las escrituras que el main hace sin preguntar, sobre un store recién leído. */
  function escribirTodo(s: InstanceType<typeof ConnectionStore>): { alta: ReturnType<typeof intentar> } {
    const alta = intentar(() => s.create(ALTA))
    intentar(() => s.marcarVerificada(ORA.id, 'oracle-thin'))
    intentar(() => s.setVerificada(ORA.id, true))
    intentar(() => s.setDriver(ORA.id, 'oracle-ic-19'))
    intentar(() => s.reorder('p1', [ORA.id]))
    intentar(() => s.remove(ORA.id))
    intentar(() => s.pruneProfiles(new Set()))
    return { alta }
  }

  const ruta = archivo(ROTO)
  const store = new ConnectionStore({ storePath: ruta })
  const lc = store.listaCompleta('p1')
  const avisoSinBak = reg.mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente')
  check(
    'JSON roto y sin .bak: el store lo BLOQUEA (no lo toma por vacío): `formatoAjeno` y su propio aviso',
    store.formatoAjeno === true && lc.formatoAjeno === true && lc.aviso === avisoSinBak && lc.conexiones.length === 0 && lc.ajenas.length === 0,
    JSON.stringify(lc)
  )
  const { alta } = escribirTodo(store)
  check(
    'dar de alta falla con ESE aviso, y no con el del formato ajeno (que mandaría a actualizar)',
    !alta.ok && alta.error === avisoSinBak && !alta.error.includes('versión más nueva'),
    alta.ok ? 'CREÓ' : alta.error
  )
  check('y el archivo sigue BYTE A BYTE tras todas las escrituras rutinarias', readFileSync(ruta, 'utf-8') === ROTO, readFileSync(ruta, 'utf-8').slice(0, 120))
  check('NEGATIVO: tampoco apareció un .bak (no hubo escritura ninguna)', !existsSync(`${ruta}.bak`), String(existsSync(`${ruta}.bak`)))
  check(
    'el aviso nombra el archivo, dice qué pasa y qué hacer (corregirlo y REINICIAR, que lo lee al arrancar)',
    avisoSinBak.includes('db-connections.json') &&
      avisoSinBak.includes('no es JSON válido') &&
      avisoSinBak.includes('corrígelo') &&
      avisoSinBak.includes('reinicia Tessera') &&
      avisoSinBak.includes('no lo toca'),
    avisoSinBak
  )
  check('NEGATIVO: sin .bak, el aviso no habla de él', !avisoSinBak.includes('.bak'), avisoSinBak)

  // Con un .bak que TAMPOCO sirve (roto, o de cero bytes): lo mismo, y el aviso lo dice.
  for (const [que, bak] of [
    ['un .bak roto', '{ tampoco'],
    ['un .bak de cero bytes', '']
  ] as const) {
    const r = archivo(ROTO)
    writeFileSync(`${r}.bak`, bak)
    const s = new ConnectionStore({ storePath: r })
    const l = s.listaCompleta('p1')
    const e = escribirTodo(s)
    check(
      `JSON roto y ${que}: bloqueado, y el aviso dice que la copia tampoco sirve`,
      l.formatoAjeno === true && l.aviso === reg.mensajeRegistroIlegible({ tipo: 'roto' }, 'inservible') && /db-connections\.json\.bak\) tampoco sirve/.test(l.aviso),
      JSON.stringify(l)
    )
    check(
      `JSON roto y ${que}: ni el principal ni el .bak cambian tras las escrituras rutinarias`,
      !e.alta.ok && readFileSync(r, 'utf-8') === ROTO && readFileSync(`${r}.bak`, 'utf-8') === bak,
      e.alta.ok ? 'CREÓ' : readFileSync(r, 'utf-8').slice(0, 80)
    )
  }

  // Un principal que EXISTE y no se deja abrir (aquí, una carpeta con su nombre: EISDIR en
  // las dos plataformas; en la vida real, permisos o un bloqueo). No se sabe qué tiene, y
  // `writeFileAtomicSync` lo sustituiría renombrando: tampoco se toma por vacío.
  const inaccesible = path.join(dir, `db-connections-${++n}.json`)
  mkdirSync(inaccesible)
  const si = new ConnectionStore({ storePath: inaccesible })
  const li = si.listaCompleta('p1')
  const altaI = intentar(() => si.create(ALTA))
  check(
    'un principal que existe y NO SE DEJA ABRIR (EISDIR): bloqueado, con el código en el aviso',
    li.formatoAjeno === true && /no se pudo abrir \(EISDIR\)/.test(li.aviso) && !altaI.ok && altaI.error === li.aviso,
    JSON.stringify({ aviso: li.formatoAjeno ? li.aviso : null, alta: altaI.ok ? 'CREÓ' : altaI.error })
  )

  // LAS MITADES NEGATIVAS: lo ya decidido no cambia.
  const conBak = archivo(ROTO)
  writeFileSync(`${conBak}.bak`, JSON.stringify({ connections: [{ ...ORA, alias: 'DEL-BAK' }] }))
  const sb = new ConnectionStore({ storePath: conBak })
  check(
    'NEGATIVO: JSON roto con un .bak que SÍ se lee: se usa el .bak, como siempre (y es escribible)',
    sb.formatoAjeno === false && sb.list('p1')[0]?.alias === 'DEL-BAK' && intentar(() => sb.create(ALTA)).ok,
    JSON.stringify(sb.list('p1').map((c) => c.alias))
  )
  for (const [que, texto] of [
    ['cero bytes', ''],
    ['solo espacios', '  \n\t\n'],
    ['solo el BOM', '\uFEFF']
  ] as const) {
    const r = archivo(texto)
    const s = new ConnectionStore({ storePath: r })
    const a = intentar(() => s.create(ALTA))
    check(`NEGATIVO: ${que} y sin .bak: VACÍO y escribible (no hay nada que perder)`, s.formatoAjeno === false && a.ok && disco(r).connections.length === 1, a.ok ? 'creó' : a.error)
  }
  // Principal vacío o ausente y un .bak roto: el .bak es copia de Tessera (nunca guarda
  // uno que no sea JSON), no algo que el usuario escribiera. Bloquear aquí dejaría sin
  // altas a quien borró el registro para empezar de cero. Ver la cabecera del módulo.
  const vacioBakRoto = archivo('')
  writeFileSync(`${vacioBakRoto}.bak`, '{ roto')
  const ausenteBakRoto = path.join(dir, `db-connections-${++n}.json`)
  writeFileSync(`${ausenteBakRoto}.bak`, '{ roto')
  check(
    'NEGATIVO: principal vacío o AUSENTE con un .bak roto: vacío y escribible',
    [vacioBakRoto, ausenteBakRoto].every((r) => {
      const s = new ConnectionStore({ storePath: r })
      return s.formatoAjeno === false && intentar(() => s.create(ALTA)).ok && disco(r).connections.length === 1
    }),
    'ok'
  )
  // EL USUARIO NUEVO, con el store real (antes solo estaba probado con el
  // lector de mentira): ni archivo, ni `.bak`, ni siquiera la carpeta de `userData`. Tiene
  // que arrancar vacío y sin aviso, y su primera alta crear el archivo.
  const nuevo = path.join(dir, 'userdata-nuevo', 'db-connections.json')
  const sn = new ConnectionStore({ storePath: nuevo })
  const ln = sn.listaCompleta('p1')
  const an = intentar(() => sn.create(ALTA))
  check(
    'NEGATIVO: el PRIMER ARRANQUE (sin archivo, sin .bak, sin carpeta): vacío sin aviso, y la primera alta crea el archivo',
    ln.formatoAjeno === false && ln.conexiones.length === 0 && an.ok && disco(nuevo).connections.length === 1 && !existsSync(`${nuevo}.bak`),
    an.ok ? JSON.stringify(ln) : an.error
  )

  // El módulo puro, con un disco de mentira: la misma decisión sin el store, y el lector
  // que LANZA (existe y no se pudo leer) frente al que devuelve `null` (no existe).
  const de = (archivos: Record<string, string | Error>): Registro =>
    reg.leerRegistroConRespaldo((r) => {
      const v = archivos[r]
      if (v instanceof Error) throw v
      return v ?? null
    }, 'r.json')
  const bloqueo = Object.assign(new Error('bloqueado'), { code: 'EBUSY' })
  const pr = de({ 'r.json': bloqueo, 'r.json.bak': '{ roto' })
  check(
    'puro: un principal que LANZA al leer (EBUSY) y un .bak roto: bloqueado, con el código y el .bak en el aviso',
    pr.formatoAjeno && pr.aviso === reg.mensajeRegistroIlegible({ tipo: 'inaccesible', codigo: 'EBUSY' }, 'inservible') && pr.entradas.length === 0,
    JSON.stringify(pr)
  )
  const sinCodigo = de({ 'r.json': new Error('sin código') })
  check('puro: un error sin `code` se nombra igual, sin reventar', sinCodigo.formatoAjeno && /no se pudo abrir \(error de lectura\)/.test(sinCodigo.aviso ?? ''), JSON.stringify(sinCodigo))
  check(
    'puro: NEGATIVO: el lector que devuelve `null` (no existe) sin .bak: vacío y escribible',
    (() => {
      const v = de({})
      return !v.formatoAjeno && v.aviso === null && intentar(() => reg.serializarRegistro(v)).ok
    })(),
    'ok'
  )
  check(
    'puro: serializar un registro ilegible se NIEGA, con su aviso',
    (() => {
      const v = de({ 'r.json': 'no es JSON' })
      const r = intentar(() => reg.serializarRegistro(v))
      return !r.ok && r.error === reg.mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente')
    })(),
    'se niega'
  )
  check(
    'puro: el formato ajeno sigue con SU aviso (no se confunden)',
    (() => {
      const v = de({ 'r.json': '{"version":"2","connections":[]}' })
      return v.formatoAjeno && v.aviso === reg.MENSAJE_FORMATO_AJENO
    })(),
    'MENSAJE_FORMATO_AJENO'
  )
}

hr('(9) El log de los montajes descartados dice la causa')
{
  // `DbController.entornoHost` registraba «AVISO: N id(s) montado(s) no existen en el
  // perfil y se descartaron» de TODO id montado que no pasara el filtro, y su comentario lo
  // daba por «SIEMPRE un fallo real». Con el registro bloqueado, o con conexiones AJENAS
  // montadas, esos ids SÍ existen en el archivo: el log mandaba a buscar un fallo de
  // montaje que no había. Aquí se recorre la cadena del main con el store REAL: sus
  // conexiones → `construirEntornoHost` → `registroParaDescartes(listaCompleta)` →
  // `avisosDeDescartados`, que es lo que escribe `DbController`.
  function logDe(storePath: string, montadas: string[]): string[] {
    const s = new ConnectionStore({ storePath })
    const { diag } = construirEntornoHost(
      {
        binDir: 'bin',
        registryPath: storePath,
        driversDir: 'drivers',
        conexionesDelPerfil: (p) => s.list(p),
        secretoDe: (id) => s.secretOf(id),
        espacioDeDatos: () => 'espacio'
      },
      'p1',
      'proyecto',
      montadas
    )
    return avisosDeDescartados(diag.idsDescartados, registroParaDescartes(s.listaCompleta('p1')), 'p1')
  }
  const noExisten = (lineas: string[]): boolean => lineas.some((l) => l.includes('no existen'))

  const rotas = logDe(archivo('{ roto,'), [ORA.id, PG.id])
  check(
    'registro ilegible: ni «no existen» ni AVISO de montaje; dice que el registro está bloqueado y por qué',
    !noExisten(rotas) && rotas.length === 1 && rotas[0].startsWith('NOTA:') && rotas[0].includes('bloqueado') && rotas[0].includes('no es JSON válido'),
    JSON.stringify(rotas)
  )
  const futuro = logDe(archivo(JSON.stringify({ version: '2', connections: [ORA, PG] })), [ORA.id])
  check(
    'formato ajeno: lo mismo, con el aviso del formato',
    !noExisten(futuro) && futuro.length === 1 && futuro[0].includes('bloqueado') && futuro[0].includes('no reconoce el formato'),
    JSON.stringify(futuro)
  )
  const mezcla = logDe(archivo({ version: 2, connections: [ORA, LITE, MSSQL] }), [ORA.id, LITE.id, 'fantasma', MSSQL.id])
  const nota = mezcla.find((l) => l.startsWith('NOTA:')) ?? ''
  const aviso = mezcla.find((l) => l.startsWith('AVISO:')) ?? ''
  check(
    'ajenas montadas: una NOTA que las nombra como no usables, no como inexistentes',
    nota.includes(LITE.id) && nota.includes(MSSQL.id) && !nota.includes('no existen') && !nota.includes('fantasma'),
    JSON.stringify(mezcla)
  )
  check(
    'NEGATIVO: el id que de verdad no existe sigue siendo un AVISO, y solo él',
    aviso.includes('no existen en el perfil "p1"') && aviso.includes('fantasma') && !aviso.includes(LITE.id) && aviso.startsWith('AVISO: 1 id(s)'),
    JSON.stringify(mezcla)
  )
  check('NEGATIVO: sin descartes, ninguna línea', logDe(archivo({ connections: [ORA] }), [ORA.id]).length === 0, 'vacío')
}

hr('(10) Un registro roto con Tessera ABIERTA tampoco se pisa')
{
  // EL FALLO: el store lee el archivo UNA vez, al arrancar. La sección (8) cubre el que ya
  // estaba roto entonces; pero la coma de más de una edición a mano llega casi siempre con
  // Tessera abierta, y la siguiente escritura rutinaria (probar la conexión, abrir una
  // sesión) ponía encima lo que el store tenía en memoria. `writeFileAtomicSync` no guarda
  // como `.bak` lo que no es JSON, así que la edición desaparecía sin rastro y al reiniciar
  // no había aviso que ver. Con el store REAL: se lee un archivo bueno, se rompe «a mano»
  // por debajo, y se intentan todas las escrituras.
  const ALTA = { profileId: 'p1', alias: 'Nueva', motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }
  const BUENO = { version: 1, connections: [ORA, { ...PG, entorno: 'desarrollo' }] }
  // Una coma de más detrás de la última conexión, como la dejaría una edición a mano.
  const ROTO = JSON.stringify(BUENO, null, 2).replace(/\n {2}\]/, ',\n  ]')
  check('(el texto de la prueba de verdad no es JSON)', intentar(() => JSON.parse(ROTO)).ok === false, ROTO.slice(-40))

  const ruta = archivo(BUENO)
  const store = new ConnectionStore({ storePath: ruta })
  const antes = store.list('p1').map((c) => c.alias)
  writeFileSync(ruta, ROTO)
  const avisoRoto = reg.mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente')
  const escrituras: Array<[string, () => unknown]> = [
    ['marcarVerificada (abrir una sesión)', () => store.marcarVerificada(ORA.id, 'oracle-thin')],
    ['setVerificada (probar)', () => store.setVerificada(PG.id, true)],
    ['setDriver', () => store.setDriver(PG.id, 'pg-17')],
    ['setIntrospeccion', () => store.setIntrospeccion(ORA.id, { totalEsquemas: 9, esquemaPorDefecto: 'ADM', en: 1 })],
    ['reorder', () => store.reorder('p1', [PG.id, ORA.id])],
    ['update', () => store.update(ORA.id, formDe(store.get(ORA.id)!, { alias: 'ORA-EDITADA' }))],
    ['remove', () => store.remove(PG.id)],
    ['pruneProfiles', () => store.pruneProfiles(new Set())]
  ]
  for (const [nombre, f] of escrituras) {
    const r = intentar(f)
    check(
      `roto con Tessera abierta: ${nombre} se NIEGA con el aviso del archivo ilegible, y el archivo sigue byte a byte`,
      !r.ok && r.error === avisoRoto && readFileSync(ruta, 'utf-8') === ROTO,
      r.ok ? `ESCRIBIÓ: ${readFileSync(ruta, 'utf-8').slice(0, 80)}` : r.error.slice(0, 80)
    )
  }
  const alta = intentar(() => store.create(ALTA))
  check(
    'roto con Tessera abierta: el alta falla con ese aviso ANTES de tocar la memoria (no queda una conexión fantasma en la lista)',
    !alta.ok && alta.error === avisoRoto && !store.list('p1').some((c) => c.alias === 'Nueva') && readFileSync(ruta, 'utf-8') === ROTO,
    alta.ok ? 'CREÓ' : JSON.stringify(store.list('p1').map((c) => c.alias))
  )
  check('NEGATIVO: ni un .bak apareció (no hubo escritura ninguna)', !existsSync(`${ruta}.bak`), String(existsSync(`${ruta}.bak`)))
  check(
    'el store NO se bloquea (se leyó bien al arrancar): se niegan las escrituras, no la lectura',
    antes.length === 2 && store.formatoAjeno === false && store.listaCompleta('p1').formatoAjeno === false,
    JSON.stringify(antes)
  )

  // Un FORMATO que no se reconoce, escrito por debajo: la misma regla de siempre.
  const rutaAjena = archivo(BUENO)
  const sa = new ConnectionStore({ storePath: rutaAjena })
  const AJENO = '{"version":"2","connections":[]}'
  writeFileSync(rutaAjena, AJENO)
  const aa = intentar(() => sa.setDriver(PG.id, 'pg-17'))
  check(
    'un formato ajeno escrito con Tessera abierta tampoco se pisa (su aviso, no el del ilegible)',
    !aa.ok && aa.error === reg.MENSAJE_FORMATO_AJENO && readFileSync(rutaAjena, 'utf-8') === AJENO,
    aa.ok ? 'ESCRIBIÓ' : aa.error.slice(0, 80)
  )

  // LAS MITADES NEGATIVAS.
  // Lo DECIDIDO: roto al arrancar y suplido con el `.bak`: la primera escritura sí lo
  // sustituye (es el mismo texto que se leyó, no una edición posterior).
  const conBak = archivo(ROTO)
  writeFileSync(`${conBak}.bak`, JSON.stringify(BUENO))
  const sb = new ConnectionStore({ storePath: conBak })
  const eb = intentar(() => sb.setDriver(PG.id, 'pg-17'))
  check(
    'NEGATIVO: roto AL ARRANCAR con un .bak legible: se usa el .bak y la primera escritura lo sustituye (lo decidido)',
    eb.ok && intentar(() => JSON.parse(readFileSync(conBak, 'utf-8'))).ok && disco(conBak).connections.length === 2,
    eb.ok ? readFileSync(conBak, 'utf-8').slice(0, 60) : eb.error
  )
  // Vaciado o borrado por debajo: no hay nada que perder.
  for (const [que, preparar] of [
    ['vaciado a cero bytes', (r: string) => writeFileSync(r, '')],
    ['dejado en solo espacios', (r: string) => writeFileSync(r, '  \n')],
    ['borrado', (r: string) => rmSync(r)]
  ] as const) {
    const r = archivo(BUENO)
    const s = new ConnectionStore({ storePath: r })
    preparar(r)
    const e = intentar(() => s.setDriver(PG.id, 'pg-17'))
    check(`NEGATIVO: ${que} con Tessera abierta: se escribe (nada que perder)`, e.ok && disco(r).connections.length === 2, e.ok ? 'escribió' : e.error)
  }
  // Una edición VÁLIDA por debajo, con Tessera abierta, TAMPOCO se pisa: pisarla
  // «porque el `.bak` la guarda» no vale, el `.bak` guarda una sola escritura y la segunda
  // escritura rutinaria la perdería sin rastro.
  const valida = archivo(BUENO)
  const sv = new ConnectionStore({ storePath: valida })
  const EDITADO = JSON.stringify({ version: 1, connections: [ORA] })
  writeFileSync(valida, EDITADO)
  const ev = intentar(() => sv.setDriver(PG.id, 'pg-17'))
  const ev2 = intentar(() => sv.setDriver(PG.id, 'pg-18'))
  check(
    'una edición VÁLIDA con Tessera abierta NO se pisa: se niega con su aviso, también en la segunda escritura, y el archivo queda byte a byte',
    !ev.ok && ev.error === reg.MENSAJE_CAMBIADO_FUERA && !ev2.ok && readFileSync(valida, 'utf-8') === EDITADO,
    ev.ok ? 'escribió' : ev.error
  )
  // NEGATIVO: el mismo registro guardado de nuevo por un editor (otros espacios, otro orden
  // de líneas) no es un cambio: se escribe.
  const reformateado = archivo(BUENO)
  const sr = new ConnectionStore({ storePath: reformateado })
  writeFileSync(reformateado, JSON.stringify(JSON.parse(readFileSync(reformateado, 'utf-8')), null, 4) + '\r\n')
  const er = intentar(() => sr.setDriver(PG.id, 'pg-17'))
  check(
    'NEGATIVO: el MISMO contenido con otro formato de texto (sangría, CRLF) no bloquea: se escribe',
    er.ok && disco(reformateado).connections.length === 2,
    er.ok ? 'escribió' : er.error
  )
  // Dos escrituras seguidas del propio store: la segunda no toma la primera por un cambio.
  const seguidas = archivo(BUENO)
  const ss = new ConnectionStore({ storePath: seguidas })
  check(
    'NEGATIVO: el store no se niega a sí mismo (alta y luego driver, sin nadie por debajo)',
    intentar(() => ss.create(ALTA)).ok && intentar(() => ss.setDriver(PG.id, 'pg-17')).ok && disco(seguidas).connections.length === 3,
    JSON.stringify(ids(disco(seguidas)))
  )

  // El módulo puro.
  const ilegible = reg.mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente')
  const casos: Array<[string, string | null, string | null | undefined, string | null]> = [
    ['no existe', null, '{}', null],
    ['sin cambios, aunque esté roto (el suplido con el .bak)', '{ roto', '{ roto', null],
    ['cero bytes', '', '{}', null],
    ['solo espacios y BOM', '\uFEFF \n', undefined, null],
    ['roto y distinto', '{ roto', '{}', ilegible],
    ['roto y antes ilegible (`undefined`)', '{ roto', undefined, ilegible],
    ['roto y antes no existía', '{ roto', null, ilegible],
    ['formato ajeno', '{"version":"2"}', '{}', reg.MENSAJE_FORMATO_AJENO],
    ['JSON que se sabe escribir', '{"connections":[]}', '{}', null],
    ['JSON que se sabe escribir, y antes no existía', '{"connections":[]}', null, null],
    // si lo que se leyó era el roto rescatado con
    // el `.bak`, un JSON bueno ahora es el usuario que lo CORRIGIÓ, y lo de memoria sale del
    // `.bak`. Antes daba `null` (este mismo caso estaba fijado así) y el arreglo se perdía.
    ['el roto rescatado, CORREGIDO a mano', '{"connections":[]}', '{ roto', reg.MENSAJE_RESCATADO_CORREGIDO],
    ['el roto rescatado, vaciado a mano como JSON (`null`)', 'null', '{ roto', reg.MENSAJE_RESCATADO_CORREGIDO],
    ['el roto rescatado, vaciado a cero bytes (nada que perder)', '', '{ roto', null],
    ['el roto rescatado, dejado en solo espacios (nada que perder)', ' \n', '{ roto', null],
    // Un cambio VÁLIDO por fuera tampoco se pisa…
    [
      'JSON bueno con OTRAS conexiones que las leídas',
      '{"version":1,"connections":[{"id":"a","profileId":"p","alias":"A","motor":"postgres","host":"h","port":5432,"database":"d","user":"u"}]}',
      '{"version":1,"connections":[]}',
      reg.MENSAJE_CAMBIADO_FUERA
    ],
    [
      'JSON bueno con conexiones, creado por fuera cuando al arrancar no existía',
      '{"version":1,"connections":[{"id":"a","profileId":"p","alias":"A","motor":"postgres","host":"h","port":5432,"database":"d","user":"u"}]}',
      null,
      reg.MENSAJE_CAMBIADO_FUERA
    ],
    // …salvo que sea el MISMO contenido con otro formato de texto.
    [
      'el MISMO registro con otra sangría y CRLF',
      '{\r\n    "version": 1,\r\n    "connections": [{"id":"a","profileId":"p","alias":"A","motor":"postgres","host":"h","port":5432,"database":"d","user":"u"}]\r\n}\r\n',
      '{"version":1,"connections":[{"id":"a","profileId":"p","alias":"A","motor":"postgres","host":"h","port":5432,"database":"d","user":"u"}]}',
      null
    ]
  ]
  const malos = casos.filter(([, actual, conocido, esperado]) => reg.avisoAlSobrescribir(actual, conocido) !== esperado)
  check(`puro: avisoAlSobrescribir decide bien los ${casos.length} casos`, malos.length === 0, malos.map(([n]) => n).join('; ') || 'ok')
}

hr('(11) El registro roto con .bak legible se guarda APARTE antes de sustituirlo')
{
  // LO QUE SE ARREGLA: con el principal ROTO (una edición a mano) y un `.bak` legible, se
  // usaba el `.bak` —bien— y la primera escritura sustituía el roto sin más: la edición a
  // mano se perdía, porque `writeFileAtomicSync` no guarda como `.bak` lo que no es JSON.
  // Ahora la primera escritura lo guarda antes, byte a byte, como `.ilegible` (o con la
  // fecha si ese nombre ya existe), y si no puede no escribe. Y el principal que NO SE DEJA
  // ABRIR, que usaba el `.bak` igual, ahora se bloquea: no se puede copiar lo que no se lee.
  const ALTA = { profileId: 'p1', alias: 'Nueva', motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }
  const BAK = JSON.stringify({ version: 1, connections: [ORA, { ...PG, entorno: 'desarrollo' }] })
  const DE_LA_COPIA = ['ORA-QA', 'PG-STG']
  // Una edición con el Bloc de notas en ANSI: una «ñ» de Windows-1252 (el byte 0xF1, que
  // no es UTF-8), BOM, CRLF y una coma de más. «Exacto» es BYTE A BYTE: una copia que
  // pasara por texto cambiaría el 0xF1 por U+FFFD y ya no sería lo que el usuario escribió.
  const ROTO = Buffer.concat([
    Buffer.from('\uFEFF{\r\n  "version": 1,\r\n  "connections": [\r\n    {"id":"ora-1","profileId":"p1","alias":"ORA-CONTRASE', 'utf-8'),
    Buffer.from([0xf1]),
    Buffer.from('A","motor":"oracle","host":"db.lan","port":1521,"database":"QA","user":"ADM","readonly":true},\r\n  ]\r\n}\r\n', 'utf-8')
  ])
  check(
    '(el texto de la prueba de verdad no es JSON ni UTF-8 válido)',
    intentar(() => JSON.parse(ROTO.toString('utf-8').slice(1))).ok === false && !Buffer.from(ROTO.toString('utf-8'), 'utf-8').equals(ROTO),
    `${ROTO.length} bytes`
  )
  /** Un registro en SU carpeta, con el nombre de verdad: principal roto y `.bak` legible. */
  function rescatable(): { ruta: string; carpeta: string } {
    const carpeta = mkdtempSync(path.join(dir, 'rescate-'))
    const ruta = path.join(carpeta, 'db-connections.json')
    writeFileSync(ruta, ROTO)
    writeFileSync(`${ruta}.bak`, BAK)
    return { ruta, carpeta }
  }
  /** Las copias apartadas que hay en la carpeta, en orden. */
  const copias = (carpeta: string): string[] =>
    readdirSync(carpeta)
      .filter((f) => f.startsWith('db-connections.json.ilegible'))
      .sort()
  const esCopiaConFecha = (f: string): boolean => /^db-connections\.json\.ilegible-\d{8}-\d{6}$/.test(f)
  const alias = (s: InstanceType<typeof ConnectionStore>): string => s.list('p1').map((c) => c.alias).join()

  // (a) La lectura: se usan las del `.bak`, sin bloquear, con el aviso de la recuperación.
  const a = rescatable()
  const store = new ConnectionStore({ storePath: a.ruta })
  const lc = store.listaCompleta('p1')
  check(
    'roto con .bak legible: se usan las conexiones del .bak, sin bloquear',
    store.formatoAjeno === false && lc.formatoAjeno === false && alias(store) === DE_LA_COPIA.join(),
    JSON.stringify({ f: lc.formatoAjeno, alias: alias(store) })
  )
  check(
    'y `listaCompleta` lo cuenta en `recuperado` (el aviso de antes de escribir: nombra los tres archivos)',
    lc.recuperado === reg.mensajeRegistroRecuperado(null) &&
      /no es JSON válido/.test(lc.recuperado) &&
      lc.recuperado.includes('db-connections.json.bak') &&
      lc.recuperado.includes('db-connections.json.ilegible'),
    String(lc.recuperado)
  )
  check(
    'el aviso dice que a la copia de respaldo puede faltarle el último cambio (el .bak va una escritura por detrás), antes y después de copiar',
    reg.mensajeRegistroRecuperado(null).includes('puede faltarle el último cambio') &&
      reg.mensajeRegistroRecuperado('.ilegible').includes('puede faltarle el') &&
      reg.mensajeRegistroRecuperado('.ilegible').includes('si echas algo en falta, está ahí'),
    reg.mensajeRegistroRecuperado('.ilegible')
  )
  check('NEGATIVO: leer no copia ni toca nada', copias(a.carpeta).length === 0 && readFileSync(a.ruta).equals(ROTO), JSON.stringify(copias(a.carpeta)))

  // (b) La primera escritura: copia EXACTA aparte, y después sustituye.
  const e1 = intentar(() => store.setDriver(PG.id, 'pg-17'))
  const [copia1] = copias(a.carpeta)
  check(
    'la primera escritura guarda ANTES el roto aparte, como db-connections.json.ilegible, con sus BYTES exactos',
    e1.ok && copias(a.carpeta).length === 1 && copia1 === 'db-connections.json.ilegible' && readFileSync(path.join(a.carpeta, copia1)).equals(ROTO),
    e1.ok ? JSON.stringify(copias(a.carpeta)) : e1.error
  )
  check(
    'y DESPUÉS sustituye el principal con lo de la copia de respaldo más el cambio',
    e1.ok && de(disco(a.ruta), PG.id)?.driverId === 'pg-17' && ids(disco(a.ruta)).join() === [ORA.id, PG.id].join(),
    e1.ok ? readFileSync(a.ruta, 'utf-8').slice(0, 80) : e1.error
  )
  check(
    'el .bak no se toca en esa escritura (lo que había en el principal no era un respaldo)',
    readFileSync(`${a.ruta}.bak`, 'utf-8') === BAK,
    readFileSync(`${a.ruta}.bak`, 'utf-8').slice(0, 60)
  )
  const lc2 = store.listaCompleta('p1')
  check(
    '`recuperado` pasa a decir dónde QUEDÓ la copia (en pasado, con su nombre)',
    lc2.formatoAjeno === false &&
      lc2.recuperado === reg.mensajeRegistroRecuperado('.ilegible') &&
      lc2.recuperado.includes('se conservó') &&
      lc2.recuperado.includes('db-connections.json.ilegible,') &&
      // el principal ya ES JSON (lo acaba de sustituir esta escritura), así que
      // el aviso que lo cuenta después no puede seguir diciendo que no lo es.
      lc2.recuperado.includes('no era JSON válido') &&
      !lc2.recuperado.includes('no es JSON válido'),
    String(lc2.formatoAjeno ? '' : lc2.recuperado)
  )
  const e2 = intentar(() => store.reorder('p1', [PG.id, ORA.id]))
  check(
    'NEGATIVO: la segunda escritura no hace otra copia ni toca la primera',
    e2.ok && copias(a.carpeta).length === 1 && readFileSync(path.join(a.carpeta, copia1)).equals(ROTO),
    e2.ok ? JSON.stringify(copias(a.carpeta)) : e2.error
  )

  // (c) El alta en un roto rescatado: una sola copia (el principal se mira al
  // escribir, ver la sección 14, no dos veces). Y un alta que no pasa la validación no deja ninguna.
  const b = rescatable()
  const sb = new ConnectionStore({ storePath: b.ruta })
  const invalida = intentar(() => sb.create({ ...ALTA, alias: '' }))
  check('NEGATIVO: un alta que no pasa la validación no deja copia', !invalida.ok && copias(b.carpeta).length === 0, invalida.ok ? 'CREÓ' : invalida.error)
  const altaB = intentar(() => sb.create(ALTA))
  check(
    'el alta en un roto rescatado: UNA copia exacta y el alta en disco',
    altaB.ok && copias(b.carpeta).length === 1 && readFileSync(path.join(b.carpeta, copias(b.carpeta)[0])).equals(ROTO) && disco(b.ruta).connections.length === 3,
    altaB.ok ? JSON.stringify(copias(b.carpeta)) : altaB.error
  )

  // (d) Un `.ilegible` que YA EXISTE (una copia de otra vez) no se pisa: la nueva lleva la fecha.
  const c = rescatable()
  const ANTERIOR = 'la copia de otra vez\n'
  writeFileSync(path.join(c.carpeta, 'db-connections.json.ilegible'), ANTERIOR)
  const sc = new ConnectionStore({ storePath: c.ruta })
  const ec = intentar(() => sc.setVerificada(ORA.id, true))
  const conFecha = copias(c.carpeta).find(esCopiaConFecha) ?? ''
  check(
    'con un .ilegible ya existente: NO se pisa, y la copia nueva lleva la fecha (.ilegible-AAAAMMDD-HHMMSS) con los bytes exactos',
    ec.ok &&
      readFileSync(path.join(c.carpeta, 'db-connections.json.ilegible'), 'utf-8') === ANTERIOR &&
      copias(c.carpeta).length === 2 &&
      conFecha !== '' &&
      readFileSync(path.join(c.carpeta, conFecha)).equals(ROTO),
    ec.ok ? JSON.stringify(copias(c.carpeta)) : ec.error
  )
  const lcc = sc.listaCompleta('p1')
  check(
    'y `recuperado` nombra la copia CON FECHA, que es la que quedó',
    lcc.formatoAjeno === false && lcc.recuperado === reg.mensajeRegistroRecuperado(conFecha.slice('db-connections.json'.length)),
    String(lcc.formatoAjeno ? '' : lcc.recuperado)
  )
  // Una CARPETA con ese nombre es lo mismo: un nombre ocupado, que no se toca.
  const d = rescatable()
  mkdirSync(path.join(d.carpeta, 'db-connections.json.ilegible'))
  const ed = intentar(() => new ConnectionStore({ storePath: d.ruta }).setDriver(PG.id, 'pg-17'))
  const conFechaD = copias(d.carpeta).find(esCopiaConFecha) ?? ''
  check(
    'con una CARPETA llamada .ilegible: la carpeta sigue ahí, y la copia va al nombre con fecha',
    ed.ok &&
      statSync(path.join(d.carpeta, 'db-connections.json.ilegible')).isDirectory() &&
      conFechaD !== '' &&
      readFileSync(path.join(d.carpeta, conFechaD)).equals(ROTO),
    ed.ok ? JSON.stringify(copias(d.carpeta)) : ed.error
  )

  // (e) LA COPIA IMPOSIBLE: la escritura falla con su aviso y el principal queda byte a byte.
  //   · Un nombre que no cabe: el principal (247 caracteres) y su `.tmp` y su `.bak` caben en
  //     los 255 de un nombre en NTFS y APFS; `.ilegible` (256) no. Es lo único que falla, así
  //     que la escritura atómica sí PODRÍA sustituir el principal: la prueba distingue.
  const largo = mkdtempSync(path.join(dir, 'largo-'))
  const rutaLarga = path.join(largo, 'x'.repeat(247 - '.json'.length) + '.json')
  writeFileSync(rutaLarga, ROTO)
  writeFileSync(`${rutaLarga}.bak`, BAK)
  const sl = new ConnectionStore({ storePath: rutaLarga })
  const el = intentar(() => sl.setDriver(PG.id, 'pg-17'))
  check(
    'la copia no cabe (nombre demasiado largo): la escritura FALLA con su aviso y el principal queda byte a byte',
    !el.ok &&
      el.error.startsWith('No se guardó el cambio') &&
      el.error.includes('db-connections.json.ilegible') &&
      el.error.includes('que no se pudo escribir') &&
      readFileSync(rutaLarga).equals(ROTO),
    el.ok ? 'ESCRIBIÓ' : el.error
  )
  const altaL = intentar(() => sl.create(ALTA))
  check(
    'y el alta falla ANTES de tocar la memoria (no queda una conexión que no existe en disco)',
    !altaL.ok && altaL.error.startsWith('No se guardó el cambio') && !alias(sl).includes('Nueva') && readFileSync(rutaLarga).equals(ROTO),
    altaL.ok ? 'CREÓ' : alias(sl)
  )
  check('NEGATIVO: ni copias a medias ni temporales', readdirSync(largo).length === 2, JSON.stringify(readdirSync(largo).map((f) => f.slice(-12))))

  //   · Una carpeta en la que no se puede CREAR nada, y un principal que no se deja LEER
  //     en el momento de escribir. Los permisos se quitan como en cada sistema (ACL en
  //     Windows, modo en macOS/Linux) y se devuelven siempre.
  /** Quita un permiso y devuelve cómo devolverlo; `null` si aquí no se puede (root en POSIX). */
  function denegar(ruta: string, que: 'crear-en-carpeta' | 'leer-archivo'): (() => void) | null {
    if (esWindows()) {
      const usuario = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : String(process.env.USERNAME)
      const r = spawnSync('icacls', [ruta, '/deny', `${usuario}:${que === 'crear-en-carpeta' ? '(WD,AD)' : '(RD)'}`], { encoding: 'utf-8' })
      if (r.status !== 0) return null
      return () => void spawnSync('icacls', [ruta, '/remove:d', usuario], { encoding: 'utf-8' })
    }
    if (process.getuid?.() === 0) return null
    const antes = statSync(ruta).mode & 0o777
    chmodSync(ruta, que === 'crear-en-carpeta' ? 0o555 : 0o000)
    return () => chmodSync(ruta, antes)
  }
  const sinEscritura = rescatable()
  const ss = new ConnectionStore({ storePath: sinEscritura.ruta })
  const devolverCarpeta = denegar(sinEscritura.carpeta, 'crear-en-carpeta')
  if (devolverCarpeta === null) {
    console.log('  (saltada: aquí no se puede quitar el permiso de escritura de una carpeta)')
  } else {
    let es: ReturnType<typeof intentar>
    try {
      es = intentar(() => ss.setDriver(PG.id, 'pg-17'))
    } finally {
      devolverCarpeta()
    }
    check(
      'carpeta sin permiso para crear la copia: la escritura falla con SU aviso (no con el del temporal) y el principal queda byte a byte',
      !es.ok && es.error.startsWith('No se guardó el cambio') && readFileSync(sinEscritura.ruta).equals(ROTO) && copias(sinEscritura.carpeta).length === 0,
      es.ok ? 'ESCRIBIÓ' : es.error
    )
  }
  const sinLectura = rescatable()
  const sl2 = new ConnectionStore({ storePath: sinLectura.ruta })
  const devolverArchivo = denegar(sinLectura.ruta, 'leer-archivo')
  if (devolverArchivo === null) {
    console.log('  (saltada: aquí no se puede quitar el permiso de lectura de un archivo)')
  } else {
    let eu: ReturnType<typeof intentar>
    try {
      eu = intentar(() => sl2.setDriver(PG.id, 'pg-17'))
    } finally {
      devolverArchivo()
    }
    // Sin la guarda, el renombrado lo sustituye: en Windows, un archivo que no se deja leer
    // se deja reemplazar (medido); en POSIX, basta con poder escribir en la carpeta.
    check(
      'el roto rescatado no se deja LEER al escribir: sin copia no se sustituye (falla con su aviso, principal byte a byte)',
      !eu.ok && eu.error.startsWith('No se guardó el cambio') && readFileSync(sinLectura.ruta).equals(ROTO) && copias(sinLectura.carpeta).length === 0,
      eu.ok ? 'ESCRIBIÓ' : eu.error
    )
    // el aviso decía que la COPIA «no se pudo escribir» y mandaba a los permisos
    // de la CARPETA, cuando lo que falla es abrir el propio archivo.
    check(
      'y ese aviso dice lo que falló de verdad: el archivo no se deja LEER (no «la copia no se pudo escribir» ni la carpeta)',
      !eu.ok &&
        eu.error === reg.mensajeCopiaIlegibleFallida(eu.error.match(/\(([A-Z]+)\)\. El archivo/)?.[1] ?? '?', 'leer') &&
        eu.error.includes('no se deja leer para copiarlo') &&
        !eu.error.includes('que no se pudo escribir') &&
        !eu.error.includes('permisos de su carpeta'),
      eu.ok ? 'ESCRIBIÓ' : eu.error
    )
    // NEGATIVO: ya COPIADO (o sin nada que copiar), el tropiezo al leer se deja a la
    // escritura, como siempre (un bloqueo pasajero del antivirus no debe perder cambios).
    const hecho = rescatable()
    const sh = new ConnectionStore({ storePath: hecho.ruta })
    const primera = intentar(() => sh.setDriver(PG.id, 'pg-17'))
    const devolver2 = denegar(hecho.ruta, 'leer-archivo')
    let segunda: ReturnType<typeof intentar> = { ok: false, error: 'sin permisos que quitar' }
    try {
      segunda = intentar(() => sh.setVerificada(ORA.id, true))
    } finally {
      devolver2?.()
    }
    check(
      'NEGATIVO: con la copia ya hecha, un principal que no se deja leer NO frena la escritura (lo de siempre)',
      primera.ok && segunda.ok && copias(hecho.carpeta).length === 1 && de(disco(hecho.ruta), ORA.id)?.verificadaEn !== undefined,
      primera.ok ? (segunda.ok ? 'escribió' : segunda.error) : primera.error
    )
  }

  // (f) LAS MITADES NEGATIVAS: donde no hay nada que perder, ni copia ni aviso.
  for (const [que, preparar] of [
    ['principal de cero bytes', (r: string) => writeFileSync(r, '')],
    ['principal ausente', (r: string) => rmSync(r)]
  ] as const) {
    const n0 = rescatable()
    preparar(n0.ruta)
    const s0 = new ConnectionStore({ storePath: n0.ruta })
    const l0 = s0.listaCompleta('p1')
    const w0 = intentar(() => s0.setDriver(PG.id, 'pg-17'))
    check(
      `NEGATIVO: ${que} con un .bak legible: se usa el .bak sin \`recuperado\`, y la escritura no deja copia`,
      l0.formatoAjeno === false && l0.recuperado === undefined && alias(s0) === DE_LA_COPIA.join() && w0.ok && copias(n0.carpeta).length === 0,
      w0.ok ? JSON.stringify({ recuperado: l0.formatoAjeno ? null : l0.recuperado, copias: copias(n0.carpeta) }) : w0.error
    )
  }
  const bien = new ConnectionStore({ storePath: archivo(BAK) })
  check('NEGATIVO: un registro que se lee bien no trae `recuperado`', !('recuperado' in bien.listaCompleta('p1')), JSON.stringify(Object.keys(bien.listaCompleta('p1'))))
  // El usuario ARREGLA el roto con Tessera abierta antes de la primera escritura (el aviso
  // de la recuperación le acaba de decir que no es JSON). MEDIDO: antes esto se
  // dejaba escribir —ya no había nada ilegible que copiar—, la primera escritura guardaba el
  // arreglo en el `.bak` y ponía encima lo del `.bak` viejo, y la segunda pisaba ese `.bak`:
  // la edición a mano que la copia aparte existe para conservar no quedaba en ningún
  // archivo. Ahora se niega (lo de memoria sale del `.bak`, no de su arreglo) hasta reiniciar.
  const arreglado = rescatable()
  const sa = new ConnectionStore({ storePath: arreglado.ruta })
  const MIA = { ...PG, id: 'mia-1', alias: 'LA-QUE-CORREGI-A-MANO', orden: 5 }
  const ARREGLO = JSON.stringify({ version: 1, connections: [ORA, MIA] })
  writeFileSync(arreglado.ruta, ARREGLO)
  const ea1 = intentar(() => sa.setDriver(PG.id, 'pg-17'))
  const ea2 = intentar(() => sa.setVerificada(ORA.id, true))
  const altaA = intentar(() => sa.create(ALTA))
  check(
    'arreglado a mano con Tessera abierta: las escrituras se NIEGAN con su aviso, y el arreglo sigue en el principal byte a byte',
    !ea1.ok &&
      ea1.error === reg.MENSAJE_RESCATADO_CORREGIDO &&
      !ea2.ok &&
      ea2.error === reg.MENSAJE_RESCATADO_CORREGIDO &&
      readFileSync(arreglado.ruta, 'utf-8') === ARREGLO &&
      readFileSync(`${arreglado.ruta}.bak`, 'utf-8') === BAK &&
      copias(arreglado.carpeta).length === 0,
    ea1.ok ? `ESCRIBIÓ: ${readFileSync(arreglado.ruta, 'utf-8').slice(0, 60)}` : ea1.error
  )
  check(
    'y el alta se niega ANTES de tocar la memoria (ninguna conexión fantasma)',
    !altaA.ok && altaA.error === reg.MENSAJE_RESCATADO_CORREGIDO && !alias(sa).includes('Nueva'),
    altaA.ok ? 'CREÓ' : alias(sa)
  )
  check(
    'el aviso dice qué pasó y qué hacer: ya es JSON, Tessera sigue con el .bak, reiniciar',
    reg.MENSAJE_RESCATADO_CORREGIDO.startsWith('No se guardó el cambio') &&
      reg.MENSAJE_RESCATADO_CORREGIDO.includes('ya es JSON válido') &&
      reg.MENSAJE_RESCATADO_CORREGIDO.includes('db-connections.json.bak') &&
      reg.MENSAJE_RESCATADO_CORREGIDO.includes('Reinicia Tessera'),
    reg.MENSAJE_RESCATADO_CORREGIDO
  )
  // Al reiniciar, el principal ya legible manda: se ve el arreglo, sin aviso, y se escribe.
  const sa2 = new ConnectionStore({ storePath: arreglado.ruta })
  const ea3 = intentar(() => sa2.setDriver(MIA.id, 'pg-17'))
  check(
    'al reiniciar se lee el arreglo (sin `recuperado`) y la escritura lo conserva',
    alias(sa2) === ['ORA-QA', 'LA-QUE-CORREGI-A-MANO'].join() &&
      sa2.listaCompleta('p1').recuperado === undefined &&
      ea3.ok &&
      ids(disco(arreglado.ruta)).join() === [ORA.id, MIA.id].join() &&
      de(disco(arreglado.ruta), MIA.id)?.driverId === 'pg-17',
    ea3.ok ? alias(sa2) : ea3.error
  )
  // NEGATIVOS: vaciado a cero bytes o apartado (la salida que da el aviso de la copia) con
  // Tessera abierta: no hay nada que perder, y se escribe sin copia.
  for (const [que, preparar] of [
    ['vaciado a cero bytes', (r: string) => writeFileSync(r, '')],
    ['apartado (borrado del sitio)', (r: string) => rmSync(r)]
  ] as const) {
    const v = rescatable()
    const sv = new ConnectionStore({ storePath: v.ruta })
    preparar(v.ruta)
    const ev = intentar(() => sv.setDriver(PG.id, 'pg-17'))
    check(
      `NEGATIVO: el roto rescatado ${que} con Tessera abierta: se escribe, sin copia`,
      ev.ok && copias(v.carpeta).length === 0 && de(disco(v.ruta), PG.id)?.driverId === 'pg-17',
      ev.ok ? JSON.stringify(copias(v.carpeta)) : ev.error
    )
  }

  // (g) El principal que NO SE DEJA ABRIR, con un `.bak` legible: BLOQUEADO (antes se usaba
  // el `.bak`, una escritura más viejo, y la primera escritura lo sustituía renombrando).
  const bloq = mkdtempSync(path.join(dir, 'inaccesible-'))
  const rutaBloq = path.join(bloq, 'db-connections.json')
  mkdirSync(rutaBloq)
  writeFileSync(`${rutaBloq}.bak`, BAK)
  const sg = new ConnectionStore({ storePath: rutaBloq })
  const lg = sg.listaCompleta('p1')
  const avisoBloq = reg.mensajeRegistroIlegible({ tipo: 'inaccesible', codigo: 'EISDIR' }, 'legible')
  check(
    'no se deja abrir (EISDIR) y el .bak SÍ se lee: bloqueado, sin listar, con el aviso que dice que la copia no se usa',
    sg.formatoAjeno === true && lg.formatoAjeno === true && lg.aviso === avisoBloq && lg.conexiones.length === 0 && lg.ajenas.length === 0,
    JSON.stringify(lg)
  )
  check(
    'el aviso dice qué pasa con la copia y qué hacer (permisos u otro programa, y reiniciar)',
    avisoBloq.includes('su copia de respaldo (db-connections.json.bak), aunque se lee, no se usa') &&
      avisoBloq.includes('revisa sus permisos, o si otro programa lo tiene abierto') &&
      avisoBloq.includes('reinicia Tessera') &&
      !avisoBloq.includes('tampoco sirve'),
    avisoBloq
  )
  const altaG = intentar(() => sg.create(ALTA))
  intentar(() => sg.pruneProfiles(new Set()))
  check(
    'y no se escribe nada: el alta falla con ese aviso, el .bak sigue igual y no aparece ninguna copia',
    !altaG.ok && altaG.error === avisoBloq && readFileSync(`${rutaBloq}.bak`, 'utf-8') === BAK && statSync(rutaBloq).isDirectory() && readdirSync(bloq).length === 2,
    altaG.ok ? 'CREÓ' : JSON.stringify(readdirSync(bloq))
  )

  // (h) El módulo puro.
  check(
    'puro: los nombres de la copia, en orden (sin fecha; con la fecha LOCAL; y -2… si el segundo ya tiene una)',
    JSON.stringify(reg.sufijosCopiaIlegible(new Date(2026, 8, 27, 15, 30, 12))) ===
      JSON.stringify([
        '.ilegible',
        '.ilegible-20260927-153012',
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => `.ilegible-20260927-153012-${i}`)
      ]) && reg.sufijosCopiaIlegible(new Date(2026, 0, 5, 3, 4, 5))[1] === '.ilegible-20260105-030405',
    JSON.stringify(reg.sufijosCopiaIlegible(new Date(2026, 0, 5, 3, 4, 5)).slice(0, 3))
  )
  const ilegibles: Array<[string, boolean]> = [
    ['{ roto', true],
    ['{"a":1,}', true],
    ['', false],
    ['  \n\t', false],
    ['\uFEFF', false],
    ['{}', false],
    ['null', false],
    ['{"version":"2"}', false]
  ]
  const malIlegibles = ilegibles.filter(([t, esperado]) => reg.esContenidoIlegible(t) !== esperado)
  check(`puro: esContenidoIlegible decide bien los ${ilegibles.length} casos (lo vacío no se pierde; el JSON lo guarda el .bak)`, malIlegibles.length === 0, JSON.stringify(malIlegibles))
  const lectura = (archivos: Record<string, string | Error>): ReturnType<typeof reg.lecturaConRespaldo> =>
    reg.lecturaConRespaldo((r) => {
      const v = archivos[r]
      if (v instanceof Error) throw v
      return v ?? null
    }, 'r.json')
  const acceso = Object.assign(new Error('sin permiso'), { code: 'EACCES' })
  const lecturas: Array<[string, Record<string, string | Error>, string]> = [
    ['principal bueno', { 'r.json': BAK, 'r.json.bak': '{}' }, 'principal/-/libre'],
    ['roto + .bak legible', { 'r.json': '{ roto', 'r.json.bak': BAK }, 'respaldo/rescate/libre'],
    ['roto + .bak de formato ajeno', { 'r.json': '{ roto', 'r.json.bak': '{"version":"2"}' }, 'respaldo/-/bloqueado'],
    ['vacío + .bak legible', { 'r.json': '', 'r.json.bak': BAK }, 'respaldo/-/libre'],
    ['ausente + .bak legible', { 'r.json.bak': BAK }, 'respaldo/-/libre'],
    ['inaccesible + .bak legible', { 'r.json': acceso, 'r.json.bak': BAK }, 'ninguno/-/bloqueado'],
    ['inaccesible sin .bak', { 'r.json': acceso }, 'ninguno/-/bloqueado'],
    ['roto sin .bak', { 'r.json': '{ roto' }, 'ninguno/-/bloqueado'],
    ['ausente + .bak roto', { 'r.json.bak': '{ roto' }, 'ninguno/-/libre']
  ]
  const malLecturas = lecturas
    .map(([n, archivos, esperado]) => {
      const l = lectura(archivos)
      return [n, `${l.origen}/${l.rescateDeRoto ? 'rescate' : '-'}/${l.reg.formatoAjeno ? 'bloqueado' : 'libre'}`, esperado] as const
    })
    .filter(([, real, esperado]) => real !== esperado)
  check(`puro: lecturaConRespaldo da el origen, el rescate y el bloqueo de ${lecturas.length} casos`, malLecturas.length === 0, JSON.stringify(malLecturas))
  const inacc = lectura({ 'r.json': acceso, 'r.json.bak': BAK })
  check(
    'puro: el inaccesible con .bak legible lleva el aviso con la copia «legible» y su código',
    inacc.reg.aviso === reg.mensajeRegistroIlegible({ tipo: 'inaccesible', codigo: 'EACCES' }, 'legible') && /no se pudo abrir \(EACCES\)/.test(inacc.reg.aviso ?? ''),
    String(inacc.reg.aviso)
  )
  const fallida = reg.mensajeCopiaIlegibleFallida('EACCES')
  check(
    'puro: el aviso de la copia imposible dice qué no se guardó, por qué, el código y las dos salidas',
    fallida.startsWith('No se guardó el cambio') &&
      fallida.includes('db-connections.json.ilegible') &&
      fallida.includes('(EACCES)') &&
      fallida.includes('permisos') &&
      fallida.includes('apártalo tú'),
    fallida
  )
}

hr('(12) borrar SOLO la entrada que se pidió cuando dos comparten id')
{
  // Una conocida y una ajena con el MISMO id (solo por edición a mano). Antes, eliminar
  // cualquiera de las dos se llevaba las dos, y el diálogo solo nombraba la pulsada.
  const K = { id: 'dup-1', profileId: 'p1', alias: 'Conocida', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true, orden: 0 }
  const A = { id: 'dup-1', profileId: 'p1', alias: 'Ajena', motor: 'sqlite', ruta: 'x.db', orden: 1 }
  const A2 = { id: 'dup-1', profileId: 'p1', alias: 'Ajena bis', motor: 'duckdb', ruta: 'y.db', orden: 2 }
  const OTRA = { id: 'otra-1', profileId: 'p1', alias: 'Otra', motor: 'oracle', host: 'h', port: 1521, sid: 'S', user: 'u', readonly: true, orden: 3 }

  // El módulo puro.
  const entradas = reg.leerRegistro(JSON.stringify({ version: 1, connections: [K, A, A2, OTRA] }))!.entradas
  const alias = (l: readonly Entrada[]): string =>
    JSON.stringify(l.map((e) => (e.tipo === 'conocida' ? e.registro.alias : (e.crudo as { alias: string }).alias)))
  const qa = reg.quitarPorId(entradas, 'dup-1', 'ajena')
  check(
    "puro: con tipo 'ajena' se quita SOLO la primera ajena; la conocida y la otra ajena siguen",
    qa.quitadas === 1 && qa.perfil === 'p1' && qa.quedan === 2 && alias(qa.entradas) === '["Conocida","Ajena bis","Otra"]',
    `${alias(qa.entradas)} quedan=${qa.quedan}`
  )
  const qk = reg.quitarPorId(entradas, 'dup-1', 'conocida')
  check(
    "puro: con tipo 'conocida' se quita SOLO la conocida",
    qk.quitadas === 1 && qk.quedan === 2 && alias(qk.entradas) === '["Ajena","Ajena bis","Otra"]',
    alias(qk.entradas)
  )
  const qs = reg.quitarPorId(entradas, 'dup-1')
  check(
    'puro: sin tipo, la conocida (a la que resuelve el id en get/update/secretOf), y solo ella',
    qs.quitadas === 1 && alias(qs.entradas) === '["Ajena","Ajena bis","Otra"]',
    alias(qs.entradas)
  )
  const soloAjenas = reg.quitarPorId(qk.entradas, 'dup-1')
  check(
    'puro: sin tipo y sin conocida, la PRIMERA ajena (de una en una)',
    soloAjenas.quitadas === 1 && soloAjenas.quedan === 1 && alias(soloAjenas.entradas) === '["Ajena bis","Otra"]',
    alias(soloAjenas.entradas)
  )
  const nada = reg.quitarPorId(qk.entradas, 'dup-1', 'conocida')
  check(
    'puro NEGATIVO: pedir la conocida cuando solo hay ajenas con ese id no quita nada (ni una ajena por error)',
    nada.quitadas === 0 && nada.perfil === null && nada.quedan === 2 && alias(nada.entradas) === alias(qk.entradas),
    `quitadas=${nada.quitadas} quedan=${nada.quedan}`
  )

  // El store real, con el disco.
  const ruta = archivo({ version: 1, connections: [K, A, OTRA] })
  const store = new ConnectionStore({ storePath: ruta })
  check('el store ve la conocida en list y la ajena en ajenas (el mismo id)', store.list('p1').some((c) => c.id === 'dup-1') && store.ajenas('p1').some((a) => a.id === 'dup-1'), 'ambas')
  const rAjena = store.remove('dup-1', 'ajena')
  const d1 = disco(ruta)
  // `get(id)` es la regla de la limpieza por id tras borrar (ver `ConnectionStore.remove`):
  // si sigue devolviendo una conocida, lo que cuelga de ese id (sesiones, consolas,
  // historial) es suyo y NO se limpia.
  check(
    'eliminar la AJENA deja la conocida en el disco, en list y en get: lo que cuelga del id es suyo y no se limpia',
    rAjena === 'p1' &&
      JSON.stringify(d1.connections.map((c) => (c as Crudo).alias)) === '["Conocida","Otra"]' &&
      store.list('p1').some((c) => c.id === 'dup-1') &&
      !store.ajenas('p1').some((a) => a.id === 'dup-1') &&
      store.get('dup-1')?.alias === 'Conocida',
    JSON.stringify(d1.connections.map((c) => (c as Crudo).alias))
  )
  const antes = readFileSync(ruta, 'utf-8')
  const rOtraVez = store.remove('dup-1', 'ajena')
  check('NEGATIVO: pedir otra vez la ajena, que ya no está, no toca la conocida ni escribe', rOtraVez === null && readFileSync(ruta, 'utf-8') === antes, String(rOtraVez))
  const rConocida = store.remove('dup-1', 'conocida')
  check(
    'eliminar la conocida la quita; ahora el id ya no existe',
    rConocida === 'p1' && !de(disco(ruta), 'dup-1') && store.get('dup-1') === undefined && store.get('otra-1') !== undefined,
    JSON.stringify(ids(disco(ruta)))
  )
  // Y al revés: eliminar la conocida primero deja la ajena. Aquí el
  // id SIGUE existiendo (en la ajena), y aun así lo que colgaba de él era de la conocida
  // borrada —su sesión abierta, sus consolas—: `get` ya no la encuentra, así que se limpia.
  // La regla «no limpiar si el id sigue existiendo» la habría dejado viva.
  const ruta2 = archivo({ version: 1, connections: [K, A] })
  const store2 = new ConnectionStore({ storePath: ruta2 })
  const r2 = store2.remove('dup-1', 'conocida')
  check(
    'eliminar la CONOCIDA deja la ajena tal cual en el disco (y en ajenas), y get ya no da nada: se limpia lo suyo',
    r2 === 'p1' &&
      JSON.stringify(disco(ruta2).connections) === JSON.stringify([A]) &&
      store2.ajenas('p1').some((a) => a.alias === 'Ajena') &&
      store2.get('dup-1') === undefined,
    JSON.stringify(disco(ruta2).connections)
  )
  // Sin tipo (lo que manda hoy la UI, solo el id): la conocida, y también se limpia lo suyo.
  const ruta3 = archivo({ version: 1, connections: [A, K] })
  const store3 = new ConnectionStore({ storePath: ruta3 })
  const r3 = store3.remove('dup-1')
  check(
    'sin tipo, con la ajena DELANTE en el archivo: se borra la conocida (a la que resuelve el id), no la primera',
    r3 === 'p1' && JSON.stringify(disco(ruta3).connections) === JSON.stringify([A]) && store3.get('dup-1') === undefined,
    JSON.stringify(disco(ruta3).connections)
  )

  // El contrato del DELETE (`DbBorrarConexion.ajena`) y lo que
  // el `DbController` decide con `borrar`: limpiar lo que cuelga del id (sesiones,
  // consolas, historial; y el renderer, los montajes) SOLO si no queda una conocida.
  check(
    "tipoEntradaPedida: true -> 'ajena', false -> 'conocida'",
    reg.tipoEntradaPedida(true) === 'ajena' && reg.tipoEntradaPedida(false) === 'conocida',
    `${reg.tipoEntradaPedida(true)} / ${reg.tipoEntradaPedida(false)}`
  )
  const raros = [undefined, null, 'true', 1, 0, {}, 'ajena'].map((v) => reg.tipoEntradaPedida(v))
  check(
    'NEGATIVO: ausente (renderer anterior) o cualquier cosa que no es un booleano -> sin tipo (la conocida); nunca «ajena» adivinada',
    raros.every((t) => t === undefined),
    JSON.stringify(raros)
  )
  const ruta4 = archivo({ version: 1, connections: [K, A, OTRA] })
  const store4 = new ConnectionStore({ storePath: ruta4 })
  const bAjena = store4.borrar('dup-1', reg.tipoEntradaPedida(true))
  check(
    'DELETE de la fila AJENA que comparte id: borrada, y QUEDA la conocida (no se limpia nada del id ni se desmonta)',
    bAjena.borrada && bAjena.perfil === 'p1' && bAjena.quedaConocida && store4.get('dup-1')?.alias === 'Conocida' && !store4.ajenas('p1').some((a) => a.id === 'dup-1'),
    JSON.stringify(bAjena)
  )
  const bConocida = store4.borrar('dup-1', reg.tipoEntradaPedida(false))
  check(
    'DELETE de la CONOCIDA: borrada y ya no queda ninguna conocida con el id (se limpia lo suyo)',
    bConocida.borrada && bConocida.perfil === 'p1' && !bConocida.quedaConocida,
    JSON.stringify(bConocida)
  )
  const ruta5 = archivo({ version: 1, connections: [K, A] })
  const store5 = new ConnectionStore({ storePath: ruta5 })
  const bK5 = store5.borrar('dup-1', reg.tipoEntradaPedida(false))
  check(
    'DELETE de la CONOCIDA con una ajena del mismo id DETRÁS: se limpia igual (la regla es «queda una conocida», no «queda el id»)',
    bK5.borrada && !bK5.quedaConocida && store5.ajenas('p1').some((a) => a.id === 'dup-1'),
    JSON.stringify(bK5)
  )
  const bNada = store5.borrar('no-existe', undefined)
  check('NEGATIVO: un id que no existe: nada borrado, sin perfil (no se avisa de un borrado que no ocurrió)', !bNada.borrada && bNada.perfil === null && !bNada.quedaConocida, JSON.stringify(bNada))
  const bOtraVez = store5.borrar('dup-1', reg.tipoEntradaPedida(false))
  check(
    'NEGATIVO: pedir la conocida que ya no está no borra la ajena por error',
    !bOtraVez.borrada && store5.ajenas('p1').some((a) => a.id === 'dup-1'),
    JSON.stringify(bOtraVez)
  )

  // QUÉ HACE EL DELETE con lo que cuelga del id
  // (`limpiezaTrasBorrar`, la decisión que toma `DbController`). Tres salidas, y cada una
  // con su mitad negativa.
  const lim = reg.limpiezaTrasBorrar
  check(
    "limpieza: se borró la CONOCIDA y no queda ninguna -> 'borrada' (sesiones, consolas a la papelera, historial)",
    lim({ borrada: true, tipo: 'conocida', quedaConocida: false }) === 'borrada',
    lim({ borrada: true, tipo: 'conocida', quedaConocida: false })
  )
  check(
    "limpieza: se borró una AJENA y no hay conocida con su id -> 'borrada' (sus consolas de cuando era conocida)",
    lim({ borrada: true, tipo: 'ajena', quedaConocida: false }) === 'borrada',
    lim({ borrada: true, tipo: 'ajena', quedaConocida: false })
  )
  check(
    "limpieza NEGATIVA: se borró la ajena y SIGUE la conocida que compartía el id -> 'ninguna' (lo del id es de la conocida, que no cambió)",
    lim({ borrada: true, tipo: 'ajena', quedaConocida: true }) === 'ninguna',
    lim({ borrada: true, tipo: 'ajena', quedaConocida: true })
  )
  check(
    "limpieza NEGATIVA: no se borró nada -> 'ninguna' (no se avisa de un borrado que no ocurrió)",
    lim({ borrada: false, tipo: null, quedaConocida: false }) === 'ninguna' && lim({ borrada: false, tipo: null, quedaConocida: true }) === 'ninguna',
    'ninguna'
  )
  // DOS CONOCIDAS con el mismo id (a mano). La segunda se LEE como ajena
  // (id repetido, sección 13): borrar la primera no deja ninguna conocida con ese id, así que es 'borrada' —se limpia lo suyo y
  // se desmonta— y el id no pasa en silencio a otro servidor. 'cambiada' queda como defensa.
  const K2 = { ...K, alias: 'Conocida bis', host: 'otro-servidor', orden: 1 }
  const ruta6 = archivo({ version: 1, connections: [K, K2] })
  const store6 = new ConnectionStore({ storePath: ruta6 })
  const antesK = store6.get('dup-1')
  const b6 = store6.borrar('dup-1', reg.tipoEntradaPedida(false))
  const despuesK = store6.get('dup-1')
  check(
    "DOS conocidas con el mismo id: la segunda es ajena, así que borrar la primera NO deja el id resolviendo a otro servidor -> 'borrada'",
    b6.borrada &&
      b6.tipo === 'conocida' &&
      !b6.quedaConocida &&
      antesK?.host === 'h' &&
      despuesK === undefined &&
      reg.limpiezaTrasBorrar(b6) === 'borrada' &&
      JSON.stringify(disco(ruta6).connections) === JSON.stringify([K2]),
    JSON.stringify({ b6, antes: antesK?.host, despues: despuesK?.host ?? null })
  )
  check(
    "limpieza (defensa): si algún camino dejara dos conocidas con un id, borrar una con la otra detrás sigue siendo 'cambiada'",
    lim({ borrada: true, tipo: 'conocida', quedaConocida: true }) === 'cambiada',
    lim({ borrada: true, tipo: 'conocida', quedaConocida: true })
  )
  const ruta7 = archivo({ version: 1, connections: [K, A] })
  const store7 = new ConnectionStore({ storePath: ruta7 })
  const b7 = store7.borrar('dup-1', reg.tipoEntradaPedida(true))
  check(
    "NEGATIVO del anterior: borrar la AJENA junto a una conocida da el tipo 'ajena' y 'ninguna' (la conocida no cambió)",
    b7.borrada && b7.tipo === 'ajena' && b7.quedaConocida && reg.limpiezaTrasBorrar(b7) === 'ninguna',
    JSON.stringify(b7)
  )
}

hr('(13) una conocida cuyo id YA TIENE otra anterior es AJENA (id repetido)')
{
  // Una entrada copiada y pegada a mano: la MISMA forma, el mismo id, otro alias y otra
  // contraseña. Antes las dos eran conocidas y todo lo que va por id (get, update,
  // secretOf, el DELETE, el explorador) iba a la primera: la copia se pintaba con su alias
  // y abría el servidor de la otra con su contraseña, también desde OTRO perfil (los ids son
  // de todo el registro).
  const K = { id: 'rep-1', profileId: 'p1', alias: 'Original', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'u', readonly: true, orden: 0, secretEnc: enc('clave-original') }
  const COPIA = { ...K, alias: 'Copia', host: 'otro.lan', orden: 1, secretEnc: enc('clave-copia'), campoFuturo: { x: 1 } }
  const DE_P2 = { ...K, profileId: 'p2', alias: 'De otro perfil', orden: 0, secretEnc: enc('clave-p2') }
  const OTRA = { id: 'otra-2', profileId: 'p1', alias: 'Otra', motor: 'postgres', host: 'pg', port: 5432, database: 'd', user: 'u', readonly: true, orden: 2 }
  const texto = JSON.stringify({ version: 1, connections: [K, COPIA, DE_P2, OTRA] })

  // El módulo puro.
  const leido = reg.leerRegistro(texto)!
  const forma = leido.entradas.map((e) => (e.tipo === 'conocida' ? 'conocida' : e.idRepetido ? 'repetida' : 'ajena'))
  check(
    'puro: la primera de un id es la conocida; las demás de forma conocida con ese id, AJENAS por id repetido (también la de otro perfil)',
    JSON.stringify(forma) === '["conocida","repetida","repetida","conocida"]',
    JSON.stringify(forma)
  )
  const LITE = { id: 'rep-1', profileId: 'p1', alias: 'Lite', motor: 'sqlite', ruta: 'a.db' }
  const conLite = reg.leerRegistro(JSON.stringify({ connections: [LITE, K, COPIA] }))!
  const formaLite = conLite.entradas.map((e) => (e.tipo === 'conocida' ? 'conocida' : e.idRepetido ? 'repetida' : 'ajena'))
  check(
    'puro NEGATIVO: una ajena de motor con ese id DELANTE no cuenta como «anterior» (no es una conexión que se use): la primera conocida sigue siéndolo',
    JSON.stringify(formaLite) === '["ajena","conocida","repetida"]',
    JSON.stringify(formaLite)
  )
  check(
    'puro: al escribir, la copia vuelve al disco TAL CUAL y en su sitio (con su contraseña y su campo futuro)',
    reg.serializarRegistro(leido) === JSON.stringify({ version: 1, connections: [K, COPIA, DE_P2, OTRA] }, null, 2) + '\n',
    reg.serializarRegistro(leido).slice(0, 200)
  )

  // El store real.
  const ruta = archivo(texto)
  const store = new ConnectionStore({ storePath: ruta })
  const l1 = store.list('p1').map((c) => c.alias)
  const a1 = store.ajenas('p1')
  check(
    'list(p1) solo tiene la ORIGINAL (y la otra); la copia sale en ajenas con quién comparte el id',
    JSON.stringify(l1) === '["Original","Otra"]' &&
      JSON.stringify(a1) ===
        JSON.stringify([{ id: 'rep-1', profileId: 'p1', alias: 'Copia', motor: 'oracle', idRepetido: { tipo: 'conexion', alias: 'Original' } }]),
    `${JSON.stringify(l1)} ${JSON.stringify(a1)}`
  )
  const l2 = store.list('p2')
  const a2 = store.ajenas('p2')
  check(
    'en OTRO perfil: la copia no sale en list y sí en ajenas, sin nombrar la de p1 (las conexiones son privadas de su perfil)',
    l2.length === 0 && JSON.stringify(a2) === JSON.stringify([{ id: 'rep-1', profileId: 'p2', alias: 'De otro perfil', motor: 'oracle', idRepetido: { tipo: 'otroPerfil' } }]),
    `${JSON.stringify(l2)} ${JSON.stringify(a2)}`
  )
  check(
    'NEGATIVO: ni get ni secretOf ni los secretos de un perfil dan la copia (antes, abrir la de p2 desde su perfil abría la original de p1 con su contraseña)',
    store.get('rep-1')?.alias === 'Original' &&
      store.get('rep-1')?.host === 'db.lan' &&
      store.secretOf('rep-1') === 'clave-original' &&
      store.secretsForProfile('p2').length === 0,
    JSON.stringify({ get: store.get('rep-1')?.alias, secreto: store.secretOf('rep-1'), p2: store.secretsForProfile('p2') })
  )
  const choque = intentar(() => store.create({ profileId: 'p1', alias: 'Copia', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }))
  check('dar de alta otra con el alias de la copia choca, como con cualquier ajena (tdb las ve)', !choque.ok && /ya tiene una conexión llamada "Copia"/.test(choque.error), choque.ok ? 'se creó' : choque.error)

  // Las escrituras rutinarias no la tocan.
  store.marcarVerificada('rep-1', null, 1700000000000)
  store.update('rep-1', formDe(store.get('rep-1')!, { alias: 'Original2' }))
  const d = disco(ruta)
  check(
    'marcarVerificada y update van a la ORIGINAL; la copia y la de p2 siguen en el disco byte a byte y en su sitio',
    JSON.stringify(ids(d)) === '["rep-1","rep-1","rep-1","otra-2"]' &&
      (d.connections[0] as Crudo).alias === 'Original2' &&
      (d.connections[0] as Crudo).verificadaEn === 1700000000000 &&
      JSON.stringify(d.connections[1]) === JSON.stringify(COPIA) &&
      JSON.stringify(d.connections[2]) === JSON.stringify(DE_P2),
    JSON.stringify(d.connections.map((c) => (c as Crudo).alias))
  )
  check(
    'y la copia dice ya el alias NUEVO de la original (se mira al listar, no al leer)',
    JSON.stringify(store.ajenas('p1')[0]?.idRepetido) === JSON.stringify({ tipo: 'conexion', alias: 'Original2' }),
    JSON.stringify(store.ajenas('p1')[0]?.idRepetido)
  )

  // Eliminar la copia (la fila ajena): se va SOLO ella; la original, en list, en get y con lo
  // suyo (`quedaConocida`: ni se limpia ni se desmonta).
  const bCopia = store.borrar('rep-1', reg.tipoEntradaPedida(true))
  const d2 = disco(ruta)
  check(
    'eliminar la copia la quita del disco y deja la original y la de p2; queda la conocida -> nada se limpia ni se desmonta',
    bCopia.borrada &&
      bCopia.tipo === 'ajena' &&
      bCopia.quedaConocida &&
      reg.limpiezaTrasBorrar(bCopia) === 'ninguna' &&
      JSON.stringify(d2.connections.map((c) => (c as Crudo).alias)) === '["Original2","De otro perfil","Otra"]' &&
      store.get('rep-1')?.alias === 'Original2',
    JSON.stringify({ bCopia, disco: d2.connections.map((c) => (c as Crudo).alias) })
  )
  // Y si se elimina la ORIGINAL, la de p2 no la hereda en esta sesión: no hay conocida con el
  // id (se limpia y se desmonta lo de la original), y la de p2 lo dice hasta reiniciar.
  const bOriginal = store.borrar('rep-1', reg.tipoEntradaPedida(false))
  check(
    "eliminar la original: 'borrada' (no pasa el id en silencio a otra conexión), y la de p2 dice que la otra se eliminó",
    bOriginal.borrada &&
      !bOriginal.quedaConocida &&
      reg.limpiezaTrasBorrar(bOriginal) === 'borrada' &&
      store.get('rep-1') === undefined &&
      JSON.stringify(store.ajenas('p2')[0]?.idRepetido) === JSON.stringify({ tipo: 'eliminada' }),
    JSON.stringify({ bOriginal, p2: store.ajenas('p2') })
  )
  // Al reiniciar (otro store sobre el mismo archivo), la de p2 es la primera de su id: conocida.
  const reinicio = new ConnectionStore({ storePath: ruta })
  check(
    'al reiniciar, la que quedaba es la primera de su id y pasa a ser la conocida',
    reinicio.list('p2').some((c) => c.alias === 'De otro perfil') && reinicio.ajenas('p2').length === 0 && reinicio.secretOf('rep-1') === 'clave-p2',
    JSON.stringify({ list: reinicio.list('p2').map((c) => c.alias), ajenas: reinicio.ajenas('p2') })
  )

  // DOS AJENAS con el mismo id —la copia y una de motor—: con el id y el tipo se borraba la
  // PRIMERA del archivo (la de motor), aunque se pulsara la copia. El alias de la fila decide.
  const LITE_REP = { id: 'rep-1', profileId: 'p1', alias: 'Lite', motor: 'sqlite', ruta: 'a.db', orden: 1 }
  const COPIA2 = { ...COPIA, orden: 2 }
  const dosAjenas = reg.leerRegistro(JSON.stringify({ version: 1, connections: [K, LITE_REP, COPIA2] }))!.entradas
  const aliasDe = (l: readonly Entrada[]): string =>
    JSON.stringify(l.map((e) => (e.tipo === 'conocida' ? e.registro.alias : (e.crudo as { alias: string }).alias)))
  const qCopia = reg.quitarPorId(dosAjenas, 'rep-1', 'ajena', 'Copia')
  const qLite = reg.quitarPorId(dosAjenas, 'rep-1', 'ajena', 'Lite')
  const qNinguna = reg.quitarPorId(dosAjenas, 'rep-1', 'ajena', 'No existe')
  const qSinAlias = reg.quitarPorId(dosAjenas, 'rep-1', 'ajena')
  check(
    'dos ajenas con el mismo id: el alias de la fila pulsada decide cuál se va; uno que no casa no quita NINGUNA; sin alias, la primera (lo de antes)',
    aliasDe(qCopia.entradas) === '["Original","Lite"]' &&
      aliasDe(qLite.entradas) === '["Original","Copia"]' &&
      qNinguna.quitadas === 0 &&
      aliasDe(qNinguna.entradas) === '["Original","Lite","Copia"]' &&
      aliasDe(qSinAlias.entradas) === '["Original","Copia"]',
    JSON.stringify({ copia: aliasDe(qCopia.entradas), lite: aliasDe(qLite.entradas), ninguna: qNinguna.quitadas, sinAlias: aliasDe(qSinAlias.entradas) })
  )
  const rutaDos = archivo({ version: 1, connections: [K, LITE_REP, COPIA2] })
  const storeDos = new ConnectionStore({ storePath: rutaDos })
  const bDos = storeDos.borrar('rep-1', reg.tipoEntradaPedida(true), 'Copia')
  check(
    'con el store: DELETE de la COPIA (ajena + su alias) se lleva la copia, no la de motor que va delante, y la original sigue con lo suyo',
    bDos.borrada &&
      bDos.quedaConocida &&
      JSON.stringify(disco(rutaDos).connections) === JSON.stringify([K, LITE_REP]) &&
      JSON.stringify(storeDos.ajenas('p1').map((a) => a.alias)) === '["Lite"]',
    JSON.stringify({ bDos, disco: disco(rutaDos).connections.map((c) => (c as Crudo).alias) })
  )

  // El log de los montajes descartados nombra la causa nueva (un id montado en p2 que es de
  // la copia: ni está en list ni «no existe»).
  const ruta2 = archivo(texto)
  const store2 = new ConnectionStore({ storePath: ruta2 })
  const lineas = avisosDeDescartados(['rep-1'], registroParaDescartes(store2.listaCompleta('p2')), 'p2')
  check(
    'el log de montajes descartados la cuenta como ajena y dice «id repetido» entre las causas (no «no existe»)',
    lineas.length === 1 && lineas[0].startsWith('NOTA:') && lineas[0].includes('id repetido') && !lineas[0].includes('no existen'),
    lineas.join(' | ')
  )
}

hr('(14) una escritura que FALLA no cambia la memoria')
{
  // EL FALLO: solo el alta miraba ANTES de tocar la memoria si el principal se podía
  // sustituir. Las demás escrituras cambiaban la memoria y luego escribían; si la escritura
  // fallaba —el registro editado por fuera con Tessera abierta, la copia `.ilegible`
  // imposible, un `EPERM`—, la memoria se quedaba con el cambio y el disco sin él: una
  // conexión borrada desaparecía de la lista hasta reiniciar aunque siguiera en disco, y la
  // SIGUIENTE escritura buena se llevaba al disco el cambio que había fallado. Con el store
  // REAL, cada mutador por las tres causas: tras el fallo, el error llega al llamador y la
  // memoria y el disco dicen lo mismo que antes; y (la del `EPERM`, que se puede quitar) la
  // siguiente escritura buena deja el disco como si el fallo no hubiera existido.
  const ALTA = { profileId: 'p1', alias: 'Nueva', motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }
  // Con una AJENA (se borra y se poda como cualquiera) y la Oracle verificada (para que
  // `setVerificada(false)` tenga algo que quitar).
  const BUENO = { version: 1, connections: [{ ...ORA, verificadaEn: 5 }, { ...PG, entorno: 'desarrollo' }, LITE] }
  const BUENO_TEXTO = JSON.stringify(BUENO, null, 2)
  // Una coma de más: roto, para la copia aparte imposible.
  const ROTO = BUENO_TEXTO.replace(/\n {2}\]/, ',\n  ]')
  type Store = InstanceType<typeof ConnectionStore>
  /** Todo lo que el store dice de sí mismo, de los dos perfiles. */
  const estado = (s: Store): string =>
    JSON.stringify({
      p1: s.listaCompleta('p1'),
      p2: s.listaCompleta('p2'),
      gets: [ORA.id, PG.id, LITE.id].map((id) => s.get(id) ?? null),
      secretos: [ORA.id, PG.id].map((id) => s.secretOf(id)),
      delPerfil: s.secretsForProfile('p1')
    })
  const mutadores: Array<[string, (s: Store) => unknown]> = [
    ['create', (s) => s.create(ALTA)],
    ['update', (s) => s.update(ORA.id, formDe(s.get(ORA.id)!, { alias: 'ORA-EDITADA', host: 'otro.lan' }))],
    ['reorder', (s) => s.reorder('p1', [PG.id, ORA.id])],
    ['setVerificada(true)', (s) => s.setVerificada(PG.id, true, 123)],
    ['setVerificada(false)', (s) => s.setVerificada(ORA.id, false)],
    ['setDriver', (s) => s.setDriver(PG.id, 'pg-17')],
    ['setIntrospeccion', (s) => s.setIntrospeccion(ORA.id, { totalEsquemas: 9, esquemaPorDefecto: 'ADM', en: 1 })],
    ['setEsquemasVisibles', (s) => s.setEsquemasVisibles(ORA.id, { modo: 'lista', porDefecto: false, esquemas: ['ADM'] })],
    ['marcarVerificada', (s) => s.marcarVerificada(PG.id, 'pg-17', 7)],
    ['remove (una conocida)', (s) => s.remove(PG.id)],
    ['borrar (una ajena)', (s) => s.borrar(LITE.id, 'ajena')],
    ['pruneProfiles', (s) => s.pruneProfiles(new Set())]
  ]
  // La escritura buena de después, igual para todos: una que no toca lo de los mutadores.
  const despues = (s: Store): void => s.setIntrospeccion(PG.id, { totalEsquemas: 42, esquemaPorDefecto: 'public', en: 1 })
  // Lo que esa escritura deja en disco partiendo del registro de siempre, sin fallo previo.
  const referencia = ((): string => {
    const r = archivo(BUENO_TEXTO)
    despues(new ConnectionStore({ storePath: r }))
    return readFileSync(r, 'utf-8')
  })()

  for (const [nombre, mutar] of mutadores) {
    // (a) El registro editado por fuera con Tessera abierta: `exigirPrincipalSustituible`.
    const ra = archivo(BUENO_TEXTO)
    const sa = new ConnectionStore({ storePath: ra })
    const memA = estado(sa)
    const EDITADO = JSON.stringify({ version: 1, connections: [ORA] })
    writeFileSync(ra, EDITADO)
    const a = intentar(() => mutar(sa))
    check(
      `${nombre}, con el registro editado por fuera: falla con su aviso, y la memoria y el disco siguen como antes`,
      !a.ok && a.error === reg.MENSAJE_CAMBIADO_FUERA && estado(sa) === memA && readFileSync(ra, 'utf-8') === EDITADO,
      a.ok ? 'ESCRIBIÓ' : estado(sa) === memA ? 'memoria intacta; disco: ' + (readFileSync(ra, 'utf-8') === EDITADO) : 'LA MEMORIA CAMBIÓ'
    )

    // (b) La copia `.ilegible` imposible: el principal roto rescatado con el `.bak`, con un
    // nombre en el que `.ilegible` ya no cabe (ver la sección 11).
    const carpeta = mkdtempSync(path.join(dir, 'atom-'))
    const rb = path.join(carpeta, 'x'.repeat(247 - '.json'.length) + '.json')
    writeFileSync(rb, ROTO)
    writeFileSync(`${rb}.bak`, BUENO_TEXTO)
    const sb = new ConnectionStore({ storePath: rb })
    const memB = estado(sb)
    const b = intentar(() => mutar(sb))
    check(
      `${nombre}, con la copia .ilegible imposible: falla con su aviso, y la memoria y el disco siguen como antes`,
      !b.ok && b.error.startsWith('No se guardó el cambio') && estado(sb) === memB && readFileSync(rb, 'utf-8') === ROTO,
      b.ok ? 'ESCRIBIÓ' : estado(sb) === memB ? 'memoria intacta' : 'LA MEMORIA CAMBIÓ'
    )

    // (c) La escritura misma falla (un `EPERM`, un disco lleno): aquí, una carpeta con el
    // nombre del temporal de `writeFileAtomicSync`, que es igual en las dos plataformas.
    const rc = archivo(BUENO_TEXTO)
    const sc = new ConnectionStore({ storePath: rc })
    const memC = estado(sc)
    mkdirSync(`${rc}.tmp`)
    const c = intentar(() => mutar(sc))
    check(
      `${nombre}, con la escritura fallando (E/S): su código llega al llamador (sin la ruta del host, sección 16), y la memoria y el disco siguen como antes`,
      !c.ok && /\((EISDIR|EPERM|EACCES)\)/.test(c.error) && !c.error.includes(rc) && estado(sc) === memC && readFileSync(rc, 'utf-8') === BUENO_TEXTO,
      c.ok ? 'ESCRIBIÓ' : estado(sc) === memC ? c.error.slice(0, 60) : 'LA MEMORIA CAMBIÓ'
    )
    rmSync(`${rc}.tmp`, { recursive: true, force: true })
    const d = intentar(() => despues(sc))
    check(
      `${nombre}: la siguiente escritura buena NO se lleva al disco el cambio que falló`,
      d.ok && readFileSync(rc, 'utf-8') === referencia,
      d.ok ? (readFileSync(rc, 'utf-8') === referencia ? 'igual' : `DISTINTO: ${JSON.stringify(ids(disco(rc)))}`) : d.error
    )
  }

  // NEGATIVO: sin fallo, cada mutador escribe y la memoria lo refleja (no se «arregló»
  // dejando de escribir).
  const noEscriben: string[] = []
  for (const [nombre, mutar] of mutadores) {
    const r = archivo(BUENO_TEXTO)
    const s = new ConnectionStore({ storePath: r })
    const mem = estado(s)
    const e = intentar(() => mutar(s))
    if (!e.ok || estado(s) === mem || readFileSync(r, 'utf-8') === BUENO_TEXTO) noEscriben.push(`${nombre}${e.ok ? '' : `: ${e.error}`}`)
  }
  check('NEGATIVO: sin fallo, los 12 mutadores escriben en disco y cambian la memoria', noEscriben.length === 0, noEscriben.join('; ') || 'todos')
}

hr('(15) La huella que emite el main (DTO de list()) casa con el disco')
{
  // Valores del destino que un `toDto` o un `separarConocida` «arreglarían» —espacios alrededor,
  // una base vacía, un SID a null, sin usuario, un usuario con acento—: una edición a mano los
  // deja así, y `tdb` los lee TAL CUAL del disco. El main no normaliza nada al leer ni al
  // reescribir (ver `huellaDestino.ts`); esto es lo que lo fija por el camino de producción.
  const RAROS = [
    { id: 'h1', profileId: 'p1', alias: 'Espacios', motor: 'postgres', host: ' db.lan ', port: 5432, database: '', user: 'u ', readonly: true, secretEnc: enc('x') },
    { id: 'h2', profileId: 'p1', alias: 'Nulos', motor: 'oracle', host: 'ora.lan', port: 1521, database: null, sid: 'XE', user: 'José', secretEnc: enc('x'), entorno: 'raro' },
    { id: 'h3', profileId: 'p1', alias: 'Sin usuario', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'd', secretEnc: enc('x') }
  ]
  const r = archivo({ version: 1, connections: RAROS })
  const s = new ConnectionStore({ storePath: r })
  /** La huella de una entrada CRUDA, como la calcula `tdb` sobre lo que lee (la misma función). */
  const huellaCruda = (c: Crudo): string =>
    huellaDestino({ motor: c.motor, host: c.host, port: c.port, database: c.database, sid: c.sid, user: c.user })
  /** Las conexiones cuya huella del DTO NO es la de su entrada en el disco. */
  const noCasan = (st: InstanceType<typeof ConnectionStore>): string[] => {
    const enDisco = new Map(disco(r).connections.map((c) => [(c as Crudo).id, huellaCruda(c as Crudo)]))
    return st
      .list('p1')
      .filter((c) => huellaDestino(c) !== enDisco.get(c.id))
      .map((c) => c.alias)
  }
  const pasos: Array<[string, () => unknown]> = [
    ['al leer', () => undefined],
    ['tras setVerificada', () => s.setVerificada('h1', true, 1)],
    ['tras setDriver', () => s.setDriver('h2', 'ic-19')],
    ['tras setIntrospeccion', () => s.setIntrospeccion('h3', { totalEsquemas: 2, esquemaPorDefecto: 'public', en: 1 })],
    ['tras setEsquemasVisibles', () => s.setEsquemasVisibles('h2', { modo: 'todos' })],
    ['tras reorder', () => s.reorder('p1', ['h3', 'h2', 'h1'])],
    ['tras marcarVerificada', () => s.marcarVerificada('h3', 'pg', 2)],
    ['tras renombrar una (update)', () => s.update('h2', formDe(s.get('h2')!, { alias: 'Nulos 2' }))]
  ]
  const fallidos: string[] = []
  for (const [paso, hacer] of pasos) {
    const e = intentar(hacer)
    const malas = e.ok ? noCasan(s) : [`falló: ${e.error}`]
    if (malas.length > 0) fallidos.push(`${paso}: ${malas.join(', ')}`)
  }
  check(
    'la huella del DTO de list() es la de la entrada del disco, al leer y tras cada mutador (espacios, base vacía, SID a null, sin usuario)',
    fallidos.length === 0 && s.list('p1').length === RAROS.length,
    fallidos.join('; ') || `${pasos.length} pasos, ${s.list('p1').length} conexiones`
  )
  const releido = new ConnectionStore({ storePath: r })
  const malasReleido = noCasan(releido)
  check(
    'y la de un store NUEVO sobre el disco reescrito (lo que ve Tessera al reiniciar)',
    malasReleido.length === 0 && releido.list('p1').length === RAROS.length,
    malasReleido.join(', ') || `${releido.list('p1').length} conexiones`
  )
  // NEGATIVO: la comparación distingue (si no, pasaría con cualquier cosa): con el host del disco
  // cambiado a mano, la de esa conexión ya no casa.
  writeFileSync(r, JSON.stringify({ ...disco(r), connections: disco(r).connections.map((c) => ((c as Crudo).id === 'h3' ? { ...(c as Crudo), host: 'otro.lan' } : c)) }))
  const malasEditado = noCasan(releido)
  check('NEGATIVO: con el host de una cambiado en el disco, esa y solo esa deja de casar', JSON.stringify(malasEditado) === JSON.stringify(['Sin usuario']), JSON.stringify(malasEditado))
}

hr('(16) el borrado ceñido al PERFIL, y los fallos sin RUTAS del host')
{
  // La MISMA copia pegada a mano en dos perfiles (mismo id, mismo alias), y
  // la original en p1. La UI lista las ajenas de UN perfil, pero el DELETE buscaba el id y el
  // alias en todo el registro: eliminar la copia de p2 se llevaba la de p1 (la primera del
  // archivo) y la pulsada seguía. Y tras borrarla, `quedaConocida` miraba todos los perfiles y
  // decía «queda» (la original de p1): ni las consolas de p2 iban a la papelera ni se desmontaba
  // nada en p2. Ceñirlo al perfil sin más habría dado 'borrada', que cierra las sesiones de la
  // original de p1 y desmonta su id en TODOS los proyectos: por eso hay una salida propia.
  const K = { id: 'cp-1', profileId: 'p1', alias: 'Original', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'u', readonly: true, orden: 0, secretEnc: enc('clave-original') }
  const COPIA_P1 = { ...K, alias: 'Copia', orden: 1, secretEnc: enc('clave-p1') }
  const COPIA_P2 = { ...K, profileId: 'p2', alias: 'Copia', orden: 0, secretEnc: enc('clave-p2') }
  const TRES = { version: 1, connections: [K, COPIA_P1, COPIA_P2] }

  // El módulo puro.
  const entradas = reg.leerRegistro(JSON.stringify(TRES))!.entradas
  const perfiles = (l: readonly Entrada[]): string => JSON.stringify(l.map((e) => reg.perfilDeEntrada(e)))
  const q2 = reg.quitarPorId(entradas, 'cp-1', 'ajena', 'Copia', 'p2')
  check(
    'puro: con el perfil de la fila (p2) se quita la copia de p2, no la de p1 que va delante con el mismo id y alias',
    q2.quitadas === 1 && q2.perfil === 'p2' && perfiles(q2.entradas) === '["p1","p1"]',
    `${perfiles(q2.entradas)} perfil=${q2.perfil}`
  )
  const q1 = reg.quitarPorId(entradas, 'cp-1', 'ajena', 'Copia', 'p1')
  const qSin = reg.quitarPorId(entradas, 'cp-1', 'ajena', 'Copia')
  check(
    'puro: con p1, la de p1; sin perfil (un llamador de antes), la primera del archivo, como siempre',
    q1.perfil === 'p1' && perfiles(q1.entradas) === '["p1","p2"]' && qSin.perfil === 'p1' && perfiles(qSin.entradas) === '["p1","p2"]',
    `${perfiles(q1.entradas)} / ${perfiles(qSin.entradas)}`
  )
  const qCruzada = reg.quitarPorId(entradas, 'cp-1', 'conocida', undefined, 'p2')
  const qNadie = reg.quitarPorId(entradas, 'cp-1', 'ajena', 'Copia', 'p3')
  check(
    'puro NEGATIVO: desde p2 no se borra la conocida del id, que es de p1 (una petición cruzada); ni nada desde un perfil sin entradas de ese id',
    qCruzada.quitadas === 0 && qCruzada.entradas.length === 3 && qNadie.quitadas === 0 && qNadie.quedan === 3,
    `cruzada=${qCruzada.quitadas} nadie=${qNadie.quitadas}`
  )

  // El store real.
  const ruta = archivo(TRES)
  const store = new ConnectionStore({ storePath: ruta })
  const b2 = store.borrar('cp-1', 'ajena', 'Copia', 'p2')
  check(
    'store: el DELETE de la copia de p2, con su perfil, quita ESA del disco; la de p1 sigue en su sitio y en ajenas(p1)',
    b2.borrada &&
      b2.perfil === 'p2' &&
      JSON.stringify(disco(ruta).connections) === JSON.stringify([K, COPIA_P1]) &&
      store.ajenas('p2').length === 0 &&
      JSON.stringify(store.ajenas('p1').map((a) => a.alias)) === '["Copia"]',
    JSON.stringify({ b2, disco: disco(ruta).connections.map((c) => (c as Crudo).profileId) })
  )
  check(
    "y la conocida del id es de p1: en p2 no queda (quedaConocida falso), sí en otro perfil -> 'delPerfil' (lo de p2 se limpia; las sesiones de la de p1, no)",
    !b2.quedaConocida && b2.conocidaEnOtroPerfil && reg.limpiezaTrasBorrar(b2) === 'delPerfil',
    JSON.stringify(b2)
  )
  const bVieja = store.borrar('cp-1', 'ajena', 'Copia', 'p2')
  check(
    'NEGATIVO: una vista vieja de p2 que la pide otra vez: nada borrado, y dice que la conocida es de otro perfil (el renderer no desmonta el id de todos los proyectos)',
    !bVieja.borrada && bVieja.perfil === null && !bVieja.quedaConocida && bVieja.conocidaEnOtroPerfil && reg.limpiezaTrasBorrar(bVieja) === 'ninguna',
    JSON.stringify(bVieja)
  )
  const b1 = store.borrar('cp-1', 'ajena', 'Copia', 'p1')
  check(
    "NEGATIVO: la copia de p1, cuya original es de p1: queda la conocida en SU perfil -> 'ninguna' (ni 'delPerfil' ni 'borrada')",
    b1.borrada && b1.quedaConocida && !b1.conocidaEnOtroPerfil && reg.limpiezaTrasBorrar(b1) === 'ninguna',
    JSON.stringify(b1)
  )
  const storeK = new ConnectionStore({ storePath: archivo({ version: 1, connections: [K, COPIA_P2] }) })
  const bK = storeK.borrar('cp-1', 'conocida', undefined, 'p1')
  check(
    "NEGATIVO: borrar la ORIGINAL de p1 con su copia en p2: no queda conocida en NINGÚN perfil -> 'borrada', como siempre",
    bK.borrada && !bK.quedaConocida && !bK.conocidaEnOtroPerfil && reg.limpiezaTrasBorrar(bK) === 'borrada',
    JSON.stringify(bK)
  )
  const lim = reg.limpiezaTrasBorrar
  const salidas = [
    lim({ borrada: true, tipo: 'ajena', quedaConocida: false, conocidaEnOtroPerfil: true }),
    lim({ borrada: true, tipo: 'conocida', quedaConocida: false, conocidaEnOtroPerfil: true }),
    lim({ borrada: false, tipo: null, quedaConocida: false, conocidaEnOtroPerfil: true })
  ]
  check(
    "limpieza: ajena con la conocida en otro perfil -> 'delPerfil'; una conocida con otra en otro perfil (defensa) -> 'cambiada'; nada borrado -> 'ninguna'",
    JSON.stringify(salidas) === '["delPerfil","cambiada","ninguna"]',
    JSON.stringify(salidas)
  )

  // EL DELETE DE VERDAD: el handler de `DbController` con un `ipc` de mentira. Es donde se lee lo
  // que manda el renderer (el perfil de la fila) y se decide qué gancho se llama: aquí se fija que
  // 'delPerfil' llama SOLO al gancho del perfil, y no a `onConexionBorrada`, que en la app cierra
  // las sesiones del id (las de la original de p1, con su transacción pendiente).
  const { DbController } = await import('./DbController.ts')
  type Handler = (evento: unknown, req: unknown) => unknown
  const handlers = new Map<string, Handler>()
  const ganchos: string[] = []
  const datos = mkdtempSync(path.join(dir, 'datos-'))
  const OTRA16 = { id: 'otra-16', profileId: 'p1', alias: 'Otra', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'd', user: 'u', readonly: true, orden: 2 }
  const rutaC = archivo({ version: 1, connections: [K, COPIA_P1, COPIA_P2, OTRA16] })
  const storeC = new ConnectionStore({ storePath: rutaC })
  const ctrl = new DbController({
    connections: storeC,
    drivers: {} as never,
    userDataDir: datos,
    appDir: process.cwd(),
    eventos: eventosNulos,
    dialogos: dialogosNulos,
    papelera: async () => {},
    onChanged: () => {},
    onConexionEditada: (previo) => void ganchos.push(`editada ${previo.id}`),
    onConexionBorrada: (id, perfil) => void ganchos.push(`borrada ${id} ${perfil}`),
    onConexionOlvidadaEnPerfil: (id, perfil) => void ganchos.push(`olvidada ${id} ${perfil}`),
    log: () => {}
  })
  registrarIpcBd({ ipc: { handle: (canal: string, fn: Handler) => void handlers.set(canal, fn) } as never, bd: ctrl })
  const invocar = (canal: string, req: unknown): ReturnType<typeof intentar<unknown>> => intentar(() => handlers.get(canal)!({}, req))
  const rDel = invocar(DB_CHANNELS.DELETE, { id: 'cp-1', ajena: true, alias: 'Copia', profileId: 'p2' })
  check(
    'DbController: el DELETE con el profileId de la fila borra la copia de p2, responde conocidaEnOtroPerfil y llama SOLO al gancho del perfil',
    rDel.ok &&
      JSON.stringify(rDel.valor) === JSON.stringify({ borrada: true, quedaConocida: false, conocidaEnOtroPerfil: true }) &&
      JSON.stringify(disco(rutaC).connections) === JSON.stringify([K, COPIA_P1, OTRA16]) &&
      JSON.stringify(ganchos) === '["olvidada cp-1 p2"]',
    JSON.stringify({ r: rDel.ok ? rDel.valor : rDel.error, ganchos })
  )
  ganchos.length = 0
  const rAntes = invocar(DB_CHANNELS.DELETE, { id: 'cp-1', ajena: true, alias: 'Copia' })
  check(
    'DbController NEGATIVO: sin profileId (un renderer anterior), todo el registro como antes: la copia de p1, cuya conocida sigue -> ningún gancho',
    rAntes.ok &&
      JSON.stringify(rAntes.valor) === JSON.stringify({ borrada: true, quedaConocida: true, conocidaEnOtroPerfil: false }) &&
      JSON.stringify(disco(rutaC).connections) === JSON.stringify([K, OTRA16]) &&
      ganchos.length === 0,
    JSON.stringify({ r: rAntes.ok ? rAntes.valor : rAntes.error, ganchos })
  )

  // Lo que lanzan los mutadores llega al RENDERER como texto (el IPC de db, y
  // `fijarEsquemas` del explorador), y un error de `fs` en crudo lleva la RUTA del registro
  // («EISDIR: illegal operation on a directory, open 'C:\Users\…\db-connections.json.tmp'»).
  // Con la escritura fallando como en la sección 14 (una carpeta con el nombre del temporal).
  /** ¿Lleva una ruta ABSOLUTA del host? Node las cita entre comillas simples, en las dos plataformas. */
  const conRuta = (m: string): boolean => m.includes(dir) || m.includes(tmpdir()) || /'(?:[A-Za-z]:[\\/]|\/)/.test(m)
  /** Un error de `fs` en crudo y DE VERDAD, con su ruta (`syscall` y `path`). */
  const errorFs = ((): unknown => {
    try {
      readFileSync(path.join(dir, 'no-existe', 'db-connections.json'))
    } catch (e) {
      return e
    }
    return new Error('no falló')
  })()
  const bienSaneado = (m: string, codigo: RegExp): boolean =>
    m.startsWith('No se guardó el cambio: no se pudo escribir el registro de conexiones (db-connections.json)') && codigo.test(m) && !conRuta(m)
  check(
    'la prueba vale: el error de fs de referencia SÍ lleva la ruta en su message',
    errorFs instanceof Error && conRuta(errorFs.message) && typeof (errorFs as { syscall?: unknown }).syscall === 'string',
    errorFs instanceof Error ? errorFs.message.slice(0, 60) : String(errorFs)
  )
  mkdirSync(`${rutaC}.tmp`)
  const CODIGO_ES = /\((EISDIR|EPERM|EACCES)\)/
  const mutadoresIpc: Array<[string, string, unknown]> = [
    ['alta', DB_CHANNELS.CREATE, { profileId: 'p1', alias: 'Nueva', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true }],
    ['edición', DB_CHANNELS.UPDATE, { id: 'cp-1', input: formDe(storeC.get('cp-1')!, { alias: 'Renombrada' }) }],
    ['borrado', DB_CHANNELS.DELETE, { id: 'cp-1', ajena: false, profileId: 'p1' }],
    ['orden', DB_CHANNELS.REORDER, { profileId: 'p1', ids: ['otra-16', 'cp-1'] }]
  ]
  for (const [nombre, canal, req] of mutadoresIpc) {
    const r = invocar(canal, req)
    check(
      `IPC de db, ${nombre} con la escritura fallando: el renderer recibe el código y qué hacer, SIN la ruta del host`,
      !r.ok && bienSaneado(r.error, CODIGO_ES),
      r.ok ? 'NO FALLÓ' : r.error.slice(0, 160)
    )
  }
  // La GUARDA de la frontera, aparte de la del store: un error de `fs` en crudo que saliera de
  // otra llamada (aquí, el alta sustituida por una que lo lanza tal cual) tampoco pasa con su ruta.
  const altaReal = storeC.create.bind(storeC)
  storeC.create = (): never => {
    throw errorFs
  }
  const rCruda = invocar(DB_CHANNELS.CREATE, { profileId: 'p1', alias: 'Nueva' })
  storeC.create = altaReal
  check(
    'IPC de db: un error de fs EN CRUDO que llegue al handler se cambia por el del registro, sin la ruta',
    !rCruda.ok && bienSaneado(rCruda.error, /\(ENOENT\)/),
    rCruda.ok ? 'NO FALLÓ' : rCruda.error.slice(0, 160)
  )

  // Y `fijarEsquemas` del explorador, que enseña el motivo del store tal cual: con el store REAL
  // (su escritura fallando) y con un error de `fs` en crudo (la guarda de la frontera).
  const { ExploradorController } = await import('./explorador/ExploradorController.ts')
  const explorador = (conexiones: ConstructorParameters<typeof ExploradorController>[0]['conexiones']): InstanceType<typeof ExploradorController> =>
    new ExploradorController({
      conexiones,
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: '' }),
        notificarCambio: () => {},
        espacioDeDatos: (perfil) => path.join(datos, 'conexiones', perfil),
        tdbScriptDir: () => path.join(process.cwd(), 'src', 'tdb'),
        ensureWorkspace: () => undefined
      },
      perfilVivo: () => true,
      nombrePerfil: () => 'Perfil',
      papelera: async () => {},
      plataforma: plataformaActual(),
      getWindow: () => null,
      emitir: () => {},
      lanzar: () => {
        throw new Error('esta prueba no abre sesiones')
      },
      log: () => {}
    })
  const LISTA = { modo: 'lista' as const, porDefecto: false, esquemas: ['APP'] }
  const fReal = await explorador(storeC).fijarEsquemas('cp-1', LISTA)
  check(
    'fijarEsquemas con el store real y la escritura fallando: dice el motivo del store, SIN la ruta del host',
    !fReal.ok && fReal.error.mensaje.startsWith('No se pudo guardar la selección de esquemas: ') && bienSaneado(fReal.error.mensaje.replace(/^No se pudo guardar la selección de esquemas: /, ''), CODIGO_ES),
    fReal.ok ? 'NO FALLÓ' : fReal.error.mensaje.slice(0, 200)
  )
  const crudo = {
    get: (id: string) => storeC.get(id),
    secretOf: (id: string) => storeC.secretOf(id),
    setEsquemasVisibles: (): never => {
      throw errorFs
    },
    setIntrospeccion: () => {},
    marcarVerificada: () => false
  }
  const fCruda = await explorador(crudo).fijarEsquemas('cp-1', LISTA)
  check(
    'fijarEsquemas: un error de fs EN CRUDO del registro tampoco llega al renderer con su ruta',
    !fCruda.ok && bienSaneado(fCruda.error.mensaje.replace(/^No se pudo guardar la selección de esquemas: /, ''), /\(ENOENT\)/),
    fCruda.ok ? 'NO FALLÓ' : fCruda.error.mensaje.slice(0, 200)
  )
  const fAviso = await explorador({ ...crudo, setEsquemasVisibles: (): never => { throw new Error(reg.MENSAJE_CAMBIADO_FUERA) } }).fijarEsquemas('cp-1', LISTA)
  check(
    'NEGATIVO: un aviso del store (el registro editado por fuera) sigue llegando TAL CUAL, no se cambia por el de la E/S',
    !fAviso.ok && fAviso.error.mensaje === `No se pudo guardar la selección de esquemas: ${reg.MENSAJE_CAMBIADO_FUERA}`,
    fAviso.ok ? 'NO FALLÓ' : fAviso.error.mensaje.slice(0, 200)
  )
  rmSync(`${rutaC}.tmp`, { recursive: true, force: true })
  ctrl.pararPuente()
}

hr('(17) «Probar» sin rutas del host, y la mitad del renderer del borrado')
{
  // R1. «Probar» con un `tdb` que NO LLEGA A RESPONDER (sin su línea JSON: se cae, no arranca,
  // se pasa de un tope) enseñaba el `message` de `execFile`, que es la línea de órdenes entera
  // («Command failed: C:\…\Tessera.exe C:\…\tdb.cjs test <alias> --json»), o una traza con las
  // rutas de sus módulos: rutas del host en el renderer, y ninguna causa. Se prueba con un
  // `tdb.cjs` de mentira (en una `appDir` temporal) y el handler de TEST de verdad.
  const { DbController, mensajeFalloTdb } = await import('./DbController.ts')
  /** ¿Lleva una ruta ABSOLUTA del host, entrecomillada o no? */
  const conRutaDelHost = (m: string): boolean =>
    m.includes(dir) || m.includes(tmpdir()) || m.includes(process.execPath) || /[A-Za-z]:[\\/]|(?:^|\s)\/[^\s/]+\//.test(m)
  const TOPE = 90_000
  const errorArranque = spawnSync(path.join(dir, 'no-existe', 'tdb-falso.exe')).error
  const casos: Array<[string, Parameters<typeof mensajeFalloTdb>[0], string]> = [
    ['el tope de tiempo (execFile lo mata: killed + señal)', { killed: true, signal: 'SIGTERM', code: null }, 'no respondió en 90 s y se detuvo'],
    ['una caída en Windows (código de salida del acceso indebido)', { killed: false, signal: null, code: 3221225477 }, 'terminó con el código 3221225477 sin dar respuesta'],
    ['una caída en macOS (una señal, sin código)', { killed: false, signal: 'SIGSEGV', code: null }, 'se detuvo (SIGSEGV) sin dar respuesta'],
    ['el tope de salida', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'su salida pasó del tope y se detuvo'],
    ['un arranque que falla DE VERDAD (su message lleva la ruta)', errorArranque as Parameters<typeof mensajeFalloTdb>[0], 'no arrancó (ENOENT)'],
    ['salir con 0 sin decir nada', null, 'terminó sin dar respuesta']
  ]
  check(
    'la prueba vale: el error de arranque de referencia SÍ lleva la ruta en su message',
    errorArranque instanceof Error && conRutaDelHost(errorArranque.message),
    errorArranque instanceof Error ? errorArranque.message.slice(0, 80) : String(errorArranque)
  )
  for (const [nombre, err, causa] of casos) {
    const m = mensajeFalloTdb(err, false, TOPE)
    check(`mensajeFalloTdb, ${nombre}: dice la causa, sin rutas`, m === `No se pudo ejecutar tdb: ${causa}.` && !conRutaDelHost(m), m)
  }
  // Los campos de los topes, de un `execFile` DE VERDAD (no de lo que se
  // cree del código de Node). Con topes cortos, para no
  // esperar los 90 s: lo que se comprueba es la FORMA del error, igual con cualquier tope.
  const { execFile } = await import('node:child_process')
  const errTope = await new Promise<unknown>((res) =>
    execFile(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 300 }, (e) => res(e))
  )
  const errSalida = await new Promise<unknown>((res) =>
    execFile(process.execPath, ['-e', "process.stdout.write('x'.repeat(5000))"], { maxBuffer: 100 }, (e) => res(e))
  )
  check(
    'el tope de tiempo de un execFile DE VERDAD da la causa del tope (killed + señal, en las dos plataformas)',
    mensajeFalloTdb(errTope as Parameters<typeof mensajeFalloTdb>[0], false, TOPE) === 'No se pudo ejecutar tdb: no respondió en 90 s y se detuvo.',
    JSON.stringify({ killed: (errTope as { killed?: unknown })?.killed, signal: (errTope as { signal?: unknown })?.signal, code: (errTope as { code?: unknown })?.code })
  )
  check(
    'y el tope de salida de uno DE VERDAD, la suya',
    mensajeFalloTdb(errSalida as Parameters<typeof mensajeFalloTdb>[0], false, TOPE) === 'No se pudo ejecutar tdb: su salida pasó del tope y se detuvo.',
    JSON.stringify({ code: (errSalida as { code?: unknown })?.code })
  )
  const conLog = mensajeFalloTdb({ code: 1 }, true, TOPE)
  check('mensajeFalloTdb con detalle: manda al log de bases de datos, que se nombra sin su ruta', conLog.endsWith(' El detalle queda en el log de bases de datos (logs/db.log).') && !conRutaDelHost(conLog), conLog)

  const appDir = mkdtempSync(path.join(dir, 'app-'))
  const scriptTdb = path.join(appDir, 'src', 'tdb', 'tdb.cjs')
  mkdirSync(path.dirname(scriptTdb), { recursive: true })
  const lineasLog: string[] = []
  const K17 = { id: 'cp-17', profileId: 'p1', alias: 'Original', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'u', readonly: true, orden: 0, secretEnc: enc('o') }
  const COPIA17_P1 = { ...K17, alias: 'Copia', orden: 1 }
  const COPIA17_P2 = { ...K17, profileId: 'p2', alias: 'Copia', orden: 0 }
  const SOLA17 = { id: 'sola-17', profileId: 'p1', alias: 'SQLite nueva', motor: 'sqlite', orden: 2 }
  const PROBAR17 = { id: 'probar-17', profileId: 'p1', alias: 'Probar R1', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'd', user: 'u', readonly: true, orden: 3, secretEnc: enc('x') }
  const ruta17 = archivo({ version: 1, connections: [K17, COPIA17_P1, COPIA17_P2, SOLA17, PROBAR17] })
  const handlers = new Map<string, (evento: unknown, req: unknown) => unknown>()
  const ctrl = new DbController({
    connections: new ConnectionStore({ storePath: ruta17 }),
    drivers: { driversDir: path.join(dir, 'drivers-17') } as never,
    userDataDir: mkdtempSync(path.join(dir, 'datos17-')),
    appDir,
    eventos: eventosNulos,
    dialogos: dialogosNulos,
    papelera: async () => {},
    log: (l) => void lineasLog.push(l)
  })
  registrarIpcBd({ ipc: { handle: (canal: string, fn: (evento: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never, bd: ctrl })
  /** «Probar» con este `tdb.cjs`: sin `process.exit`, para que la salida se vacíe igual en las dos plataformas. */
  const probarCon = async (cuerpo: string): Promise<{ ok: boolean; mensaje: string }> => {
    writeFileSync(scriptTdb, cuerpo)
    lineasLog.length = 0
    return (await handlers.get(DB_CHANNELS.TEST)!({}, { id: 'probar-17' })) as { ok: boolean; mensaje: string }
  }
  const NL = 'String.fromCharCode(10)'
  const mudo = await probarCon('process.exitCode = 1')
  check(
    '«Probar» con un tdb que sale con 1 sin decir nada: la causa, SIN la línea de órdenes (el ejecutable y el script son rutas del host)',
    !mudo.ok && mudo.mensaje === 'No se pudo ejecutar tdb: terminó con el código 1 sin dar respuesta.' && !conRutaDelHost(mudo.mensaje),
    mudo.mensaje.slice(0, 200)
  )
  check('y la línea de órdenes, con sus rutas, va entera al log (no se pierde para diagnosticar)', lineasLog.some((l) => l.includes(scriptTdb)), JSON.stringify(lineasLog).slice(0, 200))
  const traza = await probarCon(
    `process.stderr.write('Error: Cannot find module ' + JSON.stringify(__filename) + ${NL} + '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)' + ${NL}); process.exitCode = 1`
  )
  check(
    '«Probar» con un tdb que se cae con una traza (rutas de sus módulos): la causa y dónde está el detalle, SIN la traza',
    !traza.ok && traza.mensaje === 'No se pudo ejecutar tdb: terminó con el código 1 sin dar respuesta. El detalle queda en el log de bases de datos (logs/db.log).' && !conRutaDelHost(traza.mensaje),
    traza.mensaje.slice(0, 200)
  )
  check('y la traza va al log', lineasLog.some((l) => l.includes('Cannot find module')), JSON.stringify(lineasLog).slice(0, 200))
  const ORA = 'ORA-12154: TNS:could not resolve the connect identifier specified'
  const servidor = await probarCon(`process.stdout.write(JSON.stringify({ ok: false, error: ${JSON.stringify(ORA)} }) + ${NL}); process.exitCode = 1`)
  check(
    'NEGATIVO: el error del SERVIDOR (tdb respondió con su línea JSON) se sigue enseñando CRUDO, sin tocar',
    !servidor.ok && servidor.mensaje === ORA && lineasLog.length === 0,
    `${servidor.mensaje.slice(0, 120)} log=${lineasLog.length}`
  )

  // R2. La mitad del RENDERER del borrado ceñido al perfil: tras el DELETE, `DbArbol` olvida el
  // id EN EL PERFIL DE LA FILA (`onConexionEliminada(id, perfil)`: desmontarlo de los proyectos
  // de ese perfil y cerrar allí sus pestañas) si en ese perfil ya no queda su conocida. Estaba
  // en línea en `DbArbol` y no la fijaba nada. Primero fue «olvidar en TODOS los perfiles salvo
  // si la conocida sigue en otro» (y los montajes de la copia quedaban hasta el arranque); con
  // el olvido ceñido al perfil (`quitarConexion`/`podarConexion` con perfil)
  // la copia de p2 se olvida en p2 en el acto. Aquí, con el handler de verdad.
  const borrar = (req: unknown): DbConexionBorrada => handlers.get(DB_CHANNELS.DELETE)!({}, req) as DbConexionBorrada
  const rMismo = borrar({ id: 'cp-17', ajena: true, alias: 'Copia', profileId: 'p1' })
  check(
    'renderer NEGATIVO: borrar la copia de p1, cuya original sigue en p1 -> NO se olvida el id en p1 (sus montajes son de la original)',
    rMismo.borrada && rMismo.quedaConocida && !olvidarEnPerfilTrasBorrar(rMismo),
    JSON.stringify(rMismo)
  )
  const rOtro = borrar({ id: 'cp-17', ajena: true, alias: 'Copia', profileId: 'p2' })
  check(
    'renderer: borrar la copia de p2, cuya original vive en p1 -> SÍ se olvida, y solo en p2 (el perfil de la fila; lo de p1 no se toca)',
    rOtro.borrada && rOtro.conocidaEnOtroPerfil === true && olvidarEnPerfilTrasBorrar(rOtro),
    JSON.stringify(rOtro)
  )
  const rVieja = borrar({ id: 'cp-17', ajena: true, alias: 'Copia', profileId: 'p2' })
  check(
    'renderer: una vista vieja de p2 que la pide otra vez (nada borrado) -> se olvida en p2, donde ya no está; la original de p1 sigue',
    !rVieja.borrada && rVieja.conocidaEnOtroPerfil === true && olvidarEnPerfilTrasBorrar(rVieja),
    JSON.stringify(rVieja)
  )
  const rSola = borrar({ id: 'sola-17', ajena: true, alias: 'SQLite nueva', profileId: 'p1' })
  const rOriginal = borrar({ id: 'cp-17', ajena: false, profileId: 'p1' })
  check(
    'renderer: una ajena sin conocida de su id, y la original sin copias que queden -> se olvida el id en su perfil',
    rSola.borrada && olvidarEnPerfilTrasBorrar(rSola) && rOriginal.borrada && olvidarEnPerfilTrasBorrar(rOriginal),
    JSON.stringify({ rSola, rOriginal })
  )
  ctrl.pararPuente()
}

hr('(18) la limpieza POR PERFIL del explorador, cableada como en la app')
{
  // La mitad del main: al borrar la copia de p2 cuya conocida vive en
  // p1 ('delPerfil'), `DbController` llama a `onConexionOlvidadaEnPerfil`, que en la app es
  // `ExploradorController.alOlvidarConexionEnPerfil` (`DbController.conectarExplorador`). Aquí, con los DOS de
  // verdad y el mismo cableado: las consolas de ESE perfil atadas al id van a la papelera, su
  // historial se borra y se olvidan sus claves de consola; lo de p1 (sus consolas, su
  // historial, sus sesiones, la caché del id) sigue. Y la puerta de las consolas: una de p2
  // atada al id de la conocida de p1 no llega a abrir nada contra ella.
  const { DbController } = await import('./DbController.ts')
  const { ExploradorController } = await import('./explorador/ExploradorController.ts')
  const K18 = { id: 'cp-18', profileId: 'p1', alias: 'Original', motor: 'oracle', host: 'db.lan', port: 1521, database: 'QA', user: 'u', readonly: true, orden: 0, secretEnc: enc('o') }
  const COPIA18_P2 = { ...K18, profileId: 'p2', alias: 'Copia', orden: 0 }
  const OTRA18_P2 = { id: 'otra-18', profileId: 'p2', alias: 'Otra', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'd', user: 'u', readonly: true, orden: 1, secretEnc: enc('x') }
  const ruta18 = archivo({ version: 1, connections: [K18, COPIA18_P2, OTRA18_P2] })
  const store18 = new ConnectionStore({ storePath: ruta18 })
  const datos18 = mkdtempSync(path.join(dir, 'datos18-'))
  const aPapelera: string[] = []
  const lanzados: string[] = []
  const explorador = new ExploradorController({
    conexiones: store18,
    registro: {
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: '' }),
      notificarCambio: () => {},
      espacioDeDatos: (perfil) => path.join(datos18, 'conexiones', perfil),
      tdbScriptDir: () => path.join(process.cwd(), 'src', 'tdb'),
      ensureWorkspace: () => undefined
    },
    perfilVivo: () => true,
    nombrePerfil: () => 'Perfil',
    // La papelera de verdad es la del sistema; aquí, borrar el archivo y apuntarlo.
    papelera: async (ruta) => {
      aPapelera.push(path.basename(ruta))
      rmSync(ruta, { force: true })
    },
    dirHistorial: path.join(datos18, 'historial'),
    plataforma: plataformaActual(),
    getWindow: () => null,
    emitir: () => {},
    lanzar: (con) => {
      lanzados.push(con.id)
      throw new Error('esta prueba no abre sesiones')
    },
    log: () => {}
  })
  // Lo que NO debe tocarse: las sesiones y la caché del id son de la conocida de p1.
  const tocados: string[] = []
  explorador.gestor.alBorrarConexion = (id: string): void => void tocados.push(`gestor ${id}`)
  explorador.cache.olvidarConexion = (id: string): void => void tocados.push(`cache ${id}`)
  const ctrl = new DbController({
    connections: store18,
    drivers: {} as never,
    userDataDir: datos18,
    appDir: process.cwd(),
    eventos: eventosNulos,
    dialogos: dialogosNulos,
    papelera: async () => {},
    onChanged: () => {},
    log: () => {}
  })
  // EL MISMO CABLEADO que la app (`db/componer.ts`).
  ctrl.conectarExplorador(explorador)
  const handlers = new Map<string, (evento: unknown, req: unknown) => unknown>()
  registrarIpcBd({ ipc: { handle: (canal: string, fn: (evento: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never, bd: ctrl })

  // Las consolas: la de p1 se crea como en la app; las de p2 atadas a cp-18 son de cuando la
  // copia era la conocida (un registro editado a mano), así que van directas al store.
  const c1 = await explorador.crearConsola('p1', 'cp-18')
  const c2 = await explorador.consolas.crear('p2', 'cp-18')
  const cOtra = await explorador.consolas.crear('p2', 'otra-18')
  await explorador.consolas.fijarEsquema('p1', c1.ok ? c1.valor.id : '', 'APP')
  await explorador.consolas.fijarEsquema('p2', c2.id, 'APP')
  // Con texto, para que vaya a la PAPELERA (una vacía se borra sin más).
  await explorador.consolas.escribir('p2', c2.id, 'select 1 from dual')
  // Listarlas las recuerda (`conexionDe`/`esquemaDe`), como hace el renderer al abrir la vista.
  await explorador.listarConsolas('p1')
  await explorador.listarConsolas('p2')
  const historial = explorador.historial!
  const entrada = (perfilId: string, conexionId: string, consolaId: string): Parameters<typeof historial.anotar>[0] => ({
    en: 1,
    perfilId,
    conexionId,
    consolaId,
    sql: `select '${perfilId} ${conexionId}' from dual`,
    resultado: 'ok',
    ms: 1
  })
  await historial.anotar(entrada('p1', 'cp-18', c1.ok ? c1.valor.id : ''), 'oracle')
  await historial.anotar(entrada('p2', 'cp-18', c2.id), 'oracle')
  await historial.anotar(entrada('p2', 'otra-18', cOtra.id), 'postgres')
  const mapas = (explorador as unknown as { estado: { conexionDe: Map<string, string>; esquemaDe: Map<string, string> } }).estado
  const clavesDe = (m: Map<string, string>): string => JSON.stringify([...m.keys()].map((k) => k.split('|')[0]).sort())
  check(
    'la prueba vale: antes del borrado, las dos consolas de cp-18 (p1 y p2) están recordadas con su esquema',
    c1.ok && clavesDe(mapas.conexionDe) === '["p1","p2","p2"]' && clavesDe(mapas.esquemaDe) === '["p1","p2"]',
    `${clavesDe(mapas.conexionDe)} ${clavesDe(mapas.esquemaDe)}`
  )

  // Petición 6 del REGISTRO, confirmada y cerrada: la consola de p2 atada a la conocida de p1.
  const idC2 = c2.id
  const ej = await explorador.ejecutar({ perfilId: 'p2', consolaId: idC2, ejecucionId: 'e18', sql: 'select 1 from dual', maxFilas: 10 })
  const esq = await explorador.esquemaConsola('p2', idC2, 'OTRO')
  check(
    'una consola de p2 atada al id de la conocida de p1 NO ejecuta contra ella: «no pertenece a este perfil», sin abrir proceso',
    !ej.ok && ej.error.mensaje === 'La consola no pertenece a este perfil.' && lanzados.length === 0,
    JSON.stringify({ ej: ej.ok ? 'ok' : ej.error.mensaje, lanzados })
  )
  check(
    'ni valida su esquema con el CATÁLOGO de la conexión de p1 (antes abría un proceso con sus credenciales antes de que el gestor se negara)',
    !esq.ok && esq.error.mensaje === 'La consola no pertenece a este perfil.' && lanzados.length === 0,
    JSON.stringify({ esq: esq.ok ? 'ok' : esq.error.mensaje, lanzados })
  )

  const rDel = handlers.get(DB_CHANNELS.DELETE)!({}, { id: 'cp-18', ajena: true, alias: 'Copia', profileId: 'p2' }) as DbConexionBorrada
  await explorador.consolas.vaciar()
  await historial.esperar()
  const quedanP1 = (await explorador.consolas.listar('p1')).map((k) => k.conexionId)
  const quedanP2 = (await explorador.consolas.listar('p2')).map((k) => k.conexionId)
  const histP1 = (await historial.listar({ perfilId: 'p1' })).map((e) => e.conexionId)
  const histP2 = (await historial.listar({ perfilId: 'p2' })).map((e) => e.conexionId)
  check(
    "DELETE de la copia de p2 ('delPerfil'): sus consolas de cp-18 van a la papelera; la de p1 y la de otra conexión de p2 siguen",
    rDel.borrada && rDel.conocidaEnOtroPerfil === true &&
      JSON.stringify(quedanP1) === '["cp-18"]' && JSON.stringify(quedanP2) === '["otra-18"]' && aPapelera.length === 1,
    JSON.stringify({ rDel, quedanP1, quedanP2, aPapelera })
  )
  check(
    'y su historial de cp-18 en p2 se borra; el de p1 y el de la otra conexión de p2 siguen',
    JSON.stringify(histP1) === '["cp-18"]' && JSON.stringify(histP2) === '["otra-18"]',
    JSON.stringify({ histP1, histP2 })
  )
  check(
    'se olvidan las claves de consola de p2 atadas a cp-18 (conexionDe y esquemaDe); las de p1 siguen',
    clavesDe(mapas.conexionDe) === '["p1","p2"]' &&
      [...mapas.conexionDe].every(([k, v]) => !(k.startsWith('p2|') && v === 'cp-18')) &&
      clavesDe(mapas.esquemaDe) === '["p1"]',
    `${JSON.stringify([...mapas.conexionDe])} ${JSON.stringify([...mapas.esquemaDe])}`
  )
  check(
    'NEGATIVO: ni las sesiones ni la caché del id (son de la conocida de p1): no se llama a gestor.alBorrarConexion ni a cache.olvidarConexion',
    tocados.length === 0,
    JSON.stringify(tocados)
  )
  const trasBorrar = await explorador.ejecutar({ perfilId: 'p2', consolaId: idC2, ejecucionId: 'e18b', sql: 'select 1 from dual', maxFilas: 10 })
  check(
    'la consola borrada ya no se resuelve por una clave rancia: «ya no existe»',
    !trasBorrar.ok && trasBorrar.error.mensaje === 'La consola ya no existe.',
    trasBorrar.ok ? 'ok' : trasBorrar.error.mensaje
  )

  // Y el negativo del otro gancho, con el mismo cableado: borrar la ORIGINAL sin copias que
  // queden es 'borrada', que sí cierra sesiones y tira la caché del id.
  const rOrig = handlers.get(DB_CHANNELS.DELETE)!({}, { id: 'cp-18', ajena: false, profileId: 'p1' }) as DbConexionBorrada
  await explorador.consolas.vaciar()
  await historial.esperar()
  check(
    "NEGATIVO: borrar la original de p1 ('borrada') sí pasa por la limpieza entera del id (gestor y caché) y manda sus consolas a la papelera",
    rOrig.borrada && !rOrig.quedaConocida && !rOrig.conocidaEnOtroPerfil &&
      JSON.stringify(tocados) === '["gestor cp-18","cache cp-18"]' && (await explorador.consolas.listar('p1')).length === 0,
    JSON.stringify({ rOrig, tocados })
  )
  ctrl.pararPuente()
}

hr('(19) El alta valida el motor y el destino con el descriptor')
{
  // Copia LITERAL de la parte de `ConnectionStore.validate` que cambió (de la comprobación
  // del motor al final), tal como estaba ANTES del descriptor. Lo de antes de esa parte (perfil,
  // alias, nombre repetido) no cambió y aquí no se toca: cada alta lleva su alias.
  const deAntes = (input: DbConnectionInput): string | null => {
    if (!(['oracle', 'postgres'] as readonly string[]).includes(input.motor)) return `Motor desconocido: "${input.motor}".`
    const host = limpiarDestinoBd(input.host)
    if (!host) return 'Falta el host.'
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      return 'El puerto debe ser un entero entre 1 y 65535.'
    }
    if (typeof input.user !== 'string' || !input.user.trim()) return 'Falta el usuario.'
    const database = limpiarDestinoBd(input.database)
    const sid = limpiarDestinoBd(input.sid)
    if (input.motor === 'oracle' && !database && !sid) return 'Oracle necesita un Service Name o un SID.'
    if (input.motor === 'oracle' && database && sid) return 'Indica Service Name O SID, no ambos.'
    if (input.motor === 'postgres' && !database) return 'PostgreSQL necesita el nombre de la base.'
    return null
  }
  check(
    'MOTORES_CONOCIDOS es IDS_MOTORES (el registro de descriptores): Oracle, PostgreSQL, SQLite, SQL Server, MongoDB y Redis',
    reg.MOTORES_CONOCIDOS === IDS_MOTORES &&
      JSON.stringify(reg.MOTORES_CONOCIDOS) === '["oracle","postgres","sqlite","sqlserver","mongodb","redis"]',
    JSON.stringify(reg.MOTORES_CONOCIDOS)
  )

  const store = new ConnectionStore({ storePath: archivo({ version: 1, connections: [] }) })
  let k = 0
  // La copia de «antes» es la de los motores de RED; la de un motor de archivo está
  // en (21), y la de SQL Server (base opcional, campos opcionales), en (22). 'mysql'
  // hace de motor desconocido (antes lo hacía 'sqlite', y luego 'sqlserver').
  const MOTORES_PRUEBA = [
    ...IDS_MOTORES.filter((m) => !descriptor(m).conexion.deArchivo && descriptor(m).conexion.opcionales.length === 0),
    'mysql',
    'constructor',
    'toString'
  ]
  const casos: DbConnectionInput[] = []
  for (const motor of MOTORES_PRUEBA) {
    for (const host of ['db.lan', '', 'http://']) {
      for (const database of ['', 'QA', 'http://', undefined]) {
        for (const sid of ['', 'XE', ' ', undefined]) {
          casos.push({ profileId: 'p19', alias: '', motor, host, port: 1521, database, sid, user: 'u', readonly: true } as DbConnectionInput)
        }
      }
    }
    // Lo común que va ANTES que la regla del destino: puerto y usuario malos, destino malo.
    for (const [port, user] of [[0, 'u'], [1.5, 'u'], [1521, ''], [1521, '  ']] as const) {
      casos.push({ profileId: 'p19', alias: '', motor, host: 'db.lan', port, database: '', sid: '', user, readonly: true } as DbConnectionInput)
    }
  }
  const desacuerdos: string[] = []
  const vistos = new Set<string>()
  for (const caso of casos) {
    const input = { ...caso, alias: `Alta-19-${++k}` }
    const r = intentar(() => store.create(input))
    const ahora = r.ok ? null : r.error
    const antes = deAntes(input)
    vistos.add(String(antes))
    if (ahora !== antes) desacuerdos.push(`${JSON.stringify(caso)}: ahora=${ahora} antes=${antes}`)
  }
  check(
    `las ${casos.length} altas de la matriz dan el MISMO resultado que la validación de antes`,
    desacuerdos.length === 0,
    desacuerdos.length ? desacuerdos.slice(0, 5).join(' | ') : `${casos.length} de ${casos.length}`
  )
  // Que la matriz no sea vacía: cada mensaje del destino y del motor salió al menos una vez.
  const ESPERADOS = [
    'null',
    'Motor desconocido: "mysql".',
    'Motor desconocido: "constructor".',
    'Motor desconocido: "toString".',
    'Falta el host.',
    'El puerto debe ser un entero entre 1 y 65535.',
    'Falta el usuario.',
    'Oracle necesita un Service Name o un SID.',
    'Indica Service Name O SID, no ambos.',
    'PostgreSQL necesita el nombre de la base.'
  ]
  const faltan = ESPERADOS.filter((e) => !vistos.has(e))
  check('la matriz recorre cada resultado posible (alta buena y los nueve errores)', faltan.length === 0, faltan.length ? `faltan: ${faltan.join(' | ')}` : `${vistos.size} distintos`)
  check(
    'NEGATIVO: una conexión de «constructor» no entra en el registro',
    store.list('p19').every((c) => IDS_MOTORES.includes(c.motor)),
    JSON.stringify(store.list('p19').map((c) => c.motor))
  )
}

hr('(20) Lo que el motor DESCARTA al guardar lo descarta también el main')
{
  // El SID de PostgreSQL: el formulario lo vacía (`limpiarParaGuardar`), pero el main es la
  // autoridad del registro y guardaba lo que llegara. Con el `fields()` de antes, las
  // comprobaciones de «no hay sid» de abajo fallan (medido con esa mutación).
  const AJENA20 = { id: 'lite-20', profileId: 'p20', alias: 'Lite20', motor: 'sqlite', ruta: 'x.db', sid: 'NO-TOCAR', orden: 9 }
  const PG_VIEJA = { id: 'pg-vieja-20', profileId: 'p20', alias: 'PG-vieja', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', sid: 'RESTO', user: 'u', readonly: true, orden: 0, futuro: { x: 1 } }
  const ruta = archivo({ version: 1, connections: [PG_VIEJA, AJENA20] })
  const store = new ConnectionStore({ storePath: ruta })
  const altaPg: DbConnectionInput = { profileId: 'p20', alias: 'PG-20', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', sid: 'XE', user: 'u', readonly: true }
  const pg = intentar(() => store.create(altaPg))
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  check('alta de PG con un SID escrito: se da de alta', pg.ok, pg.ok ? pg.valor.id : pg.error)
  if (pg.ok) {
    const d = enDisco(pg.valor.id)
    check("…y el SID NO llega al disco (ni como '' ni como null)", d !== undefined && !('sid' in d), JSON.stringify(d))
    check('…ni al DTO', pg.valor.sid === undefined, JSON.stringify(pg.valor.sid))
    check('…y lo demás del destino sí (la base, el host)', d?.database === 'app' && d?.host === 'pg.lan', JSON.stringify(d))
    const ed = intentar(() => store.update(pg.valor.id, formDe(pg.valor, { sid: 'OTRO', alias: 'PG-20b' })))
    const d2 = enDisco(pg.valor.id)
    check('editar la PG con un SID: tampoco lo guarda', ed.ok && d2 !== undefined && !('sid' in d2) && d2.alias === 'PG-20b', ed.ok ? JSON.stringify(d2) : ed.error)
  }
  // Mitad NEGATIVA: el SID de Oracle es su destino y se guarda, en el alta y al editar.
  const ora = intentar(() => store.create({ profileId: 'p20', alias: 'ORA-20', motor: 'oracle', host: 'ora.lan', port: 1521, database: '', sid: 'XE', user: 'u', readonly: true }))
  check('NEGATIVO: Oracle por SID lo guarda', ora.ok && enDisco(ora.valor.id)?.sid === 'XE' && ora.valor.sid === 'XE', ora.ok ? JSON.stringify(enDisco(ora.valor.id)) : ora.error)
  if (ora.ok) {
    const ed = intentar(() => store.update(ora.valor.id, formDe(ora.valor, { sid: 'XE2' })))
    check('NEGATIVO: y al editarla, el SID nuevo', ed.ok && enDisco(ora.valor.id)?.sid === 'XE2', ed.ok ? JSON.stringify(enDisco(ora.valor.id)) : ed.error)
  }
  // Lo que ya estaba en disco: una escritura que NO reconstruye desde el formulario no lo
  // toca; editar sí lo reconstruye (y conserva lo que esta versión no gobierna).
  const viejaAntes = JSON.stringify(enDisco('pg-vieja-20'))
  store.marcarVerificada('pg-vieja-20', null, 1700000000000)
  const trasMarcar = enDisco('pg-vieja-20')
  check("una PG que YA traía 'sid' en disco lo conserva mientras nadie la edite", trasMarcar?.sid === 'RESTO', `${viejaAntes} -> ${JSON.stringify(trasMarcar)}`)
  const vieja = store.get('pg-vieja-20')
  const edVieja = vieja ? intentar(() => store.update('pg-vieja-20', formDe(vieja, { alias: 'PG-vieja2' }))) : null
  const trasEditar = enDisco('pg-vieja-20')
  check(
    'al editarla desde el formulario (que trae ese SID del DTO) se va, y su clave futura se queda',
    edVieja !== null && edVieja.ok && trasEditar !== undefined && !('sid' in trasEditar) && JSON.stringify(trasEditar.futuro) === '{"x":1}',
    JSON.stringify(trasEditar)
  )
  check('la AJENA sigue byte a byte, con su propio sid', JSON.stringify(enDisco('lite-20')) === JSON.stringify(AJENA20), JSON.stringify(enDisco('lite-20')))
  // Para CUALQUIER motor del registro: el main descarta al guardar EXACTAMENTE lo que dice su
  // descriptor, y conserva el resto del destino. Cada campo de texto del destino se prueba
  // por separado, con un alta que la validación acepta (no todos admiten ir juntos).
  const desacuerdos: string[] = []
  let n20 = 0
  for (const motor of IDS_MOTORES) {
    const descartados: readonly string[] = descriptor(motor).conexion.descartarAlGuardar
    for (const campo of ['host', 'database', 'sid'] as const) {
      // Un motor de archivo necesita su archivo ya resuelto para darse de alta.
      const archivoResuelto = descriptor(motor).conexion.deArchivo ? { rutaArchivo: path.join(dir, 'm20.db') } : {}
      // En un motor de claves (Redis) la base es un NÚMERO (0-9999).
      const deClaves = esDeClaves(descriptor(motor))
      const base: EntradaConexion = { profileId: 'p20m', alias: '', motor, host: 'h.lan', port: 1000, database: deClaves ? '1' : 'BASE', sid: '', user: 'u', readonly: true, ...archivoResuelto }
      // El SID, primero junto a la base (PG la exige) y, si el motor no los admite juntos
      // (Oracle), solo.
      const intentos: EntradaConexion[] =
        campo === 'host'
          ? [{ ...base, host: 'VALOR20' }]
          : campo === 'database'
            ? [{ ...base, database: deClaves ? '20' : 'VALOR20' }]
            : [{ ...base, sid: 'SID20' }, { ...base, database: '', sid: 'SID20' }]
      let alta: { ok: true; valor: DbConnection } | { ok: false; error: string } | null = null
      for (const i of intentos) {
        alta = intentar(() => store.create({ ...i, alias: `M20-${++n20}` }))
        if (alta.ok) break
      }
      if (alta === null || !alta.ok) {
        desacuerdos.push(`${motor}.${campo}: ningún alta aceptada (${alta?.ok === false ? alta.error : '?'})`)
        continue
      }
      const d = enDisco(alta.valor.id)
      const guardado = d !== undefined && campo in d && d[campo] !== ''
      if (guardado === descartados.includes(campo)) desacuerdos.push(`${motor}.${campo}: guardado=${guardado} descartado=${descartados.includes(campo)}`)
    }
  }
  check('cada motor: el main guarda o descarta cada campo del destino según su descriptor', desacuerdos.length === 0, desacuerdos.length ? desacuerdos.join(' | ') : `${IDS_MOTORES.length} motores x 3 campos`)

  // La base de Redis se valida AL GUARDAR como un número 0-9999.
  const redisDe = (database: string): EntradaConexion => ({ profileId: 'p20r', alias: `R20-${++n20}`, motor: 'redis', host: 'r.lan', port: 6379, database, sid: '', user: '', readonly: true })
  const antesRedis = JSON.stringify(disco(ruta))
  const redisMala = intentar(() => store.create(redisDe('db1')))
  const redisFuera = intentar(() => store.create(redisDe('10000')))
  check(
    'Redis: una base que no es un número 0-9999 se RECHAZA al guardar (el disco no cambia)',
    !redisMala.ok && !redisFuera.ok && redisMala.error.includes('de 0 a 9999') && JSON.stringify(disco(ruta)) === antesRedis,
    JSON.stringify({ redisMala, redisFuera })
  )
  const redisBuena = intentar(() => store.create(redisDe('3')))
  check('Redis: la base 3 se guarda tal cual', redisBuena.ok && enDisco(redisBuena.valor.id)?.database === '3', JSON.stringify(redisBuena))

  // Se VALIDA lo que se va a GUARDAR (`destinoAGuardar`, compartido por `validate` y
  // `fields()`). Hoy ningún descriptor descarta un campo que su validación mire (lo cruza
  // `test-motores.mts`), así que se fuerza: Oracle con el SID «descartado». Una validación
  // sobre la entrada cruda aceptaría el alta por SID y la escribiría sin servicio ni SID
  // (medido con esa mutación); la buena la rechaza con el mensaje del destino y no escribe.
  const conexionOra = descriptor('oracle').conexion as { descartarAlGuardar: readonly string[] }
  const descartesOra = conexionOra.descartarAlGuardar
  const antesForzado = disco(ruta)
  let forzado: { ok: true; valor: DbConnection } | { ok: false; error: string }
  try {
    conexionOra.descartarAlGuardar = ['sid']
    forzado = intentar(() => store.create({ profileId: 'p20f', alias: 'ORA-forzado', motor: 'oracle', host: 'ora.lan', port: 1521, database: '', sid: 'XE', user: 'u', readonly: true }))
  } finally {
    conexionOra.descartarAlGuardar = descartesOra
  }
  check(
    'con un descarte que la validación mira, el alta se RECHAZA con el mensaje del destino (se valida lo que se guarda)',
    !forzado.ok && forzado.error === 'Oracle necesita un Service Name o un SID.',
    forzado.ok ? `aceptada: ${JSON.stringify(enDisco(forzado.valor.id))}` : forzado.error
  )
  const intacto = JSON.stringify(disco(ruta)) === JSON.stringify(antesForzado)
  check('…y el disco no cambia', intacto, intacto ? 'registro intacto' : 'el registro cambió')
}

hr('(21) Una SQLite en el registro (motor de ARCHIVO), con el ConnectionStore real')
{
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  const bd = path.join(dir, 'carpeta con espacios', 'ejemplo.db')
  const otra = path.join(dir, 'otra.db')
  const alta: EntradaConexion = { profileId: 'p21', alias: 'Ejemplo', motor: 'sqlite', host: 'quedó.escrito', port: 5432, database: 'x', sid: 'y', user: 'u', readonly: true, rutaArchivo: bd }
  const r = intentar(() => store.create(alta))
  check('alta de una SQLite con su archivo resuelto', r.ok, r.ok ? r.valor.id : r.error)
  if (r.ok) {
    const d = enDisco(r.valor.id)
    check(
      'en disco: el archivo (la ruta), y host/puerto/usuario VACÍOS ('+"''/0/''"+'), sin base ni SID (los descarta el motor)',
      d?.archivo === bd && d?.host === '' && d?.port === 0 && d?.user === '' && !('database' in d) && !('sid' in d),
      JSON.stringify(d)
    )
    check('el DTO lleva el NOMBRE (archivoVisible) y NO la ruta', r.valor.archivoVisible === 'ejemplo.db' && !('archivo' in r.valor), JSON.stringify(r.valor))
    check('nace de solo lectura, sin contraseña', r.valor.readonly === true && r.valor.tieneSecreto === false, '')
    check('y se lee como CONOCIDA al releer el registro', new ConnectionStore({ storePath: ruta }).get(r.valor.id)?.archivoVisible === 'ejemplo.db', '')

    // Editar sin elegir otro archivo lo CONSERVA, y la verificación también (nada de lo probado cambió).
    store.marcarVerificada(r.valor.id, null, 1700000000000)
    const e1 = intentar(() => store.update(r.valor.id, { ...formDe(r.valor, { alias: 'Ejemplo 2' }) }))
    check(
      'editar sin archivo nuevo: conserva el archivo y la verificación',
      e1.ok && enDisco(r.valor.id)?.archivo === bd && e1.valor.verificada === true && e1.valor.alias === 'Ejemplo 2',
      e1.ok ? JSON.stringify(enDisco(r.valor.id)) : e1.error
    )
    const e2 = intentar(() => store.update(r.valor.id, { ...formDe(r.valor), rutaArchivo: otra }))
    check(
      'editar con OTRO archivo: lo cambia y retira la verificación (lo probado era el otro)',
      e2.ok && enDisco(r.valor.id)?.archivo === otra && e2.valor.verificada === false && e2.valor.archivoVisible === 'otra.db',
      e2.ok ? JSON.stringify(enDisco(r.valor.id)) : e2.error
    )
    const e3 = intentar(() =>
      store.update(r.valor.id, { profileId: 'p21', alias: 'Ahora PG', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', user: 'u', readonly: true })
    )
    check(
      'pasarla a PostgreSQL: el archivo se va del disco y del DTO',
      e3.ok && !('archivo' in (enDisco(r.valor.id) ?? {})) && e3.valor.archivoVisible === undefined,
      e3.ok ? JSON.stringify(enDisco(r.valor.id)) : e3.error
    )
  }
  const sinArchivo = intentar(() => store.create({ ...alta, alias: 'Sin archivo', rutaArchivo: undefined }))
  check('sin archivo: «Falta el archivo de la base.»', !sinArchivo.ok && sinArchivo.error === 'Falta el archivo de la base.', sinArchivo.ok ? 'creó' : sinArchivo.error)
  const sinNombre = intentar(() => store.create({ ...alta, alias: ' ', rutaArchivo: undefined }))
  check('sin nombre ni archivo: el del nombre, primero (el orden de siempre)', !sinNombre.ok && sinNombre.error === 'La conexión necesita un nombre.', sinNombre.ok ? 'creó' : sinNombre.error)
  const conClave = intentar(() => store.create({ ...alta, alias: 'Con clave', password: 'x' }))
  check('con contraseña: «SQLite no usa contraseña.» (no queda un secreto huérfano)', !conClave.ok && conClave.error === 'SQLite no usa contraseña.', conClave.ok ? 'creó' : conClave.error)
  const claveVacia = intentar(() => store.create({ ...alta, alias: 'Clave vacía', password: '', rutaArchivo: otra }))
  check('NEGATIVO: la contraseña VACÍA del formulario no es una contraseña', claveVacia.ok, claveVacia.ok ? '' : claveVacia.error)
  // Oracle y PG, sin archivo: lo de siempre (su archivo, si llegara, se ignora).
  const pg = intentar(() => store.create({ profileId: 'p21', alias: 'PG', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', user: 'u', readonly: true, rutaArchivo: bd }))
  check('NEGATIVO: una PG con un archivo colado no lo guarda', pg.ok && !('archivo' in (enDisco(pg.valor.id) ?? {})) && pg.valor.archivoVisible === undefined, pg.ok ? JSON.stringify(enDisco(pg.valor.id)) : pg.error)

  // La huella: la de un motor de red es la de SIEMPRE (seis valores); la de un archivo lleva la ruta.
  const red = { motor: 'postgres', host: 'h', port: 5432, database: 'd', sid: undefined, user: 'u' }
  const seis = createHash('sha256').update(JSON.stringify(['postgres', 'h', 5432, 'd', null, 'u']), 'utf8').digest('hex').slice(0, 32)
  check('huella de red: la de antes al byte (sin séptimo valor)', huellaDestino(red) === seis, huellaDestino(red))
  const deArchivo = { motor: 'sqlite', host: '', port: 0, user: '', archivo: bd }
  check('huella de archivo: cambia con la ruta', huellaDestino(deArchivo) !== huellaDestino({ ...deArchivo, archivo: otra }), '')
}

hr('(22) Una SQL Server en el registro (base opcional, instancia, dominio, cifrado), con el ConnectionStore real')
{
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  const alta: EntradaConexion = {
    profileId: 'p22',
    alias: 'Ventas SQLS',
    motor: 'sqlserver',
    host: ' mssql.lan ',
    port: 1433,
    database: '',
    sid: 'quedó',
    user: 'ana',
    readonly: true,
    instancia: ' SQLEXPRESS ',
    autenticacion: 'ntlm',
    dominio: ' EMPRESA ',
    tls: { cifrar: true, confiarCertificado: true }
  }
  const r = intentar(() => store.create(alta))
  check('alta de una SQL Server SIN base (el árbol híbrido: nivel «Bases»)', r.ok, r.ok ? r.valor.id : r.error)
  if (r.ok) {
    const d = enDisco(r.valor.id)
    check(
      'en disco: instancia y dominio recortados, autenticación y cifrado; sin base ni SID',
      d?.instancia === 'SQLEXPRESS' &&
        d?.dominio === 'EMPRESA' &&
        d?.autenticacion === 'ntlm' &&
        JSON.stringify(d?.tls) === JSON.stringify({ cifrar: true, confiarCertificado: true }) &&
        d !== undefined &&
        !('database' in d) &&
        !('sid' in d),
      JSON.stringify(d)
    )
    check('el DTO los lleva (no son secretos)', r.valor.instancia === 'SQLEXPRESS' && r.valor.autenticacion === 'ntlm' && r.valor.dominio === 'EMPRESA', JSON.stringify(r.valor))
    store.marcarVerificada(r.valor.id, null, 1700000000000)
    const e1 = intentar(() => store.update(r.valor.id, { ...formDe(r.valor, { alias: 'Ventas 2' }), instancia: 'SQLEXPRESS', autenticacion: 'ntlm', dominio: 'EMPRESA', tls: { cifrar: true, confiarCertificado: true } }))
    check('editar el nombre sin tocar el destino: conserva la verificación', e1.ok && e1.valor.verificada === true, e1.ok ? JSON.stringify(e1.valor) : e1.error)
    const e2 = intentar(() => store.update(r.valor.id, { ...formDe(r.valor), instancia: 'SQLEXPRESS', autenticacion: 'ntlm', dominio: 'EMPRESA', tls: { cifrar: true, confiarCertificado: false } }))
    check('cambiar solo «Confiar en el certificado» RETIRA la verificación (es lo probado)', e2.ok && e2.valor.verificada === false, e2.ok ? JSON.stringify(e2.valor) : e2.error)
    const e3 = intentar(() => store.update(r.valor.id, { ...formDe(r.valor), autenticacion: 'sql', dominio: 'EMPRESA' }))
    check('con autenticación SQL el dominio NO se guarda', e3.ok && !('dominio' in (enDisco(r.valor.id) ?? {})) && enDisco(r.valor.id)?.autenticacion === 'sql', e3.ok ? JSON.stringify(enDisco(r.valor.id)) : e3.error)
    const e4 = intentar(() => store.update(r.valor.id, { profileId: 'p22', alias: 'Ahora PG', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', user: 'u', readonly: true, instancia: 'X', autenticacion: 'ntlm', dominio: 'D', tls: { cifrar: false, confiarCertificado: false } }))
    const d4 = enDisco(r.valor.id) ?? {}
    check(
      'pasarla a PostgreSQL: los campos de SQL Server se van (PG no los declara) y su huella es la de siempre',
      e4.ok && !('instancia' in d4) && !('autenticacion' in d4) && !('dominio' in d4) && !('tls' in d4),
      JSON.stringify(d4)
    )
  }
  const sinDominio = intentar(() => store.create({ ...alta, alias: 'Sin dominio', dominio: '  ' }))
  check('NTLM sin dominio: «Falta el dominio de la cuenta.»', !sinDominio.ok && sinDominio.error === 'Falta el dominio de la cuenta.', sinDominio.ok ? 'creó' : sinDominio.error)
  const instMala = intentar(() => store.create({ ...alta, alias: 'Inst mala', instancia: 'srv\\SQLEXPRESS' }))
  check('instancia con el servidor pegado: se dice qué va ahí', !instMala.ok && instMala.error.startsWith('En la instancia va solo su nombre'), instMala.ok ? 'creó' : instMala.error)
  const autRara = intentar(() => store.create({ ...alta, alias: 'Aut rara', autenticacion: 'kerberos' as never }))
  check('una autenticación desconocida se rechaza', !autRara.ok && autRara.error === 'Autenticación desconocida: "kerberos".', autRara.ok ? 'creó' : autRara.error)
  const tlsMalo = intentar(() => store.create({ ...alta, alias: 'TLS malo', tls: { cifrar: 'si' } as never }))
  check('un cifrado mal formado se rechaza', !tlsMalo.ok && tlsMalo.error === 'El cifrado de la conexión no es válido.', tlsMalo.ok ? 'creó' : tlsMalo.error)
  const conBase = intentar(() => store.create({ ...alta, alias: 'Con base', database: ' ventas ', instancia: undefined, autenticacion: undefined, dominio: undefined, tls: undefined }))
  check(
    'con base fija y lo demás por defecto: la base limpia y ningún campo opcional en disco',
    conBase.ok && enDisco(conBase.valor.id)?.database === 'ventas' && !('instancia' in (enDisco(conBase.valor.id) ?? {})) && !('tls' in (enDisco(conBase.valor.id) ?? {})),
    conBase.ok ? JSON.stringify(enDisco(conBase.valor.id)) : conBase.error
  )
  const pgColado = intentar(() => store.create({ profileId: 'p22', alias: 'PG colado', motor: 'postgres', host: 'pg', port: 5432, database: 'a', user: 'u', readonly: true, instancia: 'X', tls: { cifrar: true, confiarCertificado: true } }))
  check(
    'NEGATIVO: una PG con campos de SQL Server colados no los guarda (su registro no cambia)',
    pgColado.ok && !('instancia' in (enDisco(pgColado.valor.id) ?? {})) && !('tls' in (enDisco(pgColado.valor.id) ?? {})),
    pgColado.ok ? JSON.stringify(enDisco(pgColado.valor.id)) : pgColado.error
  )
  check('y se lee como CONOCIDA al releer el registro', r.ok && new ConnectionStore({ storePath: ruta }).get(r.valor.id) !== undefined, '')
}

hr('(23) Integración: las BASES visibles del nivel «Bases» se guardan de verdad')
{
  // Lo pidió el grupo SESIÓN: `FIJAR_BASES` llamaba a un `setBasesVisibles` que el store no
  // tenía, y el «N de M» de las bases se perdía al cerrar. Misma forma y misma regla que los
  // esquemas: se normaliza al fijar y al leer, sale COPIADA en el DTO, editar el nombre la
  // conserva y cambiar de motor la retira.
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  const r = intentar(() =>
    store.create({ profileId: 'p23', alias: 'Sin base', motor: 'sqlserver', host: 'mssql.lan', port: 1433, database: '', user: 'ana', readonly: true })
  )
  check('alta de una SQL Server sin base', r.ok, r.ok ? r.valor.id : r.error)
  if (r.ok) {
    const id = r.valor.id
    const LISTA = { modo: 'lista' as const, porDefecto: true, esquemas: ['ventas', 'ventas', 'rrhh'] }
    const f = intentar(() => store.setBasesVisibles(id, LISTA))
    check(
      'setBasesVisibles guarda la selección NORMALIZADA (sin duplicados) y el DTO la trae',
      f.ok && JSON.stringify(f.valor.bases) === '{"modo":"lista","porDefecto":true,"esquemas":["ventas","rrhh"]}',
      f.ok ? JSON.stringify(f.valor.bases) : f.error
    )
    check('en disco, en la clave `bases` (los esquemas no se tocan)', JSON.stringify(enDisco(id)?.bases) === '{"modo":"lista","porDefecto":true,"esquemas":["ventas","rrhh"]}' && !('esquemas' in (enDisco(id) ?? {})), JSON.stringify(enDisco(id)))
    check('y sobrevive a releer el registro (el «N de M» no se pierde al cerrar)', JSON.stringify(new ConnectionStore({ storePath: ruta }).get(id)?.bases) === JSON.stringify(enDisco(id)?.bases), JSON.stringify(new ConnectionStore({ storePath: ruta }).get(id)?.bases))
    const dto = store.get(id)!
    ;(dto.bases as { esquemas: string[] }).esquemas.push('colada')
    check('NEGATIVO: mutar el DTO no cambia el registro (sale copiada)', !JSON.stringify(store.get(id)?.bases).includes('colada'), JSON.stringify(store.get(id)?.bases))
    const mala = intentar(() => store.setBasesVisibles(id, { modo: 'raro' } as never))
    check('NEGATIVO: una forma inválida se RECHAZA y no se guarda', !mala.ok && mala.error === 'La selección de bases no es válida.' && JSON.stringify(enDisco(id)?.bases).includes('rrhh'), mala.ok ? 'guardó' : mala.error)
    store.update(id, formDe(store.get(id)!, { alias: 'Sin base 2' }))
    check('editar el nombre conserva las bases (regla de los esquemas)', enDisco(id)?.alias === 'Sin base 2' && JSON.stringify(enDisco(id)?.bases).includes('rrhh'), JSON.stringify(enDisco(id)))
    const t = intentar(() => store.setBasesVisibles(id, { modo: 'todos' }))
    check('volver a «todas» se escribe', t.ok && JSON.stringify(enDisco(id)?.bases) === '{"modo":"todos"}', JSON.stringify(enDisco(id)?.bases))
    store.update(id, formDe(store.get(id)!, { motor: 'postgres', port: 5432, database: 'app' }))
    check('NEGATIVO: pasarla a PostgreSQL retira las bases (sus nombres no significan nada allí)', !('bases' in (enDisco(id) ?? {})), JSON.stringify(enDisco(id)))
  }
  const desconocida = intentar(() => store.setBasesVisibles('no-existe', { modo: 'todos' }))
  check('NEGATIVO: una conexión desconocida lanza', !desconocida.ok && desconocida.error.includes('no-existe'), desconocida.ok ? 'guardó' : desconocida.error)
  // Del disco: unas bases que no se entienden van al RESTO (el disco las conserva) y no al DTO.
  const rutaRara = archivo({ version: 1, connections: [{ id: 'b-raro', profileId: 'p23', alias: 'Rara', motor: 'sqlserver', host: 'h', port: 1433, user: 'u', bases: { modo: 'futuro' } }] })
  const sRara = new ConnectionStore({ storePath: rutaRara })
  check('unas bases ilegibles en disco no llegan al DTO', sRara.get('b-raro') !== undefined && sRara.get('b-raro')?.bases === undefined, JSON.stringify(sRara.get('b-raro')))
}

hr('(24) MongoDB y Redis con el USUARIO OPCIONAL, con el ConnectionStore real')
{
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  for (const [motor, port] of [['mongodb', 27017], ['redis', 6379]] as const) {
    const base: EntradaConexion = { profileId: 'p24', alias: `${motor} sin usuario`, motor, host: ' local ', port, user: '', readonly: true }
    const sinNada = intentar(() => store.create(base))
    check(
      `${motor}: sin usuario ni clave se guarda (se conecta sin autenticar), con user '' en disco y sin secreto`,
      sinNada.ok && enDisco(sinNada.valor.id)?.user === '' && enDisco(sinNada.valor.id)?.host === 'local' && sinNada.valor.tieneSecreto === false,
      sinNada.ok ? JSON.stringify(enDisco(sinNada.valor.id)) : sinNada.error
    )
    const soloClave = intentar(() => store.create({ ...base, alias: `${motor} solo clave`, password: 'secreto' }))
    check(
      `${motor}: sin usuario y CON clave (p. ej. un requirepass) se guarda con su secreto`,
      soloClave.ok && soloClave.valor.tieneSecreto === true && enDisco(soloClave.valor.id)?.user === '',
      soloClave.ok ? JSON.stringify(soloClave.valor) : soloClave.error
    )
    const conUsuario = intentar(() => store.create({ ...base, alias: `${motor} con usuario`, user: ' lector ', password: 'x' }))
    check(
      `${motor}: el usuario opcional, si se escribe, se GUARDA recortado`,
      conUsuario.ok && enDisco(conUsuario.valor.id)?.user === 'lector' && conUsuario.valor.user === 'lector',
      conUsuario.ok ? JSON.stringify(enDisco(conUsuario.valor.id)) : conUsuario.error
    )
    const usuarioRaro = intentar(() => store.create({ ...base, alias: `${motor} usuario raro`, user: 7 as never }))
    check(`${motor}: un usuario que no es texto se rechaza`, !usuarioRaro.ok && usuarioRaro.error === 'El usuario no es válido.', usuarioRaro.ok ? 'creó' : usuarioRaro.error)
    check(`${motor}: y se lee como CONOCIDA al releer el registro`, sinNada.ok && new ConnectionStore({ storePath: ruta }).get(sinNada.valor.id)?.motor === motor, '')
  }
  // NEGATIVO: los motores SQL con usuario obligatorio siguen exigiéndolo, con su mensaje de siempre.
  const oraSinUsuario = intentar(() => store.create({ profileId: 'p24', alias: 'Ora sin usuario', motor: 'oracle', host: 'h', port: 1521, database: 'ORCL', user: '', readonly: true }))
  check('NEGATIVO: un Oracle sin usuario sigue rechazándose con «Falta el usuario.»', !oraSinUsuario.ok && oraSinUsuario.error === 'Falta el usuario.', oraSinUsuario.ok ? 'creó' : oraSinUsuario.error)
}

hr('(25) MongoDB con srv, opcionesUri y el cifrado EFECTIVO en el registro que lee tdb')
{
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const enDisco = (id: string): Crudo | undefined => de(disco(ruta), id)
  const base: EntradaConexion = { profileId: 'p25', alias: 'Atlas', motor: 'mongodb', host: 'cluster0.ejemplo.net', port: 27017, user: 'u', readonly: true }
  const conSrv = intentar(() => store.create({ ...base, srv: true, opcionesUri: '' }))
  check(
    'con srv y sin cifrado escrito: en disco srv: true y tls { cifrar: true, confiarCertificado: false }; sin opcionesUri (vacía)',
    conSrv.ok &&
      enDisco(conSrv.valor.id)?.srv === true &&
      JSON.stringify(enDisco(conSrv.valor.id)?.tls) === JSON.stringify({ cifrar: true, confiarCertificado: false }) &&
      !('opcionesUri' in (enDisco(conSrv.valor.id) ?? {})) &&
      conSrv.valor.srv === true,
    conSrv.ok ? JSON.stringify(enDisco(conSrv.valor.id)) : conSrv.error
  )
  const local = intentar(() => store.create({ ...base, alias: 'Local', host: '127.0.0.1' }))
  check(
    'sin srv ni cifrado: tls efectivo sin cifrar en disco (lo que lee tdb) y sin la clave srv',
    local.ok && JSON.stringify(enDisco(local.valor.id)?.tls) === JSON.stringify({ cifrar: false, confiarCertificado: false }) && !('srv' in (enDisco(local.valor.id) ?? {})),
    local.ok ? JSON.stringify(enDisco(local.valor.id)) : local.error
  )
  const srvRaro = intentar(() => store.create({ ...base, alias: 'Raro', srv: 'si' as never }))
  check('un srv que no es booleano se rechaza', !srvRaro.ok && srvRaro.error === 'El tipo de dirección (SRV) no es válido.', srvRaro.ok ? 'creó' : srvRaro.error)
  const opcMala = intentar(() => store.create({ ...base, alias: 'Opc mala', opcionesUri: 'tlsCAFile=/etc/ca.pem' }))
  check('unas opcionesUri fuera de la lista blanca se rechazan al guardar', !opcMala.ok, opcMala.ok ? 'creó' : opcMala.error)
  // Del disco: un srv o unas opcionesUri de otro tipo (edición a mano) no llegan al DTO y se conservan.
  const rutaRara = archivo({
    version: 1,
    connections: [{ id: 'm-raro', profileId: 'p25', alias: 'Rara', motor: 'mongodb', host: 'h', port: 27017, user: '', srv: 'si', opcionesUri: 3 }]
  })
  const sRara = new ConnectionStore({ storePath: rutaRara })
  const dto = sRara.get('m-raro')
  check('srv y opcionesUri ilegibles en disco no llegan al DTO', dto !== undefined && dto.srv === undefined && dto.opcionesUri === undefined, JSON.stringify(dto))
}

hr('(26) Guardar SOLO la casilla de los agentes, con lo que el store GUARDARÍA')
{
  // La entrada es la que manda el formulario (`entradaDe` de `borradorConexion.ts`): con
  // MongoDB van SIEMPRE `srv` (también false), `tls` y `opcionesUri`, y `notas`, `database` y
  // `sid` vacíos: comparando la entrada cruda, `srv: false` frente al
  // `srv` ausente del registro hacía que ninguna MongoDB sin SRV entrara nunca.
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const formMongo = (c: DbConnection, cambio: Partial<EntradaConexion> = {}): EntradaConexion => ({
    profileId: c.profileId,
    alias: c.alias,
    motor: c.motor,
    host: c.host,
    port: c.port,
    database: c.database ?? '',
    sid: '',
    user: c.user,
    readonly: c.readonly,
    notas: '',
    tls: c.tls ?? { cifrar: false, confiarCertificado: false },
    srv: c.srv === true,
    opcionesUri: c.opcionesUri ?? '',
    ...cambio
  })
  const m = store.create({ profileId: 'p26', alias: ' Mongo ', motor: 'mongodb', host: 'h', port: 27017, user: 'u', password: 's', readonly: true, srv: false, opcionesUri: 'authSource=admin', tls: { cifrar: false, confiarCertificado: false } })
  const casilla = formMongo(m, { readonly: false })
  check('MongoDB SIN srv, con opciones y alias con blancos: solo la casilla → sí', store.soloCambiaLaCasillaDeAgentes(m.id, casilla), JSON.stringify(m))
  check('sin cambiar la casilla → no (es otra edición o ninguna)', !store.soloCambiaLaCasillaDeAgentes(m.id, formMongo(m)), '')
  const negativos: Array<[string, EntradaConexion]> = [
    ['contraseña nueva', { ...casilla, password: 'otra' }],
    ['contraseña borrada', { ...casilla, password: '' }],
    ['otro host', { ...casilla, host: 'h2' }],
    ['marcar el SRV', { ...casilla, srv: true }],
    ['quitar las opciones', { ...casilla, opcionesUri: '' }],
    ['cifrar', { ...casilla, tls: { cifrar: true, confiarCertificado: false } }],
    ['otro entorno', { ...casilla, entorno: 'produccion' }],
    ['otras notas', { ...casilla, notas: 'x' }],
    ['una entrada que no valida', { ...casilla, port: 0 }],
    ['un archivo nuevo', { ...casilla, rutaArchivo: 'C:\\x.db' }]
  ]
  const falsos = negativos.filter(([, e]) => store.soloCambiaLaCasillaDeAgentes(m.id, e)).map(([n]) => n)
  check('con cualquier otro cambio → no', falsos.length === 0, JSON.stringify(falsos))
  const conSrv = store.create({ profileId: 'p26', alias: 'Srv', motor: 'mongodb', host: 'c.ejemplo.net', port: 27017, user: '', readonly: true, srv: true })
  check('con SRV guardado: solo la casilla → sí; desmarcar el SRV → no', store.soloCambiaLaCasillaDeAgentes(conSrv.id, formMongo(conSrv, { readonly: false })) && !store.soloCambiaLaCasillaDeAgentes(conSrv.id, formMongo(conSrv, { readonly: false, srv: false })), JSON.stringify(conSrv))
  // Un motor SQL, con la forma de su formulario (sin opcionales).
  const pg = store.create({ profileId: 'p26', alias: 'PG', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', password: 's', readonly: false, entorno: 'pruebas' })
  const formPg: EntradaConexion = { profileId: 'p26', alias: 'PG', motor: 'postgres', host: 'h', port: 5432, database: 'd', sid: '', user: 'u', readonly: true, notas: '', entorno: 'pruebas' }
  check('PostgreSQL: solo la casilla → sí; y quitar el entorno a la vez → no', store.soloCambiaLaCasillaDeAgentes(pg.id, formPg) && !store.soloCambiaLaCasillaDeAgentes(pg.id, { ...formPg, entorno: undefined }), JSON.stringify(pg))
  check('una conexión que no existe → no', !store.soloCambiaLaCasillaDeAgentes('no-existe', formPg), '')
}

hr('(27) «Probar» en vuelo y «Guardar» a la vez: el resultado solo se apunta a la conexión que se probó')
{
  // La prueba tarda (un servidor por VPN) y, mientras dice «Probando…», el usuario cambia el
  // destino y guarda. Al volver, el resultado es del destino de ANTES: apuntarlo dejaría verificada
  // (y montable para el agente) una conexión que nunca respondió, con el driver de la otra.
  const { probarConexion, MENSAJE_CAMBIO_EN_VUELO } = await import('./controlador/probarConexion.ts')
  const ruta = archivo({ version: 1, connections: [] })
  const store = new ConnectionStore({ storePath: ruta })
  const bueno = { ok: true, ms: 8421, modo: 'thick', servidor: 'Oracle 11.2', driverId: 'instantclient-19-win' }
  /** Lanza «Probar» con un `tdb` que no responde hasta que el caso lo suelta. */
  const enVuelo = (id: string): { respuesta: Promise<{ ok: boolean; mensaje: string }>; soltar: () => void; contra: string[] } => {
    let soltar!: () => void
    const tdb = new Promise<Record<string, unknown>>((r) => (soltar = () => r(bueno)))
    const contra: string[] = []
    const respuesta = probarConexion(
      {
        connections: store,
        ejecutar: (con) => {
          contra.push(con.host)
          return tdb
        },
        avisarCambio: () => {}
      },
      id
    )
    return { respuesta, soltar, contra }
  }
  const nueva = (alias: string): DbConnection =>
    store.create({ profileId: 'p27', alias, motor: 'oracle', host: 'erp-a.lan', port: 1521, sid: 'ERP', user: 'APP', password: 'pw', readonly: true })
  /** Lo que queda en memoria y en disco de la conexión. */
  const estado = (id: string): string => {
    const m = store.get(id)
    const d = de(disco(ruta), id)
    return JSON.stringify({ host: m?.host, verificada: m?.verificada, driverId: m?.driverId ?? null, verificadaEn: d?.verificadaEn ?? null, driverDisco: d?.driverId ?? null })
  }

  const a = nueva('Otro host')
  const p1 = enVuelo(a.id)
  store.update(a.id, formDe(a, { host: 'erp-b.lan' }))
  p1.soltar()
  const r1 = await p1.respuesta
  const f1 = store.get(a.id)
  check(
    'guardar OTRO HOST con la prueba en vuelo: la conexión nueva NO queda verificada ni con el driver de la vieja, y se avisa',
    p1.contra[0] === 'erp-a.lan' && f1?.host === 'erp-b.lan' && f1.verificada === false && (f1.driverId ?? null) === null &&
      de(disco(ruta), a.id)?.verificadaEn === undefined && !r1.ok && r1.mensaje === MENSAJE_CAMBIO_EN_VUELO,
    `${estado(a.id)} respuesta=${JSON.stringify(r1)}`
  )

  const b = nueva('Otra clave')
  const p2 = enVuelo(b.id)
  store.update(b.id, formDe(b, { password: 'otra' }))
  p2.soltar()
  const r2 = await p2.respuesta
  check(
    'guardar OTRA CONTRASEÑA con la prueba en vuelo: tampoco se apunta (lo probado era la clave de antes)',
    store.get(b.id)?.verificada === false && !r2.ok && r2.mensaje === MENSAJE_CAMBIO_EN_VUELO,
    `${estado(b.id)} respuesta=${JSON.stringify(r2)}`
  )

  const c = nueva('Borrada')
  const p3 = enVuelo(c.id)
  store.remove(c.id)
  p3.soltar()
  const r3 = await p3.respuesta
  check('borrarla con la prueba en vuelo: nada que apuntar, y se avisa', store.get(c.id) === undefined && !r3.ok && r3.mensaje === MENSAJE_CAMBIO_EN_VUELO, JSON.stringify(r3))

  const d = nueva('Solo notas')
  const p4 = enVuelo(d.id)
  store.update(d.id, formDe(d, { notas: 'de la VPN', readonly: false }))
  p4.soltar()
  const r4 = await p4.respuesta
  const f4 = store.get(d.id)
  check(
    'NEGATIVO: guardar lo que no se prueba (notas, la casilla de los agentes) con la prueba en vuelo SÍ la apunta',
    r4.ok && f4?.verificada === true && f4.driverId === 'instantclient-19-win' && f4.notas === 'de la VPN',
    `${estado(d.id)} respuesta=${JSON.stringify(r4)}`
  )

  const e = nueva('Sin tocar')
  const p5 = enVuelo(e.id)
  p5.soltar()
  const r5 = await p5.respuesta
  check('NEGATIVO: sin editar nada, la prueba buena verifica y recuerda el driver, como siempre', r5.ok && store.get(e.id)?.verificada === true && store.get(e.id)?.driverId === 'instantclient-19-win', estado(e.id))
}

hr('(28) El espacio de datos (WORKSPACE_ENSURE) solo se prepara para un perfil que el main conoce')
{
  const handlers = new Map<string, (evento: unknown, req: unknown) => unknown>()
  const llamadas: string[] = []
  const bd = {
    ensureWorkspace: (id: string, nombre: string) => {
      llamadas.push(`${id}|${nombre}`)
      return { projectHostPath: `conexiones/${id}`, name: 'Datos' }
    }
  }
  registrarIpcBd({
    ipc: { handle: (canal: string, fn: (evento: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never,
    bd: bd as never,
    perfiles: () => [{ id: 'vivo', nombre: 'Vivo del main' }]
  })
  const asegurar = (req: unknown): ReturnType<typeof intentar<unknown>> => intentar(() => handlers.get(DB_CHANNELS.WORKSPACE_ENSURE)!({}, req))
  const borrado = asegurar({ profileId: 'borrado', nombrePerfil: 'Borrado' })
  check(
    'un perfil que el main no tiene (recién borrado) NO recupera su conexiones/<id>',
    !borrado.ok && borrado.error.includes('Ese perfil no existe') && !llamadas.some((l) => l.startsWith('borrado|')),
    borrado.ok ? 'se preparó' : borrado.error
  )
  const vivo = asegurar({ profileId: 'vivo', nombrePerfil: 'Lo que diga el renderer' })
  check('uno vivo sí, con el nombre del main y no el del renderer', vivo.ok && llamadas.includes('vivo|Vivo del main'), llamadas.join(' ; '))
}

rmSync(dir, { recursive: true, force: true })

hr('RESULTADO (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
