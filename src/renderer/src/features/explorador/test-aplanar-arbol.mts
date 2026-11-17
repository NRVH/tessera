#!/usr/bin/env node
// =============================================================================
// Prueba de aplanarArbol (aplanado PURO del árbol para virtualizar).
// (node src/renderer/src/features/explorador/test-aplanar-arbol.mts)
// -----------------------------------------------------------------------------
// Cubre filas de archivos y carpetas, expansión, compactación de cadenas, placeholders
// (loading, empty, error), el orden y las profundidades en un árbol anidado, y qué cadenas
// conserva un refresco (un .jar expandido no pierde sus filas ni la selección de dentro).
// =============================================================================

import {
  entradasConCadena,
  aplanarArbol,
  necesitaCadena,
  podarCadenas,
  type InfoCadena,
  type FilaAplanada
} from './aplanarArbol.ts'
import { podarSeleccion } from './seleccionArbol.ts'
import type { EntradaArchivo } from '../../../../shared/archivos-ipc.ts'

function dir(ruta: string): EntradaArchivo {
  return { nombre: ruta.slice(ruta.lastIndexOf('/') + 1), ruta, tipo: 'dir' }
}
function archivo(ruta: string): EntradaArchivo {
  return { nombre: ruta.slice(ruta.lastIndexOf('/') + 1), ruta, tipo: 'file' }
}
function cadena(segmentos: EntradaArchivo[], hijos: EntradaArchivo[]): InfoCadena {
  return { segmentos, hijos }
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
/** Resumen compacto de las filas: "ruta@profundidad" para nodos, "!variante@profundidad" para placeholders. */
function sig(filas: FilaAplanada[]): string {
  return filas
    .map((r) => (r.tipo === 'node' ? `${r.clave}@${r.profundidad}${r.estaExpandida ? '+' : ''}` : `!${r.variante}@${r.profundidad}`))
    .join(' ')
}

function main(): void {
  // (1) plano: archivo + carpeta colapsada
  {
    const filas = aplanarArbol({
      raices: [archivo('a.txt'), dir('src')],
      cadenas: new Map([['src', cadena([dir('src')], [archivo('src/x.ts')])]]),
      expandidas: new Set(),
      errores: new Map()
    })
    check('(1) plano, colapsado', sig(filas) === 'a.txt@0 src@0', sig(filas))
  }

  // (2) carpeta expandida -> hijos a profundidad+1
  {
    const filas = aplanarArbol({
      raices: [dir('src')],
      cadenas: new Map([['src', cadena([dir('src')], [archivo('src/x.ts'), dir('src/sub')])]]),
      expandidas: new Set(['src']),
      errores: new Map()
    })
    check('(2) expandida emite hijos a depth 1', sig(filas) === 'src@0+ src/x.ts@1 src/sub@1', sig(filas))
  }

  // (3) compactación: java -> com -> ejemplo (cadena), expandida por la HOJA 'ejemplo'
  {
    const compacta = cadena(
      [dir('java'), dir('java/com'), dir('java/com/ejemplo')],
      [archivo('java/com/ejemplo/App.java')]
    )
    const filas = aplanarArbol({
      raices: [dir('java')],
      cadenas: new Map([['java', compacta]]),
      expandidas: new Set(['java/com/ejemplo']), // la hoja
      errores: new Map()
    })
    const r0 = filas[0]
    const compactada =
      r0.tipo === 'node' && r0.segmentos.length === 3 && r0.hoja.ruta === 'java/com/ejemplo' && r0.estaExpandida
    check(
      '(3) cadena compactada, hijo de la hoja a depth 1',
      compactada && sig(filas) === 'java/com/ejemplo@0+ java/com/ejemplo/App.java@1',
      sig(filas)
    )
  }

  // (4a) expandida SIN cadena cargada -> placeholder loading
  {
    const filas = aplanarArbol({
      raices: [dir('src')],
      cadenas: new Map(),
      expandidas: new Set(['src']),
      errores: new Map()
    })
    check('(4a) expandida sin cadena -> loading', sig(filas) === 'src@0+ !loading@1', sig(filas))
  }
  // (4b) expandida con 0 hijos -> empty
  {
    const filas = aplanarArbol({
      raices: [dir('empty')],
      cadenas: new Map([['empty', cadena([dir('empty')], [])]]),
      expandidas: new Set(['empty']),
      errores: new Map()
    })
    check('(4b) expandida vacía -> empty', sig(filas) === 'empty@0+ !empty@1', sig(filas))
  }
  // (4c) error registrado -> placeholder error con mensaje
  {
    const filas = aplanarArbol({
      raices: [dir('boom')],
      cadenas: new Map(),
      expandidas: new Set(['boom']),
      errores: new Map([['boom', 'EACCES']])
    })
    const ph = filas[1]
    check(
      '(4c) error -> placeholder con mensaje',
      ph.tipo === 'placeholder' && ph.variante === 'error' && ph.mensaje === 'EACCES',
      sig(filas)
    )
  }

  // (5) colapsada NO emite hijos aunque la cadena esté cargada
  {
    const filas = aplanarArbol({
      raices: [dir('src')],
      cadenas: new Map([['src', cadena([dir('src')], [archivo('src/x.ts')])]]),
      expandidas: new Set(), // colapsada
      errores: new Map()
    })
    check('(5) colapsada no emite hijos', sig(filas) === 'src@0', sig(filas))
  }

  // (6) anidado de varios niveles con expansión parcial
  {
    const filas = aplanarArbol({
      raices: [dir('a'), archivo('z.txt')],
      cadenas: new Map([
        ['a', cadena([dir('a')], [dir('a/b'), archivo('a/f.ts')])],
        ['a/b', cadena([dir('a/b')], [archivo('a/b/deep.ts')])]
      ]),
      expandidas: new Set(['a', 'a/b']),
      errores: new Map()
    })
    check(
      '(6) anidado, orden y profundidades',
      sig(filas) === 'a@0+ a/b@1+ a/b/deep.ts@2 a/f.ts@1 z.txt@0',
      sig(filas)
    )
  }

  // (7) refresco con un .jar expandido: su cadena se conserva y se re-lista con su entrada
  {
    const jar: EntradaArchivo = { ...archivo('lib.jar'), contenedor: 'jar' }
    const cadenas = new Map([
      ['lib.jar', cadena([jar], [dir('lib.jar!/com')])],
      ['lib.jar!/com', cadena([dir('lib.jar!/com')], [archivo('lib.jar!/com/A.class')])],
      ['a', cadena([dir('a')], [dir('a/b')])],
      ['a/b', cadena([dir('a/b')], [archivo('a/b/x.ts')])],
      ['cerrado.jar', cadena([{ ...archivo('cerrado.jar'), contenedor: 'jar' }], [archivo('cerrado.jar!/B.class')])]
    ])
    const entrada = {
      raices: [dir('a'), { ...archivo('cerrado.jar'), contenedor: 'jar' as const }, jar],
      cadenas,
      expandidas: new Set(['lib.jar', 'lib.jar!/com']),
      errores: new Map<string, string>()
    }
    const antes = aplanarArbol(entrada)
    const vivas = entradasConCadena(antes)
    const podadas = podarCadenas(cadenas, vivas)
    const despues = aplanarArbol({ ...entrada, cadenas: podadas })
    check(
      '(7a) el .jar expandido entra en el refresco con SU entrada (contenedor)',
      vivas.get('lib.jar')?.contenedor === 'jar',
      JSON.stringify(vivas.get('lib.jar') ?? null)
    )
    check(
      '(7b) se conservan las cadenas del .jar; caen las de ramas colapsadas y el .jar cerrado',
      [...podadas.keys()].sort().join() === 'a,lib.jar,lib.jar!/com',
      [...podadas.keys()].sort().join()
    )
    check('(7c) las filas de dentro del .jar siguen ahí tras el refresco', sig(despues) === sig(antes), sig(despues))
    const sel = { claves: new Set(['lib.jar!/com']), ancla: 'lib.jar!/com', lider: 'lib.jar!/com' }
    const vivasFilas = new Set(despues.flatMap((r) => (r.tipo === 'node' ? [r.clave] : [])))
    const podada = podarSeleccion(sel, vivasFilas)
    check(
      '(7d) la selección de dentro del .jar sobrevive al files:changed (Ctrl+V no cae a la raíz)',
      podada === sel && podada.lider === 'lib.jar!/com',
      JSON.stringify({ lider: podada.lider, claves: [...podada.claves] })
    )
    check(
      '(7e) necesitaCadena: un .jar CERRADO no se lee; una carpeta colapsada sí',
      !necesitaCadena(antes.find((r) => r.clave === 'cerrado.jar')!) && necesitaCadena(antes.find((r) => r.clave === 'a')!),
      'ok'
    )
  }

  console.log('\n' + '='.repeat(78))
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  console.log(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main()
