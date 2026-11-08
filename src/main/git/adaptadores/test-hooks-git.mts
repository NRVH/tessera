// =============================================================================
// Prueba de `hooksGit.ts` (npm run test:hooks-git): la carpeta efectiva de hooks, la huella y el estado de cada uno,
// y con git real que un hook no corre en una escritura de segundo plano, que una de la interfaz se detiene si no está
// aceptado, que aceptarlo lo ejecuta y lo recuerda, que si cambia vuelve a preguntar y que las fichas son de un uso.
// =============================================================================
import { register } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(especificador, contexto, siguiente) {
  try { return await siguiente(especificador, contexto) }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && especificador.startsWith('.') && !/\\.[mc]?[jt]s$/.test(especificador)) return siguiente(especificador + '.ts', contexto)
    throw error
  }
}`))
const { FichasHooks, autorizarHooks, candidatosHook, hooksDeOperacion, carpetaEfectiva, huellaHook, estadoHook, configurarHooksGit, conPeticionHooks, prepararHooksOperacion, PendienteHooks } = await import('./hooksGit.ts')
const { ColaGit, colaGit } = await import('./colaGit.ts')
const { ejecutarGit, gitSinCola } = await import('./procesoGit.ts')
const { entornoGit } = await import('./configSegura.ts')
const { GitService } = await import('../GitService.ts')
const { registrarIpcGit } = await import('../ipc.ts')
const { GIT_CHANNELS } = await import('../../../shared/git-ipc.ts')
const { esWindows } = await import('../../../shared/plataforma.ts')
type Resolucion = import('../../../shared/git-ipc.ts').ResolucionHooks
let aprobadas = 0
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(78) + '\n' + titulo + '\n' + '='.repeat(78)) }
function check(id: string, correcto: boolean, detalle: string): void {
  if (correcto) aprobadas++; else fallidas++
  console.log(`${correcto ? 'PASS' : 'FAIL'} (${id}) ${detalle}`)
}
const temporal = realpathSync(mkdtempSync(path.join(tmpdir(), 'tessera-hooks-prueba-')))
const repo = path.join(temporal, 'repo')
const datos = path.join(temporal, 'datos')
configurarHooksGit(datos)
const git = (...argumentos: string[]): string => execFileSync('git', argumentos, { cwd: repo, encoding: 'utf8' }).trim()
const commit = ['commit', '--allow-empty', '-m', 'prueba']
const usuario = (resolucion?: Resolucion): ReturnType<typeof ejecutarGit> => conPeticionHooks(7, resolucion, () => ejecutarGit(commit, repo))
async function pendiente(operar: () => Promise<unknown>): Promise<import('../../../shared/git-ipc.ts').HooksPendientes> {
  try { await operar() } catch (error) { if (error instanceof PendienteHooks) return error.pendiente; throw error }
  throw new Error('Se esperaba una autorización pendiente')
}
async function rechazado(operar: () => Promise<unknown>): Promise<boolean> { try { await operar(); return false } catch { return true } }
function sinCiclos(archivo: string, activos = new Set<string>(), terminados = new Set<string>()): boolean {
  if (activos.has(archivo)) return false
  if (terminados.has(archivo)) return true
  activos.add(archivo)
  const codigo = readFileSync(archivo, 'utf8')
  for (const enlace of codigo.matchAll(/(?:import|export)\s+(?!type\b)[^'";]*?\sfrom\s*['"](\.\/[^'"]+)['"]/g)) {
    const destino = path.resolve(path.dirname(archivo), enlace[1].endsWith('.ts') ? enlace[1] : enlace[1] + '.ts')
    if (!sinCiclos(destino, activos, terminados)) return false
  }
  activos.delete(archivo); terminados.add(archivo)
  return true
}
try {
  hr('Carpeta efectiva, huellas y decisión')
  const entrada = (ambito: string, valor: string): import('./configSegura.ts').EntradaConfig => ({ ambito, clave: 'core.hooksPath', valor, origen: 'file:config' })
  check('1', carpetaEfectiva([], repo, '.git/hooks').carpeta === path.join(repo, '.git/hooks'), 'carpeta predeterminada')
  check('2', carpetaEfectiva([entrada('global', '/global'), entrada('worktree', '.husky')], repo, '.git/hooks').carpeta === path.join(repo, '.husky'), 'worktree relativo prevalece sobre global')
  check('3', !carpetaEfectiva([entrada('global', '.global')], repo, '.git/hooks').usuario, 'global relativo dentro del repo exige permiso')
  check('3b', carpetaEfectiva([entrada('system', path.join(temporal, 'externo'))], repo, '.git/hooks').usuario, 'sistema fuera del repo es del usuario')
  check('4', !carpetaEfectiva([entrada('local', '.husky')], repo, '.git/hooks').usuario, 'local requiere permiso')
  check('5', huellaHook(Buffer.from('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 del contenido')
  check('6', estadoHook('a') === 'nuevo' && estadoHook('a', 'b') === 'cambiado' && estadoHook('a', 'a') === null, 'nuevo, cambiado y aceptado')
  check('6b', sinCiclos(path.join(import.meta.dirname, 'hooksGit.ts')), 'el grafo de módulos del permiso no contiene ciclos de importación')
  hr('Git real')
  execFileSync('git', ['init', '-q', repo])
  git('config', 'user.name', 'Pruebas'); git('config', 'user.email', 'pruebas@example.invalid')
  const archivo = path.join(repo, '.git/hooks/pre-commit')
  const marca = path.join(repo, 'marca')
  const contenido = '#!/bin/sh\nprintf aceptado > marca\n'
  writeFileSync(archivo, contenido)
  if (!esWindows()) chmodSync(archivo, 0o755)
  writeFileSync(archivo + '.sample', '#!/bin/sh\nexit 1\n')
  writeFileSync(path.join(repo, '.git/hooks/comun.sh'), '# auxiliar\n')
  await ejecutarGit(commit, repo)
  check('7', !existsSync(marca), 'escritura de fondo sin hook')
  await gitSinCola(commit, repo)
  check('8', !existsSync(marca), 'fuera de la cola también apagado')
  const antes = git('rev-parse', 'HEAD')
  const primera = await pendiente(() => usuario())
  check('9', primera.hooks[0].estado === 'nuevo' && primera.hooks[0].ruta === '.git/hooks/pre-commit' && primera.hooks.some((h) => h.nombre === 'comun.sh') && !primera.hooks.some((h) => h.nombre.endsWith('.sample')) && git('rev-parse', 'HEAD') === antes && !existsSync(marca), 'usuario pendiente sin mutar HEAD; incluye los vecinos de la copia, no los ejemplos de git')
  await usuario({ ficha: primera.ficha, decision: 'aceptar' })
  check('10', existsSync(marca) && readFileSync(marca, 'utf8') === 'aceptado', 'aceptar ejecuta')
  rmSync(marca)
  await usuario()
  check('11', existsSync(marca), 'aceptación persistente sin nuevo diálogo')
  rmSync(marca)
  writeFileSync(archivo, contenido + '# cambiado\n')
  const segunda = await pendiente(() => usuario())
  check('12', segunda.hooks[0].estado === 'cambiado' && !existsSync(marca), 'contenido cambiado vuelve a pendiente')
  await usuario({ ficha: segunda.ficha, decision: 'omitir' })
  check('13', !existsSync(marca), 'omitir crea commit sin hook')
  check('14', await rechazado(() => usuario({ ficha: segunda.ficha, decision: 'aceptar' })), 'ficha usada no se reutiliza')
  const tercera = await pendiente(() => usuario())
  writeFileSync(archivo, contenido + '# sustituido mientras se decide\n')
  const cuarta = await pendiente(() => usuario({ ficha: tercera.ficha, decision: 'aceptar' }))
  check('15', cuarta.ficha !== tercera.ficha && !existsSync(marca), 'cambio entre diálogo y aceptación exige otra ficha')
  check('16', await rechazado(() => conPeticionHooks(8, { ficha: cuarta.ficha, decision: 'aceptar' }, () => ejecutarGit(commit, repo))), 'otro emisor no usa la ficha')
  const quinta = await pendiente(() => usuario())
  check('17', await rechazado(() => conPeticionHooks(7, { ficha: quinta.ficha, decision: 'aceptar' }, () => ejecutarGit(['commit', '--allow-empty', '-m', 'otro'], repo))), 'otros argumentos no usan la ficha')
  writeFileSync(archivo, contenido + '#'.repeat(40 * 1024))
  const sexta = await pendiente(() => usuario())
  check('18', sexta.hooks[0].truncado && Buffer.byteLength(sexta.hooks[0].contenido) <= 32 * 1024, 'vista truncada, huella del archivo completo')
  const reloj = Date.now
  try {
    Date.now = () => reloj() + 121_000
    const renovada = await pendiente(() => usuario({ ficha: sexta.ficha, decision: 'aceptar' }))
    check('19', renovada.ficha !== sexta.ficha && !existsSync(marca), 'ficha caducada renueva el permiso sin ejecutar')
    Date.now = () => reloj() + 242_000
    const otraRenovada = await pendiente(() => usuario({ ficha: renovada.ficha, decision: 'omitir' }))
    check('19b', otraRenovada.ficha !== renovada.ficha, 'omitir con ficha caducada también renueva')
  } finally { Date.now = reloj }

  hr('Lotes y rutas alternativas')
  const otro = path.join(temporal, 'otro')
  execFileSync('git', ['init', '-q', otro])
  writeFileSync(path.join(repo, 'sin-preparar'), 'uno')
  writeFileSync(path.join(otro, 'sin-preparar'), 'dos')
  const indice = path.join(repo, '.git/hooks/post-index-change')
  writeFileSync(indice, '#!/bin/sh\nexit 0\n'); chmodSync(indice, 0o755)
  const operacion = ['preparar-lote']
  const lote = (resolucion?: Resolucion): Promise<void> => conPeticionHooks(7, resolucion, async () => {
    await prepararHooksOperacion(operacion, [otro, repo], entornoGit, hooksDeOperacion(['add']))
    await ejecutarGit(['add', 'sin-preparar'], otro)
    await ejecutarGit(['add', 'sin-preparar'], repo)
  })
  const septima = await pendiente(() => lote())
  check('20', !execFileSync('git', ['ls-files'], { cwd: otro, encoding: 'utf8' }).trim(), 'preflight no prepara ningún repo cuando otro está pendiente')
  await lote({ ficha: septima.ficha, decision: 'omitir' })
  check('21', execFileSync('git', ['ls-files'], { cwd: otro, encoding: 'utf8' }).trim() === 'sin-preparar' && !existsSync(marca), 'omitir se aplica a todo el lote, aunque la ficha fuera del segundo repo')
  rmSync(indice)
  const octava = await pendiente(() => usuario())
  await usuario({ ficha: octava.ficha, decision: 'aceptar' })
  rmSync(marca)
  const enlazado = path.join(temporal, 'enlazado')
  await ejecutarGit(['worktree', 'add', '--detach', enlazado], repo)
  await conPeticionHooks(7, undefined, () => ejecutarGit(commit, enlazado))
  check('22', existsSync(path.join(enlazado, 'marca')), 'worktree comparte permisos por git-common-dir real')
  const husky = path.join(repo, '.husky')
  mkdirSync(husky)
  writeFileSync(path.join(husky, 'pre-commit'), contenido)
  chmodSync(path.join(husky, 'pre-commit'), 0o755)
  git('config', 'core.hooksPath', '.husky')
  const novena = await pendiente(() => usuario())
  check('23', novena.hooks[0].ruta === '.husky/pre-commit' && novena.hooks[0].estado === 'nuevo', 'hooksPath relativo no hereda permisos de otra carpeta')
  const globalAnterior = process.env.GIT_CONFIG_GLOBAL
  try {
    const global = path.join(temporal, 'global.gitconfig')
    writeFileSync(global, `[core]\n\thooksPath = ${JSON.stringify(husky.replace(/\\/g, '/'))}\n`)
    process.env.GIT_CONFIG_GLOBAL = global
    git('config', '--unset', 'core.hooksPath')
    check('24', (await pendiente(() => usuario())).hooks.length > 0, 'hooksPath global absoluto dentro del repo exige permiso')
    writeFileSync(global, '[core]\n\thooksPath = .husky\n')
    check('24b', (await pendiente(() => usuario())).hooks.length > 0, 'git real: hooksPath global relativo dentro del repo exige permiso')
    const externo = path.join(temporal, 'hooks-usuario')
    mkdirSync(externo)
    writeFileSync(path.join(externo, 'pre-commit'), contenido); chmodSync(path.join(externo, 'pre-commit'), 0o755)
    writeFileSync(global, `[core]\n\thooksPath = ${JSON.stringify(externo.replace(/\\/g, '/'))}\n`)
    await usuario()
    check('24c', existsSync(marca), 'git real: hooks globales fuera del repo conservan la confianza del usuario')
    rmSync(marca)
    await ejecutarGit(commit, repo)
    check('25', !existsSync(marca), 'hooks globales también apagados en segundo plano')
    git('config', 'core.hooksPath', '.husky')
    check('26', (await pendiente(() => usuario())).hooks[0].estado === 'nuevo', 'ámbito local prevalece sobre global sin aceptación implícita')
  } finally {
    if (globalAnterior === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = globalAnterior
  }
  hr('Contrato IPC de la interfaz')
  writeFileSync(path.join(repo, 'sin-preparar'), 'cambio para IPC')
  git('add', 'sin-preparar')
  const servicio = new GitService({ projectRoot: temporal, containerPath: temporal, log: () => undefined })
  const canales = new Map<string, (evento: unknown, req: unknown) => unknown>()
  registrarIpcGit({ git: servicio, ipc: { handle: (canal, manejar) => { canales.set(canal, manejar as (evento: unknown, req: unknown) => unknown) } } })
  const invocar = async (canal: string, req: object): Promise<unknown> => canales.get(canal)!({ sender: { id: 7 } }, { raiz: temporal, ...req })
  const respuesta = await invocar(GIT_CHANNELS.COMMIT, { repo, message: 'desde IPC' }) as import('../../../shared/git-ipc.ts').CommitResult
  check('27', respuesta.ok === false && respuesta.pendienteHooks?.hooks[0].ruta === '.husky/pre-commit', 'IPC devuelve pendiente estructurado')
  const aceptada = await invocar(GIT_CHANNELS.COMMIT, { repo, message: 'desde IPC', resolucionHooks: { ficha: respuesta.pendienteHooks!.ficha, decision: 'aceptar' } }) as import('../../../shared/git-ipc.ts').CommitResult
  check('28', aceptada.ok && existsSync(marca), 'IPC acepta, recuerda y ejecuta la misma operación')
  rmSync(marca)
  writeFileSync(path.join(husky, 'pre-commit'), contenido + '# cambiado por el agente\n')
  const preparacion = await invocar(GIT_CHANNELS.STAGE_FILES, { paths: ['repo/sin-preparar', 'otro/sin-preparar'] }) as { pendienteHooks?: import('../../../shared/git-ipc.ts').HooksPendientes }
  check('29', !preparacion.pendienteHooks && Array.isArray(preparacion), 'preparar no pide permiso por pre-commit')
  check('30', !existsSync(marca), 'preparar mantiene apagado pre-commit')

  hr('Regresiones de aislamiento y envoltorios')
  const contexto = new AsyncLocalStorage<string>()
  const cola = new ColaGit(1)
  let liberar!: () => void
  const bloqueada = contexto.run('bombeo', () => cola.correr(() => new Promise<void>((resolver) => { liberar = resolver })))
  const deInterfaz = contexto.run('interfaz', () => cola.correr(async () => contexto.getStore()))
  const deFondo = cola.correr(async () => contexto.getStore())
  liberar(); await bloqueada
  check('31', await deInterfaz === 'interfaz' && await deFondo === undefined, 'la cola conserva el contexto al encolar y no lo filtra al fondo')

  const subcarpeta = path.join(husky, '_')
  mkdirSync(subcarpeta)
  const envoltorio = path.join(subcarpeta, 'pre-commit')
  writeFileSync(envoltorio, '#!/bin/sh\nsh "$(dirname "$0")/../pre-commit"\n'); chmodSync(envoltorio, 0o755)
  git('config', 'core.hooksPath', '.husky/_')
  const permisoEnvoltorio = await pendiente(() => usuario())
  check('32', permisoEnvoltorio.hooks.some((h) => h.ruta === '.husky/pre-commit'), 'el permiso muestra el script auxiliar del envoltorio')
  await usuario({ ficha: permisoEnvoltorio.ficha, decision: 'aceptar' })
  rmSync(marca)
  writeFileSync(path.join(husky, 'pre-commit'), contenido + '# auxiliar cambiado\n')
  const auxiliarCambiado = await pendiente(() => usuario())
  check('33', auxiliarCambiado.hooks.some((h) => h.estado === 'cambiado'), 'cambiar solo el auxiliar renueva el permiso')
  await usuario({ ficha: auxiliarCambiado.ficha, decision: 'aceptar' })
  rmSync(marca)
  const ajeno = path.join(husky, 'no-es-un-hook')
  writeFileSync(ajeno, '# archivo ajeno\n')
  await usuario()
  check('33a', existsSync(marca), 'un archivo ajeno del padre de Husky no renueva el permiso')
  rmSync(marca)
  const auxiliar = path.join(subcarpeta, 'auxiliar')
  writeFileSync(auxiliar, '# auxiliar\n')
  const agregado = await pendiente(() => usuario())
  await usuario({ ficha: agregado.ficha, decision: 'aceptar' })
  rmSync(marca); rmSync(auxiliar)
  const eliminado = await pendiente(() => usuario())
  check('33b', eliminado.hooks.some((h) => h.estado === 'cambiado'), 'eliminar un auxiliar también cambia la huella del conjunto')
  await usuario({ ficha: eliminado.ficha, decision: 'aceptar' })
  rmSync(marca)
  await conPeticionHooks(7, undefined, async () => {
    const entorno = await autorizarHooks(commit, repo, await entornoGit(repo))
    writeFileSync(envoltorio, '#!/bin/sh\nprintf intruso > marca\n')
    writeFileSync(path.join(husky, 'pre-commit'), '#!/bin/sh\nprintf intruso > marca\n')
    execFileSync('git', commit, { cwd: repo, env: entorno })
    check('34', readFileSync(marca, 'utf8') === 'aceptado', 'cambiar entrada y auxiliar tras autorizar no cambia los bytes ejecutados')
  })
  rmSync(marca)

  git('config', '--unset', 'core.hooksPath')
  rmSync(archivo)
  check('35', candidatosHook('pre-commit', true).join(',') === 'pre-commit,pre-commit.exe' && candidatosHook('pre-commit', false).length === 1, 'solo Windows busca el respaldo .exe')
  if (esWindows()) {
    copyFileSync(path.join(process.env.SystemRoot!, 'System32/whoami.exe'), archivo + '.exe')
    const salida = spawnSync('git', ['-c', `core.hooksPath=${path.dirname(archivo)}`, 'hook', 'run', 'pre-commit'], { cwd: repo, encoding: 'utf8' })
    check('36', salida.status === 0 && salida.stderr.trim().length > 0, 'Git for Windows ejecuta pre-commit.exe sin pre-commit')
    const ejecutable = await pendiente(() => usuario())
    check('37', ejecutable.hooks[0].nombre === 'pre-commit.exe', 'el permiso incluye el ejecutable de Windows')
    await usuario({ ficha: ejecutable.ficha, decision: 'aceptar' })
    check('38', !!git('rev-parse', 'HEAD'), 'la copia privada conserva el ejecutable aceptado')
    rmSync(archivo + '.exe')
    for (const extension of ['cmd', 'bat', 'com']) {
      copyFileSync(path.join(process.env.SystemRoot!, 'System32/whoami.exe'), `${archivo}.${extension}`)
      const noEncontrado = spawnSync('git', ['-c', `core.hooksPath=${path.dirname(archivo)}`, 'hook', 'run', 'pre-commit'], { cwd: repo, encoding: 'utf8' })
      check(`38-${extension}`, noEncontrado.status !== 0 && noEncontrado.stderr.includes('cannot find'), `Git no busca el respaldo .${extension}`)
      rmSync(`${archivo}.${extension}`)
    }
  }

  const correrOriginal = colaGit.correr.bind(colaGit)
  let consultas = 0
  colaGit.correr = <T,>(...args: Parameters<typeof colaGit.correr<T>>): Promise<T> => { consultas++; return correrOriginal<T>(...args) }
  try {
    await conPeticionHooks(7, undefined, async () => {
      await prepararHooksOperacion(['lote'], [repo], entornoGit)
      await ejecutarGit(commit, repo)
      await ejecutarGit(commit, repo)
    })
    check('39', consultas === 8, 'tres consultas de inspección, tres preparaciones de entorno y dos escrituras por la cola')
  } finally { colaGit.correr = correrOriginal }

  writeFileSync(archivo, contenido); chmodSync(archivo, 0o755)
  const ignorado = await invocar(GIT_CHANNELS.IGNORAR_GITIGNORE, { paths: ['repo/marca'] }) as { pendienteHooks?: unknown }
  check('40', !ignorado.pendienteHooks, 'ignorar sin escritura de git no abre permiso')
  hr('Límites y vecinos de hooks con git real')
  for (const carpeta of [path.dirname(archivo), path.join(temporal, 'hooks-externos-locales')]) {
    mkdirSync(carpeta, { recursive: true })
    git('config', 'core.hooksPath', carpeta.replace(/\\/g, '/'))
    const entrada = path.join(carpeta, 'pre-commit')
    writeFileSync(entrada, '#!/bin/sh\n. "$(dirname "$0")/vecino"\nprintf "$valor" > marca\n'); chmodSync(entrada, 0o755)
    writeFileSync(path.join(carpeta, 'vecino'), 'valor=vecino\n')
    const permiso = await pendiente(() => usuario())
    check('40-vecino', permiso.hooks.some((h) => h.nombre === 'vecino'), 'el permiso de .git/hooks y hooksPath local externo incluye vecinos')
    await usuario({ ficha: permiso.ficha, decision: 'aceptar' })
    check('40-copia', readFileSync(marca, 'utf8') === 'vecino', 'el hook externo al árbol carga su auxiliar desde la copia')
    rmSync(marca)
  }
  const scripts = path.join(repo, 'scripts')
  const acotada = path.join(scripts, 'hooks')
  mkdirSync(acotada, { recursive: true })
  git('config', 'core.hooksPath', 'scripts/hooks')
  const principal = path.join(acotada, 'pre-commit')
  writeFileSync(principal, '#!/bin/sh\n. "$(dirname "$0")/vecino"\nprintf "$valor" > marca\n'); chmodSync(principal, 0o755)
  writeFileSync(path.join(acotada, 'vecino'), 'valor=vecino\n')
  writeFileSync(path.join(scripts, 'ajeno'), 'no se ejecuta\n')
  const vecinos = await pendiente(() => usuario())
  check('41', vecinos.hooks.length === 2 && vecinos.hooks.some((h) => h.nombre === 'vecino') && !vecinos.hooks.some((h) => h.nombre.includes('ajeno')), 'solo carpeta efectiva, sin padre arbitrario')
  await usuario({ ficha: vecinos.ficha, decision: 'aceptar' })
  check('42', readFileSync(marca, 'utf8') === 'vecino', 'la copia conserva auxiliares junto a $0')
  rmSync(marca)
  const grande = path.join(acotada, 'grande')
  writeFileSync(grande, ''); truncateSync(grande, 1024 * 1024 + 1)
  const sinLimite = await pendiente(() => usuario())
  const insiste = await pendiente(() => usuario({ ficha: sinLimite.ficha, decision: 'aceptar' }))
  check('43', insiste.incompleta === true && insiste.hooks[0].contenido.includes('scripts/hooks/grande') && !existsSync(marca), 'archivo excesivo permanece pendiente incluso al aceptar, y el motivo lo nombra')
  await usuario({ ficha: insiste.ficha, decision: 'omitir' })
  check('44', !existsSync(marca), 'la inspección incompleta se puede omitir')
  rmSync(grande)
  const muchos = path.join(acotada, 'muchos')
  mkdirSync(muchos)
  for (let indice = 0; indice < 257; indice++) writeFileSync(path.join(muchos, String(indice)), '')
  check('45', (await pendiente(() => usuario())).incompleta === true, 'demasiados archivos permanecen pendientes')
  rmSync(muchos, { recursive: true })
  mkdirSync(muchos)
  for (let indice = 0; indice < 1025; indice++) writeFileSync(path.join(muchos, `${indice}.sample`), '')
  check('45b', (await pendiente(() => usuario())).incompleta === true, 'los ejemplos de git cuentan para el tope de entradas')
  rmSync(muchos, { recursive: true })
  mkdirSync(muchos)
  for (let indice = 0; indice < 9; indice++) writeFileSync(path.join(muchos, String(indice)), Buffer.alloc(1024 * 1024))
  check('46', (await pendiente(() => usuario())).incompleta === true, 'el presupuesto total impide leer más de 8 MiB')
  rmSync(muchos, { recursive: true })
  const externo = path.join(temporal, 'auxiliares-fuera')
  mkdirSync(externo)
  writeFileSync(path.join(externo, 'secreto'), 'NO_LEER_FUERA')
  const enlace = path.join(acotada, 'enlace')
  symlinkSync(externo, enlace, esWindows() ? 'junction' : 'dir')
  const conEnlace = await pendiente(() => usuario())
  check('47', conEnlace.incompleta === true && conEnlace.hooks[0].contenido.includes('scripts/hooks/enlace') && conEnlace.hooks.every((h) => !h.contenido.includes('NO_LEER_FUERA')), 'enlace externo no se sigue ni expone contenido, y el motivo nombra el enlace')
  unlinkSync(enlace)
  hr('Retención acotada de fichas')
  const almacen = new FichasHooks()
  const ficha = { vence: Date.now() + 120_000, propietario: 7, operacion: 'prueba', firma: 'firma' }
  for (let indice = 0; indice < 513; indice++) almacen.guardar(String(indice), ficha)
  check('48', almacen.tamano === 512 && !almacen.leer('0') && !!almacen.leer('512'), 'el almacén elimina la ficha más antigua al alcanzar su tope')
  const ahora = Date.now
  try {
    Date.now = () => ahora() + 121_000
    almacen.guardar('nueva', { ...ficha, vence: Date.now() + 120_000 })
    check('49', almacen.tamano === 1 && !!almacen.leer('nueva'), 'el almacén barre todas las caducadas')
  } finally { Date.now = ahora }
} catch (error) { check('excepcion', false, String(error)) }
finally { rmSync(temporal, { recursive: true, force: true }) }
console.log(`\nVEREDICTO: ${aprobadas} aprobadas, ${fallidas} fallidas`)
process.exit(fallidas ? 1 : 0)
