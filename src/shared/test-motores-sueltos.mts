#!/usr/bin/env node
// =============================================================================
// Guardia de MOTORES SUELTOS (npm run test:motores-sueltos): fuera de los módulos por motor, ni
// `motor === 'oracle'` a mano, ni capacidades del descriptor comparadas sin `switch` con `nunca`,
// ni «Oracle»/«PostgreSQL» escritos en un texto común. `[raíz]` la corre sobre otra copia del árbol.
// Lee las uniones de `FUENTES_UNIONES`, escanea `src/` salvo las ZONAS de un motor y exige que cada
// marca `motor-fijo:` y cada excepción sigan haciendo falta. Prueba que el detector se dispara.
// Decisiones: docs/decisiones/bd/registro-motores-guardia-de-motores-sueltos.md
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDS_MOTORES, MOTORES } from './motores/index.ts'
import { REGLAS } from './sql/dialectosSql.ts'

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

/** La raíz del repo: la del argumento, o la de este archivo (`src/shared/`). */
const RAIZ = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// Zonas y excepciones
// ---------------------------------------------------------------------------

/**
 * Donde un literal de motor comparado es LEGÍTIMO por diseño. Una zona que acaba en `/` es
 * una carpeta POR MOTOR: exime solo sus archivos DE UN MOTOR, los que llevan su id al
 * final del nombre (`oracle.ts`, `sesionPostgres.ts`: ver `esArchivoDeMotor`), y NO los
 * comunes de la misma carpeta (`index.ts`, `tipos.ts`, `definir.ts`, `comun.ts`,
 * `filasCatalogo.ts`…). Si no acaba en `/`, es un archivo.
 */
const ZONAS: readonly { ruta: string; motivo: string }[] = [
  {
    ruta: 'src/shared/motores/',
    motivo: 'los descriptores de cada motor (`oracle.ts`, `postgres.ts`): es donde se DECLARA lo que cambia de un motor a otro'
  },
  {
    ruta: 'src/shared/escrituraSql/',
    motivo: 'cómo escribe SQL cada motor (literales, guion INSERT, vista previa): un archivo por motor'
  },
  {
    ruta: 'src/main/db/explorador/motores/',
    motivo:
      'CatalogoExplorador/SesionExplorador de cada motor (`catalogoOracle.ts`, `sesionPostgres.ts`…): ' +
      'archivos de un solo motor, con guardas que comparan con su propio literal'
  },
  {
    // Como carpeta: exime solo lo que acaba en el id del motor (`oracle.cjs`, `sesionPostgres.cjs`
    // y las piezas que se partan de ellos con el mismo sufijo); `tdb.cjs`, `sesion.cjs`,
    // `motores.cjs` y `celdas.cjs` son comunes y se escanean enteros.
    ruta: 'src/tdb/',
    motivo: 'adaptadores de `tdb` y trabajadores de sesión de un solo motor, y sus piezas'
  },
  // Lo común de un motor para `tdb` y su trabajador no acaba en el id: va por su ruta.
  {
    ruta: 'src/tdb/sqliteComun.cjs',
    motivo: 'lo común de SQLite para `tdb` y su trabajador (apertura, autorizador, celdas): de un solo motor'
  },
  {
    ruta: 'src/tdb/sqlserverComun.cjs',
    motivo: 'lo común de SQL Server para `tdb` y su trabajador (conexión tedious, errores, valores exactos, celdas): de un solo motor'
  },
  {
    ruta: 'src/tdb/redisComun.cjs',
    motivo: 'lo común de Redis para `tdb` y su trabajador (conexión ioredis, comandos, política, valores): de un solo motor'
  }
]

/**
 * Archivos fuera de las zonas que SÍ pueden tener un motor suelto, con el motivo. Vacía
 * a propósito: lo de un solo motor dentro de un archivo común va con la marca
 * `motor-fijo:` en su línea, que es más estrecha que eximir el archivo entero.
 */
const EXCEPCIONES: readonly { archivo: string; motivo: string }[] = []

/**
 * Textos de UN motor por diseño que nombran su producto fuera de las zonas (o, en un archivo de
 * un motor de una zona, el de OTRO: ver `escanearAjenos`). `texto` es un
 * trozo EXACTO del literal o del texto de JSX que exime, y exime ESE trozo y nada más (se
 * quita y lo que queda se vuelve a mirar: ver `nombreDeProducto`); sin él, el archivo
 * entero, y solo para un archivo que es todo de un motor. (5) exige que cada una siga
 * eximiendo algo.
 */
const EXCEPCIONES_NOMBRE: readonly { archivo: string; texto?: string; motivo: string }[] = [
  {
    archivo: 'src/main/db/driverPacks.ts',
    motivo: 'el catálogo de packs del Instant Client (`usaClientes` de Oracle): el archivo entero es de los clientes de Oracle'
  },
  {
    archivo: 'src/main/db/DriverManager.ts',
    texto: 'Oracle ya no publica ',
    motivo: 'la descarga de un pack del Instant Client: quien lo publica es Oracle'
  },
  {
    archivo: 'src/tdb/motores.cjs',
    motivo: 'la copia CJS del registro (`etiqueta` de cada motor), cruzada con `shared/motores` por test:motores-tdb'
  },
  {
    archivo: 'src/main/db/explorador/planSql.ts',
    texto: 'Oracle no mira el valor de los parámetros al explicar',
    motivo: 'AVISO_BINDS_ORACLE: el aviso del EXPLAIN PLAN de Oracle, que solo elige `motores/sesionOracle.ts`'
  },
  // En archivos DE UN MOTOR de una zona (`escanearAjenos`): el nombre de OTRO motor, por diseño.
  {
    archivo: 'src/main/db/explorador/motores/catalogoPostgres.ts',
    texto: 'Los tipos declarados solo se leen de Oracle',
    motivo: 'el rechazo de pedir tipos declarados a un motor que no los necesita: dice cuál sí los tiene'
  },
  {
    archivo: 'src/main/db/explorador/motores/catalogoSqlserver.ts',
    texto: 'Los tipos declarados solo se leen de Oracle',
    motivo: 'el rechazo de pedir tipos declarados a un motor que no los necesita: dice cuál sí los tiene'
  },
  {
    archivo: 'src/main/db/explorador/lecturaSegura.ts',
    texto: 'este smoke es solo de Oracle',
    motivo: 'el smoke de lectura segura es de Oracle (la línea de arriba lleva su `motor-fijo:`)'
  },
  {
    archivo: 'src/renderer/src/features/bd/consola/lenguajeConsola.ts',
    texto: 'Oracle SQL (consola)',
    motivo: 'el nombre del lenguaje de Monaco de la consola de Oracle (`tessera-oracle-sql`)'
  },
  {
    archivo: 'src/renderer/src/features/bd/consola/lenguajeConsola.ts',
    texto: 'SQLite (consola)',
    motivo: 'el nombre del lenguaje de Monaco de la consola de SQLite (`tessera-sqlite-sql`)'
  },
  {
    archivo: 'src/main/db/explorador/maquinaSesion.ts',
    texto: 'o un DDL de Oracle',
    motivo:
      'explica POR QUÉ una sentencia se confirma sola; el caso del DDL es el de Oracle y el texto ' +
      'es el mismo en todos los motores (cambiarlo cambiaría el de PG)'
  },
  {
    archivo: 'src/main/db/agentMemoryBlock.ts',
    texto: 'Oracle responde ORA-01456',
    motivo: 'un EJEMPLO en las instrucciones del agente (qué hace el servidor con una escritura en solo lectura)'
  },
  {
    archivo: 'src/main/db/shims.ts',
    texto: 'un hint de Oracle al principio del SQL',
    motivo: 'un comentario del guion de shell generado: el ejemplo de argumento que MSYS rompería'
  },
  // Texto de JSX (la guardia también lo mira).
  {
    archivo: 'src/renderer/src/features/bd/DriversLista.tsx',
    texto: 'Oracle ya no lo publica para descarga directa',
    motivo: 'un pack del Instant Client que no se puede bajar: quien lo publica es Oracle'
  },
  {
    archivo: 'src/renderer/src/features/bd/DriversLista.tsx',
    texto: 'Solo hacen falta para Oracle anterior a 12.1.',
    motivo:
      'los clientes de esta lista son los packs del Instant Client, de Oracle por diseño; la frase de los motores ' +
      'que NO los necesitan sale del registro (`ayudaSinClientes`)'
  },
  {
    archivo: 'src/renderer/src/features/bd/DbConexionDialogo.tsx',
    texto: 'Oracle ya no lo publica para descarga directa',
    motivo: 'el aviso de un pack del Instant Client que no se puede bajar: quien lo publica es Oracle'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/Acerca.tsx',
    texto: 'Postgres, PostgreSQL y el logo del elefante (Slonik) son marcas',
    motivo: 'la atribución de marcas de «Acerca de»: nombra a cada titular por diseño (el logo del árbol es el de PostgreSQL)'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/Acerca.tsx',
    texto: 'de la PostgreSQL Community Association of Canada, y se usan con su permiso. Oracle es',
    motivo: 'la atribución de marcas de «Acerca de» (sigue)'
  },
  {
    archivo: 'src/renderer/src/features/ajustes/categorias/Acerca.tsx',
    texto: 'una marca registrada de Oracle y/o sus filiales.',
    motivo: 'la atribución de marcas de «Acerca de» (sigue)'
  }
]

const EXTENSIONES = ['.ts', '.tsx', '.cjs', '.mjs', '.js', '.mts']

/**
 * ¿Es `rel` el archivo de UN motor? Su nombre (sin extensión) acaba en el id de un motor
 * del registro, sin distinguir mayúsculas: `oracle.ts`, `catalogoOracle.ts`,
 * `sesionPostgres.ts`. Un archivo de un motor que aún no está en el registro NO lo es: se
 * escanea y, si compara con su literal, falla (el lado ruidoso, no el silencioso).
 */
export function esArchivoDeMotor(rel: string, ids: readonly string[] = IDS_MOTORES): boolean {
  return motorDelArchivo(rel, ids) !== null
}

/** El motor de un archivo DE UN MOTOR (el id en que acaba su nombre), o null. */
export function motorDelArchivo(rel: string, ids: readonly string[] = IDS_MOTORES): string | null {
  const base = rel
    .slice(rel.lastIndexOf('/') + 1)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
  return ids.find((m) => base.endsWith(m.toLowerCase())) ?? null
}

/** ¿Está `rel` en una zona? En una carpeta, solo sus archivos de un motor, sin subcarpetas. */
export function enZona(rel: string, ids: readonly string[] = IDS_MOTORES): boolean {
  return ZONAS.some((z) =>
    z.ruta.endsWith('/')
      ? rel.startsWith(z.ruta) && rel.indexOf('/', z.ruta.length) < 0 && esArchivoDeMotor(rel, ids)
      : rel === z.ruta
  )
}

/** Los fuentes bajo una carpeta, sin tests (`test-*`) ni declaraciones (`.d.ts`). */
function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) {
      if (entrada === 'node_modules') continue
      out.push(...fuentes(ruta))
      continue
    }
    if (entrada.startsWith('test-') || entrada.endsWith('.d.ts')) continue
    if (EXTENSIONES.some((e) => entrada.endsWith(e))) out.push(ruta)
  }
  return out
}

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

/**
 * Las líneas con los COMENTARIOS en blanco y todo lo demás intacto, conservando la
 * numeración. Es el recorredor de `test-nombres-sistema.mts` (allí está el porqué de
 * que no baste con «¿empieza por `//`?»): comentarios de línea, de bloque, de
 * continuación y JSX fuera; cadenas dentro.
 */
export function sinComentarios(fuente: string): string[] {
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
    salida.push(out.replace(/\r$/, ''))
  }
  return salida
}

/** El contenido de los literales de cadena de una línea SIN comentarios (por línea). */
export function literalesDe(linea: string): string[] {
  const salida: string[] = []
  let cita: string | null = null
  let actual = ''
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (cita !== null) {
      if (c === '\\') {
        actual += c + (linea[i + 1] ?? '')
        i++
        continue
      }
      if (c === cita) {
        salida.push(actual)
        cita = null
        actual = ''
        continue
      }
      actual += c
      continue
    }
    if (c === '"' || c === "'" || c === '`') cita = c
  }
  // Una plantilla que sigue en la línea de abajo: lo que va de ella en esta.
  if (cita !== null && actual !== '') salida.push(actual)
  return salida
}

/** Las expresiones que reconocen un literal de motor suelto, para una lista de ids. */
export interface DetectorMotores {
  comparacion: RegExp[]
  pertenencia: RegExp
  lista: RegExp
  caso: RegExp
}

/**
 * El detector de motores sueltos para los ids dados: los del REGISTRO (`IDS_MOTORES`), no
 * una lista escrita aquí. Antes era `(oracle|postgres)` a
 * mano, y el día que 'sqlite' entrase en `DbMotor` un `motor === 'sqlite'` en código común
 * habría pasado la guardia sin que nadie se acordara de este archivo: justo lo que existe
 * para cazar. La comilla del literal es SIEMPRE el grupo 1 (lo demás va sin capturar), para
 * que la referencia `\1` cierre con la misma comilla que abrió.
 */
export function detectorMotores(ids: readonly string[]): DetectorMotores {
  const alternativas = ids.map(escaparRe).join('|')
  const lit = `(['"\`])(?:${alternativas})`
  return {
    comparacion: [new RegExp(`(?:===|!==|==|!=)\\s*${lit}\\1`), new RegExp(`${lit}\\1\\s*(?:===|!==|==|!=)`)],
    pertenencia: new RegExp(`\\.(?:includes|indexOf)\\(\\s*${lit}\\1`),
    lista: new RegExp(`${lit}\\1\\s*,\\s*(['"\`])(?:${alternativas})\\2`),
    caso: new RegExp(`\\bcase\\s+${lit}\\1\\s*:`)
  }
}

const escaparRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const DETECTOR: DetectorMotores = detectorMotores(IDS_MOTORES)

type Forma =
  | 'comparación'
  | 'pertenencia'
  | 'lista a mano'
  | 'case sin nunca'
  | 'capacidad comparada'
  | 'case de capacidad sin nunca'
  | 'nombre de producto'

/** La forma de motor suelto que tiene la línea (sin comentarios), sin mirar `case`. */
export function formaSuelta(linea: string, det: DetectorMotores = DETECTOR): Forma | null {
  if (det.comparacion.some((r) => r.test(linea))) return 'comparación'
  if (det.pertenencia.test(linea)) return 'pertenencia'
  if (det.lista.test(linea)) return 'lista a mano'
  return null
}

// --- Las uniones del descriptor y de REGLAS -----------------------------------------

/** Un campo cuyo tipo es una unión de literales, con esos literales. */
export interface CampoUnion {
  campo: string
  literales: string[]
  /** El fuente del que se leyó, relativo a la raíz. */
  archivo: string
  /** De dónde se leyó (`archivo › campo`), para el informe. */
  origen: string
}

/**
 * Los campos de unión de un fuente de TIPOS: las `export type X = 'a' | 'b'` y, en sus
 * interfaces, cada campo cuyo tipo es una de ellas o una unión de literales escrita en el
 * sitio (`'a' | 'b' | null`). Un campo de tipo lista (`readonly X[]`) no cuenta: no se
 * compara con `===`.
 *
 * Y el DISCRIMINANTE de una unión discriminada: un campo cuyo tipo es UN
 * literal que pertenece a UNA SOLA de las uniones con nombre del archivo (`familia: 'sql'`
 * en `DescriptorSql`, con `FamiliaMotor = 'sql' | 'documentos' | 'claves'`) lleva los
 * literales de esa unión. Sin esto, `d.familia === 'sql'` pasaba la guardia: ninguna
 * interfaz declara `familia: FamiliaMotor`, cada miembro del descriptor lleva el suyo. Si el
 * literal está en dos uniones con nombre, no se adivina cuál es (se deja fuera).
 */
export function leerUniones(archivo: string, fuente: string): CampoUnion[] {
  const texto = sinComentarios(fuente).join('\n')
  const nombradas = new Map<string, string[]>()
  for (const m of texto.matchAll(/\bexport\s+type\s+(\w+)\s*=\s*((?:\|?\s*'[^'\n]*'\s*)+)(?=;|\n|$)/g)) {
    nombradas.set(m[1], [...m[2].matchAll(/'([^'\n]*)'/g)].map((x) => x[1]))
  }
  const campos: CampoUnion[] = []
  for (const m of texto.matchAll(/^[ \t]*(?:readonly[ \t]+)?(\w+)\??[ \t]*:[ \t]*([^;{}()\n=]+?)[ \t]*;?[ \t]*$/gm)) {
    const tipo = m[2].trim()
    let literales: string[] | null = null
    if (nombradas.has(tipo)) literales = nombradas.get(tipo) as string[]
    else if (/^(?:'[^'\n]*'|null)(?:\s*\|\s*(?:'[^'\n]*'|null))+$/.test(tipo)) {
      literales = [...tipo.matchAll(/'([^'\n]*)'/g)].map((x) => x[1])
    } else {
      const solo = /^'([^'\n]*)'$/.exec(tipo)
      const suyas = solo ? [...nombradas.values()].filter((lits) => lits.indexOf(solo[1]) >= 0) : []
      if (suyas.length === 1) literales = suyas[0]
    }
    if (literales && literales.length > 0) campos.push({ campo: m[1], literales, archivo, origen: `${archivo} › ${m[1]}` })
  }
  return campos
}

/**
 * Las fuentes de las uniones, relativas a la raíz: los CONTRATOS de lo que cambia de un
 * motor a otro. El descriptor y `REGLAS`; el de la escritura de SQL de cada motor; y los de
 * su código del main (`CatalogoExplorador`, `SesionExplorador`), donde se llevó
 * la forma de esperar un bloqueo (`FormaEsperaBloqueo`, campo `forma`)
 * cuando dejó de ser una bandera del descriptor.
 */
const FUENTES_UNIONES = [
  'src/shared/motores/tipos.ts',
  'src/shared/sql/dialectosSql.ts',
  'src/shared/escrituraSql/tipos.ts',
  'src/main/db/explorador/motores/tipos.ts',
  'src/main/db/explorador/motores/catalogo.ts',
  'src/main/db/explorador/motores/sesion.ts'
]

function unionesDe(raiz: string): CampoUnion[] {
  const salida: CampoUnion[] = []
  for (const rel of FUENTES_UNIONES) {
    let fuente = ''
    try {
      fuente = readFileSync(join(raiz, rel), 'utf8')
    } catch {
      continue
    }
    salida.push(...leerUniones(rel, fuente))
  }
  return salida
}

const UNIONES: CampoUnion[] = unionesDe(RAIZ)

/**
 * ¿Algún archivo DE UN MOTOR de la carpeta del contrato da a su campo uno de sus literales
 * (`forma: 'porFila'`)? Es la prueba de vida de las uniones cuyo valor no está en el
 * descriptor ni en `REGLAS` sino en el código de cada motor.
 */
function valorEnArchivosDeMotor(u: CampoUnion): boolean {
  const carpeta = u.archivo.slice(0, u.archivo.lastIndexOf('/') + 1)
  const re = new RegExp(`\\b${u.campo}\\s*:\\s*(['"\`])(?:${u.literales.map(escaparRe).join('|')})\\1`)
  let nombres: string[] = []
  try {
    nombres = readdirSync(join(RAIZ, carpeta))
  } catch {
    return false
  }
  return nombres
    .filter((f) => !f.startsWith('test-') && esArchivoDeMotor(carpeta + f))
    .some((f) => re.test(sinComentarios(readFileSync(join(RAIZ, carpeta, f), 'utf8')).join('\n')))
}

interface ReglaUnion {
  union: CampoUnion
  directa: RegExp
  inversa: RegExp
}
// En la forma inversa (`'porFila' === x.forma`) la cadena hasta el campo puede llevar
// llamadas e índices sin espacios (`motorExplorador(m).sesion.esperaBloqueo.forma`,
// `REGLAS[d].explain`): antes solo admitía puntos, y esas se escapaban.
const REGLAS_UNION: ReglaUnion[] = UNIONES.map((u) => {
  const lits = u.literales.map(escaparRe).join('|')
  return {
    union: u,
    directa: new RegExp(`\\b${u.campo}\\s*(?:===|!==|==|!=)\\s*(['"\`])(?:${lits})\\1`),
    inversa: new RegExp(`(['"\`])(?:${lits})\\1\\s*(?:===|!==|==|!=)\\s*[\\w$.?!()[\\]]*\\b${u.campo}(?![\\w$(])`)
  }
})

/** ¿Compara la línea un campo de unión con uno de sus literales? El campo, o null. */
export function capacidadComparada(linea: string): string | null {
  for (const r of REGLAS_UNION) if (r.directa.test(linea) || r.inversa.test(linea)) return r.union.campo
  return null
}

const CASE_LITERAL = /\bcase\s+(['"`])([^'"`\n]*)\1\s*:/

// --- Los nombres de producto -----------------------------------------------------------

/** Las etiquetas del registro (hoy «Oracle» y «PostgreSQL»), como palabras enteras. */
const NOMBRES_PRODUCTO = new RegExp(`\\b(?:${IDS_MOTORES.map((m) => escaparRe(MOTORES[m].etiqueta)).join('|')})\\b`)
const NOMBRES_PRODUCTO_TODOS = new RegExp(NOMBRES_PRODUCTO.source, 'g')

/**
 * Lo que queda de una línea SIN comentarios al quitarle sus literales de cadena: el código
 * y, en un `.tsx`, el TEXTO DE JSX (`<p>Solo Oracle…</p>`), que no va entre comillas. Por
 * línea, como `literalesDe`: la línea de en medio de una plantilla de varias líneas también
 * cae aquí, porque el recorredor no arrastra la comilla de una línea a otra.
 */
export function fueraDeLiterales(linea: string): string {
  let out = ''
  let cita: string | null = null
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (cita !== null) {
      if (c === '\\') i++
      else if (c === cita) cita = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      cita = c
      out += ' '
      continue
    }
    out += c
  }
  return out
}

/**
 * Un nombre fuera de un literal que es un IDENTIFICADOR y no prosa: detrás de una palabra
 * clave que declara o importa (`const Oracle`, `import Redis`, `new Redis`), de un acceso
 * (`x.Oracle`) o de una etiqueta JSX (`<Oracle`); o delante de una llamada, un genérico,
 * una asignación o un acceso (`Oracle(`, `Oracle<`, `Oracle =`, `Oracle.x`). El punto que
 * cierra una frase («…en Oracle.») no es un acceso.
 */
const ANTES_DE_IDENTIFICADOR =
  /(?:(?:^|[^\w$])(?:import|new|const|let|var|class|type|interface|enum|extends|implements|typeof|instanceof|keyof|as|function)\s+|\??\.|<\/?)$/
const DESPUES_DE_IDENTIFICADOR = /^\s*(?:\(|<|=(?![=>])|\.[\w$])/

/** ¿Nombra el código (o el texto de JSX) un producto como PROSA? */
export function nombraEnProsa(codigo: string): boolean {
  for (const m of codigo.matchAll(NOMBRES_PRODUCTO_TODOS)) {
    const i = m.index ?? 0
    if (!ANTES_DE_IDENTIFICADOR.test(codigo.slice(0, i)) && !DESPUES_DE_IDENTIFICADOR.test(codigo.slice(i + m[0].length))) {
      return true
    }
  }
  return false
}

/**
 * Las posiciones del texto que están DENTRO de una cadena, para que las llaves de
 * `'{'` o de un mensaje no descuadren el recuento. Por línea, como `sinComentarios`.
 */
function mascaraCadenas(texto: string): boolean[] {
  const dentro: boolean[] = new Array(texto.length).fill(false)
  let cita: string | null = null
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '\n') {
      cita = null
      continue
    }
    if (cita !== null) {
      dentro[i] = true
      if (c === '\\') {
        dentro[i + 1] = true
        i++
        continue
      }
      if (c === cita) cita = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      cita = c
      dentro[i] = true
    }
  }
  return dentro
}

/** El `switch` que contiene una posición: su expresión y si cierra con `nunca`. */
interface SwitchDe {
  discriminante: string
  conNunca: boolean
}

/**
 * El `switch (…) {` más cercano cuyo bloque CONTIENE la posición `pos` (el más interno):
 * el texto de su expresión y si, dentro de ese bloque, a profundidad 1, hay un `default`
 * seguido de `nunca(` antes del cierre. El `nunca` de un switch anidado no cuenta: la
 * profundidad se lleva desde la llave del switch que se examina. null si no hay ninguno.
 */
export function switchDe(texto: string, pos: number): SwitchDe | null {
  const cadena = mascaraCadenas(texto)
  const re = /\bswitch\s*\(/g
  const inicios: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    if (m.index >= pos) break
    if (!cadena[m.index]) inicios.push(m.index)
  }
  for (let k = inicios.length - 1; k >= 0; k--) {
    // La llave que abre el bloque: la primera `{` fuera de cadena tras cerrar el paréntesis.
    const parenAbre = inicios[k] + texto.slice(inicios[k]).indexOf('(')
    let i = parenAbre
    let par = 0
    for (; i < texto.length; i++) {
      if (cadena[i]) continue
      if (texto[i] === '(') par++
      else if (texto[i] === ')') {
        par--
        if (par === 0) break
      }
    }
    const discriminante = texto.slice(parenAbre + 1, i)
    while (i < texto.length && (texto[i] !== '{' || cadena[i])) i++
    const abre = i
    let prof = 0
    let cierra = -1
    let defaultEn = -1
    for (let j = abre; j < texto.length; j++) {
      if (cadena[j]) continue
      const c = texto[j]
      if (c === '{') prof++
      else if (c === '}') {
        prof--
        if (prof === 0) {
          cierra = j
          break
        }
      } else if (prof === 1 && c === 'd' && /^default\b/.test(texto.slice(j, j + 8)) && !/[\w$]/.test(texto[j - 1] ?? '')) {
        defaultEn = j
      }
    }
    if (cierra < 0 || !(abre < pos && pos < cierra)) continue
    return { discriminante, conNunca: defaultEn >= 0 && /\bnunca\s*\(/.test(texto.slice(defaultEn, cierra)) }
  }
  return null
}

/** ¿El `case` que está en `pos` pertenece a un `switch` que cierra con `nunca`? */
export function caseConNunca(texto: string, pos: number): boolean {
  return switchDe(texto, pos)?.conNunca ?? false
}

interface Hallazgo {
  archivo: string
  linea: number
  forma: Forma
  texto: string
}

interface Escaneo {
  hallazgos: Hallazgo[]
  /** Líneas con la marca `motor-fijo:` en código, y si eximían algo. */
  marcas: { archivo: string; linea: number; necesaria: boolean; texto: string }[]
}

/** Las excepciones de nombre que eximieron algo en este escaneo (para (5)). */
const excepcionesUsadas = new Set<(typeof EXCEPCIONES_NOMBRE)[number]>()

/**
 * ¿Nombra la línea un producto, en un literal o en texto de JSX, que ninguna excepción
 * exime? Una excepción con `texto` exime ESE texto y nada más: se quita del trozo y lo que
 * queda se vuelve a mirar. Así «Solo hacen falta para Oracle anterior a 12.1. PostgreSQL no
 * necesita ninguno.» sigue marcado por su segunda frase aunque la primera esté exenta (era
 * justo lo que había en una versión anterior de `DriversLista.tsx`).
 */
function nombreDeProducto(rel: string, linea: string, soloEnLiterales?: RegExp): boolean {
  const propias = EXCEPCIONES_NOMBRE.filter((x) => x.archivo === rel)
  const trozos: Array<{ texto: string; nombra: (s: string) => boolean }> = soloEnLiterales
    ? literalesDe(linea).map((texto) => ({ texto, nombra: (s: string) => soloEnLiterales.test(s) }))
    : [
        ...literalesDe(linea).map((texto) => ({ texto, nombra: (s: string) => NOMBRES_PRODUCTO.test(s) })),
        { texto: fueraDeLiterales(linea), nombra: nombraEnProsa }
      ]
  for (const t of trozos) {
    if (!t.nombra(t.texto)) continue
    const entera = propias.find((x) => x.texto === undefined)
    if (entera) {
      excepcionesUsadas.add(entera)
      continue
    }
    let resto = t.texto
    for (const x of propias) {
      if (x.texto !== undefined && resto.includes(x.texto)) {
        excepcionesUsadas.add(x)
        resto = resto.split(x.texto).join(' ')
      }
    }
    if (t.nombra(resto)) return true
  }
  return false
}

/** Los motores sueltos de un texto fuente (una ruta relativa solo para el informe). */
export function escanearTexto(rel: string, fuente: string): Escaneo {
  const crudas = fuente.split('\n')
  const lineas = sinComentarios(fuente)
  const texto = lineas.join('\n')
  const hallazgos: Hallazgo[] = []
  const marcas: Escaneo['marcas'] = []
  let offset = 0
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    let forma: Forma | null = formaSuelta(linea)
    if (forma === null) {
      const mc = DETECTOR.caso.exec(linea)
      if (mc && !caseConNunca(texto, offset + mc.index)) forma = 'case sin nunca'
    }
    if (forma === null && capacidadComparada(linea) !== null) forma = 'capacidad comparada'
    if (forma === null) {
      // Un `case 'literal':` de una unión, en un switch sobre ESE campo y sin `nunca`.
      const mc = CASE_LITERAL.exec(linea)
      if (mc) {
        const sw = switchDe(texto, offset + mc.index)
        if (
          sw !== null &&
          !sw.conNunca &&
          UNIONES.some((u) => u.literales.indexOf(mc[2]) >= 0 && new RegExp(`\\b${u.campo}\\b`).test(sw.discriminante))
        ) {
          forma = 'case de capacidad sin nunca'
        }
      }
    }
    if (forma === null && nombreDeProducto(rel, linea)) forma = 'nombre de producto'
    // La marca solo exime si va en una línea con CÓDIGO (no un comentario de línea entera).
    const marcada = linea.trim() !== '' && /motor-fijo:\s*\S/.test(crudas[i])
    if (marcada) marcas.push({ archivo: rel, linea: i + 1, necesaria: forma !== null, texto: crudas[i].trim() })
    else if (forma !== null) hallazgos.push({ archivo: rel, linea: i + 1, forma, texto: linea.trim() })
    offset += linea.length + 1
  }
  return { hallazgos, marcas }
}

/**
 * En un archivo DE UN MOTOR de una zona, lo único que no puede haber: OTRO motor. Su id comparado
 * (`motor === 'oracle'` en `ddlPostgres.ts`) o su etiqueta en un literal («… de Oracle» en un texto de
 * PostgreSQL). El propio motor sí, que es para lo que existe la zona. Medido al escribirlo: dos textos
 * en todo el árbol, los dos de diseño (excepciones de nombre con su motivo).
 */
export function escanearAjenos(rel: string, fuente: string): Escaneo {
  const propio = motorDelArchivo(rel)
  if (propio === null) return { hallazgos: [], marcas: [] }
  const ajenos = IDS_MOTORES.filter((m) => m !== propio)
  const det = detectorMotores(ajenos)
  const nombres = new RegExp(`\\b(?:${ajenos.map((m) => escaparRe(MOTORES[m].etiqueta)).join('|')})\\b`)
  const crudas = fuente.split('\n')
  const lineas = sinComentarios(fuente)
  const hallazgos: Hallazgo[] = []
  const marcas: Escaneo['marcas'] = []
  lineas.forEach((linea, i) => {
    let forma: Forma | null = formaSuelta(linea, det)
    if (forma === null && nombreDeProducto(rel, linea, nombres)) forma = 'nombre de producto'
    const marcada = linea.trim() !== '' && /motor-fijo:\s*\S/.test(crudas[i])
    if (marcada) marcas.push({ archivo: rel, linea: i + 1, necesaria: forma !== null, texto: crudas[i].trim() })
    else if (forma !== null) hallazgos.push({ archivo: rel, linea: i + 1, forma, texto: `${linea.trim()} (archivo de ${propio})` })
  })
  return { hallazgos, marcas }
}

function escanear(archivos: string[], exentos: Set<string>): Escaneo {
  const total: Escaneo = { hallazgos: [], marcas: [] }
  for (const ruta of archivos) {
    const rel = relative(RAIZ, ruta).split(sep).join('/')
    if (exentos.has(rel)) continue
    const r = enZona(rel) ? escanearAjenos(rel, readFileSync(ruta, 'utf8')) : escanearTexto(rel, readFileSync(ruta, 'utf8'))
    total.hallazgos.push(...r.hallazgos)
    total.marcas.push(...r.marcas)
  }
  return total
}

/** Los valores de un campo por todo un objeto (el descriptor o una fila de REGLAS). */
function valoresDeCampo(x: unknown, campo: string, salida: unknown[] = []): unknown[] {
  if (x === null || typeof x !== 'object') return salida
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (k === campo && (typeof v === 'string' || v === null)) salida.push(v)
    else valoresDeCampo(v, campo, salida)
  }
  return salida
}

function main(): void {
  console.log(`raíz escaneada: ${RAIZ}`)

  // (0) Las uniones ------------------------------------------------------------
  hr('(0) Las uniones que se leen de los contratos (descriptor, REGLAS, escritura, código del main)')
  const deUnion = (campo: string): string[] | undefined => UNIONES.find((u) => u.campo === campo)?.literales
  const esperadas: Array<[string, string[]]> = [
    ['identidadSinPk', ['rowid', 'unicaNoNula']],
    // SQLite: 'autorizador', 'keyset', 'queryPlan', 'sqliteMixto', 'porArchivo', y
    // la unión nueva de las credenciales.
    // SQL Server: 'clasificadorYEnvoltorio', 'offsetFetch', 'showplan', 'ninguno', y
    // la unión nueva del nivel «Bases».
    // MongoDB y Redis: 'listaBlanca', y la unión nueva de la FAMILIA, que se
    // lee del discriminante (`familia: 'sql'` en `DescriptorSql`: ver `leerUniones`).
    ['candadoSoloLectura', ['transaccionSoloLectura', 'envoltorioRollback', 'autorizador', 'clasificadorYEnvoltorio', 'listaBlanca']],
    ['familia', ['sql', 'documentos', 'claves']],
    ['rejilla', ['cursor', 'rownum', 'limitOffset', 'keyset', 'offsetFetch']],
    ['explain', ['planFor', 'conOpciones', 'queryPlan', 'showplan']],
    ['estiloParametros', ['dosPuntosNombre', 'dolarNumero', 'sqliteMixto', 'ninguno']],
    ['nivelBases', ['ninguno', 'sinBaseFija']],
    ['credenciales', ['usuarioClave', 'ninguna']],
    // La forma de esperar un bloqueo: ya no es una bandera del descriptor sino el campo
    // `forma` de la espera de la sesión de cada motor, en el main.
    ['forma', ['porFila', 'porTransaccion', 'porArchivo']]
  ]
  check(
    'la espera de bloqueos ya no se lee del descriptor (se quitó: era copia de la sesión del main)',
    deUnion('esperaBloqueo') === undefined,
    JSON.stringify(deUnion('esperaBloqueo'))
  )
  for (const [campo, lits] of esperadas) {
    check(`se lee la unión de «${campo}»`, JSON.stringify(deUnion(campo)) === JSON.stringify(lits), JSON.stringify(deUnion(campo)))
  }
  check(
    `${UNIONES.length} campos de unión leídos (ninguno de tipo lista)`,
    UNIONES.length >= 10 && !UNIONES.some((u) => u.campo === 'obligatorios' || u.campo === 'admitidas'),
    UNIONES.map((u) => u.campo).join(', ')
  )
  // Si el lector se rompe (lee otra cosa que no son las uniones), ningún valor real casa.
  // No se exige que TODOS los valores de un campo con ese nombre casen: dos interfaces
  // pueden llamar igual a campos distintos (`sql.dialecto` y `formateador.dialecto`). Los
  // valores reales salen del descriptor y de `REGLAS` (en ejecución) o, para los contratos
  // cuyo valor escribe el código de cada motor (la escritura, el main), de los archivos DE
  // UN MOTOR de su carpeta, como texto (`forma: 'porFila'` en `sesionOracle.ts`): esta
  // guardia no importa código del main.
  const vacias: string[] = []
  for (const u of UNIONES) {
    const reales: unknown[] = []
    for (const m of IDS_MOTORES) valoresDeCampo(MOTORES[m], u.campo, reales)
    for (const d of Object.keys(REGLAS) as Array<keyof typeof REGLAS>) valoresDeCampo(REGLAS[d], u.campo, reales)
    const enVivo = reales.some((v) => typeof v === 'string' && u.literales.indexOf(v) >= 0)
    if (!enVivo && !valorEnArchivosDeMotor(u)) vacias.push(`${u.origen} ${JSON.stringify(u.literales)}`)
  }
  check('cada unión leída tiene algún valor real (descriptor, REGLAS o el código de un motor)', vacias.length === 0, vacias.join(' · ') || 'todas')

  // (1) Las zonas existen ---------------------------------------------------
  hr('(1) Las zonas exentas existen')
  for (const z of ZONAS) {
    let existe = true
    let deMotor: string[] = []
    try {
      const st = statSync(join(RAIZ, z.ruta))
      existe = z.ruta.endsWith('/') ? st.isDirectory() : st.isFile()
      // Una carpeta por motor sin ningún archivo de un motor no exime nada: sobra.
      if (existe && z.ruta.endsWith('/')) {
        deMotor = readdirSync(join(RAIZ, z.ruta)).filter((f) => !f.startsWith('test-') && enZona(z.ruta + f))
        existe = deMotor.length > 0
      }
    } catch {
      existe = false
    }
    check(
      `zona ${z.ruta}`,
      existe,
      existe ? `${z.motivo}${deMotor.length ? ` — exime: ${deMotor.join(', ')}` : ''}` : 'NO EXISTE (o no tiene archivos de un motor): la zona está mal escrita o sobra'
    )
  }

  // (2) La guardia ----------------------------------------------------------
  hr('(2) Ningún motor suelto, capacidad comparada ni nombre de producto fuera de las zonas')
  const archivos = fuentes(join(RAIZ, 'src'))
  const exentos = new Set(EXCEPCIONES.map((e) => e.archivo))
  excepcionesUsadas.clear()
  const r = escanear(archivos, exentos)
  const usadasEnElArbol = new Set(excepcionesUsadas)
  // Los contratos de las familias nuevas son COMUNES (los importan el main
  // y el renderer para cualquier motor de su familia): se escanean como los demás.
  const contratosOtrasFamilias = ['src/shared/db-documentos-ipc.ts', 'src/shared/db-claves-ipc.ts']
  const relsEscaneados = new Set(archivos.map((a) => relative(RAIZ, a).split(sep).join('/')))
  check(
    'los contratos de documentos y claves se escanean como comunes (ni zona ni excepción)',
    contratosOtrasFamilias.every((c) => relsEscaneados.has(c) && !enZona(c) && !exentos.has(c)),
    contratosOtrasFamilias.map((c) => `${c}: ${relsEscaneados.has(c) ? 'escaneado' : 'NO ESTÁ'}${enZona(c) ? ', EN ZONA' : ''}`).join(' · ')
  )
  const remedio: Record<Forma, string> = {
    comparación: 'motor',
    pertenencia: 'motor',
    'lista a mano': 'motor',
    'case sin nunca': 'motor',
    'capacidad comparada': 'capacidad',
    'case de capacidad sin nunca': 'capacidad',
    'nombre de producto': 'nombre'
  }
  for (const tipo of ['motor', 'capacidad', 'nombre']) {
    const suyos = r.hallazgos.filter((h) => remedio[h.forma] === tipo)
    const consejo =
      tipo === 'motor'
        ? 'pásalo al descriptor (src/shared/motores), a REGLAS, a un Record<DbMotor, …> o a un switch que cierre con nunca(x); si es código de UN solo motor, `// motor-fijo: <porqué>` en la línea'
        : tipo === 'capacidad'
          ? 'un switch sobre la capacidad que cierre con nunca(x) (o una función con ese switch): un valor nuevo de la unión tiene que dejar de compilar ahí'
          : 'saca el nombre del registro (etiquetaMotor, etiquetasDonde) o lleva el texto al módulo de su motor; si es texto de UN motor por diseño, una excepción en EXCEPCIONES_NOMBRE con su motivo'
    const titulo =
      tipo === 'motor' ? 'motores sueltos' : tipo === 'capacidad' ? 'capacidades comparadas con ===' : 'nombres de producto a mano'
    check(
      `${archivos.length} fuentes escaneados, 0 ${titulo}`,
      suyos.length === 0,
      suyos.length === 0
        ? 'limpio'
        : `${suyos.length} sitio(s):\n      ` +
            suyos.map((h) => `${h.archivo}:${h.linea} [${h.forma}] ${h.texto}`).join('\n      ') +
            `\n      -> ${consejo}`
    )
  }

  // (3) El detector se dispara ---------------------------------------------
  hr('(3) El detector no es decorativo: líneas inventadas lo disparan')
  const si: string[] = [
    "const l = motor === 'oracle' ? 'Oracle' : 'PostgreSQL'",
    'if (d !== "postgres") return null',
    "if ('oracle' == c.motor) x()",
    'const pg = dialecto === `postgres`',
    "if (['oracle'].includes('oracle')) y()",
    "const lista = ['oracle', 'postgres']",
    // los motores de las otras familias son motores como los demás.
    "if (c.motor === 'mongodb') x()",
    "const esRedis = 'redis' !== d.motor",
    "const noSql = ['mongodb', 'redis']"
  ]
  for (const l of si) check(`dispara: ${l}`, formaSuelta(l) !== null, `-> ${formaSuelta(l)}`)
  const no: string[] = [
    "const m: DbMotor = 'oracle'",
    'return a.motor === b.motor',
    "tokenizar(texto, 'oracle', desde)",
    "const r = motor === 'oraclex'",
    "const s = 'oracle' + sufijo"
  ]
  for (const l of no) check(`no dispara: ${l}`, formaSuelta(l) === null, `-> ${formaSuelta(l)}`)
  const comentado = sinComentarios("x() // motor === 'oracle'\n/* d === 'postgres' */\ny()")
  check(
    'un literal dentro de un comentario no cuenta',
    comentado.every((l) => formaSuelta(l) === null),
    comentado.map((l) => `«${l}»`).join(' · ')
  )
  // Las capacidades: el campo pegado a la comparación, en los dos órdenes.
  const capSi: string[] = [
    "if (descriptor(m).sesion.identidadSinPk !== 'rowid') throw x",
    "fueraDeEnvoltorio: cap.candadoSoloLectura === 'envoltorioRollback' && y",
    "const sinRowid = sesion.identidadSinPk != \"rowid\"",
    "if ('porFila' === motorExplorador(m).sesion.esperaBloqueo.forma) z()",
    'const { forma } = espera; if (forma === `porTransaccion`) z()',
    "if (vista.terminador === '\\n/') u()",
    "if (REGLAS[d].explain === 'planFor') w()",
    "if ('conOpciones' !== REGLAS[d].explain) w()",
    "if (r.comandosCliente === 'sqlplus') v()",
    // la FAMILIA es una unión como las demás (un `familia === 'sql'` suelto
    // manda a una familia nueva a la rama del «si no»: se pregunta con `esMotorSql` o un switch).
    "if (d.familia === 'sql') x()",
    "if ('documentos' !== descriptor(m).familia) y()",
    "const noEsSql = MOTORES[m].familia != `claves`"
  ]
  for (const l of capSi) check(`capacidad, dispara: ${l}`, capacidadComparada(l) !== null, `-> ${capacidadComparada(l)}`)
  const capNo: string[] = [
    "if (identidad.tipo === 'rowid') x()",
    "const c = modo.tipo === 'cursor' ? a : b",
    "if (p.forma === 'rownum') y()",
    "const d = d.sesion.identidadSinPk",
    "if (x.identidadSinPk === 'otra') z()",
    "if (caja === 'minus') w()",
    // Otra `familia` con otros literales (la de la caché del catálogo, `CacheCatalogo.ts`).
    "if (e.familia === 'bases') x()"
  ]
  for (const l of capNo) check(`capacidad, no dispara: ${l}`, capacidadComparada(l) === null, `-> ${capacidadComparada(l)}`)
  // El discriminante de una unión discriminada: un campo de UN literal que está en
  // UNA unión con nombre lleva sus literales; en dos, no se adivina.
  const disc = leerUniones(
    'x.ts',
    ["export type A = 'a' | 'b'", "export type B = 'b' | 'c'", 'interface I {', "  k: 'a'", "  q: 'b'", "  s: 'z'", '}'].join('\n')
  )
  check(
    "discriminante: `k: 'a'` lleva la unión A; `q: 'b'` (en dos uniones) y `s: 'z'` (en ninguna), no",
    JSON.stringify(disc.map((u) => [u.campo, u.literales])) === JSON.stringify([['k', ['a', 'b']]]),
    JSON.stringify(disc.map((u) => [u.campo, u.literales]))
  )
  // Los nombres de producto: dentro de un literal, como palabra entera, y sus excepciones.
  const nomSi = escanearTexto('src/x.ts', "throw new Error('ROWID solo existe en Oracle.')\nconst m = `PostgreSQL admite como mucho $${n}`\n")
  check('nombre de producto en un literal y en una plantilla: dispara', nomSi.hallazgos.length === 2 && nomSi.hallazgos.every((h) => h.forma === 'nombre de producto'), JSON.stringify(nomSi.hallazgos))
  const nomNo = escanearTexto(
    'src/x.ts',
    [
      '// Solo Oracle tiene sinónimos (un comentario no cuenta)',
      'const Oracle = 1',
      "const x = 'OracleDB y postgresql y pg_catalog'",
      'const m = `ROWID solo existe en ${etiquetasDonde(f)}.`'
    ].join('\n')
  )
  check('NEGATIVO: comentarios, identificadores, otra caja o palabra, y el nombre sacado del registro', nomNo.hallazgos.length === 0, JSON.stringify(nomNo.hallazgos))
  excepcionesUsadas.clear()
  const exenta = escanearTexto('src/main/db/explorador/planSql.ts', "const A = 'Oracle no mira el valor de los parámetros al explicar'\nconst B = 'Oracle otra cosa'\n")
  check(
    'una excepción con texto exime SOLO el literal que lo contiene',
    exenta.hallazgos.length === 1 && exenta.hallazgos[0].linea === 2,
    JSON.stringify(exenta.hallazgos)
  )
  // El texto de JSX y la línea de en medio de una plantilla: prosa FUERA de un literal.
  // Antes no se miraba, y así pasó «PostgreSQL no necesita
  // ninguno.» de `DriversLista.tsx`.
  const jsx = escanearTexto(
    'src/renderer/src/x.tsx',
    ['      <p>Solo Oracle tiene sinónimos.</p>', '  que solo existe en PostgreSQL.`', '      ROWID solo existe en Oracle'].join('\n')
  )
  check(
    'texto de JSX y línea de en medio de una plantilla: dispara (las tres)',
    jsx.hallazgos.length === 3 && jsx.hallazgos.every((h) => h.forma === 'nombre de producto'),
    JSON.stringify(jsx.hallazgos)
  )
  const identificadores = escanearTexto(
    'src/renderer/src/x.tsx',
    [
      "import Oracle from './oracle'",
      'const c = new PostgreSQL(conf)',
      'return x.Oracle.y',
      'const e = <Oracle modo="a" />',
      'Oracle.conectar()',
      'const Oracle: T = f()'
    ].join('\n')
  )
  check(
    'NEGATIVO: un nombre que es un IDENTIFICADOR fuera de un literal (import, new, acceso, etiqueta JSX, llamada)',
    identificadores.hallazgos.length === 0,
    JSON.stringify(identificadores.hallazgos)
  )
  // Una excepción exime SU texto y nada más: la línea de antes, con la frase exenta de
  // Oracle y «PostgreSQL» escrito a mano detrás, sigue marcada; la de hoy, no.
  excepcionesUsadas.clear()
  const drivers = 'src/renderer/src/features/bd/DriversLista.tsx'
  const lineaAntes = escanearTexto(drivers, '      <p className="dbc-ayuda">Solo hacen falta para Oracle anterior a 12.1. PostgreSQL no necesita ninguno.</p>')
  const lineaHoy = escanearTexto(drivers, '      <p className="dbc-ayuda">Solo hacen falta para Oracle anterior a 12.1. {ayudaSinClientes()}</p>')
  check(
    'una excepción exime su texto EXACTO: lo demás de la misma línea se sigue mirando',
    lineaAntes.hallazgos.length === 1 && lineaHoy.hallazgos.length === 0,
    `antes: ${lineaAntes.hallazgos.length} · hoy: ${lineaHoy.hallazgos.length}`
  )
  excepcionesUsadas.clear()
  for (const e of usadasEnElArbol) excepcionesUsadas.add(e)

  // Los motores del detector salen del REGISTRO, no de una lista escrita en este archivo.
  const conFicticio = detectorMotores([...IDS_MOTORES, 'ficticio'])
  check(
    "con un motor más en el registro, `motor === 'ficticio'` y la lista a mano con él disparan",
    formaSuelta("if (motor === 'ficticio') x()", conFicticio) === 'comparación' &&
      formaSuelta("const l = ['postgres', 'ficticio']", conFicticio) === 'lista a mano' &&
      formaSuelta("if (['a'].includes('ficticio')) y()", conFicticio) === 'pertenencia',
    `${formaSuelta("if (motor === 'ficticio') x()", conFicticio)} · ${formaSuelta("const l = ['postgres', 'ficticio']", conFicticio)}`
  )
  check(
    'con el registro de hoy: cada motor dispara, y un id que no es motor no',
    IDS_MOTORES.every((m) => formaSuelta(`if (motor === '${m}') x()`) === 'comparación') && formaSuelta("if (motor === 'ficticio') x()") === null,
    IDS_MOTORES.map((m) => `${m}: ${formaSuelta(`if (motor === '${m}') x()`)}`).join(' · ')
  )

  // Las zonas por motor eximen los archivos DE UN MOTOR, no los comunes de su carpeta.
  const zonas: Array<[string, boolean]> = [
    ['src/shared/motores/oracle.ts', true],
    ['src/shared/motores/definir.ts', false],
    ['src/shared/motores/index.ts', false],
    ['src/shared/escrituraSql/postgres.ts', true],
    ['src/shared/escrituraSql/comun.ts', false],
    ['src/shared/escrituraSql/index.ts', false],
    ['src/main/db/explorador/motores/sesionOracle.ts', true],
    ['src/main/db/explorador/motores/catalogoPostgres.ts', true],
    ['src/main/db/explorador/motores/filasCatalogo.ts', false],
    ['src/main/db/explorador/motores/sub/oracle.ts', false],
    ['src/main/db/explorador/GestorSesiones.ts', false],
    ['src/tdb/oracle.cjs', true],
    ['src/tdb/tdb.cjs', false],
    ['src/tdb/sqlite.cjs', true],
    ['src/tdb/sesionSqlite.cjs', true],
    ['src/tdb/sqliteComun.cjs', true],
    ['src/tdb/motores.cjs', false],
    ['src/shared/motores/sqlite.ts', true],
    ['src/main/db/explorador/motores/catalogoSqlite.ts', true],
    ['src/main/db/rutaArchivoBd.ts', false],
    // los descriptores y los CJS de un motor de MongoDB y Redis, sí; los
    // contratos de sus familias (comunes: no llevan un id al final), no.
    ['src/shared/motores/mongodb.ts', true],
    ['src/shared/motores/redis.ts', true],
    ['src/tdb/mongodb.cjs', true],
    ['src/tdb/sesionMongodb.cjs', true],
    ['src/tdb/redis.cjs', true],
    ['src/tdb/sesionRedis.cjs', true],
    ['src/tdb/redisComun.cjs', true],
    // Las piezas que se parten de un CJS de un motor, por su sufijo; las del común, no.
    ['src/tdb/valoresRedis.cjs', true],
    ['src/tdb/tdbSalida.cjs', false],
    ['src/tdb/celdas.cjs', false],
    ['src/tdb/sesion.cjs', false],
    ['src/shared/db-documentos-ipc.ts', false],
    ['src/shared/db-claves-ipc.ts', false]
  ]
  const zonasMal = zonas.filter(([r, z]) => enZona(r) !== z)
  check(
    `las zonas eximen solo los archivos de un motor (${zonas.length} rutas)`,
    zonasMal.length === 0,
    zonasMal.map(([r, z]) => `${r}: esperaba ${z}`).join(' · ') || 'todas'
  )
  check(
    'el archivo de un motor que aún no está en el registro se ESCANEA, y en cuanto entra, no',
    !enZona('src/shared/escrituraSql/ficticio.ts') && enZona('src/shared/escrituraSql/ficticio.ts', [...IDS_MOTORES, 'ficticio']),
    ''
  )

  // (4) El case y su nunca --------------------------------------------------
  hr('(4) `case` con y sin `nunca`')
  const conNunca = [
    'function f(d: DbMotor) {',
    '  switch (d) {',
    "    case 'oracle': return '{'",
    "    case 'postgres': return 1",
    "    default: return nunca(d, 'f')",
    '  }',
    '}'
  ].join('\n')
  const sinNunca = [
    'function g(d: DbMotor) {',
    '  switch (d) {',
    "    case 'oracle': return 1",
    '    default: return 2',
    '  }',
    '}'
  ].join('\n')
  // Un switch interior SIN nunca dentro de uno exterior CON nunca: el `case` interior no
  // puede heredar el `nunca` de fuera.
  const anidado = [
    'switch (a) {',
    "  case 'x': {",
    '    switch (d) {',
    "      case 'oracle': return 1",
    '      default: return 2',
    '    }',
    '  }',
    '  default: return nunca(a)',
    '}'
  ].join('\n')
  const hc = escanearTexto('con.ts', conNunca).hallazgos
  const hs = escanearTexto('sin.ts', sinNunca).hallazgos
  const ha = escanearTexto('anidado.ts', anidado).hallazgos
  check('switch que cierra con nunca: permitido', hc.length === 0, JSON.stringify(hc))
  check(
    'switch con default a mano: marcado',
    hs.length === 1 && hs[0].forma === 'case sin nunca' && hs[0].linea === 3,
    JSON.stringify(hs)
  )
  check(
    'case de un switch interior sin nunca: marcado aunque el exterior lo tenga',
    ha.length === 1 && ha[0].linea === 4,
    JSON.stringify(ha)
  )
  // Lo mismo sobre una capacidad: el switch sobre el CAMPO sin nunca se marca; con nunca,
  // o sobre otra cosa que comparte el literal (`identidad.tipo`), no.
  const capSinNunca = ['switch (espera.forma) {', "  case 'porFila': return 1", '  default: return 2', '}'].join('\n')
  const capConNunca = [
    'switch (espera.forma) {',
    "  case 'porFila': return 1",
    "  case 'porTransaccion': return 2",
    '  default: return nunca(espera, "f")',
    '}'
  ].join('\n')
  const otraCosa = ['switch (identidad.tipo) {', "  case 'rowid': return 1", '  default: return 2', '}'].join('\n')
  const hcs = escanearTexto('cs.ts', capSinNunca).hallazgos
  check(
    'switch sobre una capacidad con default a mano: marcado',
    hcs.length === 1 && hcs[0].forma === 'case de capacidad sin nunca' && hcs[0].linea === 2,
    JSON.stringify(hcs)
  )
  check('switch sobre una capacidad que cierra con nunca: permitido', escanearTexto('cc.ts', capConNunca).hallazgos.length === 0, '')
  // Lo mismo sobre la familia: `esMotorSql` y `candadoSoloLecturaDe` son el
  // switch bueno; uno con default a mano manda una familia nueva al «si no» en silencio.
  const famSinNunca = ['switch (d.familia) {', "  case 'sql': return d.sesion", '  default: return null', '}'].join('\n')
  const famConNunca = [
    'switch (d.familia) {',
    "  case 'sql': return 1",
    "  case 'documentos':",
    "  case 'claves': return 2",
    "  default: return nunca(d, 'f')",
    '}'
  ].join('\n')
  const hfs = escanearTexto('fs.ts', famSinNunca).hallazgos
  check(
    'switch sobre la familia con default a mano: marcado',
    hfs.length === 1 && hfs[0].forma === 'case de capacidad sin nunca' && hfs[0].linea === 2,
    JSON.stringify(hfs)
  )
  check('switch sobre la familia que cierra con nunca: permitido', escanearTexto('fc.ts', famConNunca).hallazgos.length === 0, '')
  check(
    'NEGATIVO: un switch sobre otra cosa con el mismo literal (`identidad.tipo`): no es la capacidad',
    escanearTexto('oc.ts', otraCosa).hallazgos.length === 0,
    JSON.stringify(escanearTexto('oc.ts', otraCosa).hallazgos)
  )
  // Dentro de una zona, un archivo DE UN MOTOR no puede nombrar a OTRO (id comparado o etiqueta).
  const zonaPg = 'src/main/db/explorador/motores/ddlPostgres.ts'
  const ajenoTexto = escanearAjenos(zonaPg, "const aviso = 'DBMS_METADATA no existe: esto es de Oracle'\n").hallazgos
  const ajenoId = escanearAjenos(zonaPg, "if (c.motor === 'oracle') return null\n").hallazgos
  const propioPg = escanearAjenos(zonaPg, "const m = 'PostgreSQL no lo admite'\nif (c.motor === 'postgres') x()\n").hallazgos
  const propioOra = escanearAjenos('src/main/db/explorador/motores/ddlOracle.ts', "const aviso = 'DBMS_METADATA no existe: esto es de Oracle'\n").hallazgos
  check(
    'zona: ddlPostgres.ts con «Oracle» en un texto o con `=== \'oracle\'` se marca; con lo suyo, no; ddlOracle.ts con «Oracle», no',
    ajenoTexto.length === 1 && ajenoId.length === 1 && propioPg.length === 0 && propioOra.length === 0,
    JSON.stringify({ ajenoTexto, ajenoId, propioPg, propioOra })
  )
  check(
    'zona: un archivo común de la carpeta por motor (sin motor en el nombre) no pasa por esta comprobación',
    motorDelArchivo('src/main/db/explorador/motores/filasCatalogo.ts') === null && motorDelArchivo(zonaPg) === 'postgres',
    String(motorDelArchivo('src/main/db/explorador/motores/filasCatalogo.ts'))
  )
  const marcaMuerta = escanearTexto('m.ts', "const x = 1 // motor-fijo: ya no compara nada\n")
  const marcaViva = escanearTexto('v.ts', "if (p.motor === 'oracle') y() // motor-fijo: solo de Oracle\n")
  const marcaVacia = escanearTexto('w.ts', "if (p.motor === 'oracle') y() // motor-fijo:\n")
  check(
    'la marca exime su línea, y sin porqué no exime',
    marcaViva.hallazgos.length === 0 && marcaViva.marcas[0]?.necesaria === true && marcaVacia.hallazgos.length === 1,
    `viva: ${JSON.stringify(marcaViva)} · vacía: ${marcaVacia.hallazgos.length} hallazgo(s)`
  )
  check(
    'una marca en una línea sin nada que eximir se reconoce como muerta',
    marcaMuerta.marcas.length === 1 && !marcaMuerta.marcas[0].necesaria,
    JSON.stringify(marcaMuerta.marcas)
  )

  // (5) Marcas y excepciones que hacen falta ---------------------------------
  hr('(5) Cada marca `motor-fijo:` y cada excepción siguen eximiendo algo')
  check(`${r.marcas.length} marca(s) motor-fijo en código`, true, r.marcas.map((m) => `${m.archivo}:${m.linea}`).join(' · ') || 'ninguna')
  for (const m of r.marcas) {
    check(
      `marca ${m.archivo}:${m.linea} sigue haciendo falta`,
      m.necesaria,
      m.necesaria ? m.texto : 'MARCA MUERTA: la línea ya no compara con un motor; quítala'
    )
  }
  for (const e of EXCEPCIONES) {
    let propios: Escaneo | null = null
    try {
      propios = escanearTexto(e.archivo, readFileSync(join(RAIZ, e.archivo), 'utf8'))
    } catch {
      propios = null
    }
    check(
      `${e.archivo} sigue necesitando su excepción`,
      propios !== null && propios.hallazgos.length > 0,
      propios === null ? 'NO EXISTE' : `${propios.hallazgos.length} hallazgo(s) — ${e.motivo}`
    )
  }
  for (const e of EXCEPCIONES_NOMBRE) {
    check(
      `excepción de nombre ${e.archivo}${e.texto ? ` («${e.texto}»)` : ' (el archivo entero)'} sigue eximiendo algo`,
      usadasEnElArbol.has(e),
      usadasEnElArbol.has(e) ? e.motivo : 'EXCEPCIÓN MUERTA: ya no hay ese texto; quítala'
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const c of results) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`)
    console.log(`      -> ${c.evidence}`)
  }
  const passed = results.filter((c) => c.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
