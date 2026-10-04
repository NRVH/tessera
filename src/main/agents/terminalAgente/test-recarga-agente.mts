#!/usr/bin/env node
// =============================================================================
// Prueba de `recargar` (npm run test:recarga-agente) con un núcleo falso: Docker, contenedor y
// terminales de mentira, y un registro de lo que se hace y en qué orden.
// Fija que un fallo de Docker o del contenedor deja la sesión como estaba (armada, con su
// detector y su ancla), que el desarme va justo antes de relanzar, en contenedor y en nativo,
// y que el ancla del proceso nuevo no hereda la marca de envío del viejo.
// =============================================================================

import { register } from 'node:module'

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

// Los módulos del agente importan VALORES sin extensión y alguno trae `electron`: el mismo
// resolver que test-hibernacion-agente, registrado antes de los imports dinámicos.
const electronStub =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
const { recargar } = await import('./recarga.ts')
const { crearDetectorEnvio } = await import('../lineaEnviada.ts')
const { crearRegistroAnclas } = await import('../../context/anclaConversacion.ts')

type Fallo = 'docker' | 'contenedor' | null

/** Núcleo y sesión falsos; `eventos` registra, en orden, desarme y relanzamiento. */
function montar(host: boolean, fallo: Fallo) {
  const eventos: string[] = []
  const detectorViejo = crearDetectorEnvio()
  const open = {
    sessionId: 's1',
    host,
    profileId: 'p1',
    accountId: 'a1',
    agente: 'claude-code',
    projectHostPath: 'C:\\proyecto',
    claveAncla: 'ancla-1',
    resumeSessionId: 'chat-1',
    lanzamiento: 0,
    versionLanzada: null,
    activity: { finish: () => eventos.push('finish'), suppress: () => eventos.push('suppress') },
    detectorEnvio: detectorViejo
  }
  const n = {
    sessions: new Map([['s1', open]]),
    profiles: new Map([['p1', { id: 'p1' }]]),
    anclas: {
      retain: () => {},
      pin: (_c: string, id: string) => eventos.push(`ancla:${id}`),
      arm: () => eventos.push('ancla:nueva')
    },
    sandbox: {
      checkDocker: async () => (fallo === 'docker' ? { ok: false, detalle: 'Docker parado' } : { ok: true }),
      ensureContainer: async () => {
        if (fallo === 'contenedor') throw new Error('no arranca el contenedor')
      },
      addProject: async () => {},
      mountAgentConfig: async () => ({ containerPath: '/cfg' })
    },
    accounts: { get: () => ({ id: 'a1' }), hostDirFor: () => 'C:\\cfg' },
    touchedProfiles: new Set<string>(),
    terminals: {
      reloadSession: async (id: string) => {
        eventos.push('relanzar')
        return { id, workspacePath: '/workspace/proyecto', project: 'C:\\proyecto' }
      }
    },
    esperarCandado: async () => {},
    reloj: () => 0,
    log: () => {},
    alCambiarSesiones: () => {}
  }
  return { n, open, eventos, detectorViejo }
}

async function probarFallo(fallo: Exclude<Fallo, null>): Promise<void> {
  const { n, open, eventos, detectorViejo } = montar(false, fallo)
  let error = ''
  try {
    // El núcleo es un doble parcial: solo lo que `recargar` toca.
    await recargar(n as never, 's1', ['bd-1'])
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  check(
    `(${fallo}) si falla ${fallo === 'docker' ? 'Docker' : 'el contenedor'}, la sesión queda armada, con su detector y su ancla`,
    error !== '' && eventos.length === 0 && open.detectorEnvio === detectorViejo,
    `error=${JSON.stringify(error.split('\n')[0])} eventos=${JSON.stringify(eventos)} detector igual=${open.detectorEnvio === detectorViejo}`
  )
}

async function main(): Promise<void> {
  hr('Fallo antes de relanzar: nada se desarma')
  await probarFallo('docker')
  await probarFallo('contenedor')

  hr('Éxito: el desarme va justo antes de relanzar')
  for (const host of [false, true]) {
    const { n, open, eventos, detectorViejo } = montar(host, null)
    await recargar(n as never, 's1')
    check(
      `(${host ? 'nativo' : 'contenedor'}) cierra el turno, re-ancla al chat de la sesión y relanza, en ese orden`,
      JSON.stringify(eventos) === JSON.stringify(['finish', 'ancla:nueva', 'ancla:chat-1', 'suppress', 'relanzar']) &&
        open.detectorEnvio !== detectorViejo,
      `eventos=${JSON.stringify(eventos)} detector nuevo=${open.detectorEnvio !== detectorViejo}`
    )
  }

  hr('El ancla del proceso nuevo no hereda la marca de envío del viejo')
  for (const host of [false, true]) await probarAnclaSinHerencia(host)
}

/**
 * Con el registro de anclas REAL: el ancla ya está en el chat que se reanuda y el usuario envió
 * algo con el proceso viejo. `pin` sobre el mismo chat no toca nada, así que sin el `arm` previo
 * el proceso nuevo heredaba `marcaEnvio` y `desde`, y la regla (a) elegía con evidencia vieja.
 */
async function probarAnclaSinHerencia(host: boolean): Promise<void> {
  let t = 1_000_000
  const anclas = crearRegistroAnclas(() => t)
  const { n } = montar(host, null)
  const nucleo = { ...n, anclas }
  anclas.retain('ancla-1')
  anclas.arm('ancla-1') // la sesión arrancó sin reanudar…
  t += 10_000
  anclas.aprender('ancla-1', 'chat-1') // …el anillo aprendió el chat…
  t += 60_000
  anclas.touch('ancla-1') // …y el usuario envió con el proceso viejo
  t += 120_000
  const recarga = t
  await recargar(nucleo as never, 's1')
  const a = anclas.get('ancla-1')
  const estado = a?.estado
  check(
    `(${host ? 'nativo' : 'contenedor'}) tras recargar, el ancla está en el chat de la sesión, sin marca de envío y fechada en la recarga`,
    estado?.tipo === 'anclada' && estado.sessionId === 'chat-1' && estado.fuente === 'resume' &&
      a?.marcaEnvio === 0 && estado.desde === recarga,
    `estado=${JSON.stringify(estado)} marcaEnvio=${a?.marcaEnvio} recarga=${recarga}`
  )
}

await main()
const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
