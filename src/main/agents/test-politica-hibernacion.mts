#!/usr/bin/env node
// =============================================================================
// Prueba de la política de la hibernación por inactividad (npm run
// test:politica-hibernacion): cada veto, la inactividad como mínimo de dos relojes, el todo
// o nada por proyecto, la lista blanca, `revisarEnMs` y el saneado de la petición.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import {
  decidirHibernacion,
  sanearPeticion,
  type DecisionHibernacion,
  type SesionMedida
} from './politicaHibernacion.ts'
import type { ProyectoHibernable } from '../../shared/agent-terminal-ipc.ts'

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

const UMBRAL = 300_000
const AHORA = 10_000_000

function proyecto(extra: Partial<ProyectoHibernable> = {}): ProyectoHibernable {
  return { profileId: 'p1', projectHostPath: 'D:/a', enPantalla: false, hibernado: false, sinRevisar: false, fueraDePantallaMs: UMBRAL * 2, ...extra }
}
function sesion(extra: Partial<SesionMedida> = {}): SesionMedida {
  return {
    sessionId: 's1',
    profileId: 'p1',
    projectHostPath: 'D:/a',
    nativa: true,
    viva: true,
    ocupada: false,
    trabajando: false,
    esperandoRespuesta: false,
    textoSinEnviar: false,
    pausada: false,
    segundoPlano: false,
    ultimaEsAt: AHORA - UMBRAL * 2,
    ...extra
  }
}
function decidir(proyectos: ProyectoHibernable[], sesiones: SesionMedida[], umbralMs: number | null = UMBRAL): DecisionHibernacion {
  return decidirHibernacion({ ahora: AHORA, umbralMs, proyectos, sesiones })
}
const veredicto = (d: DecisionHibernacion): string => d.veredictos.map((v) => v.veredicto).join(',')

hr('1. El caso elegible y «Nunca»')
{
  const d = decidir([proyecto()], [sesion()])
  check('(1a) fuera de pantalla, callado y sin vetos: se hiberna', d.hibernar.length === 1 && d.hibernar[0].sessionIds[0] === 's1', veredicto(d))
  const nunca = decidir([proyecto()], [sesion()], null)
  check('(1b) con «Nunca» no se decide nada', nunca.hibernar.length === 0 && nunca.veredictos.length === 0 && nunca.revisarEnMs === null, JSON.stringify(nunca))
}

hr('2. Cada veto, por su nombre')
{
  const casos: Array<[string, Partial<ProyectoHibernable>, Partial<SesionMedida>]> = [
    ['en-pantalla', { enPantalla: true }, {}],
    ['ya-hibernado', { hibernado: true }, {}],
    ['sin-revisar', { sinRevisar: true }, {}],
    ['ocupada', {}, { ocupada: true, viva: false }],
    ['sin-sesion', {}, { viva: false }],
    ['no-nativa', {}, { nativa: false }],
    ['trabajando', {}, { trabajando: true }],
    ['esperando-respuesta', {}, { esperandoRespuesta: true }],
    ['texto-sin-enviar', {}, { textoSinEnviar: true }],
    ['contrapresion', {}, { pausada: true }],
    ['segundo-plano', {}, { segundoPlano: true }]
  ]
  for (const [esperado, p, s] of casos) {
    const d = decidir([proyecto(p)], [sesion(s)])
    check(`(2) ${esperado}`, d.hibernar.length === 0 && veredicto(d) === esperado, veredicto(d))
  }
  const sinSesiones = decidir([proyecto()], [])
  check('(2) un proyecto sin ninguna sesión: sin-sesion', veredicto(sinSesiones) === 'sin-sesion', veredicto(sinSesiones))
}

hr('3. La inactividad es el MENOR de dos relojes')
{
  const porEs = decidir([proyecto()], [sesion({ ultimaEsAt: AHORA - 1000 })])
  check('(3a) E/S hace un segundo: reciente', veredicto(porEs) === 'reciente' && porEs.revisarEnMs === UMBRAL - 1000, `${veredicto(porEs)} ${porEs.revisarEnMs}`)
  const porPantalla = decidir([proyecto({ fueraDePantallaMs: 2000 })], [sesion()])
  check('(3b) dejó de verse hace dos segundos: reciente aunque el pty calle hace horas', veredicto(porPantalla) === 'reciente' && porPantalla.revisarEnMs === UMBRAL - 2000, `${veredicto(porPantalla)} ${porPantalla.revisarEnMs}`)
  const justo = decidir([proyecto({ fueraDePantallaMs: UMBRAL })], [sesion({ ultimaEsAt: AHORA - UMBRAL })])
  check('(3c) justo en el umbral: se hiberna', justo.hibernar.length === 1, veredicto(justo))
  const casi = decidir([proyecto({ fueraDePantallaMs: UMBRAL - 1 })], [sesion()])
  check('(3d) un milisegundo antes: no', casi.hibernar.length === 0 && casi.revisarEnMs === 1, `${veredicto(casi)} ${casi.revisarEnMs}`)
  const raros = [NaN, -5, Infinity].map((ms) => veredicto(decidir([proyecto({ fueraDePantallaMs: ms })], [sesion()])))
  check('(3e) un tiempo fuera de pantalla que no se entiende vale 0: nunca hiberna', raros.every((v) => v === 'reciente'), raros.join(','))
  const futuro = decidir([proyecto()], [sesion({ ultimaEsAt: AHORA + 5000 })])
  check('(3f) una E/S «del futuro» no da inactividad negativa ni hiberna', veredicto(futuro) === 'reciente' && futuro.revisarEnMs === UMBRAL, `${veredicto(futuro)} ${futuro.revisarEnMs}`)
}

hr('4. Todo o nada por proyecto')
{
  const dos = [sesion({ sessionId: 'cc' }), sesion({ sessionId: 'codex', ultimaEsAt: AHORA - 1000 })]
  const d = decidir([proyecto()], dos)
  check('(4a) dos agentes y uno reciente: no se hiberna ninguno', d.hibernar.length === 0 && veredicto(d) === 'reciente', veredicto(d))
  const conMuerta = decidir([proyecto()], [sesion({ sessionId: 'viva' }), sesion({ sessionId: 'muerta', viva: false, ultimaEsAt: AHORA })])
  check(
    '(4b) una viva callada y una muerta: se hibernan LAS DOS, y la muerta no cuenta como E/S',
    conMuerta.hibernar[0]?.sessionIds.join(',') === 'viva,muerta',
    JSON.stringify(conMuerta.hibernar)
  )
  const unoTrabaja = decidir([proyecto()], [sesion({ sessionId: 'a' }), sesion({ sessionId: 'b', segundoPlano: true })])
  check('(4c) uno con una tarea en segundo plano bloquea a los dos', unoTrabaja.hibernar.length === 0 && veredicto(unoTrabaja) === 'segundo-plano', veredicto(unoTrabaja))
}

hr('5. Lista blanca y varios proyectos')
{
  const sesiones = [
    sesion({ sessionId: 'a' }),
    sesion({ sessionId: 'b', projectHostPath: 'D:/b' }),
    sesion({ sessionId: 'datos', projectHostPath: 'D:/espacio-de-datos' }),
    sesion({ sessionId: 'otro-perfil', profileId: 'p2' })
  ]
  const d = decidir([proyecto(), proyecto({ projectHostPath: 'D:/b', enPantalla: true })], sesiones)
  check('(5a) solo cae el proyecto elegible', d.hibernar.length === 1 && d.hibernar[0].sessionIds.join() === 'a', JSON.stringify(d.hibernar))
  const tocadas = d.hibernar.flatMap((h) => h.sessionIds)
  check('(5b) una sesión cuyo proyecto no viene en la petición no se toca', !tocadas.includes('datos') && !tocadas.includes('otro-perfil'), tocadas.join(','))
  const repetido = decidir([proyecto(), proyecto()], [sesion()])
  check('(5c) un proyecto repetido en la petición se decide una vez', repetido.hibernar.length === 1 && repetido.veredictos.length === 1, String(repetido.veredictos.length))
  const mismoNombre = decidir([proyecto({ profileId: 'p2' })], [sesion()])
  check('(5d) misma ruta en otro perfil: es otro proyecto', mismoNombre.hibernar.length === 0 && veredicto(mismoNombre) === 'sin-sesion', veredicto(mismoNombre))
}

hr('6. revisarEnMs')
{
  const d = decidir(
    [proyecto({ fueraDePantallaMs: 100_000 }), proyecto({ projectHostPath: 'D:/b', fueraDePantallaMs: 250_000 }), proyecto({ projectHostPath: 'D:/c', enPantalla: true })],
    [sesion(), sesion({ sessionId: 'b', projectHostPath: 'D:/b' }), sesion({ sessionId: 'c', projectHostPath: 'D:/c' })]
  )
  check('(6a) es lo que le falta al más cercano al umbral', d.revisarEnMs === 50_000, String(d.revisarEnMs))
  const sinEspera = decidir([proyecto({ enPantalla: true })], [sesion()])
  check('(6b) sin ninguno en espera: null', sinEspera.revisarEnMs === null, String(sinEspera.revisarEnMs))
}

hr('7. Saneado de la petición')
{
  const s = sanearPeticion({
    minutos: 5,
    proyectos: [
      { profileId: 'p1', projectHostPath: 'D:/a', enPantalla: false, hibernado: false, sinRevisar: false, fueraDePantallaMs: 9 },
      { profileId: 7, projectHostPath: 'D:/b' },
      null,
      'texto',
      { profileId: 'p1', projectHostPath: 'D:/c' }
    ]
  })
  check('(7a) lo mal formado se descarta', s.proyectos.length === 2, s.proyectos.map((p) => p.projectHostPath).join(','))
  const c = s.proyectos[1]
  check(
    '(7b) lo que falta se rellena hacia NO hibernar',
    c.enPantalla === true && c.sinRevisar === true && c.hibernado === false && c.fueraDePantallaMs === 0,
    JSON.stringify(c)
  )
  const vacias = [null, undefined, 'x', 7, {}, { proyectos: 'no' }].map((r) => sanearPeticion(r).proyectos.length)
  check('(7c) una petición que no es un objeto, o sin lista: cero proyectos', vacias.every((n) => n === 0), vacias.join(','))
  const muchos = sanearPeticion({ minutos: 5, proyectos: Array.from({ length: 900 }, (_, i) => ({ profileId: 'p', projectHostPath: String(i) })) })
  check('(7d) hay un tope de proyectos por petición', muchos.proyectos.length === 500, String(muchos.proyectos.length))
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
