#!/usr/bin/env node
// =============================================================================
// Prueba del RELEVO (npm run test:relevo), que hace que una actualización fallida no
// sea muda. Fija: el ENCARGO se valida antes de creérselo (lo escribe otro proceso);
// una copia de OTRA versión no se usa; los códigos de salida se traducen y «no
// arrancó» se distingue de «arrancó y falló» (arreglos distintos); y el HTML escapa
// lo que le metan, porque las versiones salen del feed.
// =============================================================================

import {
  ENCARGO_VERSION,
  FLAG_RELEVO,
  copiaUtilizable,
  encargoValido,
  leerSalidaInstalador,
  rutaEncargoDesdeArgv
} from './relevo.ts'
import { escaparHtml, paginaRelevo } from '../main/relevo/relevoUi.ts'

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

const ENCARGO_OK = {
  version: ENCARGO_VERSION,
  instalador: 'C:\\tmp\\Setup.exe',
  raizInstalacion: 'C:\\Programs\\Tessera',
  exeApp: 'C:\\Programs\\Tessera\\Tessera.exe',
  pidPadre: 1234,
  versionActual: '0.43.0',
  versionNueva: '0.44.0',
  log: 'C:\\tmp\\relevo.log'
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) EL ENCARGO se valida antes de creérselo')
  {
    check('un encargo completo se acepta', encargoValido(ENCARGO_OK), 'ok')
    check(
      'sin instalador NO se acepta (sería una ventana sin nada que instalar)',
      !encargoValido({ ...ENCARGO_OK, instalador: '' }),
      'rechazado'
    )
    check(
      'con un pid que no es número NO se acepta (se esperaría a un padre inexistente)',
      !encargoValido({ ...ENCARGO_OK, pidPadre: 'x' }),
      'rechazado'
    )
    check(
      'de OTRA versión de formato NO se acepta',
      !encargoValido({ ...ENCARGO_OK, version: ENCARGO_VERSION + 1 }),
      'rechazado'
    )
    check(
      'basura (null, array, texto) no revienta y se rechaza',
      !encargoValido(null) && !encargoValido([]) && !encargoValido('{}') && !encargoValido(7),
      'rechazado sin lanzar'
    )
  }

  // -------------------------------------------------------------------------
  hr('2) LA COPIA solo se usa si es de ESTA versión')
  {
    check(
      'copia de la misma versión: se usa',
      copiaUtilizable({ existeExe: true, versionCopia: '0.43.0' }, '0.43.0'),
      'true'
    )
    check(
      'copia de una versión ANTERIOR: NO se usa (correría un supervisor viejo)',
      !copiaUtilizable({ existeExe: true, versionCopia: '0.42.0' }, '0.43.0'),
      'false'
    )
    check(
      'sin marcador de versión: NO se usa',
      !copiaUtilizable({ existeExe: true, versionCopia: null }, '0.43.0'),
      'false'
    )
    check(
      'con marcador pero SIN ejecutable: NO se usa',
      !copiaUtilizable({ existeExe: false, versionCopia: '0.43.0' }, '0.43.0'),
      'false'
    )
  }

  // -------------------------------------------------------------------------
  hr('3) LOS CÓDIGOS DE SALIDA se traducen, y "no arrancó" != "arrancó y falló"')
  {
    check('0 es éxito', leerSalidaInstalador(0).ok, leerSalidaInstalador(0).titulo)
    const noArranco = leerSalidaInstalador(null)
    const fallo = leerSalidaInstalador(-1)
    check(
      'null (no llegó a ejecutarse) y un código != 0 dan mensajes DISTINTOS',
      !noArranco.ok && !fallo.ok && noArranco.titulo !== fallo.titulo,
      `${noArranco.titulo} | ${fallo.titulo}`
    )
    check(
      'el -1 que vio el prototipo de julio da un mensaje con su código',
      fallo.titulo.includes('-1'),
      fallo.titulo
    )
    check(
      '1223 se cuenta como cancelación del usuario, no como avería',
      !leerSalidaInstalador(1223).ok && /cancel/i.test(leerSalidaInstalador(1223).titulo),
      leerSalidaInstalador(1223).titulo
    )
    check(
      'el "2" histórico dice que es una RUTA larga, no un archivo en uso',
      /ruta/i.test(leerSalidaInstalador(2).detalle),
      leerSalidaInstalador(2).detalle.slice(0, 60)
    )
    check(
      'todo fallo aclara que la versión anterior sigue instalada',
      [null, -1, 2].every((c) => /anterior/i.test(leerSalidaInstalador(c).detalle)),
      'los tres lo dicen'
    )
  }

  // -------------------------------------------------------------------------
  hr('4) LA PÁGINA escapa lo que le meten')
  {
    check(
      'escaparHtml neutraliza etiquetas y comillas',
      escaparHtml('<img src=x onerror="a">') === '&lt;img src=x onerror=&quot;a&quot;&gt;',
      escaparHtml('<img src=x onerror="a">')
    )
    const html = paginaRelevo('0.43.0', '<script>alert(1)</script>')
    check(
      'una versión con HTML dentro no llega cruda a la página',
      !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'),
      'escapada'
    )
    const normal = paginaRelevo('0.43.0', '0.44.0')
    check(
      'la página anuncia el salto de versión y trae los dos botones',
      normal.includes('0.43.0') &&
        normal.includes('0.44.0') &&
        normal.includes('id="abrir"') &&
        normal.includes('id="copiar"'),
      'contiene versiones y botones'
    )
    check(
      'la página declara CSP y no carga nada de fuera',
      normal.includes("default-src 'none'"),
      "default-src 'none'"
    )
  }

  // -------------------------------------------------------------------------
  hr('5) LA BANDERA va por ARGV, que NO se hereda (bucle de instalación)')
  {
    // El fallo que esto fija: con la ruta en `TESSERA_RELEVO`, la Tessera que el
    // relevo lanzaba al pulsar "Abrir" heredaba la variable, arrancaba en modo
    // relevo y volvía a instalar. Un bucle en vez de la app.
    const argv = ['C:\\rel\\Tessera.exe', `${FLAG_RELEVO}C:\\rel\\encargo.json`]
    check(
      'con la bandera, se saca la ruta del encargo',
      rutaEncargoDesdeArgv(argv) === 'C:\\rel\\encargo.json',
      String(rutaEncargoDesdeArgv(argv))
    )
    check(
      'un arranque normal de Tessera NO es un relevo',
      rutaEncargoDesdeArgv(['C:\\Programs\\Tessera\\Tessera.exe', '--updated']) === null,
      'null'
    )
    check(
      'la bandera VACÍA no cuenta (un relevo sin encargo instalaría a ciegas)',
      rutaEncargoDesdeArgv(['x.exe', FLAG_RELEVO]) === null,
      'null'
    )
    check(
      'una ruta con espacios sobrevive entera',
      rutaEncargoDesdeArgv(['x.exe', `${FLAG_RELEVO}C:\\Con Espacios\\encargo.json`]) ===
        'C:\\Con Espacios\\encargo.json',
      'ruta completa'
    )
  }

  // -------------------------------------------------------------------------
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
