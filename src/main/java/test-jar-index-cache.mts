#!/usr/bin/env node
// =============================================================================
// Prueba de JarIndexCache (npm run test:jar-index-cache), el LRU de doble tope que sostiene la
// navegación dentro de los .jar: claves con mtime y tamaño, rejuvenecer al acertar y desalojar al
// menos usado, los topes de entradas y de bytes con su contabilidad al reemplazar, y que una
// ENTRADA GIGANTE (sola supera `maxBytes`) no se expulsa por el tope de bytes ni cuando deja de
// ser la única, sin colgar el bucle. Sin disco ni stubs: la clase solo importa un tipo.
// =============================================================================

import { JarIndexCache, type EntradaCacheJar } from './JarIndexCache.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78) + `\n${title}\n` + '='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: unknown = ''): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence === '' ? '' : ` -> ${String(evidence)}`}`)
}

/** Una entrada de caché de mentira que pesa `bytes`. */
function entrada(bytes: number): EntradaCacheJar {
  return { indice: { entradas: [] } as unknown as EntradaCacheJar['indice'], bytes }
}

hr('(1) Claves')
{
  const a = JarIndexCache.claveDisco('D:\\P\\lib\\X.jar', 100, 50)
  const b = JarIndexCache.claveDisco('D:\\P\\lib\\X.jar', 200, 50)
  const c = JarIndexCache.claveDisco('D:\\P\\lib\\X.jar', 100, 51)
  check('el mtime forma parte de la clave', a !== b, `${a} vs ${b}`)
  check('el tamaño también', a !== c)
  check('la ruta no distingue mayúsculas (Windows)', a === JarIndexCache.claveDisco('d:\\p\\LIB\\x.JAR', 100, 50))
  check('la anidada cuelga de su padre', JarIndexCache.claveAnidada(a, 'WEB-INF/lib/d.jar').startsWith(a))
}

hr('(2) LRU: un acierto rejuvenece')
{
  const c = new JarIndexCache({ maxEntradas: 2, maxBytes: 1_000_000 })
  c.set('a', entrada(10))
  c.set('b', entrada(10))
  c.get('a') // 'a' pasa a ser el más reciente; ahora el viejo es 'b'
  c.set('c', entrada(10))
  check('desaloja al MENOS usado, no al primero insertado', c.get('a') !== undefined && c.get('b') === undefined, `entradas=${c.entradas}`)
}

hr('(3) y (4) Topes de entradas y de bytes')
{
  const porEntradas = new JarIndexCache({ maxEntradas: 3, maxBytes: 1_000_000 })
  for (const k of ['a', 'b', 'c', 'd', 'e']) porEntradas.set(k, entrada(1))
  check('nunca se pasa del tope de entradas', porEntradas.entradas === 3, `entradas=${porEntradas.entradas}`)

  const porBytes = new JarIndexCache({ maxEntradas: 100, maxBytes: 100 })
  for (const k of ['a', 'b', 'c', 'd', 'e']) porBytes.set(k, entrada(30))
  check('nunca se pasa del tope de bytes', porBytes.bytes <= 100, `bytes=${porBytes.bytes}`)

  const reemplazo = new JarIndexCache({ maxEntradas: 10, maxBytes: 1_000_000 })
  reemplazo.set('a', entrada(50))
  reemplazo.set('a', entrada(10))
  check('reemplazar una clave no suma dos veces sus bytes', reemplazo.bytes === 10, `bytes=${reemplazo.bytes}`)
}

hr('(5) LA ENTRADA GIGANTE')
{
  // `gigante` sola supera maxBytes: es alcanzable de verdad, porque un jar anidado
  // admite MAX_JAR_ANIDADO_BYTES, que es MAYOR que el tope de la caché.
  const c = new JarIndexCache({ maxEntradas: 10, maxBytes: 100 })
  c.set('gigante', entrada(500))
  check('sola en la caché, se queda', c.get('gigante') !== undefined, `entradas=${c.entradas}`)

  // El paso que rompía: la petición siguiente mete el índice de su contenedor padre.
  // Con la protección vieja (`size <= 1`) la gigante dejaba de estar sola y salía la
  // primera, provocando un ping-pong con 0% de aciertos.
  c.set('padre', entrada(10))
  check(
    'sigue estando tras insertar OTRA entrada (no es el ping-pong)',
    c.get('gigante') !== undefined,
    `entradas=${c.entradas}, bytes=${c.bytes}`
  )

  // Y lo que sí debe pasar: los NO gigantes ceden sitio con normalidad.
  c.set('otro1', entrada(60))
  c.set('otro2', entrada(60))
  check(
    'los normales sí se desalojan entre ellos',
    c.get('gigante') !== undefined && c.get('otro2') !== undefined && c.get('padre') === undefined,
    `entradas=${c.entradas}`
  )
}

hr('(6) La protección no cuelga el bucle ni bloquea el tope de ENTRADAS')
{
  // Todo gigantes: tiene que terminar, no girar. Y solo sobreviven las
  // GIGANTES_PROTEGIDAS (2) más recientes: proteger a TODAS dejaba el consumo real
  // en maxEntradas × MAX_JAR_ANIDADO_BYTES (~3 GiB) con un presupuesto de 96 MiB.
  const soloGigantes = new JarIndexCache({ maxEntradas: 10, maxBytes: 10 })
  for (const k of ['g1', 'g2', 'g3']) soloGigantes.set(k, entrada(100))
  check('con la caché llena de gigantes, podar termina', soloGigantes.entradas === 2, `entradas=${soloGigantes.entradas}`)
  check(
    'y sobreviven las MÁS RECIENTES, no las primeras',
    soloGigantes.get('g3') !== undefined && soloGigantes.get('g2') !== undefined && soloGigantes.get('g1') === undefined,
    `entradas=${soloGigantes.entradas}`
  )

  // El techo REAL: por muchas gigantes que pasen, nunca se apilan más de dos.
  const muchas = new JarIndexCache({ maxEntradas: 24, maxBytes: 10 })
  for (const k of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) muchas.set(k, entrada(100))
  check('las gigantes NO se apilan: el consumo queda acotado', muchas.bytes === 200, `bytes=${muchas.bytes}, entradas=${muchas.entradas}`)

  // Pero el tope de ENTRADAS no admite excepción: acota cuántos se recuerdan, y ahí
  // hasta la gigante cede si no queda nadie más a quien echar.
  const tope = new JarIndexCache({ maxEntradas: 2, maxBytes: 10 })
  for (const k of ['g1', 'g2', 'g3']) tope.set(k, entrada(100))
  check('el tope de entradas se respeta aunque todas sean gigantes', tope.entradas === 2, `entradas=${tope.entradas}`)
}

hr('(7) invalidarPorRuta')
{
  const c = new JarIndexCache({ maxEntradas: 10, maxBytes: 1_000_000 })
  const padre = JarIndexCache.claveDisco('D:\\P\\dist\\app.war', 1, 1)
  c.set(padre, entrada(10))
  c.set(JarIndexCache.claveAnidada(padre, 'WEB-INF/lib/d.jar'), entrada(90))
  c.set(JarIndexCache.claveDisco('D:\\P\\lib\\otro.jar', 1, 1), entrada(5))
  c.invalidarPorRuta('D:\\P\\dist\\app.war')
  check('se lleva el contenedor Y sus anidados', c.entradas === 1, `entradas=${c.entradas}`)
  check('y devuelve sus bytes al presupuesto', c.bytes === 5, `bytes=${c.bytes}`)
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const ok = results.filter((r) => r.pass).length
const allPass = ok === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${ok}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
