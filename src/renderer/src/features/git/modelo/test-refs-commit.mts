#!/usr/bin/env node
// =============================================================================
// Prueba de chipsDeRefs (npm run test:refs-commit): tokens crudos de `%D` a chips. Cubre:
// sin refs, `HEAD -> main` sin la flecha, `HEAD` suelto, `tag: v1.2`, local frente a remota
// por pertenencia a la lista real y no por prefijo, sin lista de ramas (todo local), orden
// head, locales, remotas, etiquetas, tokens con espacios o vacíos y un tag con «tag: » dentro.
// =============================================================================

import { chipsDeRefs } from './refsCommit.ts'
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

function local(name: string, current = false): Branch {
  return { name, current, remote: false }
}
function remota(name: string): Branch {
  return { name, current: false, remote: true }
}

/** Resumen compacto "clase:nombre" para las evidencias. */
function resumen(chips: ReturnType<typeof chipsDeRefs>): string {
  return chips.map((c) => `${c.clase}:${c.nombre}`).join(' ')
}

const RAMAS: Branch[] = [
  local('main', true),
  local('feature/login'),
  remota('origin/main'),
  remota('origin/feature/login'),
  remota('upstream/main')
]

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Sin refs')
  // -------------------------------------------------------------------------
  check('lista vacía -> sin chips', chipsDeRefs([], RAMAS).length === 0, '0')

  // -------------------------------------------------------------------------
  hr('2-4) HEAD, HEAD suelto y tags')
  // -------------------------------------------------------------------------
  {
    const head = chipsDeRefs(['HEAD -> main'], RAMAS)
    check('"HEAD -> main" da UN chip', head.length === 1, resumen(head))
    check('de clase head', head[0].clase === 'head', head[0].clase)
    check('con la flecha ya quitada', head[0].nombre === 'main', head[0].nombre)
    check('y un título que lo explica', head[0].titulo.includes('actual'), head[0].titulo)

    const suelto = chipsDeRefs(['HEAD'], RAMAS)
    check('"HEAD" suelto (detached) da un chip head', suelto.length === 1 && suelto[0].clase === 'head', resumen(suelto))
    check('con el texto HEAD', suelto[0].nombre === 'HEAD', suelto[0].nombre)
    check('y el título dice detached', suelto[0].titulo.includes('detached'), suelto[0].titulo)

    const tag = chipsDeRefs(['tag: v1.2'], RAMAS)
    check('"tag: v1.2" -> clase etiqueta', tag[0].clase === 'etiqueta', tag[0].clase)
    check('con el prefijo quitado', tag[0].nombre === 'v1.2', tag[0].nombre)
  }

  // -------------------------------------------------------------------------
  hr('5) Local vs remota por PERTENENCIA, no por prefijo')
  // -------------------------------------------------------------------------
  {
    const c1 = chipsDeRefs(['origin/main'], RAMAS)
    check('origin/main (está en remotas) -> remota', c1[0].clase === 'remota', resumen(c1))
    const c2 = chipsDeRefs(['upstream/main'], RAMAS)
    check('un remoto con OTRO nombre también -> remota', c2[0].clase === 'remota', resumen(c2))
    const c3 = chipsDeRefs(['feature/login'], RAMAS)
    check('una local con barra -> local (no la confunde con remota)', c3[0].clase === 'local', resumen(c3))

    // El caso que rompe la heurística del prefijo: rama LOCAL llamada origin/…
    const ramasRaras: Branch[] = [local('origin/rara'), remota('origin/main')]
    const c4 = chipsDeRefs(['origin/rara'], ramasRaras)
    check(
      'una rama LOCAL llamada "origin/rara" NO se clasifica como remota',
      c4[0].clase === 'local',
      resumen(c4)
    )
    const c5 = chipsDeRefs(['origin/main'], ramasRaras)
    check('y la remota de verdad sí', c5[0].clase === 'remota', resumen(c5))

    // Una ref que no está en ninguna lista (rama recién creada fuera de la app).
    const c6 = chipsDeRefs(['recien-creada'], RAMAS)
    check('una ref desconocida se asume local (no se pierde)', c6.length === 1 && c6[0].clase === 'local', resumen(c6))
  }

  // -------------------------------------------------------------------------
  hr('6) Sin lista de ramas (aún cargando)')
  // -------------------------------------------------------------------------
  {
    const c = chipsDeRefs(['HEAD -> main', 'origin/main', 'tag: v1'], [])
    check('no desaparece ningún chip', c.length === 3, resumen(c))
    check('HEAD se sigue reconociendo (no depende de la lista)', c[0].clase === 'head', resumen(c))
    check('el tag también', c.some((x) => x.clase === 'etiqueta'), resumen(c))
    check(
      'la que no se puede clasificar cae en local, no se descarta',
      c.some((x) => x.clase === 'local' && x.nombre === 'origin/main'),
      resumen(c)
    )
  }

  // -------------------------------------------------------------------------
  hr('7) Orden: head, locales, remotas, etiquetas')
  // -------------------------------------------------------------------------
  {
    // Se pasan DESORDENADAS a propósito.
    const c = chipsDeRefs(['tag: v1.0', 'origin/main', 'feature/login', 'HEAD -> main'], RAMAS)
    check(
      'salen en el orden de importancia',
      resumen(c) === 'head:main local:feature/login remota:origin/main etiqueta:v1.0',
      resumen(c)
    )
    check('y no se pierde ninguna', c.length === 4, String(c.length))
  }

  // -------------------------------------------------------------------------
  hr('8-9) Robustez del parseo')
  // -------------------------------------------------------------------------
  {
    const c = chipsDeRefs(['  main  ', '', '   '], RAMAS)
    check('los tokens vacíos no generan chips', c.length === 1, resumen(c))
    check('y el espacio sobrante se recorta', c[0].nombre === 'main', JSON.stringify(c[0].nombre))

    // Un tag llamado literalmente "tag: raro" -> solo se quita el primer prefijo.
    const t = chipsDeRefs(['tag: tag: raro'], RAMAS)
    check('el prefijo "tag: " se quita UNA vez', t[0].nombre === 'tag: raro', JSON.stringify(t[0].nombre))

    // Varias etiquetas sobre el mismo commit.
    const dos = chipsDeRefs(['tag: v1.0', 'tag: latest'], RAMAS)
    check('varias etiquetas conviven', dos.length === 2 && dos.every((x) => x.clase === 'etiqueta'), resumen(dos))
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
