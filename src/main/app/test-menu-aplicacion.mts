#!/usr/bin/env node
// =============================================================================
// Prueba de menuAplicacion.ts: qué menú lleva cada plataforma, comprobadas las dos
// desde cualquiera (node src/main/app/test-menu-aplicacion.mts). Puro, sin Electron.
// Fija: Windows y 'otra' sin menú; macOS con tres menús escritos ítem a ítem, todos
// con `label`, y sin `reload`, `forceReload`, `close`, `toggleDevTools`, `about` ni
// roles-contenedor. Mira la plantilla SIN expandir: si vuelve un rol-contenedor, hay
// que sondear con Electron lo que trae dentro.
// Decisiones: docs/decisiones/app/atajos-y-menu.md
// =============================================================================

import { plantillaMenuAplicacion } from './menuAplicacion.ts'
import { plataformaActual } from '../../shared/plataforma.ts'

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

/** Forma mínima de un ítem de menú para recorrerlo sin depender de Electron. */
interface ItemMenu {
  role?: string
  label?: string
  type?: string
  submenu?: ItemMenu[] | { items?: ItemMenu[] }
}

/** Todos los ítems de la plantilla, a cualquier profundidad. */
function itemsEnProfundidad(items: readonly ItemMenu[]): ItemMenu[] {
  const todos: ItemMenu[] = []
  for (const item of items) {
    todos.push(item)
    const sub = item.submenu
    if (Array.isArray(sub)) todos.push(...itemsEnProfundidad(sub))
    else if (sub && Array.isArray(sub.items)) todos.push(...itemsEnProfundidad(sub.items))
  }
  return todos
}

/** Todos los roles de la plantilla, a cualquier profundidad. */
function rolesEnProfundidad(items: readonly ItemMenu[]): string[] {
  return itemsEnProfundidad(items)
    .map((i) => i.role)
    .filter((r): r is string => r !== undefined)
}

const PROHIBIDOS = ['reload', 'forceReload', 'close', 'toggleDevTools', 'fileMenu', 'viewMenu', 'about', 'appMenu']

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Windows y otra: sin menú')
  // -------------------------------------------------------------------------
  check('(1a) windows → null', plantillaMenuAplicacion('windows') === null, String(plantillaMenuAplicacion('windows')))
  check('(1b) otra → null', plantillaMenuAplicacion('otra') === null, String(plantillaMenuAplicacion('otra')))

  // -------------------------------------------------------------------------
  hr('(2) macOS: los tres menús escritos a mano, con rótulos en español')
  // -------------------------------------------------------------------------
  const mac = plantillaMenuAplicacion('mac') as ItemMenu[] | null
  check('(2a) mac → plantilla (no null)', Array.isArray(mac) && mac.length > 0, JSON.stringify(mac))
  const roles = mac ? rolesEnProfundidad(mac) : []
  // Los roles HIJOS, no los contenedores: `editMenu`/`windowMenu` se desplegaron para
  // poder ponerles `label` en español, así que lo que hay que exigir es su contenido.
  for (const rol of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'minimize', 'zoom', 'front']) {
    check(`(2b) mac lleva ${rol}`, roles.includes(rol), roles.join(', '))
  }
  // El primer menú se escribe a mano: `appMenu` traería `about`. Lo que SÍ tiene que
  // dar es lo que en Mac se espera del menú de la app: Cmd+Q y Cmd+H.
  const primero = mac?.[0]
  const rolesPrimero = primero && Array.isArray(primero.submenu) ? rolesEnProfundidad(primero.submenu) : []
  check(
    '(2c) el primer menú es el de la app (label Tessera) con submenú propio',
    !!primero && primero.label === 'Tessera' && Array.isArray(primero.submenu) && primero.role === undefined,
    JSON.stringify(primero)
  )
  for (const rol of ['quit', 'hide', 'hideOthers', 'unhide']) {
    check(`(2d) el menú de la app lleva ${rol}`, rolesPrimero.includes(rol), rolesPrimero.join(', '))
  }
  const resto = mac ? mac.slice(1) : []
  check(
    '(2e) tras él, exactamente «Edición» y «Ventana», en ese orden y sin role-contenedor',
    resto.map((i) => i.label).join(',') === 'Edición,Ventana' &&
      resto.every((i) => i.role === undefined && Array.isArray(i.submenu)),
    JSON.stringify(resto.map((i) => ({ label: i.label, role: i.role })))
  )
  // La convención del repo es "todo en español, incluidos los mensajes de UI", y la
  // barra de menús es la única superficie Cocoa de Tessera: un ítem sin `label` lo
  // rotula Electron en inglés y NO se localiza (comprobado con `--lang=es` y
  // AppleLocale=es_MX). Los separadores no llevan rótulo, obviamente.
  const sinRotulo = itemsEnProfundidad(mac ?? []).filter(
    (i) => i.type !== 'separator' && (i.label === undefined || i.label === '')
  )
  check(
    '(2f) ningún ítem sin `label`: los rótulos los pone Tessera, en español, no Electron en inglés',
    sinRotulo.length === 0,
    sinRotulo.length === 0 ? 'todos rotulados' : JSON.stringify(sinRotulo)
  )

  // -------------------------------------------------------------------------
  hr('(3) lo que NO puede estar en ningún nivel')
  // -------------------------------------------------------------------------
  for (const rol of PROHIBIDOS) {
    check(`(3) mac NO lleva ${rol}`, !roles.includes(rol), roles.join(', '))
  }

  // -------------------------------------------------------------------------
  hr('(4) parámetro por defecto = plataforma actual')
  // -------------------------------------------------------------------------
  check(
    `(4a) plantillaMenuAplicacion() == plantillaMenuAplicacion('${plataformaActual()}')`,
    JSON.stringify(plantillaMenuAplicacion()) === JSON.stringify(plantillaMenuAplicacion(plataformaActual())),
    JSON.stringify(plantillaMenuAplicacion())
  )

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
