#!/usr/bin/env node
// =============================================================================
// Prueba de las decisiones del grupo en la barra de tareas de las ventanas de agente y de franja
// (node src/main/app/test-grupos-barra-tareas.mts): identificadores distintos, icono por plataforma
// y qué ejecuta una entrada anclada. Puro.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md, docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { ARGUMENTO_VENTANA_AGENTE } from '../../shared/ventana-agente-ipc.ts'
import { archivoIconoDeGrupo, comandoDeRelanzamiento, idModeloDeFranja, idModeloDeGrupo } from './gruposBarraTareasPuro.ts'

let total = 0
let aciertos = 0

function hr(titulo: string): void {
  console.log(`\n=== ${titulo} ===`)
}

function check(nombre: string, pasa: boolean): void {
  total++
  if (pasa) aciertos++
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre}`)
}

const EXE = 'C:\\Programas\\Tessera\\Tessera.exe'

hr('Identificadores')
const ids = [idModeloDeGrupo('agente', true), idModeloDeGrupo('franja', true), 'com.noe.tessera']
check('el grupo de agente conserva su identificador', ids[0] === 'com.noe.tessera.agente')
check('el de franja es propio y distinto del de Tessera y del de agente', ids[1] === 'com.noe.tessera.franja' && new Set(ids).size === 3)
check('en desarrollo cada uno lleva su `.dev` y no se mezcla con el instalado',
  idModeloDeGrupo('agente', false) === 'com.noe.tessera.dev.agente' && idModeloDeGrupo('franja', false) === 'com.noe.tessera.dev.franja')

const perfil = 'perfil de prueba'
const idFranja = idModeloDeFranja(perfil, true)
check('cada perfil tiene un identificador estable y distinto', idFranja === idModeloDeFranja(perfil, true)
  && new Set([idFranja, idModeloDeFranja('segundo', true), idModeloDeFranja('tercero', true)]).size === 3)
check('el identificador de franja es corto y solo revela el sufijo hexadecimal',
  /^com\.noe\.tessera\.franja\.[0-9a-f]{16}$/.test(idFranja) && idFranja.length < 128 && !idFranja.includes(perfil))
check('el perfil conserva el sufijo en desarrollo con el prefijo de desarrollo',
  idModeloDeFranja(perfil, false) === idFranja.replace('.franja.', '.dev.franja.'))

hr('Icono por plataforma')
check('Windows pinta un .ico suelto por grupo',
  archivoIconoDeGrupo('agente', 'windows') === 'tessera-agente.ico' && archivoIconoDeGrupo('franja', 'windows') === 'tessera-franja.ico')
check('Linux usa un .png por grupo',
  archivoIconoDeGrupo('agente', 'linux') === 'tessera-agente.png' && archivoIconoDeGrupo('franja', 'linux') === 'tessera-franja.png')
check('macOS no cambia el icono: un solo icono en el Dock', archivoIconoDeGrupo('franja', 'mac') === null && archivoIconoDeGrupo('agente', 'mac') === null)
check('otra plataforma tampoco', archivoIconoDeGrupo('franja', 'otra') === null)

hr('Entrada anclada')
check('la de agente abre otra ventana de agente',
  comandoDeRelanzamiento(EXE, { argumento: ARGUMENTO_VENTANA_AGENTE, nombre: 'x' }, true) === `"${EXE}" ${ARGUMENTO_VENTANA_AGENTE}`)
check('la de franja abre Tessera sin argumentos: una ventana de franja sola no tendría qué mostrar',
  comandoDeRelanzamiento(EXE, { argumento: null, nombre: 'Tessera' }, true) === `"${EXE}"`)
check('en desarrollo no hay relanzamiento: el ejecutable es el de Electron',
  comandoDeRelanzamiento(EXE, { argumento: null, nombre: 'Tessera' }, false) === null
  && comandoDeRelanzamiento(EXE, { argumento: ARGUMENTO_VENTANA_AGENTE, nombre: 'x' }, false) === null)

console.log(`\nVEREDICTO: ${aciertos}/${total} PASS`)
process.exit(aciertos === total ? 0 : 1)
