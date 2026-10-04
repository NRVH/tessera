// =============================================================================
// Prueba de `formatoBytes` y `deltaBytes` (npm run test:formato-bytes). Lógica pura, sin DOM;
// depende de `formatoBytes.ts`. Fija la escala que se enseña (por ejemplo, los KB van sin
// decimal): un cambio ahí no lo delata ningún tipo, solo hace que el mismo archivo pese distinto.
// =============================================================================

import { deltaBytes, formatoBytes } from './formatoBytes.ts'

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

console.log('\nformatoBytes\n')

// --- Por debajo de 1 KB van los BYTES exactos --------------------------------
{
  comprobar('cero', formatoBytes(0) === '0 B', formatoBytes(0))
  comprobar('un byte', formatoBytes(1) === '1 B', formatoBytes(1))
  comprobar('1023 no redondea a 1 KB', formatoBytes(1023) === '1023 B', formatoBytes(1023))
}

// --- KB SIN decimal: es el escalón donde "1,5 KB" no aporta nada -------------
{
  comprobar('1024 = 1 KB', formatoBytes(1024) === '1 KB', formatoBytes(1024))
  comprobar('1536 redondea a 2 KB, no 1.5', formatoBytes(1536) === '2 KB', formatoBytes(1536))
  comprobar('11124 (el icono real) = 11 KB', formatoBytes(11124) === '11 KB', formatoBytes(11124))
}

// --- De MB en adelante, un decimal mientras el número sea pequeño ------------
{
  const mb = 1024 * 1024
  comprobar('1 MiB = 1.0 MB', formatoBytes(mb) === '1.0 MB', formatoBytes(mb))
  comprobar('1.5 MiB conserva el decimal', formatoBytes(mb * 1.5) === '1.5 MB', formatoBytes(mb * 1.5))
  // A partir de 10 el decimal sobra: "12 MB" se lee mejor que "12.3 MB" y la
  // precisión ya no cambia ninguna decisión.
  comprobar('12.3 MiB pierde el decimal', formatoBytes(mb * 12.3) === '12 MB', formatoBytes(mb * 12.3))
  comprobar('el tope binario (50 MiB) = 50 MB', formatoBytes(mb * 50) === '50 MB', formatoBytes(mb * 50))
}

// --- La escala no se sale por arriba -----------------------------------------
{
  const tb = 1024 ** 4
  comprobar('1 TiB = 1.0 TB', formatoBytes(tb) === '1.0 TB', formatoBytes(tb))
  // TB es la última unidad: por encima NO se inventa 'PB', se sigue contando en TB.
  comprobar('5000 TiB sigue en TB', formatoBytes(tb * 5000).endsWith(' TB'), formatoBytes(tb * 5000))
}

console.log('\ndeltaBytes\n')

// --- El delta de un diff de imagen -------------------------------------------
{
  comprobar('sin cambio no dice nada', deltaBytes(1024, 1024) === '', JSON.stringify(deltaBytes(1024, 1024)))
  // El signo menos es U+2212, no un guion: en una fila de cifras el guion se lee
  // como un separador.
  comprobar('adelgazar lleva menos', deltaBytes(11124, 221) === '−11 KB', deltaBytes(11124, 221))
  comprobar('engordar lleva más', deltaBytes(221, 11124) === '+11 KB', deltaBytes(221, 11124))
  comprobar('un alta desde cero', deltaBytes(0, 123) === '+123 B', deltaBytes(0, 123))
  comprobar('un borrado hasta cero', deltaBytes(123, 0) === '−123 B', deltaBytes(123, 0))
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
