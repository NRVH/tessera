#!/usr/bin/env node
// =============================================================================
// Prueba del registro de operaciones del puente (`DbBridge.registrarOperacion`; npm run
// test:puente-operaciones), aparte de `test-db-bridge`, que sigue igual: lo no registrado es «operacion
// desconocida», `resolve` no se sustituye, una op 'propio' valida su token y una 'sesion' recibe la sesión
// de la CONCESIÓN (nunca la de la petición, ni con un token de un solo uso), y por el pipe real.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================

import { connect } from 'node:net'
import { DbBridge, type SesionDelPuente } from './dbBridge.ts'

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
const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: (m) => registro.push(m) })
const PROYECTO = 'D:\\Repos\\demo'

hr('1 - Sin registrar nada, todo sigue como siempre')
{
  const token = puente.mint('p1', PROYECTO)
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
  const deSesion = puente.mint('p1', PROYECTO, { espacioDatos: true })
  const r = pedir(deSesion, { profileId: 'otro', projectHostPath: 'C:\\otro', espacioDatos: false })
  check(
    '(4b) con un token de sesión se llama con la sesión de la CONCESIÓN, no la que diga la petición',
    r.ok === true && j(llamadas[0]) === j({ profileId: 'p1', projectHostPath: PROYECTO, espacioDatos: true }),
    j(llamadas[0])
  )
  const unaVez = puente.mintUnaVez('a', 'p1')
  check('(4c) un token de un solo uso (el «Probar» de una base) no abre otras operaciones', pedir(unaVez).error === 'no autorizado' && llamadas.length === 1, j(pedir(unaVez)))
  puente.bind(deSesion, 's1')
  puente.revoke('s1')
  check('(4d) revocada la sesión, su token deja de valer', pedir(deSesion).error === 'no autorizado' && llamadas.length === 1, 'revocado')
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
  puente.start()
  await new Promise((r) => setTimeout(r, 250))
  const pedirPorPipe = (linea: string): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => {
      const socket = connect(puente.pipe)
      let buffer = ''
      socket.setTimeout(3000, () => {
        socket.destroy()
        resolve(null)
      })
      socket.on('error', () => resolve(null))
      socket.on('data', (t) => (buffer += t.toString('utf-8')))
      socket.on('end', () => {
        try {
          resolve(JSON.parse(buffer.trim()))
        } catch {
          resolve(null)
        }
      })
      socket.write(linea)
    })
  const r = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'prueba.propia', dato: 'ñ€' }) + '\n')
  check('(6a) el puente escucha y la operación contesta por el pipe (UTF-8 incluido)', puente.listo && r?.ok === true && r.eco === 'ñ€', j(r))
  const d = await pedirPorPipe(JSON.stringify({ v: 1, token: 't', op: 'no.registrada' }) + '\n')
  check('(6b) y lo no registrado, igual que siempre', j(d) === j({ ok: false, error: 'operacion desconocida' }), j(d))
  puente.stop()
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
