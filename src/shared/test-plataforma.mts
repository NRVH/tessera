#!/usr/bin/env node
// =============================================================================
// Prueba de plataforma (npm run test:plataforma): el vocabulario de SO, con el cajón
// `'otra'` (Linux/BSD) para que arrancar ahí no caiga por la rama de Windows, y las
// CAPACIDADES que la UI consulta para no ofrecer botones que no puede cumplir, una a
// una y desde cualquier plataforma (`capacidadesDe` es pura). La lista de campos va
// fijada a mano: añadir una capacidad obliga a editar este test y nombrar quién la lee.
// =============================================================================

import { capacidadesDe, plataformaDe } from './plataforma.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Traducción de process.platform')
  // -------------------------------------------------------------------------
  const traducciones: [string, string][] = [
    ['win32', 'windows'],
    ['darwin', 'mac'],
    ['linux', 'otra'],
    ['freebsd', 'otra'],
    // Nada de lanzar ante un valor desconocido: un `process.platform` que no
    // reconocemos tiene que degradar a la rama POSIX, no tumbar el arranque.
    ['loquesea', 'otra']
  ]
  for (const [entrada, esperado] of traducciones) {
    check(`(1) ${entrada} -> ${esperado}`, plataformaDe(entrada) === esperado, plataformaDe(entrada))
  }

  // -------------------------------------------------------------------------
  hr('(2) Capacidades: integración con el gestor de archivos EN CALIENTE')
  // -------------------------------------------------------------------------
  // La capacidad dice "hay un INTERRUPTOR", no "aquí se puede abrir una carpeta desde
  // el gestor de archivos" (eso pasa en las dos y en Mac ni siquiera es conmutable).
  //
  // Windows: claves en HKCU que `reg.exe` escribe y borra sin reinstalar ni UAC.
  // macOS: un bundle `.workflow` en `~/Library/Services` que pone la entrada en el
  // submenú «Servicios»/«Acciones rápidas» del Finder — HOME del usuario, sin
  // administrador, y `pbs -flush` lo refresca en el acto (`main/shell/servicioFinder.ts`).
  // Estuvo en `false` por mirar el mecanismo equivocado: es verdad que
  // `CFBundleDocumentTypes` se declara al EMPAQUETAR, pero ése no es el único camino.
  check(
    '(2a) Windows sí (registro en caliente)',
    capacidadesDe('windows').integracionShellEnCaliente,
    'true'
  )
  check(
    '(2b) macOS sí (Quick Action en ~/Library/Services)',
    capacidadesDe('mac').integracionShellEnCaliente,
    'true'
  )
  // Linux/BSD: el menú contextual lo pone el escritorio (Nautilus, Dolphin, Thunar…),
  // cada uno con su formato, y ninguno está escrito.
  check('(2c) otras, no', !capacidadesDe('otra').integracionShellEnCaliente, 'false')

  // -------------------------------------------------------------------------
  hr('(3) Capacidades: auto-instalar una actualización')
  // -------------------------------------------------------------------------
  // Windows con NSIS; macOS con el relevo propio de `main/update/relevoMac.ts`, sin
  // Squirrel.Mac (con firma ad-hoc su requisito designado es el cdhash del binario y no
  // puede aceptar nunca el paquete nuevo); sustituir un `.app` es renombrar una carpeta.
  // ESTA CAPACIDAD HABLA DE LA PLATAFORMA, NO DE LA COPIA: si este `.app` no está en un
  // sitio escribible se pregunta en el momento (`sePuedeEscribirEnElBundle`) y el ciclo
  // se queda en `status:'available'` con descarga manual. Por eso `mac` es `true`.
  check('(3a) Windows sí (NSIS)', capacidadesDe('windows').autoInstalarUpdate, 'true')
  check('(3b) macOS sí (relevo propio, sin Squirrel)', capacidadesDe('mac').autoInstalarUpdate, 'true')
  check(
    '(3c) Linux/BSD no: ni instalador ni bundle que renombrar',
    !capacidadesDe('otra').autoInstalarUpdate,
    'false'
  )

  // -------------------------------------------------------------------------
  hr('(4) El interface no crece en silencio (lista de campos fijada a mano)')
  // -------------------------------------------------------------------------
  // Esto es un ALAMBRE-TRAMPA, no una verificación de lectores: compara los campos
  // que devuelve `capacidadesDe` contra una lista escrita a mano, y desde un test
  // puro no hay forma de comprobar que alguna superficie los lea. Lo que compra es
  // que añadir una capacidad OBLIGUE a pasar por aquí y a preguntarse quién la lee;
  // si nadie, no es una capacidad (ver la cabecera de `CapacidadesPlataforma` y el
  // descarte de `portapapelesDeArchivos` que cuenta).
  const esperados = ['autoInstalarUpdate', 'integracionShellEnCaliente']
  for (const plataforma of ['windows', 'mac', 'otra'] as const) {
    const campos = Object.keys(capacidadesDe(plataforma)).sort()
    check(
      `(4) ${plataforma}: el interface no ha crecido sin pasar por aquí (lista fijada a mano)`,
      JSON.stringify(campos) === JSON.stringify(esperados),
      campos.join(', ')
    )
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
