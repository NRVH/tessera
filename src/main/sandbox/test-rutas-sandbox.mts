#!/usr/bin/env node
// =============================================================================
// Prueba de `rutasSandbox.ts` (npm run test:rutas-sandbox), pura: la normalización (solo
// Windows cambia `\` por `/`), las raíces de cada plataforma en árboles separados y sin
// prefijo común, la traducción al daemon (identidad en Mac) y que lo que no se sabe
// traducir LANZA. La plataforma es el último parámetro: se fijan las dos.
// Decisiones: docs/decisiones/sandbox/raices-por-plataforma.md
// =============================================================================

import { plataformaActual } from '../../shared/plataforma.ts'
import { aRutaDelDaemon, normalizarRutaResuelta, raicesSandbox } from './rutasSandbox.ts'

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

/** `userData` de macOS: lleva un ESPACIO, que es el origen de medio módulo. */
const BASE_MAC = '/Users/ana/Library/Application Support/Tessera'

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) normalizarRutaResuelta: `\\` es separador en Windows y NOMBRE en POSIX')
  // -------------------------------------------------------------------------
  check(
    '(1a) Windows: las barras invertidas pasan a `/`',
    normalizarRutaResuelta('C:\\Users\\ana\\proyecto', 'windows') === 'C:/Users/ana/proyecto',
    normalizarRutaResuelta('C:\\Users\\ana\\proyecto', 'windows')
  )
  check(
    '(1b) Windows: una ruta que ya venía con `/` queda igual',
    normalizarRutaResuelta('C:/Users/ana', 'windows') === 'C:/Users/ana',
    normalizarRutaResuelta('C:/Users/ana', 'windows')
  )
  // El fallo que motivó la consolidación: con el reemplazo incondicional, `a\b` se
  // convertía en `a/b` y el sandbox montaba otra cosa (o la terminal no lo encontraba).
  check(
    '(1c) macOS: `a\\b` se CONSERVA (la barra invertida es un carácter legal de nombre)',
    normalizarRutaResuelta('/Users/ana/a\\b', 'mac') === '/Users/ana/a\\b',
    normalizarRutaResuelta('/Users/ana/a\\b', 'mac')
  )
  check(
    "(1d) 'otra' (Linux/BSD) se comporta como macOS",
    normalizarRutaResuelta('/home/ana/a\\b', 'otra') === '/home/ana/a\\b',
    normalizarRutaResuelta('/home/ana/a\\b', 'otra')
  )
  check(
    '(1e) macOS: los espacios se conservan intactos',
    normalizarRutaResuelta(BASE_MAC, 'mac') === BASE_MAC,
    normalizarRutaResuelta(BASE_MAC, 'mac')
  )
  check(
    '(1f) sin plataforma explícita se usa la actual',
    normalizarRutaResuelta('x\\y') === normalizarRutaResuelta('x\\y', plataformaActual()),
    `${plataformaActual()}: ${normalizarRutaResuelta('x\\y')}`
  )

  // -------------------------------------------------------------------------
  hr('(2) Raíces gestionadas por plataforma')
  // -------------------------------------------------------------------------
  const win = raicesSandbox(BASE_MAC, 'windows')
  check(
    '(2a) Windows: dentro de la VM, y la base del host se IGNORA',
    win.proyectos === '/mnt/wsl/tessera-mm' && win.agentcfg === '/mnt/wsl/tessera-agentcfg',
    `${win.proyectos} | ${win.agentcfg}`
  )
  const mac = raicesSandbox(BASE_MAC, 'mac')
  check(
    '(2b) macOS: rutas del HOST bajo userData (Docker rechaza las de la VM)',
    mac.proyectos.startsWith(BASE_MAC) && mac.agentcfg.startsWith(BASE_MAC),
    `${mac.proyectos} | ${mac.agentcfg}`
  )
  check(
    '(2c) macOS: NINGUNA raíz cae bajo /mnt/wsl',
    !mac.proyectos.includes('/mnt/wsl') && !mac.agentcfg.includes('/mnt/wsl'),
    `${mac.proyectos} | ${mac.agentcfg}`
  )

  // -------------------------------------------------------------------------
  hr('(3) Los dos árboles, SEPARADOS y sin prefijo común')
  // -------------------------------------------------------------------------
  // La limpieza barre "todo lo que cuelgue de la base". Si una base fuera prefijo de
  // la otra, barrer proyectos se llevaría por delante las credenciales del agente.
  for (const [nombre, r] of [
    ['windows', win],
    ['mac', mac]
  ] as const) {
    check(
      `(3) ${nombre}: proyectos y agentcfg son árboles distintos`,
      r.proyectos !== r.agentcfg,
      `${r.proyectos} != ${r.agentcfg}`
    )
    check(
      `(3) ${nombre}: ninguno es prefijo del otro`,
      !r.proyectos.startsWith(r.agentcfg + '/') && !r.agentcfg.startsWith(r.proyectos + '/'),
      'ok'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) aRutaDelDaemon')
  // -------------------------------------------------------------------------
  check(
    '(4a) Windows: D:\\algo -> /mnt/host/d/algo',
    aRutaDelDaemon('D:\\algo\\otro', 'windows') === '/mnt/host/d/algo/otro',
    aRutaDelDaemon('D:\\algo\\otro', 'windows')
  )
  check(
    '(4b) Windows: la letra de unidad baja a minúscula',
    aRutaDelDaemon('C:/Users/ana', 'windows') === '/mnt/host/c/Users/ana',
    aRutaDelDaemon('C:/Users/ana', 'windows')
  )
  // Comprobado con `nsenter -t 1 -m` en la VM LinuxKit: `/Users` existe ahí con la
  // MISMA ruta. Es lo que explica que `-v /Users/x:/y` funcione sin traducir nada.
  check(
    '(4c) macOS: IDENTIDAD (/Users existe en la VM con la misma ruta)',
    aRutaDelDaemon('/Users/ana/proyecto', 'mac') === '/Users/ana/proyecto',
    aRutaDelDaemon('/Users/ana/proyecto', 'mac')
  )
  check(
    '(4d) macOS: los espacios se conservan intactos (los resuelve citarSh, no esto)',
    aRutaDelDaemon(BASE_MAC, 'mac') === BASE_MAC,
    aRutaDelDaemon(BASE_MAC, 'mac')
  )
  // En POSIX la barra invertida es un carácter LEGAL de nombre: no es un separador
  // que haya que traducir, así que tiene que salir tal cual entró.
  check(
    '(4e) macOS: una barra invertida del nombre se conserva (no es separador)',
    aRutaDelDaemon('/Users/ana/a\\b', 'mac') === '/Users/ana/a\\b',
    aRutaDelDaemon('/Users/ana/a\\b', 'mac')
  )

  // -------------------------------------------------------------------------
  hr('(5) Lo que no se sabe traducir, LANZA')
  // -------------------------------------------------------------------------
  // Devolver algo plausible aquí montaría OTRA cosa en el contenedor del perfil, que
  // es la peor consecuencia posible en un producto cuyo núcleo es el aislamiento.
  function lanza(fn: () => unknown): boolean {
    try {
      fn()
      return false
    } catch {
      return true
    }
  }
  check(
    '(5a) Windows: una ruta relativa lanza',
    lanza(() => aRutaDelDaemon('proyecto/sub', 'windows')),
    'lanzó'
  )
  check(
    '(5b) Windows: una ruta POSIX lanza (no es de esta familia)',
    lanza(() => aRutaDelDaemon('/Users/ana', 'windows')),
    'lanzó'
  )
  check(
    '(5c) macOS: una ruta relativa lanza',
    lanza(() => aRutaDelDaemon('proyecto/sub', 'mac')),
    'lanzó'
  )
  check(
    '(5d) macOS: una ruta de Windows lanza',
    lanza(() => aRutaDelDaemon('D:\\algo', 'mac')),
    'lanzó'
  )

  // -------------------------------------------------------------------------
  hr('(6) La plataforma es el ÚLTIMO parámetro y por defecto es la actual')
  // -------------------------------------------------------------------------
  // Es la convención del repo para la lógica pura: producción no la pasa, el
  // test la pasa. Aquí se fija que omitirla equivale a pasar la de ESTE proceso y
  // que la otra sigue pudiéndose pedir desde aquí (si no, sus casos de arriba sólo
  // se comprobarían en una máquina de ese sistema).
  const actual = plataformaActual()
  const porDefecto = raicesSandbox(BASE_MAC)
  const explicita = raicesSandbox(BASE_MAC, actual)
  check(
    '(6a) raicesSandbox(base) == raicesSandbox(base, plataformaActual())',
    porDefecto.proyectos === explicita.proyectos && porDefecto.agentcfg === explicita.agentcfg,
    `${actual}: ${porDefecto.proyectos}`
  )
  const rutaDeAqui = actual === 'windows' ? 'C:\\Users\\ana' : '/Users/ana'
  check(
    '(6b) aRutaDelDaemon(ruta) == aRutaDelDaemon(ruta, plataformaActual())',
    aRutaDelDaemon(rutaDeAqui) === aRutaDelDaemon(rutaDeAqui, actual),
    `${actual}: ${aRutaDelDaemon(rutaDeAqui)}`
  )
  const otra = actual === 'windows' ? 'mac' : 'windows'
  check(
    '(6c) la OTRA plataforma se sigue pudiendo fijar desde ésta',
    raicesSandbox(BASE_MAC, otra).proyectos !== porDefecto.proyectos,
    `${otra}: ${raicesSandbox(BASE_MAC, otra).proyectos}`
  )

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
