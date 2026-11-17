#!/usr/bin/env node
// =============================================================================
// Prueba del registro de operaciones del puente (`PuenteBd.registrarOperacion`; npm run
// test:puente-operaciones), aparte de `test-puente-bd`, que sigue igual: lo no registrado es «operacion
// desconocida», `resolve` no se sustituye, una op 'propio' valida su token y una 'sesion' recibe la sesión
// de la CONCESIÓN (nunca la de la petición, ni con un token de un solo uso), también si contesta con una
// promesa, y por el pipe real.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================

import { connect } from 'node:net'
import { PuenteBd, type SesionDelPuente } from './puenteBd.ts'

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
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const registro: string[] = []
const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: (m) => registro.push(m) })
const PROYECTO = 'D:\\Repos\\demo'

hr('1 - Sin registrar nada, todo sigue como siempre')
{
  const token = puente.emitir('p1', PROYECTO)
  check('(1a) una op no registrada: «operacion desconocida»', j(puente.resolver({ v: 1, token, op: 'ssh.askpass' })) === j({ ok: false, error: 'operacion desconocida' }), j(puente.resolver({ v: 1, token, op: 'ssh.askpass' })))
  check('(1b) resolve sigue respondiendo', (puente.resolver({ v: 1, token, op: 'resolve' }) as { ok: boolean }).ok === true, 'resolve')
}

hr('2 - El registro: resolve no se sustituye y una op no se registra dos veces')
{
  const propio = { token: 'propio' as const, manejar: () => ({ ok: true }) }
  check('(2a) registrar «resolve» lanza', lanza(() => puente.registrarOperacion('resolve', propio))?.includes('ya existe') === true, String(lanza(() => puente.registrarOperacion('resolve', propio))))
  puente.registrarOperacion('prueba.propia', { token: 'propio', manejar: (p) => ({ ok: true, eco: p.dato ?? null, token: p.token ?? null }) })
  check('(2b) registrar dos veces la misma op lanza', lanza(() => puente.registrarOperacion('prueba.propia', propio))?.includes('ya existe') === true, 'dos veces')
}

hr("3 - Token 'propio': el puente no lo mira; lo valida la operación")
{
  const r = puente.resolver({ v: 1, token: 'inventado', op: 'prueba.propia', dato: 42 }) as Record<string, unknown>
  check('(3a) la operación recibe la petición entera, con su token', r.ok === true && r.eco === 42 && r.token === 'inventado', j(r))
  check('(3b) con otra versión de protocolo ni se llama', j(puente.resolver({ v: 2, token: 'x', op: 'prueba.propia' })) === j({ ok: false, error: 'version de protocolo distinta' }), 'v: 2')
}

hr("4 - Token 'sesion': solo una concesión de sesión viva, y la sesión es la de la concesión")
{
  const llamadas: SesionDelPuente[] = []
  puente.registrarOperacion('prueba.sesion', {
    token: 'sesion',
    manejar: (_p, sesion) => {
      llamadas.push(sesion)
      return { ok: true }
    }
  })
  const pedir = (token: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    puente.resolver({ v: 1, token, op: 'prueba.sesion', ...extra }) as Record<string, unknown>
  check('(4a) un token inventado: «no autorizado» y la operación no se llama', pedir('inventado').error === 'no autorizado' && llamadas.length === 0, j(llamadas))
  const deSesion = puente.emitir('p1', PROYECTO, { espacioDatos: true })
  const r = pedir(deSesion, { profileId: 'otro', projectHostPath: 'C:\\otro', espacioDatos: false })
  check(
    '(4b) con un token de sesión se llama con la sesión de la CONCESIÓN, no la que diga la petición',
    r.ok === true && j(llamadas[0]) === j({ profileId: 'p1', projectHostPath: PROYECTO, espacioDatos: true }),
    j(llamadas[0])
  )
  const unaVez = puente.emitirUnaVez('a', 'p1')
  check('(4c) un token de un solo uso (el «Probar» de una base) no abre otras operaciones', pedir(unaVez).error === 'no autorizado' && llamadas.length === 1, j(pedir(unaVez)))
  puente.bind(deSesion, 's1')
  puente.revocar('s1')
  check('(4d) revocada la sesión, su token deja de valer', pedir(deSesion).error === 'no autorizado' && llamadas.length === 1, 'revocado')
  // Una lectura larga (`tctx buscar`) contesta con una promesa: el puente la espera, y su fallo es el de siempre.
  puente.registrarOperacion('prueba.sesion-tarde', { token: 'sesion', manejar: async (_p, s) => ({ ok: true, perfil: s.profileId }) })
  puente.registrarOperacion('prueba.sesion-rota', { token: 'sesion', manejar: () => Promise.reject(new Error('rota de sesión')) })
  const viva = puente.emitir('p1', PROYECTO)
  const tarde = puente.resolver({ v: 1, token: viva, op: 'prueba.sesion-tarde', profileId: 'otro' })
  const r4e = tarde instanceof Promise ? await tarde : null
  check('(4e) con token de sesión, una promesa se espera y lleva la sesión de la concesión', j(r4e) === j({ ok: true, perfil: 'p1' }), j(r4e))
  const rota = await puente.resolver({ v: 1, token: viva, op: 'prueba.sesion-rota' })
  check('(4f) y si su promesa falla, «error interno» y una línea en el registro', j(rota) === j({ ok: false, error: 'error interno' }) && registro.some((m) => m.includes('rota de sesión')), j(rota))
  const sinToken = puente.resolver({ v: 1, token: 'inventado', op: 'prueba.sesion-tarde' })
  check('(4g) sin token válido ni se llama: «no autorizado» en el acto', !(sinToken instanceof Promise) && j(sinToken) === j({ ok: false, error: 'no autorizado' }), j(sinToken))
}

hr('5 - Una operación que lanza: «error interno» y una línea en el registro')
{
  puente.registrarOperacion('prueba.rota', {
    token: 'propio',
    manejar: () => {
      throw new Error('se rompió')
    }
  })
  const r = puente.resolver({ v: 1, token: 'x', op: 'prueba.rota' })
  check('(5a) responde «error interno»', j(r) === j({ ok: false, error: 'error interno' }), j(r))
  check('(5b) y lo deja escrito', registro.some((m) => m.includes('prueba.rota') && m.includes('se rompió')), registro.join(' | '))
}

hr('6 - Por el pipe real: la respuesta de una operación viaja como una línea JSON')
{
  puente.iniciar()
  await new Promise((r) => setTimeout(r, 250))
  const pedirPorPipe = (linea: string): Promise<Record<string, unknown> | null> =>
    new Promise((resolver) => {
      const socket = connect(puente.pipe)
      let buffer = ''
      socket.setTimeout(3000, () => {
        socket.destroy()
        resolver(null)
      })
      socket.on('error', () => resolver(null))
      socket.on('data', (t) => (buffer += t.toString('utf-8')))
      socket.on('end', () => {
        try {
          resolver(JSON.parse(buffer.trim()))
        } catch {
          resolver(null)
        }
      })
      socket.write(linea)
    })
  const r = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'prueba.propia', dato: 'ñ€' }) + '\n')
  check('(6a) el puente escucha y la operación contesta por el pipe (UTF-8 incluido)', puente.listo && r?.ok === true && r.eco === 'ñ€', j(r))
  const d = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'no.registrada' }) + '\n')
  check('(6b) y lo no registrado, igual que siempre', j(d) === j({ ok: false, error: 'operacion desconocida' }), j(d))
  puente.registrarOperacion('prueba.tarde', {
    token: 'propio',
    manejar: (p) => new Promise((resolver) => setTimeout(() => resolver({ ok: true, eco: p.dato ?? null }), 100))
  })
  puente.registrarOperacion('prueba.promesa-rota', { token: 'propio', manejar: () => Promise.reject(new Error('rota')) })
  const tarde = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'prueba.tarde', dato: 7 }) + '\n')
  check('(6c) una operación que contesta más tarde (una promesa) responde por el mismo socket', tarde?.ok === true && tarde.eco === 7, j(tarde))
  const rota = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'prueba.promesa-rota' }) + '\n')
  check('(6d) y si su promesa falla, «error interno» como las síncronas', j(rota) === j({ ok: false, error: 'error interno' }), j(rota))
  const colgada = pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'prueba.tarde', dato: 8 }) + '\n')
  await new Promise((r) => setTimeout(r, 20))
  await puente.pausar()
  check('(6e) una pausa corta al cliente que espera una respuesta tardía (no la espera)', (await colgada) === null, 'null')
  puente.detener()
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
