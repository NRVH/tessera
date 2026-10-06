#!/usr/bin/env node
// =============================================================================
// Prueba de que el contexto de bases de datos sobrevive al `env -i` de la línea de
// arranque del agente en Docker (npm run test:entorno-bd-agente): lista blanca de
// variables, entrecomillado POSIX, asignaciones fuera del `bash -c`, la línea completa
// con `--resume` y briefing, la clave con espacio de nombres y el texto del aviso.
// Sin Docker: se comprueba la línea que se va a ejecutar, no su ejecución.
// Decisiones: docs/decisiones/agentes/sesion-linea-de-arranque.md
// =============================================================================

import { composeCleanGitCommand, dbAgentAssignments } from './gitInContainer.ts'
import { buildAgentLaunchCommand } from './lineaArranqueAgente.ts'
import {
  briefingBasesAgente,
  PRIMERA_LINEA_ESPACIO,
  PRIMERA_LINEA_PROYECTO,
  type ConexionAviso
} from '../db/briefingAgente.ts'
import {
  claveSesionAgente,
  ENV_BUZON,
  ENV_MODO,
  ENV_SESION,
  envVarSecreto
} from '../../shared/db-ipc.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

/** El entorno tal cual lo devuelve `DbController.entornoContenedor`. */
const ENTORNO = {
  [ENV_MODO]: 'pipe',
  [ENV_SESION]: 'a1b2c3d4e5f6a7b8',
  [ENV_BUZON]: '/agent-config/dbbridge'
}

hr('(1) Sin contexto: ninguna asignación')
{
  const sinNada = dbAgentAssignments(undefined)
  check('undefined -> []', sinNada.length === 0, JSON.stringify(sinNada))

  const vacio = dbAgentAssignments({})
  check('{} (puente sin levantar) -> []', vacio.length === 0, JSON.stringify(vacio))

  // `entornoContenedor` no devuelve claves vacías, pero un token vacío que llegara
  // por cualquier vía sería PEOR que su ausencia: `tdb` vería la variable definida.
  const hueco = dbAgentAssignments({ [ENV_SESION]: '', [ENV_MODO]: 'pipe' })
  check(
    'token vacío se omite (no define la variable a medias)',
    hueco.length === 1 && hueco[0] === `${ENV_MODO}='pipe'`,
    JSON.stringify(hueco)
  )
}

hr('(2) Entorno completo: las tres, en el orden declarado')
{
  const asignaciones = dbAgentAssignments(ENTORNO)
  check('son 3', asignaciones.length === 3, JSON.stringify(asignaciones))
  check(
    'orden = ENV_CONTENEDOR (modo, sesión, buzón)',
    asignaciones[0].startsWith(`${ENV_MODO}=`) &&
      asignaciones[1].startsWith(`${ENV_SESION}=`) &&
      asignaciones[2].startsWith(`${ENV_BUZON}=`),
    asignaciones.join(' ')
  )
  check(
    'el token viaja con su valor',
    asignaciones[1] === `${ENV_SESION}='a1b2c3d4e5f6a7b8'`,
    asignaciones[1]
  )
}

hr('(3) Lista blanca: lo demás NO cruza')
{
  const conRuido = dbAgentAssignments({
    ...ENTORNO,
    PATH: 'C:\\Users\\quien\\AppData\\Roaming\\Tessera\\bin\\s2',
    TESSERA_PROFILE: 'alfa',
    // Contrato ANTIGUO: la contraseña en una variable. Jamás puede cruzar.
    [envVarSecreto('f0411010-df44-4be8-a5ed-ef82b6c3911c')]: 'contraseña-en-claro'
  })
  check('siguen siendo 3', conRuido.length === 3, JSON.stringify(conRuido))
  const linea = conRuido.join(' ')
  check(
    'ni PATH de Windows, ni perfil, ni secreto',
    !linea.includes('AppData') && !linea.includes('TESSERA_PROFILE') && !linea.includes('claro'),
    linea
  )
}

hr('(4) Citado POSIX de valores hostiles')
{
  const conEspacio = dbAgentAssignments({ [ENV_BUZON]: '/agent-config/db bridge' })
  check(
    'un espacio no parte el comando',
    conEspacio[0] === `${ENV_BUZON}='/agent-config/db bridge'`,
    conEspacio[0]
  )

  const conComilla = dbAgentAssignments({ [ENV_SESION]: `a'b` })
  check(
    'la comilla simple se escapa',
    conComilla[0] === `${ENV_SESION}='a'\\''b'`,
    conComilla[0]
  )
}

hr('(5) La asignación queda FUERA del argumento citado de bash -c')
{
  const linea = composeCleanGitCommand('exec /usr/local/bin/claude', {
    agente: 'claude-code',
    containerConfigPath: '/agent-config/claude-code',
    prelude: false,
    extraAssignments: ['TERM=xterm-256color', ...dbAgentAssignments(ENTORNO)]
  })
  const corte = linea.indexOf('bash --noprofile --norc -c ')
  check('la línea tiene su bash -c', corte > 0, linea.slice(0, 60) + '…')

  const antes = linea.slice(0, corte)
  check(
    'el token está en las asignaciones de env -i, no dentro del comando',
    antes.includes(`${ENV_SESION}='a1b2c3d4e5f6a7b8'`),
    antes
  )
  check(
    'y el buzón también',
    antes.includes(`${ENV_BUZON}='/agent-config/dbbridge'`),
    antes
  )
  check(
    'sigue empezando por env -i (el aislamiento no se ha aflojado)',
    linea.startsWith('env -i PATH='),
    linea.slice(0, 40)
  )
}

hr('(6) Regresión: sin el entorno, el token NO llega')
{
  const sinBases = composeCleanGitCommand('exec /usr/local/bin/claude', {
    agente: 'claude-code',
    containerConfigPath: '/agent-config/claude-code',
    prelude: false,
    extraAssignments: ['TERM=xterm-256color', ...dbAgentAssignments(undefined)]
  })
  check(
    'sin contexto de bases la línea no menciona ninguna TESSERA_DB_*',
    !sinBases.includes('TESSERA_DB_'),
    sinBases.slice(0, 90) + '…'
  )
}

hr('(7) La línea completa del agente en contenedor')
{
  const BRIEFING = [
    'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.',
    "- ventas (oracle, srv-bd:1521 (SID ORCL), usuario app) — solo lectura"
  ].join('\n')
  const ID = '1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'

  const linea = buildAgentLaunchCommand(
    'claude',
    'claude-code',
    '/agent-config/claude-code',
    null,
    ID,
    ENTORNO,
    BRIEFING
  )
  check('el token va en la línea', linea.includes(`${ENV_SESION}='a1b2`), 'sí')
  check('reanuda la conversación', linea.includes(`--resume ${ID}`), `--resume ${ID}`)
  check(
    'el briefing viaja como --append-system-prompt',
    linea.includes('--append-system-prompt') && linea.includes('consultables con'),
    'sí'
  )
  check(
    'el briefing va en UNA línea (el argv atraviesa ConPTY)',
    !/--append-system-prompt[^\n]*\n[^\n]*solo lectura/.test(linea),
    'sin saltos dentro del argumento'
  )

  // Codex no tiene --append-system-prompt: el aviso le llega por `-c developer_instructions=…`.
  // Lo que NO puede pasar es que se le cuele el flag de CC.
  const codex = buildAgentLaunchCommand(
    'codex',
    'codex',
    '/agent-config/codex',
    null,
    ID,
    ENTORNO,
    BRIEFING
  )
  check(
    'a Codex no se le pasa un flag que no tiene, y sí su -c developer_instructions',
    !codex.includes('--append-system-prompt') && codex.includes('developer_instructions=Avisos de Tessera: ') && /exec codex resume \S+ -c /.test(codex),
    codex.slice(codex.indexOf('exec codex'), codex.indexOf('exec codex') + 80)
  )
  check('pero sí su subcomando resume', codex.includes(`resume ${ID}`), `resume ${ID}`)
  check('y su token', codex.includes(`${ENV_SESION}='a1b2`), 'sí')

  // Un id que no tiene forma de UUID se IGNORA (acaba dentro de un `sh -c`).
  const idMalo = buildAgentLaunchCommand(
    'claude',
    'claude-code',
    '/agent-config/claude-code',
    null,
    '; rm -rf /',
    ENTORNO
  )
  // OJO al comprobarlo: el preludio ssh lleva su propio `rm -rf ~/.ssh_active`, así
  // que buscar "rm -rf" a secas da un falso positivo. Se busca la carga EXACTA.
  check(
    'un id inventado no llega al shell',
    !idMalo.includes('; rm -rf /') && !idMalo.includes('--resume'),
    'ignorado'
  )

  // Sin bases: ni token ni briefing. Es el caso de un proyecto sin montajes.
  const pelada = buildAgentLaunchCommand('claude', 'claude-code', '/agent-config/claude-code')
  check(
    'sin bases: ni TESSERA_DB_* ni briefing',
    !pelada.includes('TESSERA_DB_') && !pelada.includes('--append-system-prompt'),
    'línea limpia'
  )
}

hr('(8) La clave del puente distingue agente de terminal')
{
  check(
    'la sesión del agente se namespacea',
    claveSesionAgente('term-alfa-1') === 'agent:term-alfa-1',
    claveSesionAgente('term-alfa-1')
  )
  // El caso REAL, tal cual sale en logs/db.log: las dos sesiones del perfil `personal`
  // se llaman `term-personal-1` porque cada TerminalService numera desde cero. Sin
  // namespacear, atar una revoca el token de la otra.
  check(
    'no colisiona con la terminal de abajo del mismo perfil',
    claveSesionAgente('term-personal-1') !== 'term-personal-1',
    `${claveSesionAgente('term-personal-1')} ≠ term-personal-1`
  )
}

hr('(9) El texto del aviso: proyecto sin cambios, espacio de datos sin «proyecto»')
{
  const CONEXIONES: ConexionAviso[] = [
    { alias: 'ventas', motor: 'oracle', host: 'srv-bd', port: 1521, sid: 'ORCL', user: 'app', readonly: true },
    { alias: 'pg', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: false }
  ]
  // El texto COMPLETO que `DbController.briefingParaAgente` producía antes de mover la
  // redacción a `briefingAgente.ts`, escrito a mano y no con el módulo: es la mitad
  // negativa del cambio (el espacio de datos no puede arrastrar a los proyectos).
  const ANTES = [
    'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.',
    'Al arrancar esta sesión eran:',
    '- ventas (oracle, srv-bd:1521 (SID ORCL), usuario app) — solo lectura',
    '- pg (postgres, localhost:5432/demo, usuario u)',
    '',
    'ESA LISTA PUEDE CAMBIAR durante la sesión (se montan y desmontan en caliente).',
    'Ejecuta `tdb ls` para ver las que hay AHORA antes de darla por buena.',
    '',
    'Comandos: `tdb ls`, `tdb schema <nombre>`, `tdb describe <nombre> <TABLA>`,',
    '`tdb query <nombre> "<SQL>"` (tope de filas; usa --limit N para ampliar).',
    'Para SQL largo o con comillas, porcentajes o saltos de línea, pásalo por la',
    'entrada estándar con un heredoc ENTRECOMILLADO, que no lo altera:',
    "  tdb query <nombre> --stdin <<'SQL'",
    '  SELECT ...',
    '  SQL',
    'Si algo falla y no sabes por qué, `tdb doctor` dice qué falta.',
    'No pidas al usuario URLs ni credenciales: ya las tienes. Las marcadas como solo',
    'lectura las impone el servidor, así que puedes explorar sin riesgo de escribir.',
    'Si hay varias, cuida de consultar la que corresponde: pueden ser entornos',
    'distintos (dev/QA/producción) de la misma aplicación.'
  ].join('\n')

  check(
    '(9a) sin conexiones no hay aviso, en ninguno de los dos sitios',
    briefingBasesAgente([], false) === null && briefingBasesAgente([], true) === null,
    'null / null'
  )

  const proyecto = briefingBasesAgente(CONEXIONES, false)
  check('(9b) en un PROYECTO el texto es idéntico al de antes', proyecto === ANTES, (proyecto ?? '').split('\n')[0])
  check(
    '(9c) y su primera línea es la que usan de muestra (7) y test-linea-arranque-agente',
    PRIMERA_LINEA_PROYECTO === 'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.',
    PRIMERA_LINEA_PROYECTO
  )

  const espacio = briefingBasesAgente(CONEXIONES, true) ?? ''
  const [primera, ...resto] = espacio.split('\n')
  check(
    '(9d) en el ESPACIO DE DATOS la primera línea nombra al agente de datos',
    primera === PRIMERA_LINEA_ESPACIO && primera.includes('agente de datos'),
    primera
  )
  check('(9e) y ninguna línea dice «proyecto»', !/proyecto/i.test(espacio), espacio.split('\n').find((l) => /proyecto/i.test(l)) ?? 'ninguna')
  check(
    '(9f) el resto del aviso es el mismo que en un proyecto',
    resto.join('\n') === ANTES.split('\n').slice(1).join('\n'),
    `${resto.length} líneas`
  )

  // Y es ESE texto el que viaja en la línea de arranque del espacio (modo nativo en
  // producción; aquí la del contenedor, que es la que este test ya sabe leer).
  const linea = buildAgentLaunchCommand('claude', 'claude-code', '/agent-config/claude-code', null, undefined, ENTORNO, espacio)
  check(
    '(9g) la línea de arranque del espacio lleva el aviso nuevo, sin «este proyecto»',
    linea.includes('Como agente de datos del perfil') && !linea.includes('este proyecto'),
    'sí'
  )
}

hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const allPass = results.every((r) => r.pass)
hr(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
