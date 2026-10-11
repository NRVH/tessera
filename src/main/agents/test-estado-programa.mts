#!/usr/bin/env node
// =============================================================================
// Prueba del lector del estado informado por el agente (`estadoPrograma.ts`; npm run test:estado-programa):
// avisos con BEL y con ST, la sonda, secuencias partidas entre trozos en cualquier punto, campanas sueltas
// frente al BEL que cierra un OSC, avisos que no valen (y se descartan enteros), un OSC enorme y uno cortado.
// =============================================================================

import { avisoDe, crearLectorPrograma, type AvisoPrograma, type LecturaPrograma } from './estadoPrograma.ts'

function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : `\n         ${evidence}`}`)
}
const j = (v: unknown): string => JSON.stringify(v)
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const osc = (cuerpo: string, st = false): string => `\x1b]7501;${cuerpo}${st ? '\x1b\\' : '\x07'}`

/** Lee `trozos` con un lector nuevo y junta lo que salga. */
function leer(...trozos: string[]): LecturaPrograma {
  const l = crearLectorPrograma()
  const out: LecturaPrograma = { avisos: [], sonda: false, campanas: 0 }
  for (const t of trozos) {
    const r = l.leer(t)
    out.avisos.push(...r.avisos)
    out.sonda ||= r.sonda
    out.campanas += r.campanas
  }
  return out
}
const estados = (a: AvisoPrograma[]): string => a.map((x) => x.estado + (x.motivo ? `:${x.motivo}` : '') + (x.id ? `@${x.id}` : '')).join(',')

hr('A - Avisos y sonda')
{
  const r = leer(osc('?') + osc('state=idle:app=claude-code') + 'texto' + osc('state=working:app=claude-code:msg=' + b64('Escribiendo prueba.txt')) + osc('state=done', true))
  check('(a1) la sonda, y los avisos con BEL y con ST, en orden', r.sonda && estados(r.avisos) === 'idle,working,done' && r.campanas === 0, j(r))
  const q = leer(osc('state=blocked:app=claude-code:kind=question:msg=' + b64('answer: ¿Rojo o azul? (Rojo · Azul)')))
  check('(a2) blocked con su motivo (y un msg con tildes y «·»)', estados(q.avisos) === 'blocked:question', j(q))
  check('(a3) el motivo solo cuenta con blocked', estados(leer(osc('state=working:kind=permission')).avisos) === 'working', '')
  check('(a4) un hijo lleva su id', estados(leer(osc('state=blocked:id=build/test:kind=permission')).avisos) === 'blocked:permission@build/test', '')
  check('(a5) clear sin id', estados(leer(osc('state=clear')).avisos) === 'clear', '')
  check('(a6) la última clave repetida gana; las desconocidas y las mal formadas se ignoran', avisoDe('state=idle:raro=1:MAL=x:sinigual:msg=a*b:state=working')?.estado === 'working', '')
}

hr('B - Lo que no vale se descarta entero')
{
  const malos = [
    'app=claude-code',
    'state=dormido',
    'state=working:id=a//b',
    'state=working:id=' + 'x'.repeat(33),
    'state=working:msg=' + b64('dos\nlíneas'),
    'state=working:msg=no-es-base64',
    'state=working:title=' + b64('\x1b[31mrojo')
  ]
  const r = malos.map((m) => avisoDe(m))
  check('(b1) sin state, state desconocido, id mal formado, texto con control o no base64: null', r.every((x) => x === null), j(r))
  const otro = leer('\x1b]0;título\x07' + '\x1b]52;c;' + 'A'.repeat(10_000) + '\x07' + osc('state=done'))
  check('(b2) un OSC ajeno o enorme (un portapapeles) no es aviso ni campana, y el siguiente se lee', estados(otro.avisos) === 'done' && otro.campanas === 0, j(otro))
}

hr('C - Campanas')
{
  check('(c1) un BEL suelto es una campana', leer('hola\x07').campanas === 1, '')
  check('(c2) el BEL que cierra un título no lo es', leer('\x1b]0;✳ Claude Code\x07').campanas === 0, '')
  check('(c3) el BEL de un OSC partido entre trozos tampoco', leer('\x1b]0;✳ Cla', 'ude Code\x07').campanas === 0, '')
  check('(c4) campanas sueltas alrededor de un OSC', leer('\x07' + osc('state=idle') + '\x07').campanas === 2, '')
  const cortado = leer('\x1b]7501;state=working\x1b[0m' + osc('state=done'))
  check('(c5) un ESC que no es ST corta el OSC sin aviso; lo que sigue se lee', estados(cortado.avisos) === 'done', j(cortado))
}

hr('D - Partido en cualquier punto')
{
  const flujo =
    'arranque\x1b]0;título\x07' +
    osc('?') +
    osc('state=idle:app=claude-code') +
    '\x1b[2J\x07' +
    osc('state=working:app=claude-code:msg=' + b64('Paso 1'), true) +
    osc('state=blocked:app=claude-code:kind=permission') +
    osc('state=clear:id=sub') +
    osc('state=done:app=claude-code', true)
  const esperado = j(leer(flujo))
  let fallos = 0
  let primero = ''
  for (let i = 1; i < flujo.length; i++) {
    for (const k of [i, Math.min(flujo.length, i + 3)]) {
      const r = j(leer(flujo.slice(0, i), flujo.slice(i, k), flujo.slice(k)))
      if (r !== esperado) {
        fallos++
        primero ||= `corte ${i}/${k}: ${r}`
      }
    }
  }
  check('(d1) cortado en dos o tres trozos en cada posición, sale lo mismo que entero', fallos === 0, primero)
  const unoAUno = leer(...flujo.split(''))
  check('(d2) carácter a carácter, también', j(unoAUno) === esperado, j(unoAUno))
  check('(d3) y lo entero es lo esperado', esperado === j({ avisos: leer(flujo).avisos, sonda: true, campanas: 1 }) && estados(leer(flujo).avisos) === 'idle,working,blocked:permission,clear@sub,done', esperado)
}

hr('E - Reiniciar')
{
  const l = crearLectorPrograma()
  l.leer('\x1b]7501;state=wor')
  l.reiniciar()
  const r = l.leer('king\x07')
  check('(e1) lo que quedó a medias se olvida al reiniciar: su resto no es aviso, y su BEL es una campana', r.avisos.length === 0 && r.campanas === 1, j(r))
}

const allPass = results.every((r) => r.pass)
console.log(`\nVEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
