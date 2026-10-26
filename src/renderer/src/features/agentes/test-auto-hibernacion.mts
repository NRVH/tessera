#!/usr/bin/env node
// =============================================================================
// Prueba de las reglas del orquestador de la hibernación por inactividad
// (npm run test:auto-hibernacion): qué está en pantalla, la hora a la que deja de verse cada
// proyecto, la petición de la ronda, la carrera con un clic, la espera y el aviso.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import {
  apuntarSalidas,
  avisoPocaMemoria,
  claveProyecto,
  construirPeticion,
  etiquetasHibernados,
  planAplicacion,
  proyectosEnPantalla,
  siguienteEsperaMs,
  type ProyectoAbierto,
  type TargetAbierto
} from './autoHibernacion.ts'

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

const target = (profileId: string, ruta: string, agente: string): TargetAbierto => ({
  key: `${profileId}|${ruta}|${agente}`,
  profileId,
  projectHostPath: ruta
})
const TARGETS = [target('p1', 'D:/a', 'claude-code'), target('p1', 'D:/a', 'codex'), target('p1', 'D:/b', 'claude-code'), target('p2', 'D:/c', 'claude-code')]
const PROYECTOS: ProyectoAbierto[] = [
  { profileId: 'p1', projectHostPath: 'D:/a', name: 'a', estado: 'active' },
  { profileId: 'p1', projectHostPath: 'D:/b', name: 'b', estado: 'active' },
  { profileId: 'p2', projectHostPath: 'D:/c', name: 'c', estado: 'hibernated' }
]
const A = claveProyecto('p1', 'D:/a')
const B = claveProyecto('p1', 'D:/b')
const C = claveProyecto('p2', 'D:/c')
const lista = (s: ReadonlySet<string>): string => [...s].sort().join(' ')

hr('1. Qué está en pantalla')
{
  const base = { activo: { profileId: 'p1', projectHostPath: 'D:/a' }, confirmado: null, mosaicoActivo: false, teselas: [], targets: TARGETS }
  check('(1a) el proyecto activo', lista(proyectosEnPantalla(base)) === A, lista(proyectosEnPantalla(base)))
  const dos = proyectosEnPantalla({ ...base, confirmado: { profileId: 'p1', projectHostPath: 'D:/b' } })
  check('(1b) el activo y el confirmado, cuando van desparejados', dos.has(A) && dos.has(B) && dos.size === 2, lista(dos))
  const sinMosaico = proyectosEnPantalla({ ...base, teselas: [TARGETS[3].key] })
  check('(1c) las casillas NO cuentan con el mosaico cerrado', !sinMosaico.has(C), lista(sinMosaico))
  const conMosaico = proyectosEnPantalla({ ...base, mosaicoActivo: true, teselas: [TARGETS[3].key, 'clave-de-un-target-cerrado'] })
  check('(1d) con el mosaico abierto, el proyecto de cada casilla', conMosaico.has(C) && conMosaico.has(A) && conMosaico.size === 2, lista(conMosaico))
  const nada = proyectosEnPantalla({ ...base, activo: null })
  check('(1e) sin proyecto activo, nada', nada.size === 0, String(nada.size))
  check('(1f) misma ruta en otro perfil: otra clave', claveProyecto('p1', 'D:/a') !== claveProyecto('p2', 'D:/a'), 'distintas')
}

hr('2. Cuándo deja de verse cada proyecto')
{
  const dejo = new Map<string, number>()
  apuntarSalidas(dejo, new Set([A]), new Set([B]), 1000)
  check('(2a) el que sale de pantalla apunta la hora', dejo.get(A) === 1000 && !dejo.has(B), JSON.stringify([...dejo]))
  apuntarSalidas(dejo, new Set([B]), new Set([A, B]), 2000)
  check('(2b) el que entra, o el que sigue, no apunta nada', dejo.get(A) === 1000 && !dejo.has(B), JSON.stringify([...dejo]))
  apuntarSalidas(dejo, new Set([A, B]), new Set([B]), 3000)
  check('(2c) una visita corta entre dos rondas renueva su hora', dejo.get(A) === 3000, String(dejo.get(A)))
}

hr('3. La petición de la ronda')
{
  const req = construirPeticion({
    minutos: 5,
    proyectos: PROYECTOS,
    targets: TARGETS,
    enPantalla: new Set([A]),
    unseen: new Set([TARGETS[2].key]),
    dejoDeVerse: new Map([[B, 4000]]),
    ahora: 10_000,
    montadoEn: 1000
  })
  const [a, b, c] = req.proyectos
  check('(3a) un proyecto por cada abierto, y el ajuste tal cual', req.proyectos.length === 3 && req.minutos === 5, String(req.proyectos.length))
  check('(3b) el activo va en pantalla', a.enPantalla && !b.enPantalla && !c.enPantalla, `${a.enPantalla} ${b.enPantalla} ${c.enPantalla}`)
  check('(3c) sin revisar si ALGUNO de sus agentes tiene algo sin ver', !a.sinRevisar && b.sinRevisar && !c.sinRevisar, `${a.sinRevisar} ${b.sinRevisar} ${c.sinRevisar}`)
  check('(3d) hibernado con cualquiera de los dos estados', !a.hibernado && c.hibernado, `${a.hibernado} ${c.hibernado}`)
  check('(3e) fuera de pantalla desde que dejó de verse', b.fueraDePantallaMs === 6000, String(b.fueraDePantallaMs))
  check('(3f) el que nunca se vio cuenta desde que arrancó el orquestador', c.fueraDePantallaMs === 9000, String(c.fueraDePantallaMs))
  const dormido = construirPeticion({ minutos: 5, proyectos: [{ ...PROYECTOS[0], estado: 'agente-hibernado' }], targets: [], enPantalla: new Set(), unseen: new Set(), dejoDeVerse: new Map([[A, 99_999]]), ahora: 10, montadoEn: 0 })
  check('(3g) «agente-hibernado» también es hibernado, y un reloj adelantado no da tiempo negativo', dormido.proyectos[0].hibernado && dormido.proyectos[0].fueraDePantallaMs === 0, JSON.stringify(dormido.proyectos[0]))
}

hr('4. Aplicar la respuesta: la carrera con un clic')
{
  const hib = (profileId: string, ruta: string) => ({ profileId, projectHostPath: ruta, sesiones: [{ sessionId: `s-${ruta}`, agente: 'claude-code' as const }] })
  const resultado = { hibernados: [hib('p1', 'D:/a'), hib('p1', 'D:/b')], revisarEnMs: null, umbralMs: 300_000, pocaMemoria: false }
  const pasos = planAplicacion(resultado, new Set([B]))
  check('(4a) el que sigue fuera de pantalla solo se marca', pasos[0].despertar === false, String(pasos[0].despertar))
  check('(4b) el que el usuario abrió mientras viajaba la petición se marca Y se despierta', pasos[1].despertar === true, String(pasos[1].despertar))
  check('(4c) sin nada hibernado, ningún paso', planAplicacion({ hibernados: [], revisarEnMs: 5, umbralMs: 1, pocaMemoria: false }, new Set()).length === 0, '0')
}

hr('5. La espera hasta la siguiente ronda')
{
  check('(5a) lo que pide el main', siguienteEsperaMs(42_000, 300_000) === 42_000, String(siguienteEsperaMs(42_000, 300_000)))
  check('(5b) nunca menos de un segundo', siguienteEsperaMs(3, 300_000) === 1000 && siguienteEsperaMs(-50, 300_000) === 1000, String(siguienteEsperaMs(3, 300_000)))
  check('(5c) nunca más de un minuto', siguienteEsperaMs(280_000, 300_000) === 60_000, String(siguienteEsperaMs(280_000, 300_000)))
  check('(5d) sin nadie en espera: el umbral, acotado', siguienteEsperaMs(null, 300_000) === 60_000 && siguienteEsperaMs(null, 3000) === 3000, `${siguienteEsperaMs(null, 300_000)} ${siguienteEsperaMs(null, 3000)}`)
  check('(5e) sin umbral conocido («Nunca»): un minuto', siguienteEsperaMs(null, null) === 60_000, String(siguienteEsperaMs(null, null)))
  check('(5f) tras un fallo: un minuto, pida lo que pida', siguienteEsperaMs(1000, 3000, true) === 60_000, String(siguienteEsperaMs(1000, 3000, true)))
  check('(5g) un valor que no es un número: un minuto', siguienteEsperaMs(NaN, 3000) === 60_000, String(siguienteEsperaMs(NaN, 3000)))
}

hr('6. El aviso de poca memoria: una vez por racha')
{
  const a = avisoPocaMemoria(true, false)
  check('(6a) al entrar en poca memoria, avisa', a.avisar && a.avisado, JSON.stringify(a))
  const b = avisoPocaMemoria(true, a.avisado)
  check('(6b) en las rondas siguientes de la misma racha, no', !b.avisar && b.avisado, JSON.stringify(b))
  const c = avisoPocaMemoria(false, b.avisado)
  check('(6c) al recuperarse, se rearma sin avisar', !c.avisar && !c.avisado, JSON.stringify(c))
  check('(6d) y en una racha nueva vuelve a avisar', avisoPocaMemoria(true, c.avisado).avisar, '')
}

hr('7. Nombrar lo que se paró por el límite')
{
  const sesion = (agente: 'claude-code' | 'codex') => ({ sessionId: `s-${agente}`, agente })
  const etiqueta = (a: 'claude-code' | 'codex'): string => (a === 'codex' ? 'Codex' : 'Claude Code')
  const hibernados = [
    { profileId: 'p1', projectHostPath: 'D:\\trabajo\\api', sesiones: [sesion('codex')] },
    { profileId: 'p1', projectHostPath: '/home/u/web', sesiones: [sesion('claude-code'), sesion('codex'), sesion('codex')] },
    { profileId: 'p1', projectHostPath: 'D:\\trabajo\\vacio', sesiones: [] }
  ]
  const nombres = etiquetasHibernados(hibernados, (_p, ruta) => (ruta.endsWith('web') ? 'Sitio' : undefined), etiqueta)
  check('(7a) sin nombre conocido, la carpeta (con ambos separadores)', nombres[0] === 'api · Codex', nombres[0])
  check('(7b) con nombre conocido, ese; los agentes sin repetir', nombres[1] === 'Sitio · Claude Code, Codex', nombres[1])
  check('(7c) sin sesiones, solo el proyecto', nombres[2] === 'vacio', nombres[2])
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
