#!/usr/bin/env node
// =============================================================================
// Prueba de las piezas puras de las tareas delegadas (node src/main/agentes/delegacion/test-delegacion.mts): quién
// puede delegar (solo una sesión nativa viva del perfil del token), la orden de un archivo solo dentro del proyecto,
// la elección de cuenta, la línea de arranque de cada CLI, la lectura de su salida y cómo acaba cada ejecución.
// Los eventos de ejemplo son los que escriben los CLIs de verdad (medidos con Claude Code 2.1 y Codex 0.167).
// =============================================================================
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ORDEN_BYTES } from '../../../shared/delegacion-ipc.ts'
import { ENV_BUZON, ENV_SESION } from '../../../shared/db-ipc.ts'
import { ajustesDe, dentroDe, ordenDe, origenDe } from './operacionDelegacion.ts'
import { comprobarPeticion, esfuerzoAlContinuar, invocacionCatalogo, leerCatalogo, lineaCatalogo } from './catalogoModelos.ts'
import { crearRegistroTareas, entradaValida, trasApagado } from './registroTareas.ts'
import type { VistaTarea } from '../../../shared/delegacion-ipc.ts'
import { elegirCuenta, estadoDe, type CuentaCandidata } from './eleccionCuenta.ts'
import { CODIGO_SIN_CREDENCIAL, MARCA_SIN_CREDENCIAL, invocacionDelegada, lineaDelegada } from './lineaDelegada.ts'
import { crearLectorSalida } from './salidaDelegada.ts'
import { decidirFinal, puedeSerDocker, salidaDeDocker } from './finalTarea.ts'

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

function probarOrigen(): void {
  hr('Quién delega')
  const vivas: Record<string, { profileId: string; host: boolean }> = {
    nat: { profileId: 'alfa', host: true },
    dock: { profileId: 'alfa', host: false },
    otro: { profileId: 'beta', host: true }
  }
  const sesionAgente = (id: string): { profileId: string; host: boolean } | null => vivas[id] ?? null
  const base = { profileId: 'alfa', projectHostPath: '/p/uno', espacioDatos: false }
  const nativo = origenDe({ ...base, sesion: 'agent:nat' }, sesionAgente)
  check('un agente nativo vivo del perfil delega, con la clave de su sesión', !('ok' in nativo) && nativo.clave === 'agent:nat' && nativo.rutaHostProyecto === '/p/uno', j(nativo))
  const docker = origenDe({ ...base, sesion: 'agent:dock' }, sesionAgente)
  check('NEGATIVO: un agente en Docker no delega', 'ok' in docker && docker.rechazo === 'delegar-desde-docker', j(docker))
  const delegadaViva = (id: string): { profileId: string; host: boolean } | null => (id === 'delegada-ab12cd34' ? { profileId: 'alfa', host: false } : sesionAgente(id))
  const encadenada = origenDe({ ...base, sesion: 'agent:delegada-ab12cd34' }, delegadaViva)
  check('NEGATIVO: una tarea delegada (un agente en Docker con token) no delega a su vez', 'ok' in encadenada && encadenada.rechazo === 'delegar-desde-docker', j(encadenada))
  const ajeno = origenDe({ ...base, sesion: 'agent:otro' }, sesionAgente)
  check('NEGATIVO: el token de un perfil con la sesión de otro no delega', 'ok' in ajeno && ajeno.rechazo === 'sin-sesion', j(ajeno))
  const muerta = origenDe({ ...base, sesion: 'agent:nadie' }, sesionAgente)
  check('NEGATIVO: una sesión de agente que ya no vive no delega', 'ok' in muerta && muerta.rechazo === 'sin-sesion', j(muerta))
  const sinAtar = origenDe(base, sesionAgente)
  check('NEGATIVO: un token sin sesión atada no delega', 'ok' in sinAtar && sinAtar.rechazo === 'sin-sesion', j(sinAtar))
  const terminal = origenDe({ ...base, sesion: 'term-alfa-3' }, sesionAgente)
  check('la terminal (el usuario) delega', !('ok' in terminal) && terminal.clave === 'term-alfa-3', j(terminal))
  const sinProyecto = origenDe({ ...base, projectHostPath: '', sesion: 'agent:nat' }, sesionAgente)
  check('NEGATIVO: sin proyecto no hay qué montar', 'ok' in sinProyecto && sinProyecto.rechazo === 'delegar-sin-proyecto', j(sinProyecto))
}

async function probarOrden(): Promise<void> {
  hr('La orden: texto o archivo dentro del proyecto')
  const raiz = mkdtempSync(join(tmpdir(), 'delegacion-'))
  try {
    const proyecto = join(raiz, 'proyecto')
    mkdirSync(join(proyecto, 'docs'), { recursive: true })
    writeFileSync(join(proyecto, 'docs', 'orden.md'), 'Revise el módulo de pagos.')
    writeFileSync(join(raiz, 'fuera.md'), 'secreto')
    writeFileSync(join(proyecto, 'vacia.md'), '  \n')
    const texto = await ordenDe({ orden: 'Haga X' }, proyecto)
    check('la orden en texto pasa tal cual', 'orden' in texto && texto.orden === 'Haga X', j(texto))
    const vacia = await ordenDe({ orden: '   ' }, proyecto)
    check('NEGATIVO: una orden en blanco se rechaza', 'rechazo' in vacia && vacia.rechazo.rechazo === 'orden-vacia', j(vacia))
    const larga = await ordenDe({ orden: 'x'.repeat(MAX_ORDEN_BYTES + 1) }, proyecto)
    check('NEGATIVO: una orden que no cabe en el puente se rechaza', 'rechazo' in larga && larga.rechazo.rechazo === 'orden-larga', j('rechazo' in larga ? larga.rechazo : null))
    const ambas = await ordenDe({ orden: 'a', archivo: join(proyecto, 'docs', 'orden.md') }, proyecto)
    check('NEGATIVO: texto y archivo a la vez no', 'rechazo' in ambas, j(ambas))
    const archivo = await ordenDe({ archivo: join(proyecto, 'docs', 'orden.md') }, proyecto)
    check('un archivo del proyecto se lee en el main', 'orden' in archivo && archivo.orden.includes('pagos'), j(archivo))
    const fuera = await ordenDe({ archivo: join(raiz, 'fuera.md') }, proyecto)
    check('NEGATIVO: un archivo fuera del proyecto no se lee', 'rechazo' in fuera && fuera.rechazo.rechazo === 'archivo-fuera', j(fuera))
    const escapada = await ordenDe({ archivo: join(proyecto, '..', 'fuera.md') }, proyecto)
    check('NEGATIVO: «..» no saca la ruta del proyecto', 'rechazo' in escapada && escapada.rechazo.rechazo === 'archivo-fuera', j(escapada))
    const relativa = await ordenDe({ archivo: 'docs/orden.md' }, proyecto)
    check('NEGATIVO: una ruta relativa no se resuelve contra el main', 'rechazo' in relativa && relativa.rechazo.rechazo === 'peticion', j(relativa))
    const noExiste = await ordenDe({ archivo: join(proyecto, 'no.md') }, proyecto)
    check('un archivo que no existe se dice', 'rechazo' in noExiste && noExiste.rechazo.rechazo === 'archivo-no-existe', j(noExiste))
    const enBlanco = await ordenDe({ archivo: join(proyecto, 'vacia.md') }, proyecto)
    check('un archivo en blanco es una orden vacía', 'rechazo' in enBlanco && enBlanco.rechazo.rechazo === 'orden-vacia', j(enBlanco))
    let enlaceHecho = true
    try {
      symlinkSync(join(raiz, 'fuera.md'), join(proyecto, 'enlace.md'))
    } catch {
      enlaceHecho = false
    }
    if (enlaceHecho) {
      const enlace = await ordenDe({ archivo: join(proyecto, 'enlace.md') }, proyecto)
      check('NEGATIVO: un enlace del proyecto que apunta fuera no se lee', 'rechazo' in enlace && enlace.rechazo.rechazo === 'archivo-fuera', j(enlace))
    } else {
      check('NEGATIVO: un enlace del proyecto que apunta fuera no se lee', dentroDe('/a/p', '/a/fuera.md', false) === false, 'sin permiso para crear enlaces aquí: se comprueba la contención sola')
    }
    check('la propia raíz no cuenta como archivo de dentro', dentroDe('/a/p', '/a/p', false) === false, 'raíz')
    check('en Windows la contención no distingue mayúsculas', dentroDe('C:\\Repos\\Uno', 'c:\\repos\\uno\\x.md', true), 'mayúsculas')
    check('NEGATIVO: un prefijo de nombre no es estar dentro', dentroDe('/a/p', '/a/p2/x.md', false) === false, '/a/p2')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

function probarEleccion(): void {
  hr('Elección de cuenta')
  const c = (id: string, nombre: string, agente: 'codex' | 'claude-code', usos: number[], credencial = true, reinicio?: number): CuentaCandidata => ({
    id,
    nombre,
    agente,
    credencial,
    ventanas: usos.map((p) => ({ etiqueta: 'x', porcentaje: p, ...(reinicio ? { reinicio } : {}) }))
  })
  const cuentas = [c('1', 'Codex 1', 'codex', [99, 20], true, 5000), c('2', 'Codex 2', 'codex', [60, 92]), c('3', 'Codex 3', 'codex', [15, 40]), c('4', 'Trabajo', 'claude-code', [10]), c('5', 'Sin sesión', 'codex', [], false)]
  const auto = elegirCuenta(cuentas, 'codex', 'auto')
  check('auto elige la de más uso libre en su ventana más ajustada', auto.ok && auto.cuenta.id === '3', j(auto))
  const nombre = elegirCuenta(cuentas, 'codex', 'codex 3')
  check('el nombre no distingue mayúsculas', nombre.ok && nombre.cuenta.id === '3', j(nombre))
  const trozo = elegirCuenta(cuentas, 'claude-code', 'trab')
  check('un trozo que solo encaja con una vale', trozo.ok && trozo.cuenta.id === '4', j(trozo))
  const ambigua = elegirCuenta(cuentas, 'codex', 'codex')
  check('un trozo que encaja con varias pide elegir', !ambigua.ok && ambigua.rechazo === 'cuenta-ambigua' && ambigua.candidatos.length === 3, j(ambigua))
  const ajena = elegirCuenta(cuentas, 'codex', 'Trabajo')
  check('NEGATIVO: la cuenta de otro agente no se elige', !ajena.ok && ajena.rechazo === 'cuenta-no-existe', j(ajena))
  const sinSesion = elegirCuenta(cuentas, 'codex', 'Sin sesión')
  check('una nombrada sin sesión se rechaza', !sinSesion.ok && sinSesion.rechazo === 'sin-credencial', j(sinSesion))
  const agotada = elegirCuenta(cuentas, 'codex', 'Codex 1')
  check('una nombrada con el uso agotado se deja intentar', agotada.ok && agotada.cuenta.id === '1', j(agotada))
  const ninguna = elegirCuenta([cuentas[0]], 'codex', 'auto')
  check('sin ninguna libre dice cuándo se reinicia la primera', !ninguna.ok && ninguna.rechazo === 'ninguna-cuenta' && ninguna.reinicio === 5000, j(ninguna))
  check('estado: lista, agotada y sin credencial', estadoDe(cuentas[2]) === 'lista' && estadoDe(cuentas[0]) === 'agotada' && estadoDe(cuentas[4]) === 'sin-credencial', 'estados')
  const tres = [c('a', 'Uno', 'codex', [10]), c('b', 'Dos', 'codex', [12]), c('d', 'Tres', 'codex', [40])]
  const reparto: string[] = []
  const enMarcha: Record<string, number> = {}
  for (let i = 0; i < 3; i++) {
    const r = elegirCuenta(tres.map((x) => ({ ...x, enMarcha: enMarcha[x.id] ?? 0 })), 'codex', 'auto')
    if (r.ok) {
      reparto.push(r.cuenta.id)
      enMarcha[r.cuenta.id] = (enMarcha[r.cuenta.id] ?? 0) + 1
    }
  }
  check('auto reparte las tareas lanzadas seguidas, aunque el uso aún no se mueva', j(reparto) === j(['a', 'b', 'a']), j(reparto))
  const unaSola = elegirCuenta([{ ...tres[0], enMarcha: 4 }], 'codex', 'auto')
  check('con una sola cuenta, las tareas en marcha no la descartan', unaSola.ok && unaSola.cuenta.id === 'a', j(unaSola))
}

/** Recortes de las respuestas reales de cada CLI (Claude Code 2.1.318 y Codex 0.167 en un contenedor de cuenta). */
function probarCatalogo(): void {
  hr('Catálogo de modelos')
  const claude = JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'catalogo',
      response: {
        account: { apiProvider: 'firstParty', subscriptionType: 'max' },
        models: [
          { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
          { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
          { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
          { value: '--dangerously-skip-permissions', displayName: 'Trampa' },
          { value: 'x; rm -rf /', displayName: 'Trampa' }
        ]
      }
    }
  })
  const rc = leerCatalogo('claude-code', `aviso suelto\n${claude}\n`)
  check('Claude Code: sin la fila «default», con alias, modelo resuelto y esfuerzos', rc.ok && j(rc.modelos.map((m) => m.id)) === j(['opus', 'claude-haiku-4-5-20251001']) && rc.modelos[0].resuelto === 'claude-opus-5-5' && rc.modelos[0].porDefecto && rc.modelos[1].esfuerzos.length === 0, j(rc))
  check('NEGATIVO: lo que anuncia el contenedor sin forma de nombre no pasa', rc.ok && !j(rc).includes('rm -rf') && !j(rc).includes('dangerously'), j(rc))
  const sinSesion = claude.replace('"subscriptionType":"max"', '"tokenSource":"none"')
  const rs = leerCatalogo('claude-code', sinSesion)
  check('NEGATIVO: sin la sesión de la cuenta, los alias genéricos no valen como catálogo', !rs.ok && rs.motivo === 'sin-sesion', j(rs))
  const codex = JSON.stringify({
    id: 2,
    result: {
      data: [
        { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol\u001b[31m', hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }, { reasoningEffort: '$(rm)' }] },
        { id: 'gpt-reserve', model: 'gpt-reserve', displayName: 'Reserve', hidden: true, supportedReasoningEfforts: [] }
      ],
      nextCursor: null
    }
  })
  const rx = leerCatalogo('codex', `{"id":1,"result":{}}\n${codex}\n`)
  check('Codex: visibles, predeterminado y esfuerzos válidos; sin secuencias de control en el nombre', rx.ok && rx.modelos.length === 1 && rx.modelos[0].porDefecto && j(rx.modelos[0].esfuerzos) === j(['low', 'ultra']) && !rx.modelos[0].nombre.includes('\u001b'), j(rx))
  const roto = leerCatalogo('codex', 'no es json')
  check('una salida ilegible no es un catálogo vacío', !roto.ok && roto.motivo === 'ilegible', j(roto))
  const modelos = [
    { id: 'opus', resuelto: 'claude-opus-5-5', nombre: 'Opus', esfuerzos: ['low', 'max'], porDefecto: true },
    { id: 'viejo', nombre: 'Viejo', esfuerzos: [], porDefecto: false }
  ]
  check('el modelo se acepta por alias y por nombre completo', comprobarPeticion(modelos, 'opus', 'max') === null && comprobarPeticion(modelos, 'claude-opus-5-5', undefined) === null, 'alias y resuelto')
  const noHay = comprobarPeticion(modelos, 'otro', undefined)
  check('NEGATIVO: un modelo que no ofrece la cuenta se rechaza con los disponibles', noHay?.rechazo === 'modelo-no-disponible' && j(noHay.disponibles) === j(['opus', 'viejo']), j(noHay))
  const sinNivel = comprobarPeticion(modelos, 'viejo', 'low')
  check('NEGATIVO: un esfuerzo en un modelo que no admite niveles se rechaza', sinNivel?.rechazo === 'esfuerzo-no-admitido' && sinNivel.admitidos.length === 0, j(sinNivel))
  check('sin modelo, vale el esfuerzo que admita alguno', comprobarPeticion(modelos, undefined, 'max') === null && comprobarPeticion(modelos, undefined, 'ultra')?.rechazo === 'esfuerzo-no-admitido', 'sin modelo')
  check('continuar en un modelo sin niveles suelta el esfuerzo heredado', esfuerzoAlContinuar(modelos, 'viejo', undefined, 'max') === undefined, 'viejo')
  check('continuar en un modelo que lo admite conserva el esfuerzo heredado', esfuerzoAlContinuar(modelos, 'opus', undefined, 'max') === 'max', 'opus')
  check('sin cambiar de modelo, se conserva el heredado', esfuerzoAlContinuar(modelos, undefined, undefined, 'max') === 'max', 'igual')
  check('NEGATIVO: un esfuerzo pedido no se suelta, se comprueba', esfuerzoAlContinuar(modelos, 'viejo', 'max', 'low') === 'max' && comprobarPeticion(modelos, 'viejo', 'max')?.rechazo === 'esfuerzo-no-admitido', 'pedido')
  const lc = invocacionCatalogo('claude-code', 'claude')
  check('Claude Code: no guarda sesión ni pide nada al modelo', lc.includes('--no-session-persistence') && lc.includes('--input-format stream-json') && lc.includes('"subtype":"initialize"') && !lc.includes('"user"'), lc)
  const lx = invocacionCatalogo('codex', 'codex')
  check('Codex: mantiene la entrada abierta y respeta el saludo antes de listar', lx.includes('coproc') && lx.includes('app-server') && lx.indexOf('"method":"initialize"') < lx.indexOf('"method":"model/list"'), lx)
  const entera = lineaCatalogo('claude-code', 'claude', '/agent-config/claude-code/c1')
  check('la línea lleva la carpeta de la cuenta y el entorno limpio', entera.startsWith('env -i ') && entera.includes('CLAUDE_CONFIG_DIR=/agent-config/claude-code/c1'), entera.slice(0, 200))
  const inyeccion = ajustesDe({ modelo: 'x; rm -rf /' })
  check('NEGATIVO: un modelo con forma de orden se rechaza en el puente', 'rechazo' in inyeccion && inyeccion.rechazo.rechazo === 'modelo-invalido', j(inyeccion))
  const opcion = ajustesDe({ modelo: '--dangerously-skip-permissions' })
  check('NEGATIVO: un modelo con forma de opción se rechaza', 'rechazo' in opcion && opcion.rechazo.rechazo === 'modelo-invalido', j(opcion))
  const esfuerzoMal = ajustesDe({ esfuerzo: 'high"; x' })
  check('NEGATIVO: un esfuerzo con comillas se rechaza', 'rechazo' in esfuerzoMal && esfuerzoMal.rechazo.rechazo === 'esfuerzo-invalido', j(esfuerzoMal))
  check('sin ajustes, la petición sigue valiendo', j(ajustesDe({})) === '{}', j(ajustesDe({})))
}

function probarRegistro(): void {
  hr('Registro de tareas sin terminar')
  const vista: VistaTarea = { id: 'ab12cd34', origen: 'agent:s1', profileId: 'alfa', agente: 'codex', cuenta: 'Uno', soloLectura: false, estado: 'en-marcha', resumen: 'Haga X', inicio: 1, ultimaActividad: 1, actividad: [], conversacion: '01a1b3b4-9da2-7921-af9f-ad5d07590550', modelo: 'gpt-6.1-sol' }
  const base = { vista, accountId: 'c1', projectHostPath: '/p/uno', archivoOrden: 'ab12cd34-1.md' }
  check('una entrada bien formada vale', entradaValida(base), j(base))
  const vuelta = trasApagado(vista, 500)
  check('tras un apagado, la que seguía en marcha vuelve interrumpida y conserva con qué reanudarla', vuelta.estado === 'interrumpida' && vuelta.fin === 500 && vuelta.conversacion === vista.conversacion && vuelta.modelo === 'gpt-6.1-sol', j(vuelta))
  const dos = trasApagado(vuelta, 900)
  check('una interrumpida conserva la fecha del corte al volver a arrancar', dos.fin === 500, j(dos))
  const raiz = mkdtempSync(join(tmpdir(), 'registro-tareas-'))
  try {
    const ruta = join(raiz, 'tareas.json')
    const registro = crearRegistroTareas(ruta)
    check('sin archivo no hay tareas', registro.leer().length === 0, 'sin archivo')
    registro.escribir([base])
    check('lo escrito se relee', j(registro.leer()) === j([base]), j(registro.leer()))
    writeFileSync(ruta, '{roto')
    check('un archivo dañado no impide arrancar', registro.leer().length === 0, 'dañado')
    writeFileSync(ruta, JSON.stringify([base, { vista: { ...vista, id: 'x' } }]))
    check('una entrada con otra forma se ignora, sin perder las demás', registro.leer().length === 1, 'mezcla')
    let lanzo = false
    try {
      crearRegistroTareas(raiz).leer()
    } catch {
      lanzo = true
    }
    check('NEGATIVO: un archivo que existe y no se puede leer no cuenta como vacío', lanzo, 'carpeta en lugar de archivo')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
  check('NEGATIVO: una tarea terminada no se registra', !entradaValida({ ...base, vista: { ...vista, estado: 'hecha' } }), 'hecha')
  check('NEGATIVO: un id que no es de tarea no se restaura', !entradaValida({ ...base, vista: { ...vista, id: '../x' } }), '../x')
  check('NEGATIVO: el nombre de la orden no puede salir de su carpeta', !entradaValida({ ...base, archivoOrden: '../../.credentials.json' }), 'ruta')
  check('NEGATIVO: un agente desconocido no se restaura', !entradaValida({ ...base, vista: { ...vista, agente: 'otro' } }), 'agente')
}

function probarLinea(): void {
  hr('Línea de arranque')
  const base = { binario: 'claude', rutaConfig: '/agent-config/claude-code/c1', rutaOrden: '/agent-config/claude-code/c1/.tessera-delegadas/ab12cd34-1.md', reanudar: null, aviso: 'Reglas: x', conCapa: false }
  const cc = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false })
  check('Claude Code: modo no interactivo con eventos JSON', cc.includes('-p --output-format stream-json --verbose'), cc)
  check('Claude Code: sin preguntas al editar', cc.includes('--dangerously-skip-permissions'), cc)
  check('la orden entra por la entrada estándar desde su archivo', cc.endsWith(`< '${base.rutaOrden}'`), cc)
  const ccLectura = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: true })
  check('Claude Code solo lectura: modo de planificación y nada de saltarse permisos', ccLectura.includes('--permission-mode plan') && !ccLectura.includes('dangerously'), ccLectura)
  const ccReanuda = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false, reanudar: '0d1c2b3a-1111-2222-3333-444455556666' })
  check('continuar reanuda la misma conversación', ccReanuda.includes('--resume 0d1c2b3a-1111-2222-3333-444455556666'), ccReanuda)
  const ccInyeccion = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false, reanudar: 'x; rm -rf /' })
  check('NEGATIVO: un id de conversación que no es un id no entra en la línea', !ccInyeccion.includes('rm -rf') && !ccInyeccion.includes('--resume'), ccInyeccion)
  const cx = invocacionDelegada({ ...base, binario: 'codex', rutaConfig: '/agent-config/codex/x1', agente: 'codex', soloLectura: false })
  check('Codex: exec con eventos JSON y sin servidor compartido', cx.includes('exec --json --skip-git-repo-check -c features.daemon_auto_start=false'), cx)
  check('Codex: sin sesión no se lanza el login (nadie lo completaría)', cx.includes(MARCA_SIN_CREDENCIAL) && cx.includes(`exit ${CODIGO_SIN_CREDENCIAL}`) && !cx.includes('codex login'), cx)
  check('Codex: editar es saltarse el sandbox propio dentro del contenedor', cx.includes('--dangerously-bypass-approvals-and-sandbox'), cx)
  const cxLectura = invocacionDelegada({ ...base, binario: 'codex', agente: 'codex', soloLectura: true })
  check('Codex solo lectura: sin su sandbox, que en el contenedor no arranca (la restricción va en el aviso)', !cxLectura.includes('sandbox_mode') && cxLectura.includes('--dangerously-bypass-approvals-and-sandbox'), cxLectura)
  const cxReanuda = invocacionDelegada({ ...base, binario: 'codex', agente: 'codex', soloLectura: false, reanudar: '01a1b3b4-9da2-7921-af9f-ad5d07590550' })
  check('Codex continuar: las opciones de exec van antes de resume', /exec --json .* resume 01a1b3b4-9da2-7921-af9f-ad5d07590550 - </.test(cxReanuda), cxReanuda)
  const ccModelo = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false, modelo: 'opus', esfuerzo: 'max' })
  check('Claude Code: modelo y esfuerzo con sus opciones', ccModelo.includes(`--model 'opus'`) && ccModelo.includes(`--effort 'max'`), ccModelo)
  const cxModelo = invocacionDelegada({ ...base, binario: 'codex', agente: 'codex', soloLectura: false, modelo: 'gpt-6.1-sol', esfuerzo: 'high', reanudar: '01a1b3b4-9da2-7921-af9f-ad5d07590550' })
  check('Codex: modelo y esfuerzo antes de resume', /-m 'gpt-6\.1-sol' -c 'model_reasoning_effort="high"'.* resume /.test(cxModelo), cxModelo)
  const sinModelo = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false })
  check('sin modelo no se añade ninguna opción', !sinModelo.includes('--model') && !sinModelo.includes('--effort'), sinModelo)
  const malModelo = invocacionDelegada({ ...base, agente: 'claude-code', soloLectura: false, modelo: 'x; rm -rf /', esfuerzo: '$(id)' })
  check('NEGATIVO: un modelo o esfuerzo sin forma de nombre no entra en la línea', !malModelo.includes('rm -rf') && !malModelo.includes('$(id)'), malModelo)
  const entorno = { [ENV_SESION]: 'tok-123', [ENV_BUZON]: '/agent-config/dbbridge/buzon' }
  const entera = lineaDelegada({ ...base, agente: 'claude-code', soloLectura: false, entorno })
  check(
    'la línea va bajo el entorno limpio con las variables del puente, como una pestaña de la cuenta',
    entera.startsWith('env -i ') && entera.includes(`${ENV_SESION}='tok-123'`) && entera.includes(`${ENV_BUZON}=`) && entera.includes('CLAUDE_CONFIG_DIR=/agent-config/claude-code/c1'),
    entera.slice(0, 220)
  )
}

function probarSalida(): void {
  hr('Lectura de la salida')
  const cc = crearLectorSalida('claude-code')
  cc.alimentar('{"type":"system","subtype":"init","cwd":"/workspace/p","session_id":"fd0163fd-c0c4-49fa-a640-17b2883f3333","tools":[]}\r\n')
  cc.alimentar('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}\r\n{"type":"assistant","message":{"con')
  cc.alimentar('tent":[{"type":"text","text":"Listo.\\nDetalle"}]}}\r\n')
  cc.alimentar('{"type":"result","subtype":"success","is_error":false,"result":"Todo en verde.","session_id":"fd0163fd-c0c4-49fa-a640-17b2883f3333"}\r\n')
  const rc = cc.resumen()
  check('Claude Code: conversación, actividad y resultado (también con una línea partida en dos trozos)', rc.conversacion === 'fd0163fd-c0c4-49fa-a640-17b2883f3333' && j(rc.actividad) === j(['Bash: npm test', 'Listo.']) && rc.resultado === 'Todo en verde.' && rc.error === null, j(rc))
  const ccMal = crearLectorSalida('claude-code')
  ccMal.alimentar('{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1794024600"}\n')
  const resumenCodex = ccMal.resumen()
  check('Claude Code: un resultado con error no es resultado, y el límite de uso se reconoce', resumenCodex.resultado === null && resumenCodex.sinUso && resumenCodex.error !== null, j(resumenCodex))
  const ccSesion = crearLectorSalida('claude-code')
  ccSesion.alimentar('{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed"}\n')
  check('Claude Code: una sesión caducada es falta de sesión (medido en una cuenta de Docker real)', ccSesion.resumen().sinCredencial, j(ccSesion.resumen()))
  const cx = crearLectorSalida('codex')
  cx.alimentar('\x1b[2mWARNING: failed to clean up stale arg0 temp dirs\x1b[0m\r\n')
  cx.alimentar('{"type":"thread.started","thread_id":"01a1b3b4-9da2-7921-af9f-ad5d07590550"}\n')
  cx.alimentar('{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 1 unrecognized configuration setting."}}\n')
  cx.alimentar('{"type":"turn.started"}\n{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls -la"}}\n')
  cx.alimentar('{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}\n{"type":"turn.completed","usage":{}}\n')
  const rx = cx.resumen()
  check('Codex: conversación, actividad, resultado; los avisos de configuración no son el fallo', rx.conversacion === '01a1b3b4-9da2-7921-af9f-ad5d07590550' && j(rx.actividad) === j(['$ ls -la', 'OK']) && rx.resultado === 'OK' && rx.error === null, j(rx))
  const partido = crearLectorSalida('claude-code')
  partido.alimentar('{"type":"result","subtype":"success","is_error":false,"res')
  const aMedias = partido.resumen()
  partido.alimentar('ult":"Hecho.","session_id":"s1"}\n')
  const entero = partido.resumen(true)
  check('consultar a mitad de un evento no lo rompe: solo la lectura final toma la línea sin salto', aMedias.crudas.length === 0 && aMedias.resultado === null && entero.resultado === 'Hecho.' && entero.crudas.length === 0, j({ aMedias, entero }))
  const recupera = crearLectorSalida('codex')
  recupera.alimentar('{"type":"error","message":"Reconnecting... 1/5 (stream disconnected: rate limit)"}\n')
  recupera.alimentar('{"type":"item.completed","item":{"type":"agent_message","text":"Listo"}}\n{"type":"turn.completed","usage":{}}\n')
  const rr = recupera.resumen(true)
  check('Codex: un error transitorio seguido de un turno completo no es un fallo', rr.resultado === 'Listo' && rr.error === null && !rr.sinUso && j(decidirFinal(rr, 0, null)) === j({ estado: 'hecha' }), j(rr))
  const ruido = crearLectorSalida('codex')
  ruido.alimentar('2026-11-07T10:00:01.401Z WARN mcp: oauth authentication pending for server x\n')
  ruido.alimentar('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\n{"type":"turn.completed"}\n')
  const rn = ruido.resumen(true)
  check('NEGATIVO: un aviso suelto con «oauth» o «401» no convierte un resultado en falta de sesión', !rn.sinCredencial && decidirFinal(rn, 0, null).estado === 'hecha', j(rn))
  const cxSin = crearLectorSalida('codex')
  cxSin.alimentar(`${MARCA_SIN_CREDENCIAL}\r\n`)
  check('Codex sin sesión se reconoce por su marca', cxSin.resumen().sinCredencial, j(cxSin.resumen()))
  const cxFallo = crearLectorSalida('codex')
  cxFallo.alimentar('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again at 18:40."}}\n')
  const rf = cxFallo.resumen()
  check('Codex: un turno fallido por uso es sin uso', rf.sinUso && rf.resultado === null, j(rf))
}

function probarFinal(): void {
  hr('Cómo acaba')
  const ok = { conversacion: 'c', actividad: [], resultado: 'Hecho', error: null, sinCredencial: false, sinUso: false, crudas: [] }
  check('con resultado y sin error está hecha', decidirFinal(ok, 0, null).estado === 'hecha', j(decidirFinal(ok, 0, null)))
  check('una parada manda aunque haya resultado', j(decidirFinal(ok, 0, 'origen-cerrado')) === j({ estado: 'cancelada', motivo: 'origen-cerrado' }), j(decidirFinal(ok, 0, 'origen-cerrado')))
  check('la marca de Codex sin sesión por su código', decidirFinal(null, CODIGO_SIN_CREDENCIAL, null).motivo === 'sin-credencial', j(decidirFinal(null, CODIGO_SIN_CREDENCIAL, null)))
  const sinNada = decidirFinal({ ...ok, resultado: null, crudas: ['bash: claude: command not found'] }, 127, null)
  check('sin eventos, falla con lo último que escribió', sinNada.estado === 'fallida' && sinNada.motivo === 'agente' && sinNada.detalle === 'bash: claude: command not found', j(sinNada))
  const cortada = { ...ok, resultado: null, crudas: ['Learn more at https://docs.docker.com/go/debug-cli/'] }
  check('lo que escribió el cliente de Docker al perder el motor (medido al cerrar Docker Desktop) se reconoce', puedeSerDocker(cortada) && salidaDeDocker(cortada), j(cortada))
  check('NEGATIVO: una tarea con resultado no se atribuye a Docker', !puedeSerDocker({ ...ok, crudas: cortada.crudas }), 'resultado')
  check('NEGATIVO: un error propio del agente no se atribuye a Docker', !puedeSerDocker({ ...cortada, error: 'modelo no disponible' }), 'error')
  check('NEGATIVO: un aviso cualquiera no parece Docker', !salidaDeDocker({ ...ok, resultado: null, crudas: ['WARNING: failed to clean up stale arg0 temp dirs'] }), 'aviso')
  check('un fallo antes de arrancar es fallida con su motivo', j(decidirFinal(null, null, null, { motivo: 'docker' })) === j({ estado: 'fallida', motivo: 'docker' }), 'docker')
}

async function main(): Promise<void> {
  probarOrigen()
  await probarOrden()
  probarEleccion()
  probarCatalogo()
  probarRegistro()
  probarLinea()
  probarSalida()
  probarFinal()
  hr('Resumen')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
