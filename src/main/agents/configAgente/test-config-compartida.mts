// =============================================================================
// La configuración compartida de Docker y las propuestas de los agentes, contra carpetas temporales: cómo se
// combinan la capa global y la del perfil, que se componen en un archivo propio sin tocar el de la cuenta, y
// que `tctx config` ve los niveles y propone sin escribir nada, y cómo viajan las capas en la copia de la
// configuración.
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { SesionDelPuente } from '../../db/dbBridge.ts'
import { MAX_BYTES_CONFIG_AGENTE, type PropuestaConfig, type RefConfigAgente } from '../../../shared/configAgente-ipc.ts'
import {
  archivosParaCopia,
  diferenciaArchivo,
  elegirArchivos,
  importarArchivosAgentes,
  leerArchivosAgentesCopia,
  previaArchivosAgentes,
  type ArchivosAgentesCopia,
  type CuentaAqui,
  type EntornoArchivosAgentes
} from './copiaArchivosAgentes.ts'
import { capasDe, carpetaCapa, combinarCapas, prepararCapaCompartida } from './configCompartida.ts'
import { ARCHIVO_CAPA } from '../../../shared/configAgente-ipc.ts'
import { OperacionConfigTctx, OP_CONFIG, OP_CONFIG_PROPONER } from './operacionConfigTctx.ts'
import { PropuestasConfig } from './propuestasConfig.ts'
import { capasParaCopia, importarConfigDocker, leerCapa, leerConfigDockerCopia, previaConfigDocker, type EntornoContexto } from './copiaConfigCompartida.ts'
import type { ContextoGlobal } from '../../../shared/contexto.ts'
import { ServicioConfigAgente } from './ServicioConfigAgente.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}`)
}
function hr(titulo: string): void {
  console.log(`\n--- ${titulo} ---`)
}

const raiz = mkdtempSync(join(os.tmpdir(), 'tessera-config-compartida-'))
const capas = join(raiz, 'capas')
const cuenta = join(raiz, 'cuenta')
const escribir = (ruta: string, texto: string): void => {
  mkdirSync(join(ruta, '..'), { recursive: true })
  writeFileSync(ruta, texto)
}
const perfil = { id: 'sys' }
const nada = (): void => {}

/** Un equipo: las carpetas de sus cuentas y la nativa de cada agente, sin registro de cuentas real. */
function equipoCuentas(dir: string, cuentas: Array<Omit<CuentaAqui, 'base'> & { perfil: string }>): EntornoArchivosAgentes & { creadas: string[]; basePara: (id: string) => string } {
  const creadas: string[] = []
  const basePara = (id: string): string => join(dir, 'cuentas', id)
  return {
    creadas,
    basePara,
    cuentasDe: (p) => cuentas.filter((c) => c.perfil === p).map((c) => ({ ...c, base: basePara(c.id) })),
    baseNativa: (agente) => join(dir, 'nativa', agente),
    carpetaDestino: (p, agente, nombre, predeterminada) => {
      const hay = cuentas.find((c) => c.perfil === p && c.agente === agente && c.predeterminada === predeterminada && c.nombre.toLowerCase() === nombre.toLowerCase())
      if (hay) return basePara(hay.id)
      const id = `creada-${creadas.length}`
      creadas.push(id)
      cuentas.push({ id, perfil: p, agente, nombre, predeterminada })
      return basePara(id)
    }
  }
}

type Eleccion = Parameters<typeof elegirArchivos>[1]
const sinEleccion: Eleccion = { perfiles: [], archivosCuentas: [], cuentasNuevas: [], reglasNativas: [], reasignar: {} }

/** Las cuentas de Docker y las reglas nativas: qué viaja, cómo se comparan y cómo se escriben. */
async function archivosAgentes(raiz: string): Promise<void> {
  hr('archivos de las cuentas y reglas nativas: qué viaja')
  const dirA = join(raiz, 'a')
  const cuentasA = [
    { id: 'default-alfa-claude-code', perfil: 'alfa', agente: 'claude-code' as const, nombre: 'Predeterminada', predeterminada: true },
    { id: 'u-1', perfil: 'alfa', agente: 'codex' as const, nombre: 'Personal', predeterminada: false },
    { id: 'u-2', perfil: 'alfa', agente: 'codex' as const, nombre: 'Vacia', predeterminada: false }
  ]
  const a = equipoCuentas(dirA, cuentasA)
  const bloque = `<!-- tessera:sandbox:start -->\nbloque del contenedor\n<!-- tessera:sandbox:end -->\n`
  escribir(join(a.basePara('default-alfa-claude-code'), 'CLAUDE.md'), `# Reglas de Alfa\n\n${bloque}`)
  escribir(join(a.basePara('default-alfa-claude-code'), 'settings.json'), '{ "model": "alfa" }')
  escribir(join(a.basePara('default-alfa-claude-code'), '.credentials.json'), '{"token":"SECRETO-DE-SESION"}')
  escribir(join(a.basePara('u-1'), 'AGENTS.md'), 'Usa pnpm.\n')
  escribir(join(a.basePara('u-1'), 'config.toml'), 'model = "personal"\n')
  escribir(join(a.basePara('u-1'), 'auth.json'), '{"t":"SECRETO"}')
  escribir(join(a.basePara('u-2'), 'AGENTS.md'), bloque)
  escribir(join(dirA, 'nativa', 'codex', 'AGENTS.md'), 'Regla nativa de codex\n')
  escribir(join(dirA, 'nativa', 'codex', 'config.toml'), 'ruta = "C:/solo/en/este/equipo"\n')
  const { archivos, bloqueados } = await archivosParaCopia(a, ['alfa'], { cuentas: true, nativos: true })
  const texto = JSON.stringify(archivos)
  check('lleva de cada cuenta sus dos archivos y sin el bloque de Tessera', archivos!.cuentas.find((c) => c.id === 'default-alfa-claude-code')?.archivos.instrucciones === '# Reglas de Alfa\n' && archivos!.cuentas.find((c) => c.id === 'u-1')?.archivos.configuracion === 'model = "personal"\n')
  check('NEGATIVO: una cuenta sin nada del usuario no viaja', archivos!.cuentas.every((c) => c.id !== 'u-2'))
  check('NEGATIVO: ni credenciales ni sesiones', !texto.includes('SECRETO'))
  check('las nativas: solo las instrucciones', archivos!.nativos.codex === 'Regla nativa de codex\n' && !texto.includes('solo/en/este/equipo'))
  check('NEGATIVO: ninguna ruta de este equipo viaja', !texto.includes(dirA) && bloqueados.length === 0)
  const soloNativos = await archivosParaCopia(a, ['alfa'], { cuentas: false, nativos: true })
  check('se puede llevar solo una parte', soloNativos.archivos!.cuentas.length === 0 && soloNativos.archivos!.nativos.codex !== undefined)
  check('sin pedir nada, nada', (await archivosParaCopia(a, ['alfa'], { cuentas: false, nativos: false })).archivos === undefined)

  const conBom = equipoCuentas(join(raiz, 'bom'), [{ id: 'b', perfil: 'alfa', agente: 'claude-code', nombre: 'Bom', predeterminada: false }])
  escribir(join(conBom.basePara('b'), 'settings.json'), String.fromCharCode(0xfeff) + '{"a":1}\n')
  const exportadoBom = await archivosParaCopia(conBom, ['alfa'], { cuentas: true, nativos: false })
  check('un BOM no viaja, y el archivo se puede importar en otro equipo', exportadoBom.archivos!.cuentas[0].archivos.configuracion === '{"a":1}\n')

  hr('archivos: enlaces y lectura del archivo')
  const dirEnlace = join(raiz, 'enlace')
  const enlaces = equipoCuentas(dirEnlace, [{ id: 'x', perfil: 'alfa', agente: 'claude-code', nombre: 'Enlace', predeterminada: false }])
  const secreto = join(raiz, 'fuera-de-la-cuenta.txt')
  writeFileSync(secreto, 'NO-TOCAR')
  mkdirSync(enlaces.basePara('x'), { recursive: true })
  let hayEnlaces = true
  try {
    symlinkSync(secreto, join(enlaces.basePara('x'), 'CLAUDE.md'))
  } catch {
    hayEnlaces = false
    console.log('INFO  este usuario no puede crear enlaces: se omite esa parte')
  }
  if (hayEnlaces) {
    const r = await archivosParaCopia(enlaces, ['alfa'], { cuentas: true, nativos: false })
    check('NEGATIVO: un enlace plantado en la cuenta no se sigue y se dice', r.archivos === undefined && r.bloqueados.length === 1 && r.bloqueados[0].nombre === 'CLAUDE.md')
    const copia: ArchivosAgentesCopia = { cuentas: [{ id: 'x', perfil: 'alfa', agente: 'claude-code', nombre: 'Enlace', predeterminada: false, archivos: { instrucciones: 'veneno' } }], nativos: {} }
    const elegidos = elegirArchivos(copia, { ...sinEleccion, perfiles: ['alfa'], archivosCuentas: [{ perfil: 'alfa', cuenta: 'x', tipo: 'instrucciones', sustituir: true }] })
    const hecho = await importarArchivosAgentes(enlaces, elegidos, ['alfa'])
    check('NEGATIVO: importar sobre un enlace no escribe su destino y se avisa', readFileSync(secreto, 'utf8') === 'NO-TOCAR' && hecho.creados.length === 0 && hecho.sustituidos.length === 0 && hecho.revisar[0]?.motivo === 'bloqueado')
  }
  const perfilesCopia = new Set(['alfa'])
  const leido = leerArchivosAgentesCopia({
    cuentas: [
      { id: '../fuera', perfil: 'alfa', agente: 'codex', nombre: 'Mala', predeterminada: false, archivos: { instrucciones: 'x' } },
      { id: 'ok', perfil: 'fantasma', agente: 'codex', nombre: 'Sin perfil', predeterminada: false, archivos: { instrucciones: 'x' } },
      { id: 'ok2', perfil: 'alfa', agente: 'codex', nombre: 'Buena', predeterminada: false, archivos: { instrucciones: 'bien', configuracion: 'x = = 1' } },
      { id: 'ok3', perfil: 'alfa', agente: 'claude-code', nombre: 'Grande', predeterminada: false, archivos: { instrucciones: 'b'.repeat(MAX_BYTES_CONFIG_AGENTE + 1) } }
    ],
    nativos: { codex: 7 }
  }, perfilesCopia)
  check('NEGATIVO: un id que sale de su carpeta o una cuenta de un perfil que no viene no entran', leido!.cuentas.map((c) => c.id).join() === 'ok2')
  check('NEGATIVO: un archivo con errores de sintaxis no se conserva y se apunta', leido!.cuentas[0].archivos.configuracion === undefined && leido!.invalidos!.some((i) => i.nombre === 'config.toml'))
  check('NEGATIVO: un archivo demasiado grande y uno que no es texto tampoco, y se dicen', leido!.invalidos!.some((i) => i.nombre === 'CLAUDE.md') && leido!.invalidos!.some((i) => i.nombre === 'AGENTS.md' && i.cuenta === null) && leido!.nativos.codex === undefined)
  check('un archivo sin este apartado se sigue leyendo', leerArchivosAgentesCopia(undefined, perfilesCopia) === undefined && leerArchivosAgentesCopia({}, perfilesCopia) === undefined)

  hr('archivos: comparar y emparejar cuentas')
  const dirB = join(raiz, 'b')
  // En B, la de Claude Code predeterminada existe sin nada suyo; «Personal» se llama «Mia» pero conserva el id.
  const cuentasB = [
    { id: 'default-bravo-claude-code', perfil: 'bravo', agente: 'claude-code' as const, nombre: 'Predeterminada', predeterminada: true },
    { id: 'u-1', perfil: 'bravo', agente: 'codex' as const, nombre: 'Mia', predeterminada: false }
  ]
  const b = equipoCuentas(dirB, cuentasB)
  escribir(join(b.basePara('default-bravo-claude-code'), 'CLAUDE.md'), bloque)
  escribir(join(b.basePara('default-bravo-claude-code'), 'settings.json'), '{ "model": "bravo" }')
  escribir(join(b.basePara('u-1'), 'AGENTS.md'), 'Usa pnpm.\r\n')
  const previa = await previaArchivosAgentes(b, archivos, ['bravo'])
  const claude = previa.cuentas.find((c) => c.agente === 'claude-code')!
  const codex = previa.cuentas.find((c) => c.agente === 'codex')!
  check('falta: instrucciones que aquí solo traen el bloque de Tessera', claude.frente.bravo.archivos.instrucciones === 'traer')
  check('distinto', claude.frente.bravo.archivos.configuracion === 'distinto')
  check('igual, aunque cambien los finales de línea', codex.frente.bravo.archivos.instrucciones === 'igual')
  check('la misma cuenta aquí con otro nombre: se empareja por su id', codex.frente.bravo.cuenta === 'Mia' && codex.frente.bravo.archivos.configuracion === 'traer')
  check('NEGATIVO: el renderer no recibe contenido en la previa', !JSON.stringify(previa).includes('Reglas de Alfa') && !JSON.stringify(previa).includes('personal'))
  check('una nativa que no está se trae', previa.nativos.find((n) => n.agente === 'codex')?.estado === 'traer')
  const pedido = { origen: 'cuenta', perfilAqui: 'bravo', perfil: 'alfa', cuenta: 'default-alfa-claude-code', tipo: 'configuracion' } as const
  const diff = await diferenciaArchivo(b, archivos, pedido, ['bravo'])
  check('el diff de un archivo distinto da las dos versiones', diff?.aqui === '{ "model": "bravo" }' && diff?.archivo === '{ "model": "alfa" }')
  check('NEGATIVO: el de uno igual no cruza al renderer', (await diferenciaArchivo(b, archivos, { ...pedido, cuenta: 'u-1', tipo: 'instrucciones' }, ['bravo'])) === null)
  check('NEGATIVO: el de un perfil que no es de aquí tampoco', (await diferenciaArchivo(b, archivos, { ...pedido, perfilAqui: 'otro' }, ['bravo'])) === null)

  hr('archivos: importar')
  const elegir = (extra: Partial<Eleccion>): ReturnType<typeof elegirArchivos> => elegirArchivos(archivos, { ...sinEleccion, perfiles: ['alfa'], reasignar: { alfa: 'bravo' }, ...extra })
  const creando = await importarArchivosAgentes(b, elegir({ archivosCuentas: [{ perfil: 'alfa', cuenta: 'default-alfa-claude-code', tipo: 'instrucciones', sustituir: false }, { perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: false }] }), ['bravo'])
  check('lo que falta se crea, en la cuenta que le corresponde en el destino', creando.creados.length === 2 && readFileSync(join(b.basePara('default-bravo-claude-code'), 'CLAUDE.md'), 'utf8') === '# Reglas de Alfa\n' && readFileSync(join(b.basePara('u-1'), 'config.toml'), 'utf8') === 'model = "personal"\n')
  const sinSustituir = await importarArchivosAgentes(b, elegir({ archivosCuentas: [{ perfil: 'alfa', cuenta: 'default-alfa-claude-code', tipo: 'configuracion', sustituir: false }] }), ['bravo'])
  check('NEGATIVO: lo distinto no se sustituye sin elegirlo, y se avisa', sinSustituir.revisar[0]?.motivo === 'cambio' && readFileSync(join(b.basePara('default-bravo-claude-code'), 'settings.json'), 'utf8') === '{ "model": "bravo" }')
  const sustituyendo = await importarArchivosAgentes(b, elegir({ archivosCuentas: [{ perfil: 'alfa', cuenta: 'default-alfa-claude-code', tipo: 'configuracion', sustituir: true }] }), ['bravo'])
  check('elegido, se sustituye y la versión anterior queda a salvo', sustituyendo.sustituidos.length === 1 && readFileSync(join(b.basePara('default-bravo-claude-code'), 'settings.json'), 'utf8') === '{ "model": "alfa" }' && readFileSync(join(b.basePara('default-bravo-claude-code'), 'settings.json.tessera-anterior'), 'utf8') === '{ "model": "bravo" }')
  const dirC = join(raiz, 'c')
  const c = equipoCuentas(dirC, [])
  const sinCrear = await importarArchivosAgentes(c, elegirArchivos(archivos, { ...sinEleccion, perfiles: ['alfa'], reasignar: {}, archivosCuentas: [{ perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: false }] }), ['alfa'])
  check('NEGATIVO: sin cuenta aquí ni elegir crearla, no se escribe y se dice', c.creadas.length === 0 && sinCrear.revisar[0]?.motivo === 'sin-cuenta')
  const creandoCuenta = await importarArchivosAgentes(c, elegirArchivos(archivos, { ...sinEleccion, perfiles: ['alfa'], reasignar: {}, cuentasNuevas: [{ perfil: 'alfa', cuenta: 'u-1' }], archivosCuentas: [{ perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: false }] }), ['alfa'])
  check('elegido crearla, se crea sin sesión con su nombre y recibe el archivo', c.creadas.length === 1 && creandoCuenta.creados.length === 1 && readFileSync(join(c.basePara('creada-0'), 'config.toml'), 'utf8') === 'model = "personal"\n')
  check('NEGATIVO: lo de un perfil que no se importa no se escribe', elegirArchivos(archivos, { ...sinEleccion, perfiles: ['otro'], archivosCuentas: [{ perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: false }] }).cuentas.length === 0)
  const sinPerfilAqui = await importarArchivosAgentes(c, elegirArchivos(archivos, { ...sinEleccion, perfiles: ['alfa'], reasignar: { alfa: 'no-existe' }, cuentasNuevas: [{ perfil: 'alfa', cuenta: 'u-1' }], archivosCuentas: [{ perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: false }] }), ['alfa'])
  check('NEGATIVO: una cuenta de un perfil que no está aquí no se escribe', sinPerfilAqui.creados.length === 0 && sinPerfilAqui.revisar.length === 0 && c.creadas.length === 1)
  const invalido: ArchivosAgentesCopia = { cuentas: [{ id: 'u-1', perfil: 'alfa', agente: 'codex', nombre: 'Personal', predeterminada: false, archivos: { configuracion: 'x = = 1' } }], nativos: {} }
  const malo = await importarArchivosAgentes(b, elegirArchivos(invalido, { ...sinEleccion, perfiles: ['alfa'], reasignar: { alfa: 'bravo' }, archivosCuentas: [{ perfil: 'alfa', cuenta: 'u-1', tipo: 'configuracion', sustituir: true }] }), ['bravo'])
  check('NEGATIVO: un archivo con errores de sintaxis no se escribe y se dice', malo.revisar[0]?.motivo === 'invalido' && malo.sustituidos.length === 0 && readFileSync(join(b.basePara('u-1'), 'config.toml'), 'utf8') === 'model = "personal"\n')
  const nativas = await importarArchivosAgentes(b, elegirArchivos(archivos, { ...sinEleccion, reglasNativas: [{ agente: 'codex', sustituir: false }] }), ['bravo'])
  check('las nativas se escriben en la carpeta nativa de este equipo, solo las instrucciones', nativas.creados.length === 1 && readFileSync(join(dirB, 'nativa', 'codex', 'AGENTS.md'), 'utf8') === 'Regla nativa de codex\n' && !existsSync(join(dirB, 'nativa', 'codex', 'config.toml')))
  escribir(join(dirB, 'nativa', 'claude-code', 'CLAUDE.md'), 'Mis reglas\n')
  const conNativa: ArchivosAgentesCopia = { cuentas: [], nativos: { 'claude-code': 'Otras reglas\n' } }
  const sobre = await importarArchivosAgentes(b, elegirArchivos(conNativa, { ...sinEleccion, reglasNativas: [{ agente: 'claude-code', sustituir: true }] }), ['bravo'])
  check('sustituir unas nativas guarda la versión anterior', sobre.sustituidos.length === 1 && readFileSync(join(dirB, 'nativa', 'claude-code', 'CLAUDE.md.tessera-anterior'), 'utf8') === 'Mis reglas\n')
  const repetidas: ArchivosAgentesCopia = { cuentas: [{ id: 'd1', perfil: 'p1', agente: 'codex', nombre: 'X', predeterminada: true, archivos: { instrucciones: 'uno' } }, { id: 'd2', perfil: 'p2', agente: 'codex', nombre: 'Y', predeterminada: true, archivos: { instrucciones: 'dos' } }], nativos: {} }
  const dirD = join(raiz, 'd')
  const d = equipoCuentas(dirD, [{ id: 'dd', perfil: 'dest', agente: 'codex', nombre: 'Predeterminada', predeterminada: true }])
  await importarArchivosAgentes(d, elegirArchivos(repetidas, { ...sinEleccion, perfiles: ['p1', 'p2'], reasignar: { p1: 'dest', p2: 'dest' }, archivosCuentas: [{ perfil: 'p1', cuenta: 'd1', tipo: 'instrucciones', sustituir: true }, { perfil: 'p2', cuenta: 'd2', tipo: 'instrucciones', sustituir: true }] }), ['dest'])
  check('dos perfiles a la misma cuenta: manda el primero de la lista', readFileSync(join(d.basePara('dd'), 'AGENTS.md'), 'utf8') === 'uno')
}

try {
  hr('combinar capas')
  escribir(join(carpetaCapa(capas, { tipo: 'global' }, 'codex'), 'config.toml'), 'model_context_window = 872000\nmodel_verbosity = "low"\n')
  escribir(join(carpetaCapa(capas, { tipo: 'perfil', profileId: 'sys' }, 'codex'), 'config.toml'), 'model_context_window = 272000\n')
  const { valores, fijadas } = await combinarCapas('codex', capasDe(capas, perfil, 'codex'))
  check('el perfil gana sobre la global', valores.model_context_window === 272000 && valores.model_verbosity === 'low')
  check('cada clave dice de qué capa sale', fijadas.find((f) => f.clave === 'model_context_window')?.origen === 'perfil' && fijadas.find((f) => f.clave === 'model_verbosity')?.origen === 'global')
  const sinGlobal = capasDe(capas, { id: 'sys', contextoGlobal: false }, 'codex')
  check('un perfil sin el contexto global recibe solo su capa', sinGlobal.length === 1 && sinGlobal[0].origen === 'perfil')

  hr('la capa junto a la cuenta')
  const deLaCuenta = '# mis ajustes\nmodel = "x"\n[projects."/workspace/a"]\ntrust_level = "trusted"\n'
  escribir(join(cuenta, 'config.toml'), deLaCuenta)
  const capaCodex = join(cuenta, ARCHIVO_CAPA.codex)
  const preparada = await prepararCapaCompartida(cuenta, 'codex', capasDe(capas, perfil, 'codex'), nada)
  const compuesta = readFileSync(capaCodex, 'utf8')
  check('compone las capas en su propio archivo', preparada && compuesta.includes('model_context_window = 272000') && compuesta.includes('model_verbosity = "low"'))
  check('NEGATIVO: el archivo de la cuenta no se toca, ni sus comentarios', readFileSync(join(cuenta, 'config.toml'), 'utf8') === deLaCuenta && !existsSync(join(cuenta, 'config.toml.tessera-anterior')))
  await prepararCapaCompartida(cuenta, 'codex', capasDe(capas, { id: 'sys', contextoGlobal: false }, 'codex'), nada)
  check('dejar de usar el global se nota en la próxima sesión', !readFileSync(capaCodex, 'utf8').includes('model_verbosity'))
  check('sin capas queda vacía, y se le puede seguir pasando al CLI', (await prepararCapaCompartida(cuenta, 'codex', [], nada)) && readFileSync(capaCodex, 'utf8').trim() === '')
  const noCarpeta = join(raiz, 'no-es-carpeta')
  writeFileSync(noCarpeta, 'x')
  const registro: string[] = []
  check('NEGATIVO: si no se puede escribir, no se pasa y se registra', !(await prepararCapaCompartida(noCarpeta, 'codex', capasDe(capas, perfil, 'codex'), (m) => registro.push(m))) && registro.length === 1)

  hr('tablas')
  const claude = join(raiz, 'claude')
  escribir(join(claude, 'settings.json'), JSON.stringify({ tema: 'oscuro', permissions: { allow: ['Bash(ls)'], deny: ['Bash(rm)'] } }))
  escribir(join(carpetaCapa(capas, { tipo: 'global' }, 'claude-code'), 'settings.json'), JSON.stringify({ permissions: { allow: ['Read'] }, env: { A: '1' } }))
  escribir(join(carpetaCapa(capas, { tipo: 'perfil', profileId: 'sys' }, 'claude-code'), 'settings.json'), JSON.stringify({ permissions: { ask: ['Write'] }, env: 'x' }))
  const combinadas = await combinarCapas('claude-code', capasDe(capas, perfil, 'claude-code'))
  const origenDe = (clave: string): string | undefined => combinadas.fijadas.find((f) => f.clave === clave)?.origen
  check('dentro de una tabla cada valor dice su capa', origenDe('permissions.allow') === 'global' && origenDe('permissions.ask') === 'perfil')
  check('una capa que sustituye una tabla anula lo que la otra fijaba dentro', origenDe('env') === 'perfil' && origenDe('env.A') === undefined)
  const ajustesCuenta = readFileSync(join(claude, 'settings.json'), 'utf8')
  await prepararCapaCompartida(claude, 'claude-code', capasDe(capas, perfil, 'claude-code'), nada)
  const ajustes = JSON.parse(readFileSync(join(claude, ARCHIVO_CAPA['claude-code']), 'utf8')) as { env: unknown; permissions: Record<string, string[]> }
  check('la capa de Claude Code lleva lo de las dos, fundido', JSON.stringify(ajustes.permissions.allow) === '["Read"]' && JSON.stringify(ajustes.permissions.ask) === '["Write"]')
  check('gana el perfil también sobre una tabla de la global', ajustes.env === 'x')
  check('NEGATIVO: los permisos propios de la cuenta siguen en su archivo, que no se toca', readFileSync(join(claude, 'settings.json'), 'utf8') === ajustesCuenta)

  hr('tctx config')
  const servicio = new ServicioConfigAgente({
    carpetaDe: (ref: RefConfigAgente) => (ref.capa ? carpetaCapa(capas, ref.capa, ref.agente) : cuenta),
    sesionesAbiertas: () => 0
  })
  const propuestas = new PropuestasConfig({ ruta: join(raiz, 'propuestas.json') })
  const llegadas: PropuestaConfig[] = []
  const op = new OperacionConfigTctx()
  op.conectar({
    sesionAgente: (id) => (id === 's1' ? { profileId: 'sys', agente: 'codex', accountId: 'c1', host: false } : id === 's2' ? { profileId: 'aislado', agente: 'codex', accountId: 'c2', host: false } : null),
    leer: (ref) => servicio.leer(ref),
    usaGlobal: (id) => id !== 'aislado',
    propuestas,
    alProponer: (p) => llegadas.push(p)
  })
  const sesion = { profileId: 'sys', sesion: 'agent:s1', projectHostPath: 'E:\\Trabajo\\api', espacioDatos: false } as unknown as SesionDelPuente
  const ver = await op.atender(OP_CONFIG, {}, sesion)
  const niveles = (ver.niveles as Array<{ nivel: string }> | undefined)?.map((n) => n.nivel).join(',')
  check('muestra global, perfil y la cuenta de Docker', ver.ok === true && niveles === 'global,perfil,cuenta')
  const mala = await op.atender(OP_CONFIG_PROPONER, { nivel: 'perfil', tipo: 'configuracion', texto: 'x = = 1' }, sesion)
  check('una propuesta con errores de sintaxis se rechaza', mala.rechazo === 'config-sintaxis' && llegadas.length === 0)
  const igual = await op.atender(OP_CONFIG_PROPONER, { nivel: 'perfil', tipo: 'configuracion', texto: 'model_context_window = 272000\n' }, sesion)
  check('una propuesta igual a la actual se rechaza', igual.rechazo === 'config-igual')
  const buena = await op.atender(OP_CONFIG_PROPONER, { nivel: 'global', tipo: 'configuracion', texto: 'model = "y"\n', motivo: 'unificar' }, sesion)
  check('una propuesta válida queda pendiente y avisa', buena.ok === true && propuestas.listar().length === 1 && llegadas[0]?.proyecto === 'api')
  check('proponer no escribe nada', readFileSync(join(carpetaCapa(capas, { tipo: 'global' }, 'codex'), 'config.toml'), 'utf8').includes('872000'))
  await op.atender(OP_CONFIG_PROPONER, { nivel: 'global', tipo: 'configuracion', texto: 'model = "z"\n' }, sesion)
  check('una nueva para el mismo nivel y archivo sustituye a la anterior', propuestas.listar().length === 1 && propuestas.listar()[0].texto === 'model = "z"\n')
  const terminal = { ...sesion, sesion: undefined } as unknown as SesionDelPuente
  check('desde la terminal hay que nombrar el agente', (await op.atender(OP_CONFIG, {}, terminal)).rechazo === 'config-sin-agente')
  check('y con --agente funciona', (await op.atender(OP_CONFIG, { agente: 'codex' }, terminal)).ok === true)
  const aislada = { ...sesion, profileId: 'aislado', sesion: 'agent:s2' } as unknown as SesionDelPuente
  const verAislada = await op.atender(OP_CONFIG, {}, aislada)
  check('NEGATIVO: un perfil sin el contexto global no ve la capa global', (verAislada.niveles as Array<{ nivel: string }> | undefined)?.map((n) => n.nivel).join(',') === 'perfil,cuenta')
  const propuestasAntes = propuestas.listar().length
  const globalAislada = await op.atender(OP_CONFIG_PROPONER, { nivel: 'global', tipo: 'configuracion', texto: 'model = "otro"\n' }, aislada)
  check('NEGATIVO: ni la propone', globalAislada.rechazo === 'config-sin-global' && propuestas.listar().length === propuestasAntes)
  check('una sesión de otro perfil no se atiende', (await op.atender(OP_CONFIG, {}, { ...sesion, profileId: 'otro' } as SesionDelPuente)).rechazo === 'sin-sesion')
  propuestas.guardar({ ...propuestas.listar()[0], id: 'de-otro', profileId: 'otro', texto: 'model = "w"\n' })
  check('una propuesta global de otro perfil no sustituye la pendiente', propuestas.listar().length === 2)
  propuestas.depurar(['otro'])
  check('las propuestas de un perfil que ya no existe se quitan', propuestas.listar().length === 1 && propuestas.listar()[0].id === 'de-otro')

  hr('copia de la configuración')
  /** Un equipo: la raíz de sus capas y su contexto global, en memoria. */
  const equipo = (dir: string, reglas = ''): EntornoContexto => {
    let actual: ContextoGlobal = { reglas, documentos: [] }
    return { raiz: dir, global: { leer: () => actual, guardar: (c) => (actual = c) } }
  }
  const este = equipo(capas, 'Responde en español.')
  const exportada = await capasParaCopia(este, ['sys', 'vacio'])
  check('lleva la global con sus reglas y la del perfil, sin los perfiles vacíos', exportada?.global?.codex?.includes('872000') === true && exportada.global.reglas === 'Responde en español.' && Object.keys(exportada?.perfiles ?? {}).join() === 'sys')
  check('la de un perfil no lleva reglas: viajan con el perfil', exportada?.perfiles.sys?.reglas === undefined)
  const leidaCopia = leerConfigDockerCopia(JSON.parse(JSON.stringify({ ...exportada, perfiles: { ...exportada?.perfiles, '': {}, raro: { codex: 5 }, conReglas: { reglas: 'x' } } })))
  check('NEGATIVO: lo que no tiene la forma se queda fuera, y un perfil no trae reglas', Object.keys(leidaCopia?.perfiles ?? {}).join() === 'sys')
  check('sin nada que llevar no hay apartado', (await capasParaCopia(equipo(join(raiz, 'sin-capas')), ['sys'])) === undefined)
  const otro = equipo(join(raiz, 'otro-equipo'))
  const previaVacia = await previaConfigDocker(otro, exportada, ['sys'])
  check('en un equipo sin contexto todo se trae', previaVacia.global === 'traer' && JSON.stringify(previaVacia.perfiles.sys) === '{}')
  escribir(join(carpetaCapa(otro.raiz, { tipo: 'perfil', profileId: 'local' }, 'codex'), 'config.toml'), 'model = "local"\n')
  otro.global.guardar({ reglas: 'Propias del otro equipo', documentos: ['E:/Guias'] })
  const previa = await previaConfigDocker(otro, exportada, ['local'])
  check('frente a uno distinto, distinta', previa.global === 'distinta' && previa.perfiles.sys?.local === 'distinta')
  const fallidas = await importarConfigDocker(otro, { global: exportada!.global, perfiles: { local: exportada!.perfiles.sys } }, ['local'])
  const globalOtro = carpetaCapa(otro.raiz, { tipo: 'global' }, 'codex')
  check('importar deja el nivel como el del archivo: configuración y reglas', fallidas.length === 0 && readFileSync(join(globalOtro, 'config.toml'), 'utf8').includes('872000') && otro.global.leer().reglas === 'Responde en español.')
  check('y no toca los documentos de este equipo', JSON.stringify(otro.global.leer().documentos) === '["E:/Guias"]')
  check('y guarda la anterior', readFileSync(join(carpetaCapa(otro.raiz, { tipo: 'perfil', profileId: 'local' }, 'codex'), 'config.toml.tessera-anterior'), 'utf8') === 'model = "local"\n')
  check('tras importar, igual', (await previaConfigDocker(otro, exportada, ['local'])).perfiles.sys?.local === 'igual')
  escribir(join(carpetaCapa(otro.raiz, { tipo: 'perfil', profileId: 'local' }, 'claude-code'), 'settings.json'), '{ "model": "local" }')
  const soloCodex = { perfiles: { sys: { codex: exportada!.perfiles.sys.codex } } }
  const sinClaude = await importarConfigDocker(otro, { perfiles: { local: soloCodex.perfiles.sys } }, ['local'])
  const settingsLocal = readFileSync(join(carpetaCapa(otro.raiz, { tipo: 'perfil', profileId: 'local' }, 'claude-code'), 'settings.json'), 'utf8')
  check('un settings.json que el archivo no trae se vacía como JSON válido', sinClaude.length === 0 && settingsLocal.trim() === '{}')
  check('y vacío cuenta como sin contenido: la capa queda igual a la del archivo', (await previaConfigDocker(otro, soloCodex, ['local'])).perfiles.sys?.local === 'igual')
  const conErrores = await importarConfigDocker(otro, { perfiles: { local: { codex: 'x = = 1' } } }, ['local'])
  const sinReglas = { global: { codex: 'model = "sin-reglas"\n' }, perfiles: {} }
  check('unas reglas que el archivo no trae no hacen distinto el global', (await previaConfigDocker(otro, { global: { ...(await leerCapa(otro, { tipo: 'global' })), reglas: undefined }, perfiles: {} }, [])).global === 'igual')
  await importarConfigDocker(otro, sinReglas, [])
  check('NEGATIVO: importar un global sin reglas no vacía las de este equipo', otro.global.leer().reglas === 'Responde en español.' && readFileSync(join(globalOtro, 'config.toml'), 'utf8').includes('sin-reglas'))
  check('NEGATIVO: una configuración con errores no se escribe y se dice', conErrores.length === 1 && !readFileSync(join(carpetaCapa(otro.raiz, { tipo: 'perfil', profileId: 'local' }, 'codex'), 'config.toml'), 'utf8').includes('= ='))
  check('NEGATIVO: un perfil que no existe aquí no recibe nada', (await importarConfigDocker(otro, { perfiles: { fantasma: exportada!.perfiles.sys } }, ['local'])).length === 0 && !existsSync(join(otro.raiz, 'perfiles', 'fantasma')))

  await archivosAgentes(raiz)
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
