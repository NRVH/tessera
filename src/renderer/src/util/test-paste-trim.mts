// =============================================================================
// Prueba de `insertarRecortado` (npm run test:paste-trim). Lógica pura, sin DOM; depende de
// `pasteTrim.ts`. Fija que recortar el pegado no se coma texto que ya estaba ni deje el cursor
// en un sitio raro: un fallo corrompería en silencio lo que el usuario acaba de escribir.
// =============================================================================

import { insertarRecortado } from './pasteTrim.ts'

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

console.log('\ninsertarRecortado\n')

// --- Caso central: campo vacío ----------------------------------------------
{
  const r = insertarRecortado('', 0, 0, '  10.0.0.1  ')
  comprobar('recorta ambos extremos', r.valor === '10.0.0.1', JSON.stringify(r))
  comprobar('cursor al final de lo pegado', r.cursor === 8)
}
{
  const r = insertarRecortado('', 0, 0, '\t usuario \r\n')
  comprobar('recorta tabuladores y saltos', r.valor === 'usuario', JSON.stringify(r.valor))
}

// --- Respeta lo que ya había -------------------------------------------------
{
  const r = insertarRecortado('abcdef', 3, 3, ' XY ')
  comprobar('inserta en medio sin comerse nada', r.valor === 'abcXYdef', JSON.stringify(r.valor))
  comprobar('cursor tras lo insertado', r.cursor === 5, String(r.cursor))
}
{
  const r = insertarRecortado('abcdef', 1, 4, '  Z  ')
  comprobar('sustituye la selección', r.valor === 'aZef', JSON.stringify(r.valor))
  comprobar('cursor tras la sustitución', r.cursor === 2, String(r.cursor))
}

// --- Espacios INTERIORES: se conservan ---------------------------------------
{
  const r = insertarRecortado('', 0, 0, '  Ventas PROD  ')
  comprobar('no toca los espacios de dentro', r.valor === 'Ventas PROD', JSON.stringify(r.valor))
}

// --- Bordes ------------------------------------------------------------------
{
  const r = insertarRecortado('hola', 0, 0, '   ')
  comprobar('pegar solo espacios no inserta nada', r.valor === 'hola' && r.cursor === 0)
}
{
  // Índices incoherentes (selección obsoleta): no debe corromper el valor.
  const r = insertarRecortado('hola', 99, 99, ' x ')
  comprobar('índices fuera de rango se acotan', r.valor === 'holax', JSON.stringify(r.valor))
}
{
  // fin < inicio (selección incoherente): se acota a una selección VACÍA en
  // `inicio`, o sea insertar sin borrar. Nunca debe invertir ni tragarse texto.
  const r = insertarRecortado('hola', 3, 1, ' x ')
  comprobar('inicio > fin inserta sin borrar', r.valor === 'holxa', JSON.stringify(r.valor))
  comprobar('cursor coherente con esa inserción', r.cursor === 4, String(r.cursor))
}
{
  const r = insertarRecortado('', 0, 0, 'sin-espacios')
  comprobar('sin espacios que quitar, pasa igual', r.valor === 'sin-espacios')
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
