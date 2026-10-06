#!/usr/bin/env node
// =============================================================================
// Prueba de textosMontajeBases: qué dicen el selector «Bases montadas» y el historial en el
// agente de un proyecto, en el del espacio de datos y en el de la terminal.
// (node src/renderer/src/features/agentes/test-textos-montaje-bases.mts)
// En un proyecto y en el espacio, los literales de siempre carácter a carácter (M1-M6, M9-M12);
// en la terminal, «el agente de la terminal» sin la carpeta (M13-M16); ningún texto nombra el
// sistema (M8), así que no hay plataforma que parametrizar.
// =============================================================================

import {
  lugarHistorial,
  rotuloHistorialConversaciones,
  textosMontajeBases,
  type LugarAgente
} from './textosMontajeBases.ts'

/** Los tres sitios donde vive un agente. */
const LUGARES: readonly LugarAgente[] = ['proyecto', 'datos', 'terminal']

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

/** Nombres de sistema que ningún texto visible puede escribir a mano. */
const PROHIBIDOS = ['Windows', 'macOS', 'Finder', 'PowerShell', 'Explorador', 'DPAPI', 'Llavero']

function main(): void {
  hr('Agente de un PROYECTO: los textos de siempre')
  {
    const t = textosMontajeBases('proyecto', 0)
    check('(M1) título del popover sin cambios', t.titulo === 'Bases montadas en este proyecto', t.titulo)
    check(
      '(M2) rótulo del botón sin nada montado sin cambios',
      t.rotuloBoton === 'Montar bases de datos en este proyecto',
      t.rotuloBoton
    )
  }
  {
    const uno = textosMontajeBases('proyecto', 1).rotuloBoton
    const tres = textosMontajeBases('proyecto', 3).rotuloBoton
    check(
      '(M3) rótulo del botón con bases montadas sin cambios',
      uno === '1 base(s) montada(s) en este proyecto' && tres === '3 base(s) montada(s) en este proyecto',
      `${uno} | ${tres}`
    )
  }

  hr('Agente del ESPACIO DE DATOS (vista Bases de datos)')
  {
    const t = textosMontajeBases('datos', 0)
    check('(M4) título del popover: «en el agente de datos»', t.titulo === 'Bases montadas en el agente de datos', t.titulo)
    check(
      '(M5) rótulo del botón sin nada montado',
      t.rotuloBoton === 'Montar bases de datos en el agente de datos',
      t.rotuloBoton
    )
  }
  {
    const dos = textosMontajeBases('datos', 2).rotuloBoton
    check('(M6) rótulo del botón con bases montadas', dos === '2 base(s) montada(s) en el agente de datos', dos)
  }
  {
    const todos = [0, 1, 5].flatMap((n) => {
      const t = textosMontajeBases('datos', n)
      return [t.titulo, t.rotuloBoton]
    })
    const malos = todos.filter((s) => /proyecto|consola/i.test(s))
    check(
      '(M7) en el espacio ningún texto dice «proyecto» ni «consola»',
      malos.length === 0,
      malos[0] ?? `textos=${todos.length}`
    )
  }

  hr('Agente de la TERMINAL (a pantalla completa de la terminal)')
  {
    const t = textosMontajeBases('terminal', 0)
    const dos = textosMontajeBases('terminal', 2).rotuloBoton
    check(
      '(M13) el selector dice «en el agente de la terminal»',
      t.titulo === 'Bases montadas en el agente de la terminal' &&
        t.rotuloBoton === 'Montar bases de datos en el agente de la terminal' &&
        dos === '2 base(s) montada(s) en el agente de la terminal',
      `${t.titulo} | ${t.rotuloBoton} | ${dos}`
    )
    const historial = rotuloHistorialConversaciones('terminal')
    check(
      '(M14) el historial, «del agente de la terminal»',
      historial === 'Historial de conversaciones del agente de la terminal',
      historial
    )
    const lugar = lugarHistorial('terminal', 'C:\\Users\\u\\AppData\\Roaming\\Tessera\\terminal\\a1b2c3d4')
    check(
      '(M15) el modal: «agente de la terminal», nunca la carpeta (el ID del perfil)',
      lugar.cabecera === 'agente de la terminal' &&
        lugar.enVacio === 'en el agente de la terminal' &&
        !JSON.stringify(lugar).includes('a1b2c3d4'),
      JSON.stringify(lugar)
    )
    const todos = [t.titulo, t.rotuloBoton, dos, historial, lugar.cabecera, lugar.enVacio]
    check(
      '(M16) ningún texto suyo dice «proyecto», «consola» ni «datos»',
      todos.every((s) => !/proyecto|consola|datos\b/i.test(s.replace('bases de datos', ''))),
      todos.join(' | ')
    )
  }

  hr('Los tres sitios: ningún nombre de sistema')
  {
    const todos = LUGARES.flatMap((lugar) => [
      ...[0, 1, 4].flatMap((n) => {
        const t = textosMontajeBases(lugar, n)
        return [t.titulo, t.rotuloBoton]
      }),
      rotuloHistorialConversaciones(lugar),
      ...Object.values(lugarHistorial(lugar, 'C:\\Users\\u\\AppData\\Roaming\\Tessera\\terminal\\a1b2c3d4'))
    ])
    const conNombre = todos.filter((s) => PROHIBIDOS.some((p) => s.includes(p)))
    check('(M8) ningún texto nombra el sistema', conNombre.length === 0, conNombre[0] ?? `textos=${todos.length}`)
  }

  hr('Rótulo del historial de conversaciones: las dos mitades')
  {
    const proyecto = rotuloHistorialConversaciones('proyecto')
    check(
      '(M9) en un proyecto, el literal de siempre',
      proyecto === 'Historial de conversaciones de este proyecto',
      proyecto
    )
    const espacio = rotuloHistorialConversaciones('datos')
    check(
      '(M10) en el espacio de datos, «del agente de datos»',
      espacio === 'Historial de conversaciones del agente de datos',
      espacio
    )
    check('(M11) y sin «proyecto» ni «consola»', !/proyecto|consola/i.test(espacio), espacio)
  }

  // ---------------------------------------------------------------------------
  // (M12) Modal de historial: en un proyecto, el nombre de su carpeta (lo de antes,
  // con «este proyecto» si la ruta no da nombre); en el espacio de datos, NUNCA el
  // nombre de la carpeta (es el ID del perfil), sino «agente de datos».
  // ---------------------------------------------------------------------------
  {
    const deProyecto = lugarHistorial('proyecto', 'D:\\Proyectos\\tessera')
    check(
      '(M12) proyecto: la cabecera es el nombre de su carpeta',
      deProyecto.cabecera === 'tessera' && deProyecto.enVacio === 'en tessera',
      JSON.stringify(deProyecto)
    )
    const posix = lugarHistorial('proyecto', '/Users/ana/proyectos/api/')
    check('(M12) proyecto POSIX con barra final: la carpeta', posix.cabecera === 'api', JSON.stringify(posix))
    const sinNombre = lugarHistorial('proyecto', '')
    check(
      '(M12) proyecto sin ruta: sin cabecera y «en este proyecto» (el texto de antes)',
      sinNombre.cabecera === '' && sinNombre.enVacio === 'en este proyecto',
      JSON.stringify(sinNombre)
    )
    const espacio = lugarHistorial('datos', 'C:\\Users\\u\\AppData\\Roaming\\Tessera\\conexiones\\a1b2c3d4')
    check(
      '(M12) espacio de datos: «agente de datos», nunca el ID del perfil',
      espacio.cabecera === 'agente de datos' &&
        espacio.enVacio === 'en el agente de datos' &&
        !JSON.stringify(espacio).includes('a1b2c3d4'),
      JSON.stringify(espacio)
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
