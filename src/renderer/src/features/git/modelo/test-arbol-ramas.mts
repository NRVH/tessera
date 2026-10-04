#!/usr/bin/env node
// =============================================================================
// Prueba de construirArbolRamas (npm run test:arbol-ramas). Cubre: lista vacía y HEAD
// detached, la rama actual promovida a `head`, agrupación por prefijo y anidamiento, una
// carpeta de un solo hijo que no se colapsa, remotas agrupadas por remoto, orden (carpetas
// primero y alfabético con acentos), `total` a cualquier profundidad, `ruta` estable y una
// rama local llamada «origin/algo» que no se cuela entre las remotas.
// =============================================================================

import { construirArbolRamas, type NodoRama } from './arbolRamas.ts'
import type { Branch } from '../../../../../shared/git-ipc.ts'

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

/** Rama local. */
function local(name: string, current = false): Branch {
  return { name, current, remote: false }
}
/** Rama remota. */
function remota(name: string): Branch {
  return { name, current: false, remote: true }
}

/** Nombres de los nodos de un nivel, en orden, con "/" marcando las carpetas. */
function etiquetas(nodos: readonly NodoRama[]): string[] {
  return nodos.map((n) => (n.tipo === 'carpeta' ? `${n.nombre}/` : n.nombre))
}

/** Busca una carpeta por su ruta, a cualquier profundidad. */
function carpeta(nodos: readonly NodoRama[], ruta: string): NodoRama | null {
  for (const n of nodos) {
    if (n.ruta === ruta) return n
    if (n.tipo === 'carpeta') {
      const encontrada = carpeta(n.hijos, ruta)
      if (encontrada) return encontrada
    }
  }
  return null
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Vacío y HEAD detached')
  // -------------------------------------------------------------------------
  {
    const vacio = construirArbolRamas([])
    check('sin ramas: head null', vacio.head === null, String(vacio.head))
    check('sin ramas: locales y remotas vacías', vacio.locales.length === 0 && vacio.remotas.length === 0, '0/0')

    // Detached: ninguna rama es `current`, así que no hay head que promover.
    const detached = construirArbolRamas([local('main'), local('otra')])
    check('HEAD detached: head null', detached.head === null, String(detached.head))
    check(
      'y ninguna rama se pierde por ello',
      etiquetas(detached.locales).join(',') === 'main,otra',
      etiquetas(detached.locales).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('2) La rama actual se promueve y no se repite')
  // -------------------------------------------------------------------------
  {
    const a = construirArbolRamas([local('main', true), local('otra')])
    check('head es la rama actual', a.head?.name === 'main', String(a.head?.name))
    check(
      'main NO aparece dentro de Local',
      !etiquetas(a.locales).includes('main'),
      etiquetas(a.locales).join(',')
    )
    check('el resto sí', etiquetas(a.locales).join(',') === 'otra', etiquetas(a.locales).join(','))
    // Una rama actual DENTRO de una carpeta también se saca de ahí.
    const b = construirArbolRamas([local('feature/login', true), local('feature/logout')])
    check('la rama actual anidada también se promueve', b.head?.name === 'feature/login', String(b.head?.name))
    const f = carpeta(b.locales, 'feature')
    check(
      'y su carpeta se queda solo con la hermana',
      f?.tipo === 'carpeta' && etiquetas(f.hijos).join(',') === 'logout',
      f?.tipo === 'carpeta' ? etiquetas(f.hijos).join(',') : 'sin carpeta'
    )
  }

  // -------------------------------------------------------------------------
  hr('3-5) Agrupación por prefijo, carpeta de un solo hijo y anidamiento')
  // -------------------------------------------------------------------------
  {
    const a = construirArbolRamas([
      local('main', true),
      local('feature/login'),
      local('feature/logout'),
      local('hotfix/urgente'),
      local('suelta')
    ])
    check(
      'nivel raíz: 2 carpetas y luego la rama suelta',
      etiquetas(a.locales).join(',') === 'feature/,hotfix/,suelta',
      etiquetas(a.locales).join(',')
    )
    const feature = carpeta(a.locales, 'feature')
    check(
      'feature/ agrupa sus dos ramas',
      feature?.tipo === 'carpeta' && etiquetas(feature.hijos).join(',') === 'login,logout',
      feature?.tipo === 'carpeta' ? etiquetas(feature.hijos).join(',') : 'no'
    )
    // (4) LA DECISIÓN: hotfix/ tiene UN solo hijo y sigue siendo carpeta.
    const hotfix = carpeta(a.locales, 'hotfix')
    check(
      'una carpeta de UN solo hijo se conserva como carpeta',
      hotfix?.tipo === 'carpeta' && hotfix.hijos.length === 1,
      hotfix?.tipo === 'carpeta' ? `carpeta con ${hotfix.hijos.length} hijo` : 'se colapsó (mal)'
    )
    check(
      'y su hijo se pinta con el tramo corto, no con la ruta entera',
      hotfix?.tipo === 'carpeta' && hotfix.hijos[0].nombre === 'urgente',
      hotfix?.tipo === 'carpeta' ? hotfix.hijos[0].nombre : '?'
    )

    // (5) Varios niveles.
    const b = construirArbolRamas([local('feature/ui/tabla'), local('feature/ui/menu'), local('feature/api')])
    const ui = carpeta(b.locales, 'feature/ui')
    check('anida a más de un nivel', ui?.tipo === 'carpeta', ui ? ui.tipo : 'no existe')
    check(
      'con sus dos hojas ordenadas',
      ui?.tipo === 'carpeta' && etiquetas(ui.hijos).join(',') === 'menu,tabla',
      ui?.tipo === 'carpeta' ? etiquetas(ui.hijos).join(',') : '?'
    )
    const feat = carpeta(b.locales, 'feature')
    check(
      'y en su padre la carpeta va ANTES que la rama hermana',
      feat?.tipo === 'carpeta' && etiquetas(feat.hijos).join(',') === 'ui/,api',
      feat?.tipo === 'carpeta' ? etiquetas(feat.hijos).join(',') : '?'
    )
  }

  // -------------------------------------------------------------------------
  hr('6, 9, 10) Remotas')
  // -------------------------------------------------------------------------
  {
    const a = construirArbolRamas([
      local('main', true),
      remota('origin/main'),
      remota('origin/feature/login'),
      remota('upstream/main')
    ])
    check(
      'un nodo por remoto, sin mezclarlos',
      etiquetas(a.remotas).join(',') === 'origin/,upstream/',
      etiquetas(a.remotas).join(',')
    )
    const origin = carpeta(a.remotas, 'origin')
    check(
      'dentro del remoto se agrupa por prefijo igual que en local',
      origin?.tipo === 'carpeta' && etiquetas(origin.hijos).join(',') === 'feature/,main',
      origin?.tipo === 'carpeta' ? etiquetas(origin.hijos).join(',') : '?'
    )
    check(
      'la ruta de una remota incluye su remoto (clave única)',
      carpeta(a.remotas, 'origin/feature') !== null,
      'origin/feature existe'
    )
    check(
      'los dos remotos con una rama del mismo nombre no colisionan',
      carpeta(a.remotas, 'origin')?.ruta !== carpeta(a.remotas, 'upstream')?.ruta,
      'rutas distintas'
    )
    check(
      'la rama remota conserva su nombre COMPLETO para git log',
      (() => {
        const n = carpeta(a.remotas, 'origin/main')
        return n?.tipo === 'rama' && n.rama.name === 'origin/main'
      })(),
      'name = origin/main'
    )

    // (10) Una rama LOCAL que se llame "origin/algo" no debe irse a remotas.
    const b = construirArbolRamas([local('origin/rara'), remota('origin/main')])
    check(
      'una rama local llamada "origin/…" se queda en LOCAL',
      carpeta(b.locales, 'origin/rara') !== null,
      'está en locales'
    )
    check(
      'y no se duplica en remotas',
      carpeta(b.remotas, 'origin/rara') === null,
      'no está en remotas'
    )
  }

  // -------------------------------------------------------------------------
  hr('7) Orden alfabético con acentos')
  // -------------------------------------------------------------------------
  {
    const a = construirArbolRamas([
      local('zeta'),
      local('ñandu'),
      local('alfa'),
      local('feature/zzz'),
      local('bravo/x')
    ])
    check(
      'carpetas primero (alfabéticas) y luego ramas (alfabéticas)',
      etiquetas(a.locales).join(',') === 'bravo/,feature/,alfa,ñandu,zeta',
      etiquetas(a.locales).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('8) total: cuenta a cualquier profundidad')
  // -------------------------------------------------------------------------
  {
    const a = construirArbolRamas([
      local('feature/ui/tabla'),
      local('feature/ui/menu'),
      local('feature/api'),
      local('suelta')
    ])
    const feat = carpeta(a.locales, 'feature')
    check(
      'feature/ cuenta 3 ramas, no 2 hijos directos',
      feat?.tipo === 'carpeta' && feat.total === 3,
      feat?.tipo === 'carpeta' ? String(feat.total) : '?'
    )
    const ui = carpeta(a.locales, 'feature/ui')
    check('feature/ui cuenta 2', ui?.tipo === 'carpeta' && ui.total === 2, ui?.tipo === 'carpeta' ? String(ui.total) : '?')
  }

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
