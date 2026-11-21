#!/usr/bin/env node
// =============================================================================
// Prueba de cancelar una tarea delegada que no termina (npm run test:cancelar-delegada): con Docker colgado al preparar
// el contenedor, o con una sesión que no sale al cerrarla, cancelar responde dentro de su tope, la tarea queda
// cancelada y se sueltan sus contadores; una que termina a tiempo no se fuerza.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { crearCarpetaTemporal } from '../../../../scripts/pruebas/temporales.mts'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// El servicio importa sin extensión: el hook reintenta con ".ts" (el mismo de `test-cuentas-varias`).
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
const { ServicioDelegacion } = await import('./ServicioDelegacion.ts')

function hr(t: string): void {
  console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: unknown): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${JSON.stringify(evidencia)}`)
}
const nunca = new Promise<never>(() => {})

type Modo = 'docker-colgado' | 'sesion-colgada' | 'sale-a-tiempo' | 'abre-tarde'

/** Un núcleo mínimo: lo justo para que una tarea arranque y se quede donde pide `modo`. */
function montar(modo: Modo, raiz: string) {
  const cuenta = { id: 'cuenta-a', nombre: 'Cuenta A', agente: 'claude-code', profileId: 'p1' }
  const carpeta = join(raiz, modo)
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(join(carpeta, '.credentials.json'), '{}')
  const salidas = new Map<string, (codigo: number | null) => void>()
  let llamadasDocker = 0
  const logs: string[] = []
  const atados: string[] = []
  const revocados: string[] = []
  let abrirSesion: () => void = () => undefined
  let cierreColgado: () => void = () => undefined
  const n = {
    log: (m: string) => logs.push(m),
    perfiles: new Map([['p1', { id: 'p1', nombre: 'P1', agentes: [] }]]),
    cuentas: { disponibles: (_p: string, a: string) => (a === cuenta.agente ? [cuenta] : []), obtener: () => cuenta, dirHostDe: () => carpeta },
    sesiones: new Map(),
    configRefs: new Map<string, number>(),
    delegadasPorContenedor: new Map<string, number>(),
    delegadasPorOrigen: new Map<string, number>(),
    binarios: { 'claude-code': 'claude', codex: 'codex' },
    sandbox: {
      checkDocker: async () => ({ ok: false, motorCaido: true }),
      // La primera la hace la tarea; la segunda, la preparación del contenedor, que es donde se cuelga.
      asegurarDocker: () => (modo === 'docker-colgado' && ++llamadasDocker > 1 ? nunca : Promise.resolve({ ok: true })),
      retainSession: () => undefined,
      releaseSession: () => undefined,
      unmountAgentConfig: async () => undefined,
      programarParada: () => undefined,
      ensureContainer: async () => undefined,
      addProject: async () => ({ projectHostPath: '/workspace/p' }),
      mountAgentConfig: async () => ({ containerPath: '/agent-config/claude/cuenta-a' }),
      capacidades: async () => ({ puedeInstalar: false, extras: { apt: [], depsNavegador: false } }),
      contenedoresVivos: () => [],
      dbBridgeContainerPath: '/agent-config/dbbridge'
    },
    terminales: {
      // En `abre-tarde`, la sesión se abre cuando lo pide la prueba: después de que venza el tope.
      crearSesion: () => (modo === 'abre-tarde' ? new Promise<{ id: string }>((r) => { abrirSesion = () => r({ id: 'sesion-1' }) }) : Promise.resolve({ id: 'sesion-1' })),
      // Lo primero que escribe Claude Code en `stream-json`: con su id, la tarea tiene conversación que continuar.
      onData: (_id: string, cb: (datos: string) => void) => {
        cb('{"type":"system","subtype":"init","session_id":"0a1b2c3d-0000-4000-8000-00000000000a"}\n')
        return () => undefined
      },
      onExit: (id: string, cb: (codigo: number | null) => void) => {
        salidas.set(id, cb)
        return () => undefined
      },
      cerrarSesion: async (id: string) => {
        // Colgada hasta que la prueba deja salir al proceso: entonces llega su salida, como la de un pty.
        if (modo === 'sesion-colgada') {
          await new Promise<void>((r) => { cierreColgado = r })
          const alSalir = salidas.get(id)
          salidas.delete(id)
          alSalir?.(137)
          return
        }
        // Una sola salida por sesión, como la de un pty: quien la atiende vuelve a cerrar la sesión.
        const alSalir = salidas.get(id)
        salidas.delete(id)
        alSalir?.(130)
      }
    },
    obtenerEntornoContenedor: () => ({}),
    obtenerAvisoBd: () => null,
    obtenerAvisoSsh: () => null,
    contextoGlobal: () => ({ reglas: '', documentos: [] }),
    vincularSesionDb: (_e: unknown, clave: string) => { atados.push(clave) },
    revocarSesionDb: (clave: string) => { revocados.push(clave) },
    capasCompartidas: () => []
  }
  const servicio = new ServicioDelegacion(n as never, { uso: async () => [], emitir: () => undefined, montajesDe: () => [], topeCancelarMs: 300 })
  return { servicio, n, logs, atados, revocados, abrir: () => abrirSesion(), dejarSalir: () => cierreColgado() }
}

const raiz = crearCarpetaTemporal(join(tmpdir(), 'tessera-cancelar-delegada-'))
const origen = { perfilId: 'p1', rutaHostProyecto: join(raiz, 'proyecto'), clave: 'agent:s1' }
try {
  for (const modo of ['docker-colgado', 'sesion-colgada', 'sale-a-tiempo', 'abre-tarde'] as const) {
    hr(modo)
    const { servicio, n, logs, atados, revocados, abrir, dejarSalir } = montar(modo, raiz)
    const r = await servicio.delegar(origen, { agente: 'claude-code', cuenta: 'Cuenta A', soloLectura: false, orden: 'Revisa el módulo' })
    check('la tarea arranca', r.ok === true, r)
    if (!r.ok) continue
    const id = r.tarea.id
    // Que llegue hasta donde se cuelga (la sesión, en los modos que la abren).
    await new Promise((res) => setTimeout(res, 50))
    const desde = Date.now()
    const ok = await Promise.race([servicio.cancelar(origen, id), new Promise<'colgada'>((res) => setTimeout(() => res('colgada'), 3000))])
    const ms = Date.now() - desde
    const vista = servicio.ver(origen, id)
    check('cancelar responde, sin quedarse esperando', ok === true, { ok, ms })
    check('la tarea queda cancelada por el usuario', vista?.estado === 'cancelada' && vista.motivo === 'cancelada-por-usuario', vista?.estado)
    check('se sueltan sus contadores', n.delegadasPorContenedor.size === 0 && n.delegadasPorOrigen.size === 0, [...n.delegadasPorOrigen])
    const forzada = logs.some((l) => l.includes('se da por cancelada'))
    if (modo === 'sale-a-tiempo') {
      check('NEGATIVO: si sale a tiempo no se fuerza ni se espera el tope', !forzada && ms < 250, { forzada, ms })
      check('y suelta su credencial', n.configRefs.size === 0, [...n.configRefs])
      check('el token que ató se revoca', atados.length === 1 && revocados.includes(atados[0]), { atados, revocados })
      continue
    }
    check('vencido el tope, se fuerza y queda escrito', forzada && ms >= 250, { forzada, ms })
    if (modo === 'sesion-colgada') {
      check('con el proceso vivo conserva su credencial: no se desmonta debajo de él', n.configRefs.size === 1, [...n.configRefs])
      check('pero su token de bases ya no vale', atados.length === 1 && revocados.includes(atados[0]), { atados, revocados })
      const seguida = await servicio.continuar(origen, id, 'Sigue')
      check('NEGATIVO: continuar con el proceso anterior vivo se rechaza (escribirían los dos en la conversación)', seguida === 'sigue-cerrandose', seguida)
      dejarSalir()
      await new Promise((res) => setTimeout(res, 50))
      check('cuando el proceso sale de verdad, suelta la credencial', n.configRefs.size === 0, [...n.configRefs])
    }
    if (modo === 'abre-tarde') {
      abrir()
      await new Promise((res) => setTimeout(res, 50))
      check('NEGATIVO: una sesión que se abre después de cancelarla no ata un token que nadie revocaría', atados.length === 0, atados)
    }
  }
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const pasadas = resultados.filter(Boolean).length
console.log(`\nVEREDICTO: ${pasadas}/${resultados.length} PASS`)
process.exit(pasadas === resultados.length ? 0 : 1)
