#!/usr/bin/env node
// =============================================================================
// Prueba del VOCABULARIO POR SISTEMA (npm run test:nombres-sistema) y, sobre todo, del
// guardián: lee los `.ts`/`.tsx` del renderer y falla si aparece un nombre de
// plataforma escrito a mano fuera de la lista de excepciones, que va por archivo y con
// motivo (un bloque que solo se monta en una plataforma la nombra a pelo). Descarta
// las líneas que empiezan por `//`, `*` o `/*`; un comentario a final de línea da un
// falso positivo, que se acepta (cuesta una excepción; el falso negativo es el bug).
// Cubre también la tabla, `tuEquipo` frente a `sistema` en Mac, que el guardián se
// dispara de verdad y que las excepciones apuntan a archivos que existen.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nombresSistema } from './nombresSistema.ts'
import type { Plataforma } from './plataforma.ts'

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
}

/** La raíz del repo, desde este archivo (`src/shared/`). */
const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// El guardián
// ---------------------------------------------------------------------------

/**
 * Los nombres que NO se escriben a mano en la interfaz.
 *
 * No entra «Mac» a secas: casa dentro de demasiados identificadores legítimos
 * (`relevoMac`, `esMac`, `MacOS`) y el ruido acabaría con el guardián desactivado,
 * que es peor que no tenerlo. `macOS` sí, que es la forma que se escribe en la UI.
 */
const NOMBRES = ['Windows', 'macOS', 'PowerShell', 'Explorador', 'Finder', 'DPAPI', 'Llavero']

/**
 * Archivos del renderer que SÍ pueden nombrar una plataforma a pelo, con el motivo.
 * Las rutas son relativas a la raíz del repo y con `/`; el escáner normaliza.
 */
const EXCEPCIONES: readonly { archivo: string; motivo: string }[] = [
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/Integracion.tsx',
    motivo:
      'sus dos bloques se montan cada uno en UNA plataforma (`AJUSTES_POR_PLATAFORMA`), ' +
      'así que ahí el nombre es el asunto, no una variable'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/catalogo.ts',
    motivo: 'el título del grupo «Explorador de Windows», que sólo se monta en Windows'
  },
  {
    archivo: 'src/renderer/src/features/explorador/Sidebar.tsx',
    motivo:
      '«Explorador» aquí es el panel de archivos DE TESSERA, no el de Windows: es su ' +
      'nombre en la propia app y se llama igual en las dos plataformas. OJO: esta ' +
      'exención tapó durante un tiempo un «Abrir en el explorador» del menú que SÍ ' +
      'hablaba del gestor del sistema; ahora sale de `gestorArchivos`. Antes de ' +
      'escribir «Explorador» aquí, comprobar de cuál de los dos se habla.'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/Apariencia.tsx',
    motivo: 'la fila «Explorador» es el tamaño de letra del panel de archivos de Tessera'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/BasesDeDatos.tsx',
    motivo:
      'el tamaño de letra de la vista de BD hereda de la fila «Explorador» de Apariencia, ' +
      'el panel de archivos DE TESSERA, y la ayuda lo nombra por ese nombre. Nada de esta ' +
      'categoría habla del gestor de archivos del sistema; si algún día lo hace, sale de ' +
      '`gestorArchivos`'
  }
]

/** Todos los `.ts`/`.tsx` bajo una carpeta, sin los `test-*` ni los `.d.ts`. */
function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) {
      out.push(...fuentes(ruta))
      continue
    }
    if (entrada.startsWith('test-') || entrada.endsWith('.d.ts')) continue
    if (entrada.endsWith('.ts') || entrada.endsWith('.tsx')) out.push(ruta)
  }
  return out
}

/**
 * Devuelve las líneas del archivo con los COMENTARIOS en blanco y todo lo demás
 * intacto, conservando la numeración.
 *
 * SE ESCRIBIÓ ESTO EN VEZ DE «¿la línea empieza por `//`?» porque esa versión dejaba
 * cinco falsos positivos que enseñan bien por qué no basta: un comentario JSX
 * (`{/* … *\/}`), dos líneas de CONTINUACIÓN de un bloque `/* … *\/` —que no empiezan
 * por nada— y dos comentarios al final de una línea de código (`return true //
 * (Windows) / nada (Mac)`). Con un guardián que se puede callar por cualquiera de
 * esas cuatro formas, la lista de excepciones acabaría llena de archivos exentos por
 * un comentario, y un rótulo de verdad se colaría dentro de uno de ellos.
 *
 * Recorre carácter a carácter llevando dos estados: dentro de comentario de bloque y
 * dentro de cadena (`'`, `"`, `` ` ``, con escapes). Las CADENAS Y EL TEXTO JSX se
 * conservan: son justo lo que hay que inspeccionar.
 *
 * Límite aceptado: un literal de expresión regular que contenga comillas sueltas o
 * `//` podría desalinear el estado. No hay ninguno así en el renderer, y el precio
 * de equivocarse es un falso positivo ruidoso, no un fallo silencioso.
 */
function sinComentarios(fuente: string): string[] {
  const salida: string[] = []
  let enBloque = false
  for (const linea of fuente.split('\n')) {
    let out = ''
    let cita: string | null = null
    let i = 0
    while (i < linea.length) {
      const c = linea[i]
      if (enBloque) {
        if (c === '*' && linea[i + 1] === '/') {
          enBloque = false
          i += 2
        } else i++
        continue
      }
      if (cita !== null) {
        out += c
        if (c === '\\') {
          out += linea[i + 1] ?? ''
          i += 2
          continue
        }
        if (c === cita) cita = null
        i++
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        cita = c
        out += c
        i++
        continue
      }
      if (c === '/' && linea[i + 1] === '/') break
      if (c === '/' && linea[i + 1] === '*') {
        enBloque = true
        i += 2
        continue
      }
      out += c
      i++
    }
    salida.push(out)
  }
  return salida
}

/**
 * ¿La línea nombra una plataforma como PALABRA suelta?
 *
 * Se exige que el carácter anterior no sea de identificador y que el siguiente no
 * sea una letra: así `menuWindowsCarpetas`, `shellWindows` y `WindowsModeKeys` no
 * cuentan (son identificadores, no texto que alguien lea), y `'Windows (nativo)'`
 * o `«Explorador»` sí.
 */
function nombreSuelto(linea: string): string | null {
  for (const nombre of NOMBRES) {
    let i = linea.indexOf(nombre)
    while (i >= 0) {
      const antes = i === 0 ? '' : linea[i - 1]
      const despues = linea[i + nombre.length] ?? ''
      const pegadoAntes = /[A-Za-z0-9_$]/.test(antes)
      const pegadoDespues = /[A-Za-z]/.test(despues)
      if (!pegadoAntes && !pegadoDespues) return nombre
      i = linea.indexOf(nombre, i + 1)
    }
  }
  return null
}

interface Hallazgo {
  archivo: string
  linea: number
  nombre: string
  texto: string
}

/**
 * Los nombres sueltos de esos archivos, saltándose los `exentos`.
 *
 * La lista de exentos es un PARÁMETRO y no la constante, porque la comprobación (5)
 * necesita escanear un archivo exento como si no lo estuviera — es la única forma de
 * saber si su excepción sigue haciendo falta.
 */
function escanear(archivos: string[], exentos: Set<string>): Hallazgo[] {
  const out: Hallazgo[] = []
  for (const ruta of archivos) {
    const rel = relative(RAIZ, ruta).split(sep).join('/')
    if (exentos.has(rel)) continue
    const lineas = sinComentarios(readFileSync(ruta, 'utf8'))
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i]
      const nombre = nombreSuelto(linea)
      if (nombre) out.push({ archivo: rel, linea: i + 1, nombre, texto: linea.trim() })
    }
  }
  return out
}

function main(): void {
  const PLATAFORMAS: Plataforma[] = ['windows', 'mac', 'otra']

  // (1) La tabla ------------------------------------------------------------
  hr('(1) La tabla cubre las tres plataformas y no deja campos vacíos')
  for (const p of PLATAFORMAS) {
    const n = nombresSistema(p)
    const campos = Object.entries(n)
    const vacios = campos.filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    check(
      `${p}: cinco campos, ninguno vacío`,
      campos.length === 5 && vacios.length === 0,
      `${campos.length} campos, vacíos: ${vacios.length} — ${JSON.stringify(n)}`
    )
  }
  const win = nombresSistema('windows')
  const mac = nombresSistema('mac')
  const otra = nombresSistema('otra')
  check(
    'Windows y Mac no comparten NINGÚN nombre',
    (Object.keys(win) as (keyof typeof win)[]).every((k) => win[k] !== mac[k]),
    `sistema ${win.sistema}/${mac.sistema} · gestor ${win.gestorArchivos}/${mac.gestorArchivos} · ` +
      `almacén ${win.almacenSecretos}/${mac.almacenSecretos}`
  )
  check(
    "'otra' no nombra ningún sistema concreto",
    !NOMBRES.some((nombre) => Object.values(otra).some((v) => v.includes(nombre))),
    JSON.stringify(otra)
  )

  // (2) Mac ≠ macOS ---------------------------------------------------------
  hr('(2) El equipo y el sistema son dos palabras distintas en Apple')
  check(
    'mac: `tuEquipo` dice Mac y `sistema` dice macOS',
    mac.sistema === 'macOS' && mac.tuEquipo === 'tu Mac',
    `sistema="${mac.sistema}" tuEquipo="${mac.tuEquipo}"`
  )
  check(
    'windows: los dos son Windows (que es por lo que el problema no se veía)',
    win.sistema === 'Windows' && win.tuEquipo === 'tu Windows',
    `sistema="${win.sistema}" tuEquipo="${win.tuEquipo}"`
  )

  // (3) El guardián ---------------------------------------------------------
  hr('(3) Ningún nombre de plataforma escrito a mano en el renderer')
  const archivos = fuentes(join(RAIZ, 'src', 'renderer', 'src'))
  const hallazgos = escanear(archivos, new Set(EXCEPCIONES.map((e) => e.archivo)))
  check(
    `${archivos.length} archivos del renderer escaneados, 0 nombres sueltos`,
    hallazgos.length === 0,
    hallazgos.length === 0
      ? 'limpio'
      : hallazgos.map((h) => `${h.archivo}:${h.linea} [${h.nombre}] ${h.texto}`).join('\n      ')
  )

  // (4) El guardián se dispara ---------------------------------------------
  hr('(4) El guardián no es decorativo: una línea inventada lo dispara')
  check(
    "detecta 'Windows (nativo)' en una cadena",
    nombreSuelto("    label: 'Windows (nativo)',") === 'Windows',
    `-> ${nombreSuelto("    label: 'Windows (nativo)',")}`
  )
  check(
    'NO detecta identificadores que lo contienen',
    nombreSuelto('  const [menuWindowsCarpetas, setMenuWindowsCarpetas] = useState(false)') ===
      null && nombreSuelto('  setWindowsModeKeys(new Set())') === null,
    'menuWindowsCarpetas / setWindowsModeKeys -> null'
  )
  check(
    'NO detecta el id en minúscula que se persiste',
    nombreSuelto("      id: 'windows',") === null,
    "id: 'windows' -> null"
  )
  // Las CUATRO formas de comentario que produjeron falsos positivos la primera vez
  // que se corrió el guardián. Van juntas a propósito: son la razón de que
  // `sinComentarios` sea un recorredor de estados y no un `startsWith`.
  const muestra = [
    "const a = 1 // (Windows) / nada (Mac)",
    "{/* elige Windows/Docker */}",
    "/* Tessera en Windows",
    "   y su Explorador */",
    "const url = 'https://ejemplo/Windows'",
    "const rotulo = 'Windows (nativo)'"
  ].join('\n')
  const limpias = sinComentarios(muestra)
  check(
    'los cuatro tipos de comentario se descartan (línea, JSX, bloque y continuación)',
    limpias.slice(0, 4).every((l) => nombreSuelto(l) === null),
    limpias
      .slice(0, 4)
      .map((l, i) => `${i}: «${l.trim()}»`)
      .join(' · ')
  )
  check(
    'y lo que NO es comentario sobrevive: cadenas y texto JSX',
    nombreSuelto(limpias[4]) === 'Windows' && nombreSuelto(limpias[5]) === 'Windows',
    `url -> ${nombreSuelto(limpias[4])} · rótulo -> ${nombreSuelto(limpias[5])}`
  )

  // (5) Las excepciones existen y HACEN FALTA -------------------------------
  //
  // Las dos mitades, y la segunda es la que de verdad importa. «El archivo existe» deja
  // pasar una excepción MUERTA —un archivo que ya no tiene ningún nombre suelto— y una
  // excepción muerta no es inofensiva: bendice ese archivo para siempre, así que el día
  // que alguien escriba ahí «Windows (nativo)» el guardián se calla. Ya había una:
  // `ErrorBoundary.tsx` estaba exento sin tener un solo hallazgo. Exigiendo que cada
  // excepción tenga al menos UN hallazgo, la lista se poda sola.
  hr('(5) Cada excepción apunta a un archivo que existe Y que la necesita')
  for (const e of EXCEPCIONES) {
    const ruta = join(RAIZ, e.archivo)
    let existe = true
    try {
      statSync(ruta)
    } catch {
      existe = false
    }
    if (!existe) {
      check(`existe ${e.archivo}`, false, 'NO EXISTE: la excepción sobra')
      continue
    }
    // Se escanea el archivo COMO SI no estuviera exento: si no salta nada, la exención
    // ya no protege a nadie y hay que borrarla.
    const propios = escanear([ruta], new Set())
    check(
      `${e.archivo} sigue necesitando su excepción`,
      propios.length > 0,
      propios.length > 0
        ? `${propios.length} hallazgo(s), p. ej. línea ${propios[0].linea} [${propios[0].nombre}] — ${e.motivo}`
        : 'CERO hallazgos: excepción muerta, bórrala (bendice el archivo para siempre)'
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
