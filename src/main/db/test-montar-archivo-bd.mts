#!/usr/bin/env node
// =============================================================================
// Prueba de los canales de archivo de `DbController` (motores de archivo: SQLite) con el
// `ConnectionStore` y el `DbController` reales sobre un proyecto temporal: montar como base de datos,
// «qué conexión es este archivo», lo que no se monta, alta y edición por el canal, «Probar» sin
// contraseña y que un archivo del proyecto solo se acepta de la contenedora anclada.
// (node src/main/db/test-montar-archivo-bd.mts) Se relanza con el binario de Electron.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)

if (!process.versions.electron) {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (!electron || !existsSync(electron)) {
    console.log('SALTADO: falta el binario de Electron (lo baja `npm run predev`).')
    console.log('VEREDICTO: SALTADO')
    process.exit(0)
  }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const cifradoFalso = {
  disponible: () => true,
  cifrar: (s: string) => Buffer.from('ENC:' + s, 'utf-8'),
  descifrar: (b: Buffer) => Buffer.from(b).toString('utf-8').slice(4)
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

const { ConnectionStore } = await import('./ConnectionStore.ts')
const { DbController } = await import('./DbController.ts')
const { registrarIpcBd } = await import('./ipc.ts')
const { DB_CHANNELS } = await import('../../shared/db-ipc.ts')
const { MENSAJE_FICHA_DESCONOCIDA } = await import('./archivosBd.ts')
const { esWindows, esMac } = await import('../../shared/plataforma.ts')
type DbConnection = import('../../shared/db-ipc.ts').DbConnection

// --- Molde ------------------------------------------------------------------------------
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

const aqui = path.dirname(fileURLToPath(import.meta.url))
const comun = require_(path.join(aqui, '..', '..', 'tdb', 'sqliteComun.cjs')) as { crearBaseNueva(ruta: string): void }
const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-montar-'))
const proyecto = path.join(raiz, 'Proyecto')
mkdirSync(path.join(proyecto, 'datos'), { recursive: true })
comun.crearBaseNueva(path.join(proyecto, 'datos', 'ventas.db'))
comun.crearBaseNueva(path.join(proyecto, 'otra.sqlite'))
comun.crearBaseNueva(path.join(raiz, 'fuera.db'))
writeFileSync(path.join(proyecto, 'notas.db'), 'no soy una base de datos\n')

type Handler = (evento: unknown, req: unknown) => unknown
const handlers = new Map<string, Handler>()
const storePath = path.join(raiz, 'db-connections.json')
const store = new ConnectionStore({ storePath, cifrado: cifradoFalso })
/** La contenedora que el explorador tiene anclada (la de `FileService` en la app). */
let anclada: string | null = proyecto
const ctrl = new DbController({
  connections: store,
  drivers: {} as never,
  userDataDir: path.join(raiz, 'datos-app'),
  appDir: process.cwd(),
  eventos: { emitir: () => {}, hayDestino: () => false },
  dialogos: {} as never,
  contenedoraAnclada: () => anclada,
  log: () => {}
})
registrarIpcBd({ ipc: { handle: (canal: string, fn: Handler) => void handlers.set(canal, fn) } as never, bd: ctrl })
async function invocar<T>(canal: string, req: unknown): Promise<{ ok: true; valor: T } | { ok: false; error: string }> {
  try {
    return { ok: true, valor: (await handlers.get(canal)!({}, req)) as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
const disco = (): Array<Record<string, unknown>> => (JSON.parse(readFileSync(storePath, 'utf8')) as { connections: Array<Record<string, unknown>> }).connections
const sinRuta = (v: unknown): boolean => !j(v).includes(raiz.replace(/\\/g, '\\\\')) && !j(v).includes(raiz)

try {
  // --- (1) Montar ------------------------------------------------------------------------
  hr('(1) «Montar como base de datos»')
  const req = { profileId: 'p1', projectHostPath: proyecto, relPath: 'datos/ventas.db' }
  const r1 = await invocar<{ conexion: DbConnection; reutilizada: boolean }>(DB_CHANNELS.ARCHIVO_MONTAR, req)
  const c1 = r1.ok ? r1.valor.conexion : null
  check(
    'crea una conexión de solo lectura, verificada, con el nombre del archivo',
    r1.ok && !r1.valor.reutilizada && c1 !== null && c1.motor === 'sqlite' && c1.readonly && c1.verificada === true && c1.alias === 'ventas.db' && c1.archivoVisible === 'ventas.db',
    j(r1)
  )
  check('el DTO no lleva la ruta', r1.ok && sinRuta(r1.valor) && !('archivo' in (c1 ?? {})), j(c1))
  const enDisco = disco().find((c) => c.id === c1?.id)
  check(
    'en disco: la ruta canónica, sin host/puerto/usuario',
    typeof enDisco?.archivo === 'string' && (enDisco.archivo as string).endsWith(path.join('datos', 'ventas.db')) && enDisco.host === '' && enDisco.port === 0 && enDisco.user === '',
    j(enDisco)
  )
  const r2 = await invocar<{ conexion: DbConnection; reutilizada: boolean }>(DB_CHANNELS.ARCHIVO_MONTAR, req)
  check('otra vez: la MISMA, reutilizada', r2.ok && r2.valor.reutilizada && r2.valor.conexion.id === c1?.id && store.list('p1').length === 1, j(r2))
  if (esWindows() || esMac()) {
    const r3 = await invocar<{ conexion: DbConnection; reutilizada: boolean }>(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: 'DATOS/Ventas.DB' })
    check('con otra caja (Windows y Mac no la distinguen): la misma', r3.ok && r3.valor.reutilizada && r3.valor.conexion.id === c1?.id, j(r3))
  }

  // --- (2) ARCHIVO_CONEXION -----------------------------------------------------------------
  hr('(2) ¿Qué conexión es este archivo?')
  const q1 = await invocar<{ id: string } | null>(DB_CHANNELS.ARCHIVO_CONEXION, req)
  check('el mismo archivo: su id', q1.ok && q1.valor?.id === c1?.id, j(q1))
  const q2 = await invocar<{ id: string } | null>(DB_CHANNELS.ARCHIVO_CONEXION, { ...req, relPath: 'otra.sqlite' })
  check('otro archivo: null', q2.ok && q2.valor === null, j(q2))
  const q3 = await invocar<{ id: string } | null>(DB_CHANNELS.ARCHIVO_CONEXION, { ...req, relPath: '../fuera.db' })
  check('fuera del proyecto: null (no lanza)', q3.ok && q3.valor === null, j(q3))
  const q4 = await invocar<{ id: string } | null>(DB_CHANNELS.ARCHIVO_CONEXION, { ...req, profileId: 'p2' })
  check('otro perfil sin ella: null', q4.ok && q4.valor === null, j(q4))

  // --- (3) Lo que no se monta ------------------------------------------------------------------
  hr('(3) Lo que NO se monta (y no crea nada)')
  const antes = disco().length
  const t1 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: 'notas.db' })
  check('un .db de texto: el mensaje del motor', !t1.ok && t1.error.includes('notas.db') && t1.error.includes('texto') && sinRuta(t1.error), j(t1))
  const t2 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: 'no-esta.db' })
  check('no existe', !t2.ok && t2.error === 'No existe «no-esta.db».', j(t2))
  const t3 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: '../fuera.db' })
  check('fuera del proyecto', !t3.ok && t3.error === 'Ese archivo está fuera del proyecto.', j(t3))
  const t4 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: 'lib/x.jar!/a.db' })
  check('dentro de un comprimido', !t4.ok && t4.error.includes('comprimido'), j(t4))
  const t5 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, profileId: '' })
  check('sin perfil', !t5.ok, j(t5))
  check('ninguno creó nada', disco().length === antes, `${antes} -> ${disco().length}`)
  // Un alias ya ocupado por otra conexión del perfil: el siguiente libre.
  mkdirSync(path.join(proyecto, 'copia'), { recursive: true })
  comun.crearBaseNueva(path.join(proyecto, 'copia', 'ventas.db'))
  const t6 = await invocar<{ conexion: DbConnection }>(DB_CHANNELS.ARCHIVO_MONTAR, { ...req, relPath: 'copia/ventas.db' })
  check('otro «ventas.db» en otra carpeta: otra conexión, «ventas.db (2)»', t6.ok && t6.valor.conexion.alias === 'ventas.db (2)' && t6.valor.conexion.id !== c1?.id, j(t6))

  // --- (4) Alta y edición ---------------------------------------------------------------------
  hr('(4) Alta y edición por el canal')
  const base = { profileId: 'p1', motor: 'sqlite', host: '', port: 0, user: '', readonly: false }
  const a1 = await invocar<DbConnection>(DB_CHANNELS.CREATE, { ...base, alias: 'Otra', archivo: { tipo: 'proyecto', projectHostPath: proyecto, relPath: 'otra.sqlite' } })
  const a1Disco = a1.ok ? disco().find((c) => c.id === a1.valor.id) : undefined
  check('origen «proyecto»: guarda la canónica y el DTO solo el nombre', a1.ok && a1.valor.archivoVisible === 'otra.sqlite' && !a1.valor.readonly && typeof a1Disco?.archivo === 'string' && sinRuta(a1.valor), j(a1))
  const a2 = await invocar(DB_CHANNELS.CREATE, { ...base, alias: 'Ficha', archivo: { tipo: 'elegido', token: 'inventada' } })
  check('ficha desconocida: volver a elegir', !a2.ok && a2.error === MENSAJE_FICHA_DESCONOCIDA, j(a2))
  const a3 = await invocar(DB_CHANNELS.CREATE, { ...base, alias: 'SinArchivo' })
  check('sin archivo: «Falta el archivo de la base.»', !a3.ok && a3.error === 'Falta el archivo de la base.', j(a3))
  const s1 = await invocar<{ token: string; nombre: string }>(DB_CHANNELS.ARCHIVO_SOLTADO, { motor: 'sqlite', ruta: path.join(raiz, 'fuera.db') })
  check('soltado: ficha y nombre, sin la ruta', s1.ok && s1.valor.nombre === 'fuera.db' && typeof s1.valor.token === 'string' && sinRuta(s1.valor), j(s1))
  const s2 = await invocar(DB_CHANNELS.ARCHIVO_SOLTADO, { motor: 'sqlite', ruta: path.join(proyecto, 'notas.db') })
  check('soltado un .db de texto: el mensaje del motor', !s2.ok && s2.error.includes('notas.db'), j(s2))
  const s3 = await invocar(DB_CHANNELS.ARCHIVO_SOLTADO, { motor: 'oracle', ruta: path.join(raiz, 'fuera.db') })
  check('soltado para un motor de red: no', !s3.ok && s3.error === 'Ese motor no es de archivo.', j(s3))
  const s4 = await invocar(DB_CHANNELS.ARCHIVO_SOLTADO, { motor: 'sqlite', ruta: '' })
  check('soltado sin ruta (un File que no es del disco): no', !s4.ok, j(s4))
  const a4 = s1.ok ? await invocar<DbConnection>(DB_CHANNELS.CREATE, { ...base, alias: 'Soltada', archivo: { tipo: 'elegido', token: s1.valor.token } }) : null
  check('la ficha del soltado sirve para el alta', a4 !== null && a4.ok && a4.valor.archivoVisible === 'fuera.db', j(a4))
  if (a4 && a4.ok) {
    const e1 = await invocar<DbConnection>(DB_CHANNELS.UPDATE, { id: a4.valor.id, input: { ...base, alias: 'Renombrada' } })
    const e1Disco = disco().find((c) => c.id === a4.valor.id)
    check('editar sin archivo: lo conserva', e1.ok && e1.valor.alias === 'Renombrada' && e1.valor.archivoVisible === 'fuera.db' && String(e1Disco?.archivo).endsWith('fuera.db'), j(e1))
    const e2 = await invocar(DB_CHANNELS.UPDATE, { id: a4.valor.id, input: { ...base, alias: 'Renombrada', password: 'x' } })
    check('una contraseña: «SQLite no usa contraseña.»', !e2.ok && e2.error === 'SQLite no usa contraseña.', j(e2))
  }

  // --- (5) Probar ----------------------------------------------------------------------------
  hr('(5) «Probar» sin contraseña')
  const p = c1 ? await ctrl.test(c1.id) : null
  check('no dice «no tiene contraseña guardada»', p !== null && p.mensaje !== 'Esta conexión no tiene contraseña guardada.', j(p))

  // --- (6) Solo la contenedora ANCLADA ---------------------------
  hr('(6) Un archivo «del proyecto» solo de la contenedora que enseña el explorador')
  const antes6 = disco().length
  // `fuera.db` está DENTRO de `raiz`: antes bastaba con mandar `raiz` como proyecto.
  const otroProyecto = { profileId: 'p1', projectHostPath: raiz, relPath: 'fuera.db' }
  const m1 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, otroProyecto)
  check('montar con otro «proyecto» que el anclado: no, y sin rutas en el mensaje', !m1.ok && /proyecto abierto en el explorador/.test(m1.error) && sinRuta(m1.error), j(m1))
  const m2 = await invocar(DB_CHANNELS.CREATE, { ...base, alias: 'Colada', archivo: { tipo: 'proyecto', ...otroProyecto } })
  check('alta con origen «proyecto» de otra carpeta: no', !m2.ok && /proyecto abierto en el explorador/.test(m2.error), j(m2))
  const m3 = await invocar<{ id: string } | null>(DB_CHANNELS.ARCHIVO_CONEXION, { ...req, projectHostPath: raiz, relPath: 'Proyecto/datos/ventas.db' })
  check('¿qué conexión es? desde otra carpeta: null (no lanza)', m3.ok && m3.valor === null, j(m3))
  anclada = null
  const m4 = await invocar(DB_CHANNELS.ARCHIVO_MONTAR, req)
  check('sin contenedora anclada: no se monta nada', !m4.ok && /proyecto abierto en el explorador/.test(m4.error), j(m4))
  check('ninguno creó nada', disco().length === antes6, `${antes6} -> ${disco().length}`)
  anclada = esWindows() || esMac() ? proyecto.toUpperCase() : proyecto
  const m5 = await invocar<{ conexion: DbConnection; reutilizada: boolean }>(DB_CHANNELS.ARCHIVO_MONTAR, req)
  check('la anclada con otra caja (Windows y Mac) o la misma: sí, la de antes', m5.ok && m5.valor.reutilizada && m5.valor.conexion.id === c1?.id, j(m5))
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const pasan = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(pasan === results.length ? 0 : 1)
