#!/usr/bin/env node
// =============================================================================
// Prueba de la hibernación coherente de los targets que no son pestaña (`hibernacionFueraDePestanas.ts`;
// npm run test:hibernacion-fuera-de-pestanas): al empezar a hibernarse un perfil se marcan su agente de
// datos y su agente de la terminal (y solo los suyos), repetir no vuelve a marcar, el que se empieza a
// mirar despierta, los cerrados se olvidan y la columna ve la unión con los de las pestañas. Con el camino
// real en miniatura, que es el fallo que arregla: antes el agente de datos se quedaba muerto sin aviso.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import type { OpenAgentTarget } from '../pestanas'
import {
  despertarAlVerse,
  marcarAlHibernar,
  podarMarcas,
  puedeDespertarseAMano,
  unirHibernados
} from './hibernacionFueraDePestanas.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: Iterable<string>): string => JSON.stringify([...v].sort())

function target(profileId: string, ruta: string, agente: OpenAgentTarget['agente'] = 'claude-code'): OpenAgentTarget {
  return { profileId, projectHostPath: ruta, agente, key: `${profileId}|${ruta}|${agente}` }
}

const DATOS_ALFA = target('alfa', 'U:/conexiones/alfa')
const DATOS_ALFA_CODEX = target('alfa', 'U:/conexiones/alfa', 'codex')
const TERMINAL_ALFA = target('alfa', 'U:/terminal/alfa')
const TERMINAL_BETA = target('beta', 'U:/terminal/beta')
const FUERA = [DATOS_ALFA, DATOS_ALFA_CODEX, TERMINAL_ALFA, TERMINAL_BETA]
const NADA: ReadonlySet<string> = new Set()

hr('(1) Marcar al EMPEZAR a hibernarse un perfil')
{
  const marcados = marcarAlHibernar(NADA, NADA, new Set(['alfa']), FUERA)
  check(
    'se marcan TODOS los targets que no son pestaña de alfa (datos con sus dos agentes y terminal), y ninguno de beta',
    j(marcados) === j([DATOS_ALFA.key, DATOS_ALFA_CODEX.key, TERMINAL_ALFA.key]),
    j(marcados)
  )
  check(
    'repetir con el mismo `hibernando` no marca nada (no vuelve a hibernar uno ya despertado)',
    marcarAlHibernar(NADA, new Set(['alfa']), new Set(['alfa']), FUERA) === NADA,
    'mismo conjunto'
  )
  check('cuando la hibernación termina (sale de `hibernando`) tampoco', marcarAlHibernar(NADA, new Set(['alfa']), NADA, FUERA) === NADA, 'mismo conjunto')
  const yaMarcados = new Set([DATOS_ALFA.key, DATOS_ALFA_CODEX.key, TERMINAL_ALFA.key])
  check(
    'si ya estaban todos marcados, el MISMO conjunto (no repinta)',
    marcarAlHibernar(yaMarcados, NADA, new Set(['alfa']), FUERA) === yaMarcados,
    'misma referencia'
  )
  const dos = marcarAlHibernar(NADA, NADA, new Set(['alfa', 'beta']), FUERA)
  check('dos perfiles a la vez: los de los dos', dos.size === 4, j(dos))
}

hr('(2) Despertar al verse, perezoso')
{
  const marcados = new Set([DATOS_ALFA.key, TERMINAL_ALFA.key])
  const trasVer = despertarAlVerse(marcados, TERMINAL_ALFA.key)
  check('el que se empieza a mirar deja de estar marcado; el otro sigue', j(trasVer) === j([DATOS_ALFA.key]), j(trasVer))
  check(
    'mirar otro (o nada) no cambia el conjunto',
    despertarAlVerse(marcados, 'alfa|D:/proyecto|claude-code') === marcados && despertarAlVerse(marcados, null) === marcados,
    'misma referencia'
  )
}

hr('(3) Podar los cerrados y unir con las pestañas')
{
  const marcados = new Set([DATOS_ALFA.key, TERMINAL_ALFA.key])
  const sinTerminal = podarMarcas(marcados, [DATOS_ALFA, DATOS_ALFA_CODEX])
  check('cerrar el agente de la terminal olvida su marca', j(sinTerminal) === j([DATOS_ALFA.key]), j(sinTerminal))
  check('con todos abiertos, el MISMO conjunto', podarMarcas(marcados, FUERA) === marcados && podarMarcas(NADA, []) === NADA, 'misma referencia')
  const dePestanas = new Set(['alfa|D:/proyecto|claude-code'])
  check('sin marcas, la columna ve el conjunto de las pestañas tal cual', unirHibernados(dePestanas, NADA) === dePestanas, 'misma referencia')
  check(
    'con marcas, la unión',
    j(unirHibernados(dePestanas, marcados)) === j([...dePestanas, ...marcados]),
    j(unirHibernados(dePestanas, marcados))
  )
}

hr('(4) El camino real: hibernar el perfil mirando su agente de datos (el fallo de antes)')
{
  // Antes: el modelo de pestañas marcaba solo los proyectos, y el pane del agente de datos se quedaba
  // con una sesión que el main ya había cerrado, sin aviso. Ahora:
  let marcados: ReadonlySet<string> = NADA
  let hibernando: ReadonlySet<string> = NADA
  let vista: string | null = DATOS_ALFA.key
  const pasar = (h: ReadonlySet<string>): void => {
    marcados = marcarAlHibernar(marcados, hibernando, h, FUERA)
    hibernando = h
  }
  const mirar = (clave: string | null): void => {
    if (clave === vista) return // el efecto solo corre cuando CAMBIA lo que se mira
    vista = clave
    marcados = despertarAlVerse(marcados, clave)
  }
  pasar(new Set(['alfa']))
  const alHibernar = marcados.has(DATOS_ALFA.key)
  pasar(NADA) // el main terminó
  const sigueMirandolo = marcados.has(DATOS_ALFA.key)
  mirar('alfa|D:/proyecto|claude-code')
  const alIrse = marcados.has(DATOS_ALFA.key)
  mirar(DATOS_ALFA.key)
  const alVolver = marcados.has(DATOS_ALFA.key)
  check(
    'se marca al hibernar aunque se esté mirando, sigue dormido mientras se mira, y despierta al volver a él',
    alHibernar && sigueMirandolo && alIrse && !alVolver,
    JSON.stringify({ alHibernar, sigueMirandolo, alIrse, alVolver })
  )
  check('el agente de la terminal de alfa, que no se miró, sigue marcado hasta verse', marcados.has(TERMINAL_ALFA.key), j(marcados))
}

hr('(5) Hibernar con el agente de la terminal A LA VISTA: el gesto visible es «Despertar» de su pie (E1)')
{
  // Mientras se mira no hay cambio de `claveVista` que lo despierte; su pie ofrece «Despertar» en
  // cuanto el perfil termina de hibernarse, y pulsarlo lo desmarca.
  const marcados = marcarAlHibernar(NADA, NADA, new Set(['alfa']), FUERA)
  check(
    'mientras el perfil aún se hiberna, NO se ofrece (el main sigue cerrando lo suyo)',
    !puedeDespertarseAMano('terminal', marcados.has(TERMINAL_ALFA.key), true),
    'perfil hibernando'
  )
  check(
    'terminada la hibernación, el agente de la terminal y el de datos lo ofrecen',
    puedeDespertarseAMano('terminal', marcados.has(TERMINAL_ALFA.key), false) && puedeDespertarseAMano('datos', marcados.has(DATOS_ALFA.key), false),
    'terminal y datos'
  )
  check(
    'NEGATIVO: ni un proyecto (lo despierta el clic en su pestaña) ni uno que no está hibernado',
    !puedeDespertarseAMano('proyecto', true, false) && !puedeDespertarseAMano('terminal', false, false),
    'proyecto / sin hibernar'
  )
  const trasDespertar = despertarAlVerse(marcados, TERMINAL_ALFA.key)
  check(
    'pulsarlo desmarca SOLO el suyo: el agente de datos de alfa sigue dormido',
    !trasDespertar.has(TERMINAL_ALFA.key) && trasDespertar.has(DATOS_ALFA.key) && trasDespertar.has(DATOS_ALFA_CODEX.key),
    j(trasDespertar)
  )
}

hr('RESULTADO')
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
