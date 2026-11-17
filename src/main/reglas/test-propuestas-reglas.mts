#!/usr/bin/env node
// =============================================================================
// Prueba de las propuestas de reglas (npm run test:propuestas-reglas): el almacén (una por perfil, la nueva
// sustituye, perfiles que ya no existen, escritura atómica con `.bak`, descartar solo la que sigue siendo y el
// borrado del perfil), las operaciones de `tctx` (el perfil del token y no de la petición, vacía, tope, igual a
// las vigentes, motivo) por el puente de verdad, y el `atender` del buzón de Docker. Sin red ni Docker.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_MOTIVO_PROPUESTA, MAX_REGLAS_PERFIL } from '../../shared/reglasPerfil.ts'
import { ID_REGLAS_GLOBALES, REGLAS_CHANNELS, type PropuestaReglas } from '../../shared/reglas-ipc.ts'
import { PuenteBd } from '../db/puenteBd.ts'
import { atenderTctx, programaTctx } from './buzonTctx.ts'
import { registrarIpcReglas } from './ipc.ts'
import { enUnaLinea as normalizarMotivo } from '../../shared/textoParaAviso.ts'
import { OP_PROPONER, OP_REGLAS, OperacionesReglas } from './operacionesReglas.ts'
import { PropuestasReglas } from './propuestasReglas.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const temporales: string[] = []
function temporal(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'tessera-reglas-'))
  temporales.push(d)
  return d
}

/** Las reglas globales del mundo de prueba; `sin-global` es el perfil que no las usa. */
const globales = { texto: '' }

function propuesta(profileId: string, texto: string, en: number, extra: Partial<PropuestaReglas> = {}): PropuestaReglas {
  return { profileId, texto, motivo: '', en, ...extra }
}

/** Un mundo de prueba: perfiles con sus reglas, el almacén, las operaciones y los avisos emitidos. */
function mundo(reglas: Record<string, string | undefined>): {
  dir: string
  perfiles: Map<string, string | undefined>
  almacen: PropuestasReglas
  ops: OperacionesReglas
  avisos: string[]
} {
  const dir = temporal()
  const perfiles = new Map(Object.entries(reglas))
  const almacen = new PropuestasReglas({ ruta: path.join(dir, 'reglas-propuestas.json'), idsVivos: () => [...perfiles.keys(), ID_REGLAS_GLOBALES], log: () => {} })
  const avisos: string[] = []
  let reloj = 1000
  const ops = new OperacionesReglas({
    reglasDe: (id) => (perfiles.has(id) ? (perfiles.get(id) ?? '') : null),
    reglasGlobales: () => globales.texto,
    usaGlobales: (id) => id !== 'sin-global',
    propuestas: almacen,
    alProponer: (id) => avisos.push(id),
    ahora: () => ++reloj
  })
  return { dir, perfiles, almacen, ops, avisos }
}

try {
  hr('A - El almacén: una por perfil, la nueva sustituye, y lo de un perfil que ya no existe no vuelve')
  {
    const dir = temporal()
    const ruta = path.join(dir, 'reglas-propuestas.json')
    let vivos = ['pa', 'pb']
    const almacen = new PropuestasReglas({ ruta, idsVivos: () => vivos, log: () => {} })
    almacen.guardar(propuesta('pa', 'uno', 1))
    almacen.guardar(propuesta('pa', 'dos', 2, { motivo: 'm', proyecto: 'web' }))
    almacen.guardar(propuesta('pb', 'otra', 3))
    check('(a1) la nueva sustituye a la anterior del mismo perfil', almacen.obtener('pa')?.texto === 'dos' && almacen.obtener('pa')?.proyecto === 'web', j(almacen.obtener('pa')))
    check('(a2) cada perfil la suya', j(almacen.pendientes().sort()) === j(['pa', 'pb']), j(almacen.pendientes()))
    const enDisco = JSON.parse(readFileSync(ruta, 'utf-8')) as { version: number; propuestas: PropuestaReglas[] }
    check('(a3) en disco: versión 1 y una por perfil', enDisco.version === 1 && enDisco.propuestas.length === 2, j(enDisco.propuestas.map((p) => p.profileId)))
    check('(a4) escritura atómica: el anterior queda como .bak y no hay temporal', existsSync(`${ruta}.bak`) && !existsSync(`${ruta}.tmp`), String(existsSync(`${ruta}.bak`)))
    const recargado = new PropuestasReglas({ ruta, idsVivos: () => vivos, log: () => {} })
    check('(a5) al recargar, las mismas', recargado.obtener('pa')?.texto === 'dos' && recargado.obtener('pb')?.texto === 'otra', j(recargado.pendientes()))
    vivos = ['pa']
    check('(a6) la de un perfil que ya no existe no se devuelve', recargado.obtener('pb') === null && j(recargado.pendientes()) === j(['pa']), j(recargado.pendientes()))
    const sinPb = new PropuestasReglas({ ruta, idsVivos: () => vivos, log: () => {} })
    vivos = ['pa', 'pb']
    check('(a7) al cargar se ignora la de un perfil inexistente (aunque luego se recree con el mismo id)', sinPb.obtener('pb') === null, j(sinPb.pendientes()))
  }

  hr('B - Descartar solo la que sigue siendo; el borrado del perfil; un archivo roto o a medias')
  {
    const dir = temporal()
    const ruta = path.join(dir, 'reglas-propuestas.json')
    const almacen = new PropuestasReglas({ ruta, idsVivos: () => ['pa'], log: () => {} })
    almacen.guardar(propuesta('pa', 'uno', 10))
    almacen.guardar(propuesta('pa', 'dos', 20))
    check('(b1) con el `en` de una anterior no se quita la nueva', almacen.descartar('pa', 10) === false && almacen.obtener('pa')?.texto === 'dos', j(almacen.obtener('pa')))
    check('(b2) con el suyo, sí', almacen.descartar('pa', 20) === true && almacen.obtener('pa') === null, 'quitada')
    almacen.guardar(propuesta('pa', 'tres', 30))
    almacen.borrarPerfil('pa')
    const tras = new PropuestasReglas({ ruta, idsVivos: () => ['pa'], log: () => {} })
    check('(b3) el borrado del perfil la quita también del disco', tras.obtener('pa') === null, j(tras.pendientes()))
    writeFileSync(ruta, '{ roto')
    writeFileSync(`${ruta}.bak`, JSON.stringify({ version: 1, propuestas: [propuesta('pa', 'del respaldo', 5)] }))
    const delBak = new PropuestasReglas({ ruta, idsVivos: () => ['pa'], log: () => {} })
    check('(b4) primario corrupto: se recupera del .bak', delBak.obtener('pa')?.texto === 'del respaldo', j(delBak.obtener('pa')))
    writeFileSync(ruta, JSON.stringify({ version: 1, propuestas: [{ profileId: 'pa', texto: 'x'.repeat(MAX_REGLAS_PERFIL + 1), motivo: '', en: 1 }, { profileId: 'pa', texto: '', motivo: '', en: 2 }, { profileId: 'pa', texto: 'buena', motivo: 7, en: 3 }] }))
    const raras = new PropuestasReglas({ ruta, idsVivos: () => ['pa'], log: () => {} })
    check('(b5) lo que no tiene la forma (largo, vacío, motivo raro) no se carga', raras.obtener('pa') === null, j(raras.pendientes()))
  }

  hr('B2 - Aceptar: la propuesta solo se quita cuando sus reglas están guardadas en disco')
  {
    const dir = temporal()
    const resueltas: string[] = []
    const almacen = new PropuestasReglas({ ruta: path.join(dir, 'reglas-propuestas.json'), idsVivos: () => ['pa', 'pb'], log: () => {}, alResolver: (id) => resueltas.push(id) })
    almacen.guardar(propuesta('pa', 'Nueva\nregla', 10))
    almacen.resolverAlGuardar('pa', 10, 'Nueva\r\nregla  \n')
    check('(b2a) anotada pero sin guardar, sigue pendiente', almacen.obtener('pa') !== null, j(almacen.pendientes()))
    check('(b2b) un guardado con otras reglas para ese perfil no la quita', j(almacen.alGuardarPerfiles([{ id: 'pa', reglas: 'Otra' }, { id: 'pb', reglas: 'Nueva\nregla' }])) === '[]' && almacen.obtener('pa') !== null, j(almacen.pendientes()))
    check('(b2c) el guardado con las reglas aceptadas (normalizadas) la quita y avisa', j(almacen.alGuardarPerfiles([{ id: 'pa', reglas: 'Nueva\nregla' }])) === j(['pa']) && almacen.obtener('pa') === null && j(resueltas) === j(['pa']), j(resueltas))
    check('(b2d) y no se resuelve dos veces', almacen.alGuardarPerfiles([{ id: 'pa', reglas: 'Nueva\nregla' }]).length === 0 && resueltas.length === 1, j(resueltas))
    almacen.guardar(propuesta('pa', 'A', 20))
    almacen.resolverAlGuardar('pa', 20, 'A')
    almacen.guardar(propuesta('pa', 'B', 30))
    almacen.alGuardarPerfiles([{ id: 'pa', reglas: 'A' }])
    check('(b2e) si llegó otra propuesta entre medias, esa no se pierde', almacen.obtener('pa')?.texto === 'B', j(almacen.obtener('pa')))
    // Editar antes de aceptar: se resuelve con el texto editado, no con el propuesto.
    almacen.guardar(propuesta('pb', 'Propuesto', 40))
    almacen.resolverAlGuardar('pb', 40, 'Editado')
    almacen.alGuardarPerfiles([{ id: 'pb', reglas: 'Propuesto' }])
    check('(b2f) editada: guardar el texto propuesto no la quita', almacen.obtener('pb') !== null, j(almacen.pendientes()))
    almacen.alGuardarPerfiles([{ id: 'pb', reglas: 'Editado' }])
    check('(b2g) editada: guardar el texto editado sí', almacen.obtener('pb') === null, j(almacen.pendientes()))
    // Por el IPC: si las reglas vigentes ya son las aceptadas no habrá otro guardado que esperar.
    const manejadores = new Map<string, (e: unknown, req: unknown) => unknown>()
    const perfiles: Array<{ id: string; reglas?: string }> = [{ id: 'pa', reglas: 'B' }, { id: 'pb' }]
    registrarIpcReglas({ ipc: { handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => void manejadores.set(canal, fn) } as never, propuestas: almacen, perfiles: () => perfiles })
    manejadores.get(REGLAS_CHANNELS.RESOLVER_AL_GUARDAR)?.(null, { perfilId: 'pa', en: 30, texto: 'B' })
    check('(b2h) por el IPC, unas reglas ya guardadas resuelven al momento', almacen.obtener('pa') === null, j(almacen.pendientes()))
    almacen.guardar(propuesta('pa', 'C', 50))
    manejadores.get(REGLAS_CHANNELS.RESOLVER_AL_GUARDAR)?.(null, { perfilId: 'pa', en: 50, texto: 'C' })
    check('(b2i) por el IPC, unas reglas aún sin guardar la dejan pendiente', almacen.obtener('pa') !== null, j(almacen.pendientes()))
    almacen.borrarPerfil('pa')
    almacen.guardar(propuesta('pa', 'D', 60))
    almacen.alGuardarPerfiles([{ id: 'pa', reglas: 'C' }])
    check('(b2j) borrar el perfil olvida lo anotado: el recreado no hereda la espera', almacen.obtener('pa') !== null, j(almacen.pendientes()))
    let lanzo = false
    try {
      manejadores.get(REGLAS_CHANNELS.RESOLVER_AL_GUARDAR)?.(null, { perfilId: 'pa' })
    } catch {
      lanzo = true
    }
    check('(b2k) una petición mal formada se rechaza', lanzo, String(lanzo))
  }

  hr('C - Las operaciones por el puente: el perfil sale del token, nunca de la petición')
  {
    const m = mundo({ pa: 'Regla A', pb: undefined })
    const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    m.ops.registrar(puente)
    const tokenA = puente.emitir('pa', 'C:\\proyectos\\web')
    const leidas = puente.resolver({ v: 1, token: tokenA, op: OP_REGLAS, profileId: 'pb' }) as Record<string, unknown>
    check('(c1) ctx.reglas: las del perfil del token, aunque la petición nombre otro', leidas.ok === true && leidas.reglas === 'Regla A', j(leidas))
    const tokenB = puente.emitir('pb', '/home/u/api')
    const vacias = puente.resolver({ v: 1, token: tokenB, op: OP_REGLAS }) as Record<string, unknown>
    check('(c2) un perfil sin reglas: texto vacío', vacias.ok === true && vacias.reglas === '', j(vacias))
    const r = puente.resolver({ v: 1, token: tokenA, op: OP_PROPONER, profileId: 'pb', texto: 'Regla A\r\nRegla nueva  \n\n', motivo: 'me lo pidió\n dos veces' }) as Record<string, unknown>
    const guardada = m.almacen.obtener('pa')
    check('(c3) ctx.proponer: queda en el perfil del token, normalizada, con el proyecto y sin tocar el otro', r.ok === true && guardada?.texto === 'Regla A\nRegla nueva' && guardada.proyecto === 'web' && m.almacen.obtener('pb') === null, j(guardada))
    check('(c4) el motivo, en una línea y sin controles', guardada?.motivo === 'me lo pidió dos veces', j(guardada?.motivo))
    check('(c5) y se avisa una vez, del perfil del token', j(m.avisos) === j(['pa']), j(m.avisos))
    check('(c6) las vigentes no cambian: una propuesta no es una regla', m.perfiles.get('pa') === 'Regla A', String(m.perfiles.get('pa')))
    const sinToken = puente.resolver({ v: 1, token: 'inventado', op: OP_PROPONER, texto: 'x' }) as Record<string, unknown>
    check('(c7) un token que no es de nadie: no autorizado', sinToken.ok === false && sinToken.error === 'no autorizado', j(sinToken))
    const unaVez = puente.emitirUnaVez('conexion-x', 'pa')
    const probar = puente.resolver({ v: 1, token: unaVez, op: OP_REGLAS }) as Record<string, unknown>
    check('(c8) el token de un solo uso del «Probar» de una base no abre tctx', probar.ok === false && probar.error === 'no autorizado' && puente.sesionDeToken(unaVez) === null, j(probar))
  }

  hr('D - Los rechazos: vacía, tope, igual a las vigentes, motivo largo y perfil borrado')
  {
    const m = mundo({ pa: 'Regla A\nRegla B' })
    const s = { profileId: 'pa', projectHostPath: 'C:\\p\\web', espacioDatos: false }
    const pedir = (campos: Record<string, unknown>): Record<string, unknown> => m.ops.atender(OP_PROPONER, campos, s)
    check('(d1) vacía (solo espacios y saltos)', pedir({ texto: '  \n\n ' }).rechazo === 'vacia', j(pedir({ texto: '  \n\n ' })))
    const larga = pedir({ texto: 'x'.repeat(MAX_REGLAS_PERFIL + 1) })
    check('(d2) pasa del tope: lo dice con el largo y el máximo', larga.rechazo === 'larga' && larga.largo === MAX_REGLAS_PERFIL + 1 && larga.max === MAX_REGLAS_PERFIL, j(larga))
    check('(d3) justo en el tope, se acepta', pedir({ texto: 'y'.repeat(MAX_REGLAS_PERFIL) }).ok === true, 'tope')
    m.almacen.descartar('pa')
    check('(d4) igual a las vigentes (tras normalizar)', pedir({ texto: 'Regla A  \r\nRegla B\n' }).rechazo === 'igual', 'igual')
    const motivoLargo = pedir({ texto: 'Otra', motivo: 'm'.repeat(MAX_MOTIVO_PROPUESTA + 1) })
    check('(d5) motivo de más de 500 caracteres', motivoLargo.rechazo === 'motivo-largo' && motivoLargo.max === MAX_MOTIVO_PROPUESTA, j(motivoLargo))
    check('(d6) un motivo con controles cuenta tras quitarlos', normalizarMotivo(`a${String.fromCharCode(7)}\t b${String.fromCharCode(0x1b)}[0m`) === 'a b [0m', normalizarMotivo(`a${String.fromCharCode(7)}\t b`))
    check('(d7) un texto que no es texto', pedir({ texto: 7 }).rechazo === 'peticion' && pedir({ texto: 'x', motivo: 3 }).rechazo === 'peticion', 'peticion')
    check('(d8) ningún rechazo dejó propuesta ni aviso', m.almacen.obtener('pa') === null && m.avisos.length === 1, j(m.avisos))
    m.perfiles.delete('pa')
    check('(d9) el perfil de la sesión ya no existe', pedir({ texto: 'x' }).rechazo === 'sin-perfil' && m.ops.atender(OP_REGLAS, {}, s).rechazo === 'sin-perfil', 'sin-perfil')
    check('(d10) una operación que no es de tctx', m.ops.atender('ssh.listar', {}, s).error === 'operacion desconocida', 'desconocida')
    const datos = mundo({ pd: '' })
    datos.ops.atender(OP_PROPONER, { texto: 'Para datos' }, { profileId: 'pd', projectHostPath: 'C:\\datos\\pd', espacioDatos: true })
    check('(d11) desde el espacio de datos no se apunta ningún proyecto', datos.almacen.obtener('pd')?.proyecto === undefined, j(datos.almacen.obtener('pd')))
  }

  hr('E - El buzón de Docker: resuelve el perfil con el token, sin lanzar nada')
  {
    const m = mundo({ pa: 'Regla A', pb: 'Regla B' })
    const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    const deps = { dirTctx: path.join('src', 'tctx'), sesionDeToken: (t: string) => puente.sesionDeToken(t), operaciones: m.ops }
    const tokenA = puente.emitir('pa', '/proyectos/web')
    const leidas = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_REGLAS, profileId: 'pb' }, deps)
    check('(e1) ctx.reglas: las del perfil del token, dentro de `respuesta`, con código 0', leidas.exitCode === 0 && j(leidas.respuesta) === j({ ok: true, reglas: 'Regla A', reglasGlobales: '' }), j(leidas))
    const respuestaPropuesta = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_PROPONER, texto: 'Regla C', profileId: 'pb' }, deps)
    check('(e2) ctx.proponer: en el perfil del token', (respuestaPropuesta.respuesta as { ok: boolean }).ok && m.almacen.obtener('pa')?.texto === 'Regla C' && m.almacen.obtener('pb') === null, j(respuestaPropuesta))
    const ajeno = await atenderTctx({ v: 1, prog: 'tctx', token: 'inventado', op: OP_REGLAS }, deps)
    check('(e3) un token que no es de ninguna sesión: no autorizado', j(ajeno.respuesta) === j({ ok: false, error: 'no autorizado' }), j(ajeno))
    const sinToken = await atenderTctx({ v: 1, prog: 'tctx', op: OP_REGLAS }, deps)
    check('(e4) sin token: no autorizado', j(sinToken.respuesta) === j({ ok: false, error: 'no autorizado' }), j(sinToken))
    const roto = await atenderTctx({ v: 1, token: tokenA, op: OP_REGLAS }, { ...deps, operaciones: { atender: () => { throw new Error('roto') } } })
    check('(e5) un fallo dentro: error interno, sin tumbar el buzón', j(roto.respuesta) === j({ ok: false, error: 'error interno' }), j(roto))
    hr('F - Las reglas globales: se leen con las del perfil y se proponen aparte')
    globales.texto = 'Regla global'
    const conGlobales = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_REGLAS }, deps)
    check('(f1) ctx.reglas lleva las globales del perfil que las usa', j(conGlobales.respuesta) === j({ ok: true, reglas: 'Regla A', reglasGlobales: 'Regla global' }), j(conGlobales))
    const m2 = mundo({ 'sin-global': 'Propia' })
    check('(f2) y no a uno que no las usa', j(m2.ops.reglas({ profileId: 'sin-global' } as never)) === j({ ok: true, reglas: 'Propia', reglasGlobales: '' }), '')
    const pg = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_PROPONER, texto: 'Regla global nueva', nivel: 'global' }, deps)
    const global = m.almacen.obtener(ID_REGLAS_GLOBALES)
    check('(f3) --global la deja como propuesta de las globales, con el perfil que la propuso', (pg.respuesta as { ok: boolean }).ok && global?.texto === 'Regla global nueva' && global.desdePerfil === 'pa' && m.avisos.at(-1) === ID_REGLAS_GLOBALES, j(global))
    const igualGlobal = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_PROPONER, texto: 'Regla global', nivel: 'global' }, deps)
    check('(f4) igual a las globales vigentes: se rechaza', j(igualGlobal.respuesta) === j({ ok: false, rechazo: 'igual' }), j(igualGlobal))
    const nivelRaro = await atenderTctx({ v: 1, prog: 'tctx', token: tokenA, op: OP_PROPONER, texto: 'X', nivel: 'cuenta' }, deps)
    check('(f5) NEGATIVO: otro nivel no se acepta', j(nivelRaro.respuesta) === j({ ok: false, rechazo: 'peticion' }), j(nivelRaro))
    const sinGlobal = m2.ops.proponer({ texto: 'Sustituye todo', nivel: 'global' }, { profileId: 'sin-global', projectHostPath: '', espacioDatos: true } as never)
    check('(f5b) NEGATIVO: un perfil sin el global no puede proponer las globales, que no ve', j(sinGlobal) === j({ ok: false, rechazo: 'sin-global' }) && m2.almacen.obtener(ID_REGLAS_GLOBALES) === null, j(sinGlobal))
    m.almacen.resolverAlGuardar(ID_REGLAS_GLOBALES, global!.en, 'Regla global nueva')
    check('(f6) aceptada, se resuelve al guardarse las globales', j(m.almacen.alGuardarPerfiles([{ id: ID_REGLAS_GLOBALES, reglas: 'Regla global nueva' }])) === j([ID_REGLAS_GLOBALES]) && m.almacen.obtener(ID_REGLAS_GLOBALES) === null, '')
    globales.texto = ''
    const prog = programaTctx(deps)
    check('(e6) el programa: nombre tctx, su cliente entre sus archivos y los módulos que pide', prog.nombre === 'tctx' && prog.cliente in prog.archivos && ['tctxArgumentos.cjs', 'tctxEntrada.cjs', 'tctxOrdenes.cjs', 'tctxSalida.cjs', 'textosTctx.cjs'].every((n) => n in prog.archivos), j(Object.keys(prog.archivos)))
  }
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
