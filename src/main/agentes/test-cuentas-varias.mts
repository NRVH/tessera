// =============================================================================
// Prueba de varias cuentas por (perfil, agente) en `AccountStore` (npm run test:cuentas-varias):
// se crean varias, cada una con su carpeta, en orden de creación; el nombre no se repite (sin
// distinguir mayúsculas) ni pasa del tope, y otro perfil u otro agente sí pueden repetirlo; eliminar
// un agente manual borra sus cuentas y carpetas del perfil.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { Perfil } from '../perfiles/types.ts'
import { PERFIL_CUENTAS_GLOBALES, esCuentaGlobal } from '../../shared/agent-accounts-ipc.ts'

// `AlmacenCuentas` importa sin extensión: el hook reintenta con ".ts" (el mismo de `test-terminal-agente`).
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs), import.meta.url)
const { AlmacenCuentas, MAX_NOMBRE_CUENTA } = await import('./AlmacenCuentas.ts')

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
function falla(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const raiz = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-cuentas-varias-'))
try {
  const store = (): InstanceType<typeof AlmacenCuentas> =>
    new AlmacenCuentas({ rutaAlmacen: path.join(raiz, 'agent-accounts.json'), raizDatos: raiz })

  hr('(1) varias por (perfil, agente)')
  const s = store()
  const a = s.crear({ nombre: 'Trabajo', agente: 'codex', profileId: 'p1' })
  const b = s.crear({ nombre: 'Personal', agente: 'codex', profileId: 'p1' })
  const c = s.crear({ nombre: 'Equipo', agente: 'codex', profileId: 'p1' })
  check('se crean tres sin error, en orden de creación', s.listar('p1', 'codex').map((x) => x.nombre).join() === 'Trabajo,Personal,Equipo', s.listar('p1', 'codex').map((x) => x.nombre).join())
  const carpetas = [a, b, c].map((x) => s.dirHostDe(x))
  check('cada una tiene su carpeta, distinta y creada', new Set(carpetas).size === 3 && carpetas.every((d) => existsSync(d)), carpetas.join(' | '))
  check('sobreviven al reinicio, en el mismo orden', store().listar('p1', 'codex').map((x) => x.id).join() === [a, b, c].map((x) => x.id).join(), 'ok')

  hr('(2) nombres')
  check('NEGATIVO: el mismo nombre en el mismo (perfil, agente) se rechaza', falla(() => s.crear({ nombre: 'Trabajo', agente: 'codex', profileId: 'p1' })) !== null, String(falla(() => s.crear({ nombre: 'Trabajo', agente: 'codex', profileId: 'p1' }))))
  check('NEGATIVO: también con otras mayúsculas y espacios alrededor', falla(() => s.crear({ nombre: '  tRaBaJo ', agente: 'codex', profileId: 'p1' })) !== null, 'ok')
  check('el rechazado no deja ni registro ni carpeta', s.listar('p1', 'codex').length === 3, String(s.listar('p1', 'codex').length))
  const otroAgente = falla(() => s.crear({ nombre: 'Trabajo', agente: 'claude-code', profileId: 'p1' }))
  const otroPerfil = falla(() => s.crear({ nombre: 'Trabajo', agente: 'codex', profileId: 'p2' }))
  check('otro agente u otro perfil sí pueden repetirlo', otroAgente === null && otroPerfil === null, `${otroAgente} | ${otroPerfil}`)
  const largo = 'x'.repeat(MAX_NOMBRE_CUENTA + 1)
  check(`NEGATIVO: un nombre de más de ${MAX_NOMBRE_CUENTA} caracteres se rechaza`, falla(() => s.crear({ nombre: largo, agente: 'codex', profileId: 'p1' })) !== null, 'ok')
  check(`justo ${MAX_NOMBRE_CUENTA}, vale`, falla(() => s.crear({ nombre: 'y'.repeat(MAX_NOMBRE_CUENTA), agente: 'codex', profileId: 'p1' })) === null, 'ok')
  check(
    'NEGATIVO: «Predeterminada» y «Default» están reservados (la predeterminada se enseña así en cada idioma)',
    falla(() => s.crear({ nombre: 'Default', agente: 'codex', profileId: 'p1' })) !== null &&
      falla(() => s.crear({ nombre: 'PREDETERMINADA', agente: 'claude-code', profileId: 'p9' })) !== null,
    'ok'
  )
  check('NEGATIVO: vacío se sigue rechazando', falla(() => s.crear({ nombre: '   ', agente: 'codex', profileId: 'p1' })) !== null, 'ok')

  hr('(3) borrar una no toca las demás')
  s.quitar(b.id)
  check('al borrar la del medio quedan las otras, en orden', s.listar('p1', 'codex').map((x) => x.nombre).slice(0, 2).join() === 'Trabajo,Equipo' && existsSync(s.dirHostDe(a)) && existsSync(s.dirHostDe(c)), s.listar('p1', 'codex').map((x) => x.nombre).join())
  check('y su nombre se puede volver a usar', falla(() => s.crear({ nombre: 'Personal', agente: 'codex', profileId: 'p1' })) === null, 'ok')

  hr('(4) agentes manuales')
  const m = store()
  const lista0 = m.listar('p1', 'm-mio')
  check('un agente manual trae siempre su predeterminada primero, sin entrada en el registro', lista0.length === 1 && lista0[0].id === 'manual' && lista0[0].isDefault === true, JSON.stringify(lista0))
  const carpetaPre = m.dirHostDe(lista0[0])
  check('su carpeta es la de siempre del agente en el perfil', carpetaPre === m.carpetaAgenteManual('p1', 'm-mio'), carpetaPre)
  const segunda = m.crear({ nombre: 'Segunda', agente: 'm-mio', profileId: 'p1' })
  const carpetaSeg = m.dirHostDe(segunda)
  check('se crean cuentas de un agente manual, con carpeta propia hermana y no dentro de la suya', m.listar('p1', 'm-mio').map((x) => x.nombre).join() === 'Predeterminada,Segunda' && carpetaSeg !== carpetaPre && !carpetaSeg.startsWith(carpetaPre + path.sep) && existsSync(carpetaSeg), carpetaSeg)
  check('NEGATIVO: no se puede llamar como la predeterminada', falla(() => m.crear({ nombre: 'predeterminada', agente: 'm-mio', profileId: 'p1' })) !== null, 'ok')
  check('cuentaManual da la elegida, y la predeterminada sin elegir', m.cuentaManual('p1', 'm-mio', segunda.id).id === segunda.id && m.cuentaManual('p1', 'm-mio', undefined).id === 'manual', 'ok')
  const otroAg = m.crear({ nombre: 'Ajena', agente: 'm-otro', profileId: 'p1' })
  check('NEGATIVO: cuentaManual rechaza la cuenta de otro agente, de otro perfil o una de serie', falla(() => m.cuentaManual('p1', 'm-mio', otroAg.id)) !== null && falla(() => m.cuentaManual('p2', 'm-mio', segunda.id)) !== null && falla(() => m.cuentaManual('p1', 'm-mio', a.id)) !== null, 'ok')
  check('NEGATIVO: no se cierra sesión de un agente manual (ni de su predeterminada ni de una creada)', falla(() => m.comprobarCierreSesion('manual')) !== null && falla(() => m.cerrarSesion(segunda.id)) !== null, 'ok')
  check('NEGATIVO: su predeterminada no se borra', falla(() => m.comprobarBorrable('manual')) !== null, 'ok')
  m.quitar(segunda.id)
  check('una creada sí se borra, con su carpeta, y la predeterminada sigue', !existsSync(carpetaSeg) && existsSync(carpetaPre) && m.listar('p1', 'm-mio').length === 1, 'ok')
  check('NEGATIVO: un agente con id roto no crea cuentas', falla(() => m.crear({ nombre: 'X', agente: 'm-../../x' as 'm-x', profileId: 'p1' })) !== null, 'ok')

  hr('(5) eliminar un agente manual borra sus cuentas y carpetas del perfil')
  const o = store()
  const perfilDe = (id: string): Perfil => ({ id, nombre: id, color: '#61afef', agentes: [], sandbox: { habilitado: true } })
  o.asegurarPredeterminadas([perfilDe('p1'), perfilDe('p2')])
  const preO = o.carpetaAgenteManual('p1', 'm-viejo')
  writeFileSync(path.join(preO, 'login.json'), '{}')
  const c1 = o.crear({ nombre: 'Uno', agente: 'm-viejo', profileId: 'p1' })
  const c2 = o.crear({ nombre: 'Dos', agente: 'm-viejo', profileId: 'p1' })
  const enP2 = o.crear({ nombre: 'Uno', agente: 'm-viejo', profileId: 'p2' })
  const deOtro = o.crear({ nombre: 'Uno', agente: 'm-otro', profileId: 'p1' })
  const dirsO = [c1, c2].map((x) => o.dirHostDe(x))
  check('cuentasDeAgenteManual da solo las creadas de ese agente en ese perfil', o.cuentasDeAgenteManual('p1', 'm-viejo').map((x) => x.id).join() === [c1.id, c2.id].join(), 'ok')
  check('NEGATIVO: rechaza un perfil desconocido o un id que no es de agente manual', falla(() => o.cuentasDeAgenteManual('..', 'm-viejo')) !== null && falla(() => o.cuentasDeAgenteManual('p1', '../codex')) !== null && falla(() => o.cuentasDeAgenteManual('p1', 'codex')) !== null, 'ok')
  o.olvidarAgenteManual('p1', 'm-viejo')
  check('sus cuentas creadas salen del registro y sus carpetas se borran', o.listar('p1', 'm-viejo').length === 1 && dirsO.every((d) => !existsSync(d)), o.listar('p1', 'm-viejo').map((x) => x.nombre).join())
  check('la carpeta de su predeterminada se borra con lo que guardó', !existsSync(preO), preO)
  check('las del mismo agente en otro perfil y las de otro agente siguen', existsSync(o.dirHostDe(enP2)) && existsSync(o.dirHostDe(deOtro)) && store().obtener(enP2.id) !== undefined && store().obtener(deOtro.id) !== undefined, 'ok')
  const renacido = store().listar('p1', 'm-viejo')
  check('un agente nuevo con el mismo id nace sin cuentas ni login viejo', renacido.length === 1 && !existsSync(path.join(o.carpetaAgenteManual('p1', 'm-viejo'), 'login.json')), JSON.stringify(renacido.map((x) => x.nombre)))

  hr('(globales)')
  const raizG = path.join(raiz, 'globales')
  mkdirSync(raizG)
  const almacenG = (): InstanceType<typeof AlmacenCuentas> => new AlmacenCuentas({ rutaAlmacen: path.join(raizG, 'agent-accounts.json'), raizDatos: raizG })
  const g = almacenG()
  const privada = g.crear({ nombre: 'Empresa', agente: 'codex', profileId: 'p1' })
  const global1 = g.crear({ nombre: 'Personal', agente: 'codex', profileId: 'p1', global: true })
  check('una global tiene id reconocible y queda marcada', esCuentaGlobal(global1.id) && global1.global === true && global1.profileId === PERFIL_CUENTAS_GLOBALES, global1.id)
  check('se ve en cualquier perfil, detrás de las privadas: sin cuenta elegida se toma una del perfil', g.disponibles('p2', 'codex').map((x) => x.nombre).join() === 'Personal' && g.disponibles('p1', 'codex').map((x) => x.nombre).join() === 'Empresa,Personal', g.disponibles('p1', 'codex').map((x) => x.nombre).join())
  check('NEGATIVO: list sigue siendo solo lo privado, para la copia de la configuración', g.listar('p1', 'codex').map((x) => x.nombre).join() === 'Empresa', g.listar('p1', 'codex').map((x) => x.nombre).join())
  check('NEGATIVO: una privada no repite el nombre de una global', falla(() => g.crear({ nombre: 'personal', agente: 'codex', profileId: 'p2' })) !== null, 'rechazada')
  check('NEGATIVO: una global no repite el nombre de una privada de ningún perfil', falla(() => g.crear({ nombre: 'EMPRESA', agente: 'codex', profileId: 'p9', global: true })) !== null, 'rechazada')
  check('el mismo nombre vale para otro agente', falla(() => g.crear({ nombre: 'Personal', agente: 'claude-code', profileId: 'p1', global: true })) === null, 'creada')
  check('NEGATIVO: un agente manual no puede tener globales', falla(() => g.crear({ nombre: 'Manual', agente: 'm-eco', profileId: 'p1', global: true })) !== null, 'rechazada')
  const dirGlobal = g.dirHostDe(global1)
  check('su carpeta vive fuera de las de los perfiles', existsSync(dirGlobal) && !dirGlobal.includes(`${path.sep}perfiles${path.sep}`) && g.rutaDe(global1) === dirGlobal, dirGlobal)
  writeFileSync(path.join(dirGlobal, 'auth.json'), '{}')
  check('sobrevive al reinicio, con su marca', almacenG().obtener(global1.id)?.global === true, 'ok')
  const crudo = JSON.parse(readFileSync(path.join(raizG, 'agent-accounts.json'), 'utf-8')) as { accounts: { id: string }[] }
  check('NEGATIVO: el registro de las privadas no la contiene: una versión anterior no la descarta', !crudo.accounts.some((a) => a.id === global1.id) && crudo.accounts.some((a) => a.id === privada.id), 'ok')
  g.cerrarSesion(global1.id)
  check('cerrar sesión borra su credencial', !existsSync(path.join(dirGlobal, 'auth.json')), dirGlobal)
  check('renombrarla persiste', g.renombrar(global1.id, 'Casa').nombre === 'Casa' && almacenG().obtener(global1.id)?.nombre === 'Casa', 'ok')
  g.quitar(global1.id)
  check('eliminarla borra registro y carpeta, y no toca las privadas', almacenG().obtener(global1.id) === undefined && !existsSync(dirGlobal) && almacenG().obtener(privada.id) !== undefined, 'ok')
  writeFileSync(path.join(raizG, 'agent-accounts-globales.json'), JSON.stringify({ version: 1, accounts: [{ id: 'global-../../fuera', nombre: 'Mala', agente: 'codex' }, { id: 'otra', nombre: 'Sin prefijo', agente: 'codex' }] }))
  check('NEGATIVO: una entrada editada a mano con un id que saldría de la carpeta se ignora', almacenG().disponibles('p1', 'codex').every((x) => x.nombre !== 'Mala' && x.nombre !== 'Sin prefijo'), 'ignoradas')
  writeFileSync(path.join(raizG, 'agent-accounts-globales.json'), JSON.stringify({ version: 1, accounts: [{ id: 'global-futura', nombre: 'Futura', agente: 'agente-nuevo' }] }))
  almacenG().crear({ nombre: 'Otra', agente: 'codex', profileId: 'p1', global: true })
  const reescrito = readFileSync(path.join(raizG, 'agent-accounts-globales.json'), 'utf-8')
  check('NEGATIVO: una global que esta versión no sabe usar se conserva al reescribir el registro', reescrito.includes('global-futura') && reescrito.includes('Otra'), 'conservada')
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
