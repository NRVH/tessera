#!/usr/bin/env node
// =============================================================================
// Prueba de planAperturas (node src/renderer/src/features/pestanas/test-plan-aperturas.mts):
// qué se le manda al main al recoger «Abrir con Tessera» y qué se hace con cada
// apertura. Fija la defensa de seguridad del renderer: lo que ya está abierto se
// ACTIVA y nunca nace como proyecto nuevo (que es lo que fuerza el modo nativo).
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// =============================================================================

import { peticionTomar, planApertura } from './planAperturas.ts'
import type { AperturaResuelta, ProyectoAbierto } from '../../../../shared/shell-windows-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const abiertos: ProyectoAbierto[] = [
  { profileId: 'alfa', projectHostPath: 'C:\\p\\caja' },
  { profileId: 'beta', projectHostPath: 'C:\\p\\beta' },
  { profileId: 'beta', projectHostPath: 'C:\\p\\caja' }
]
/** Una apertura de archivo sobre `contenedora`, como la devuelve el main. */
function apertura(contenedora: string, profileIdExistente: string | null): AperturaResuelta {
  return {
    contenedora: { projectHostPath: contenedora, name: contenedora.split('\\').pop() ?? contenedora },
    profileIdExistente,
    archivo: { path: 'nota.txt', name: 'nota.txt' },
    revelar: 'nota.txt'
  }
}
const ver = (p: unknown): string => JSON.stringify(p)

hr('(1) peticionTomar: sin ajustes no se recoge; sin pestañas se recoge avisando')
{
  check(
    'sin ajustes: null, estén o no las pestañas',
    peticionTomar({ ajustesCargados: false, pestanasCargadas: true, abiertos }) === null &&
      peticionTomar({ ajustesCargados: false, pestanasCargadas: false, abiertos: [] }) === null,
    'null'
  )
  const antes = peticionTomar({ ajustesCargados: true, pestanasCargadas: false, abiertos: [] })
  check(
    'ajustes antes que pestañas: la petición dice que las pestañas FALTAN',
    antes !== null && antes.pestanasCargadas === false && antes.abiertos.length === 0,
    ver(antes)
  )
  const despues = peticionTomar({ ajustesCargados: true, pestanasCargadas: true, abiertos })
  check(
    'con las dos cosas: lleva los abiertos de TODOS los perfiles y lo dice',
    despues !== null && despues.pestanasCargadas === true && despues.abiertos.length === 3,
    ver(despues)
  )
  const conSobra = peticionTomar({
    ajustesCargados: true,
    pestanasCargadas: true,
    abiertos: [{ profileId: 'alfa', projectHostPath: 'C:\\p\\caja', name: 'caja' } as ProyectoAbierto]
  })
  check(
    'solo viajan perfil y ruta',
    ver(conSobra?.abiertos) === ver([{ profileId: 'alfa', projectHostPath: 'C:\\p\\caja' }]),
    ver(conSobra?.abiertos)
  )
}

hr('(2) El main señaló dónde está abierto: se activa ahí')
{
  const plan = planApertura(apertura('C:\\p\\beta', 'beta'), 'alfa', abiertos)
  check(
    'abierto en otro perfil: activar en ESE perfil, no en el activo',
    plan.tipo === 'activar' && plan.profileId === 'beta' && plan.projectHostPath === 'C:\\p\\beta',
    ver(plan)
  )
  const dos = planApertura(apertura('C:\\p\\caja', 'beta'), 'alfa', abiertos)
  check(
    'abierto en dos perfiles: gana el que señaló el main',
    dos.tipo === 'activar' && dos.profileId === 'beta',
    ver(dos)
  )
}

hr('(3) DEFENSA: el main lo dio por nuevo, pero el renderer lo ve abierto')
{
  const mismo = planApertura(apertura('C:\\p\\caja', null), 'alfa', abiertos)
  check(
    'abierto en el perfil activo: activar, nunca «nuevo»',
    mismo.tipo === 'activar' && mismo.profileId === 'alfa',
    ver(mismo)
  )
  const otro = planApertura(apertura('C:\\p\\beta', null), 'alfa', abiertos)
  check(
    'abierto solo en otro perfil: activar allí, nunca «nuevo»',
    otro.tipo === 'activar' && otro.profileId === 'beta',
    ver(otro)
  )
  const caja = planApertura(apertura('c:\\P\\CAJA', null), 'alfa', abiertos)
  check(
    'con otra caja: activar, y con la ruta YA abierta (no la del main)',
    caja.tipo === 'activar' && caja.projectHostPath === 'C:\\p\\caja',
    ver(caja)
  )
  const activoGana = planApertura(apertura('C:\\p\\caja', null), 'beta', abiertos)
  check(
    'abierto en dos perfiles sin señal del main: gana el activo',
    activoGana.tipo === 'activar' && activoGana.profileId === 'beta',
    ver(activoGana)
  )
}

hr('(4) Nuevo solo si no está abierto en ningún perfil')
{
  const nuevo = planApertura(apertura('C:\\p\\gamma', null), 'alfa', abiertos)
  check('no abierto: nuevo en el perfil activo', nuevo.tipo === 'nuevo' && nuevo.profileId === 'alfa', ver(nuevo))
  const parecido = planApertura(apertura('C:\\p\\caja2', null), 'alfa', abiertos)
  check('mitad negativa: C:\\p\\caja2 no cuenta como C:\\p\\caja', parecido.tipo === 'nuevo', ver(parecido))
  const hijo = planApertura(apertura('C:\\p\\caja\\repo', null), 'alfa', abiertos)
  check(
    'mitad negativa: una subcarpeta no es el proyecto (eso lo resuelve el main)',
    hijo.tipo === 'nuevo',
    ver(hijo)
  )
  // El main lo vio en lo persistido, pero ya no está (perfil borrado, proyecto cerrado).
  const huerfano = planApertura(apertura('C:\\p\\gamma', 'borrado'), 'alfa', abiertos)
  check(
    'señalado por el main pero ya no abierto: nuevo en el activo, no en el perfil fantasma',
    huerfano.tipo === 'nuevo' && huerfano.profileId === 'alfa',
    ver(huerfano)
  )
  const sinNada = planApertura(apertura('C:\\p\\caja', null), 'alfa', [])
  check('sin proyectos abiertos: nuevo', sinNada.tipo === 'nuevo', ver(sinNada))
}

hr('(5) Agente diferido: solo un proyecto que NACE para ver un archivo')
{
  const archivoNuevo = planApertura(apertura('C:\\p\\gamma', null), 'alfa', abiertos)
  check('archivo suelto en un proyecto nuevo: nace con el agente diferido', archivoNuevo.tipo === 'nuevo' && archivoNuevo.agenteDiferido === true, ver(archivoNuevo))
  const carpeta: AperturaResuelta = { ...apertura('C:\\p\\gamma', null), archivo: null, revelar: null }
  const carpetaNueva = planApertura(carpeta, 'alfa', abiertos)
  check('una CARPETA nueva: el agente arranca como siempre', carpetaNueva.tipo === 'nuevo' && carpetaNueva.agenteDiferido === false, ver(carpetaNueva))
  const revelada: AperturaResuelta = { ...apertura('C:\\p\\gamma', null), archivo: null, revelar: 'src' }
  const subcarpeta = planApertura(revelada, 'alfa', abiertos)
  check('una subcarpeta que solo se revela tampoco lo difiere', subcarpeta.tipo === 'nuevo' && subcarpeta.agenteDiferido === false, ver(subcarpeta))
  const existente = planApertura(apertura('C:\\p\\caja', 'alfa'), 'alfa', abiertos)
  check(
    'un archivo de un proyecto YA abierto: se activa y su agente no se toca',
    existente.tipo === 'activar' && !('agenteDiferido' in existente) && existente.quitarDiferido === false,
    ver(existente)
  )
  const carpetaAbierta: AperturaResuelta = { ...apertura('C:\\p\\caja', 'alfa'), archivo: null, revelar: null }
  const comoCarpeta = planApertura(carpetaAbierta, 'alfa', abiertos)
  check(
    'la CARPETA de un proyecto ya abierto: se activa y, si estaba diferido, deja de estarlo',
    comoCarpeta.tipo === 'activar' && comoCarpeta.quitarDiferido === true,
    ver(comoCarpeta)
  )
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
