// =============================================================================
// Autoprueba de la guardia de idioma: casos sintéticos de lo que se marca y de lo que no, del cálculo de
// añadidos y quitados, del umbral y del tope, comprobaciones del glosario del repo y una pasada por los últimos
// 30 commits (sin fallar por lo que midan: solo que midan). Depende de las piezas `idioma*.mts`.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RAIZ, check, cerrar, hr } from './comun.mts'
import { REFERENCIAS_DEL_INDICE, TOPE_ARCHIVOS, UMBRAL_DETENER, clasificar, medirContraGit, medirIndice, medirTextos, referenciasDelCommit, restar } from './idiomaCommit.mts'
import { extraerNombres } from './idiomaDeclaraciones.mts'
import type { DatosIdioma, NombreIngles } from './idiomaDeclaraciones.mts'
import { TiempoAgotado, cambiosDelCommit, commitsPedidos, interpretarCambios, interpretarHistorial, leerObjetos, ultimosCommits } from './idiomaGit.mts'
import { cargarDatos, describir, mensajeDelCommit } from './idiomaInforme.mts'
import { RUTA_GLOSARIO, evaluarNombre, leerClavesPersistidas, leerGlosario, palabrasDe } from './idiomaGlosario.mts'
import { RUTA_EXCEPCIONES, leerExcepciones } from './idiomaExcepciones.mts'

const SIN_ARCHIVO = { detalle: false, rutas: [], json: null, privados: null }

const GLOSARIO = leerGlosario([
  'palabra\tclase\ttraduccion',
  ...['profile\tperfil', 'path\truta', 'open\tabrir', 'close\tcerrar', 'click\tclic', 'data\tdatos', 'request\tpeticion', 'result\tresultado',
    'stop\tdetener', 'name\tnombre', 'pass\tpasa', 'evidence\tevidencia', 'detail\tdetalle', 'results\tresultados', 'failed\tfallidos',
    'resolve\tresolver', 'reject\trechazar', 'on\tal', 'set\tfijar', 'left\tizquierda'].map((fila) => fila.replace('\t', '\tse-traduce\t')),
  ...['text\ttexto', 'keys\tclaves'].map((fila) => fila.replace('\t', '\tse-traduce\t')),
  ...['host', 'commit', 'log', 'id', 'check', 'hr', 'allpass', 'base64', 'utf8', 'win32'].map((palabra) => `${palabra}\tse-queda\t`),
  ...['req', 'res', 'msg', 'err', 'ev', 'deps', 'args', 'params', 'ctx', 'cfg', 'tmp', 'idx', 'len', 'buf', 'fn', 'cb'].map((palabra) => `${palabra}\tabreviatura\t`),
  'win\tabreviatura-inglesa\tventana',
  'sleep\tinglesa\t'
].join('\n'))
const DATOS: DatosIdioma = { glosario: GLOSARIO, claves: new Set(['profile']) }

const nombres = (codigo: string, archivo = 'src/x.ts', datos = DATOS): string[] => extraerNombres(archivo, codigo, datos).map((n) => n.nombre)

let casos = 0
function caso(nombre: string, prueba: () => void): void {
  casos++
  try {
    prueba()
    check(nombre, true, 'ok')
  } catch (error) {
    check(nombre, false, error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error))
  }
}

hr('EL GLOSARIO Y SUS PROPUESTAS')
caso('una fila mal formada, una clase desconocida o una palabra repetida es un error', () => {
  assert.throws(() => leerGlosario('palabra\tclase\ttraduccion\nPerfil\tse-queda\t'), /no válida/)
  assert.throws(() => leerGlosario('palabra\tclase\ttraduccion\nperfil\tinventada\t'), /clase desconocida/)
  assert.throws(() => leerGlosario('palabra\tclase\ttraduccion\nperfil\tse-traduce\t'), /falta la traducción/)
  assert.throws(() => leerGlosario('palabra\tclase\ttraduccion\nperfil\tse-queda\t\nperfil\tinglesa\t'), /repetida/)
})
caso('las claves guardadas son la última parte de cada ruta vigente, sin valores ni comodines', () => {
  const claves = leerClavesPersistidas('# nota\nruta\tforma\testado\tnota\na.json#cuentas[].profileId\ttexto\tvigente\t\na.json#mapa.*\tnumero\tvigente\t\na.json#modo="x"\tvalor\tvigente\t\na.json#viejo.oldKey\ttexto\tretirada\tlector: x.ts\n')
  assert.deepEqual([...claves], ['profileId'])
})
caso('la lista de claves guardadas se valida como la valida su guardia', () => {
  assert.throws(() => leerClavesPersistidas('ruta\tforma\testado\tnota\na.json#x\tinventada\tvigente\t\n'), /forma desconocida/)
  assert.throws(() => leerClavesPersistidas('ruta\tforma\testado\tnota\nb.json#x\ttexto\tvigente\t\na.json#x\ttexto\tvigente\t\n'), /desordenada/)
})
caso('un identificador se parte en palabras por mayúsculas y guiones bajos, y conserva los dígitos que cierran cada palabra', () => {
  assert.deepEqual(palabrasDe('profileId'), ['profile', 'Id'])
  assert.deepEqual(palabrasDe('HTMLElement'), ['HTML', 'Element'])
  assert.deepEqual(palabrasDe('PROFILE_PATH'), ['PROFILE', 'PATH'])
  assert.deepEqual(palabrasDe('base64Data'), ['base64', 'Data'])
  assert.deepEqual(palabrasDe('keysV2'), ['keys', 'V2'])
  assert.deepEqual(palabrasDe('isWin32'), ['is', 'Win32'])
})
caso('la propuesta conserva los dígitos, el _ o # inicial y el prefijo data-', () => {
  const op = { admitePrefijo: true, plataforma: false }
  const propuesta = (nombre: string): string | null | undefined => evaluarNombre(GLOSARIO, nombre, op)?.propuesta
  assert.equal(propuesta('base64Data'), 'base64Datos')
  assert.equal(propuesta('utf8Text'), 'utf8Texto')
  assert.equal(propuesta('keysV2'), 'clavesV2')
  assert.equal(propuesta('_profileId'), '_perfilId')
  assert.equal(propuesta('#closeData'), '#cerrarDatos')
  assert.equal(propuesta('profile2'), 'perfil2')
  assert.equal(propuesta('_PROFILE_PATH'), '_PERFIL_RUTA')
  assert.equal(extraerNombres('src/x.tsx', 'interface P { "data-open-path": string }', DATOS)[0].propuesta, 'data-abrir-ruta')
})
caso('un término con dígitos que el glosario conoce no se toma por su palabra inglesa', () => {
  assert.deepEqual(nombres('function f(win32: boolean) {}\nconst isWin32 = 1\nconst base64 = 1\nconst utf8 = 1'), [])
  assert.deepEqual(nombres('const win = 1'), ['win'])
})
caso('sin una propuesta segura no se propone nada y el mensaje lo dice', () => {
  const glosarioRaro = leerGlosario('palabra\tclase\ttraduccion\nopen\tse-traduce\tabrir ya\n')
  const [hallazgo] = extraerNombres('src/x.ts', 'const openFile = 1', { glosario: glosarioRaro, claves: new Set() })
  assert.equal(hallazgo.propuesta, null)
  assert.ok(describir(hallazgo).includes('sin propuesta automática'))
})
caso('la propuesta conserva el estilo del nombre', () => {
  const op = { admitePrefijo: true, plataforma: false }
  assert.equal(evaluarNombre(GLOSARIO, 'profileId', op)?.propuesta, 'perfilId')
  assert.equal(evaluarNombre(GLOSARIO, 'ProfilePath', op)?.propuesta, 'PerfilRuta')
  assert.equal(evaluarNombre(GLOSARIO, 'PROFILE_PATH', op)?.propuesta, 'PERFIL_RUTA')
  assert.equal(evaluarNombre(GLOSARIO, 'profile_path', op)?.propuesta, 'perfil_ruta')
  assert.equal(evaluarNombre(GLOSARIO, 'onClose', op)?.propuesta, 'onCerrar')
  assert.equal(evaluarNombre(GLOSARIO, 'profiles', op)?.propuesta, 'perfiles')
  assert.equal(evaluarNombre(GLOSARIO, 'openPaths', op)?.propuesta, 'abrirRutas')
})
caso('una palabra inglesa sin traducción se marca y no propone nada; una desconocida no se marca', () => {
  const op = { admitePrefijo: false, plataforma: false }
  const sinTraducir = evaluarNombre(GLOSARIO, 'sleepMs', op)
  assert.deepEqual([sinTraducir?.sinTraduccion, sinTraducir?.propuesta], [['sleep'], null])
  assert.equal(evaluarNombre(GLOSARIO, 'zorroAzul', op), null)
})

hr('LO QUE SE MARCA')
caso('variables, parámetros, funciones, clases, interfaces, tipos, enumerados y miembros con inglés propio', () => {
  assert.deepEqual(nombres('const profileId = 1\nfunction abrir(path: string) {}\nclass ProfileCard {}\nenum Modo { Stop }'), ['profileId', 'path', 'ProfileCard', 'Stop'])
  assert.deepEqual(nombres('interface Opciones { sleepMs: number; nombre: string }\ntype Otro = { openPath: string }'), ['sleepMs', 'openPath'])
  assert.deepEqual(nombres('class A { private closeData = 1; abrirResult(): void {} }'), ['closeData', 'abrirResult'])
})
caso('los sufijos Request y Result se traducen con el rol delante', () => {
  const lista = extraerNombres('src/x.ts', 'type DiffRequest = string\ntype DiffResult = string', DATOS)
  assert.deepEqual(lista.map((n) => n.propuesta), ['PeticionDiff', 'ResultadoDiff'])
})
caso('los roles van delante en Pascal y camel; las convenciones conservan su sitio', () => {
  const real = cargarDatos().glosario
  const op = { admitePrefijo: false, plataforma: false }
  const pares = [
    ['SearchService', 'ServicioBusqueda'], ['searchOptions', 'opcionesBusqueda'], ['SearchManager', 'GestorBusqueda'],
    ['SearchRequest', 'PeticionBusqueda'], ['SearchResult', 'ResultadoBusqueda'], ['SearchHandler', 'ManejadorBusqueda'],
    ['SearchProvider', 'ProveedorBusqueda'], ['SearchController', 'ControladorBusqueda'], ['SearchState', 'EstadoBusqueda'],
    ['SearchConfig', 'ConfigBusqueda'], ['SearchInfo', 'InfoBusqueda'], ['SearchError', 'ErrorBusqueda'],
    ['SearchProps', 'BusquedaProps'], ['SearchStore', 'BusquedaStore'], ['_searchService', '_servicioBusqueda'],
    ['#SearchService', '#ServicioBusqueda'], ['Search2Service', 'ServicioBusqueda2']
  ]
  for (const [original, propuesta] of pares) assert.equal(evaluarNombre(real, original, op)?.propuesta, propuesta, original)
  for (const nombre of ['ServicioBusqueda', 'AvisoProps', 'useStoreBusqueda', 'SetEstado']) {
    assert.equal(evaluarNombre(real, nombre, op), null, nombre)
  }
})
caso('un orden ambiguo se marca sin propuesta automática', () => {
  const datos = cargarDatos()
  for (const nombre of ['SearchServiceOptions', 'getSearchResult', 'SEARCH_SERVICE', 'search_service', 'PowerShellSearchService']) {
    const [hallazgo] = extraerNombres('src/x.ts', `const ${nombre} = 1`, datos)
    assert.equal(hallazgo.propuesta, null, nombre)
    assert.ok(describir(hallazgo).includes('sin propuesta automática'))
  }
})
caso('los verbos del glosario real proponen infinitivos y distinguen obtener de leer', () => {
  const real = cargarDatos().glosario
  const verbos = [
    ['get', 'obtener'], ['read', 'leer'], ['load', 'cargar'], ['fetch', 'traer'], ['find', 'buscar'], ['list', 'listar'],
    ['create', 'crear'], ['build', 'construir'], ['make', 'crear'], ['save', 'guardar'], ['write', 'escribir'],
    ['delete', 'borrar'], ['remove', 'quitar'], ['clear', 'limpiar'], ['check', 'comprobar'], ['validate', 'validar'], ['handle', 'atender'],
    ['ensure', 'asegurar'], ['parse', 'analizar'], ['toggle', 'alternar'], ['update', 'actualizar'], ['refresh', 'refrescar']
  ]
  for (const [verbo, traduccion] of verbos) {
    assert.equal(evaluarNombre(real, `${verbo}Window`, { admitePrefijo: true, plataforma: false })?.propuesta, `${traduccion}Ventana`)
  }
})
caso('set, get y has solos son API; el setter conserva set incluso en su tipo', () => {
  const datos = cargarDatos()
  const codigo = 'interface Api { set(): void; get(): void; has(): boolean }\ntype SetEstado = () => void\nconst setEstado = 1\nconst setQuery = 1\ntype SetQuery = string\nconst getWindow = 1\nconst hasQuery = 1'
  const lista = extraerNombres('src/x.ts', codigo, datos)
  assert.deepEqual(lista.map((n) => [n.nombre, n.propuesta]), [
    ['setQuery', 'setConsulta'], ['SetQuery', 'SetConsulta'], ['getWindow', 'obtenerVentana'], ['hasQuery', 'hayConsulta']
  ])
})
caso('Stop se traduce', () => assert.equal(extraerNombres('src/x.ts', 'const stop = 1', DATOS)[0].propuesta, 'detener'))
caso('onClose se marca y onCerrar no; setAbierto y useBusqueda no', () => {
  assert.deepEqual(nombres('function f(onClose: () => void, onCerrar: () => void, setAbierto: () => void) {}\nfunction useBusqueda() {}'), ['onClose'])
})
caso('una variable con el nombre de una clave guardada se marca, su propiedad no', () => {
  assert.deepEqual(nombres('const profile = 1'), ['profile'])
  assert.deepEqual(nombres('interface Guardado { profile: string }'), [])
  assert.deepEqual(nombres('interface Otro { profile: string }', 'src/y.ts', { ...DATOS, claves: new Set() }), ['profile'])
})
caso('win es una ventana salvo junto a una ruta o a una plataforma', () => {
  assert.deepEqual(nombres('const win = 1'), ['win'])
  assert.deepEqual(nombres('const rutaWin = 1\nconst esWindows = true\nconst win = process.platform === \'win32\''), [])
})

hr('LO QUE NO SE MARCA')
caso('propiedades de objetos literales, desestructuración e importaciones', () => {
  assert.deepEqual(nombres('import { profile } from "lib"\nconst o = { profile: 1, path: 2 }\nconst { path: p2 } = o\nconst { open } = o'), [])
})
caso('abreviaturas admitidas, términos del oficio y palabras desconocidas', () => {
  assert.deepEqual(nombres('const req = 1\nfunction f(res: 1, msg: 1, err: 1, ev: 1, deps: 1, args: 1, params: 1, ctx: 1, cfg: 1, tmp: 1, idx: 1, len: 1, buf: 1, fn: 1, cb: 1) {}\nconst commit = 1\nconst log = 1\nconst hostId = 1\nconst zorro = 1'), [])
})
caso('Props, XXX_CHANNELS y el prefijo use', () => {
  assert.deepEqual(nombres('interface AvisoProps {}\ninterface PropsAviso {}\nfunction C(props: {}) {}\nexport const PROFILE_CHANNELS = {}\nfunction useDatos() {}'), [])
})
caso('el molde de las pruebas, solo en pruebas', () => {
  const molde = 'function hr(name: string) {}\nfunction check(name: string, pass: boolean, evidence: string, detail?: string) {}\nconst results: unknown[] = []\nlet failed = 0\nconst allPass = true'
  assert.deepEqual(nombres(molde, 'scripts/calidad/test-x.mts'), [])
  assert.deepEqual(nombres(molde, 'src/x.ts'), ['name', 'name', 'pass', 'evidence', 'detail', 'results', 'failed', 'allPass'])
})
caso('los miembros de una clase que hereda de una API ajena', () => {
  assert.deepEqual(nombres('import { Component } from "react"\nclass A extends Component { openPath = 1 }'), [])
  assert.deepEqual(nombres('class B { openPath = 1 }'), ['openPath'])
  assert.deepEqual(nombres('class C extends Error { openPath = 1 }'), [])
})
caso('atributos del DOM en JSX, y solo ahí', () => {
  assert.deepEqual(nombres('interface P { onClick: () => void }', 'src/X.tsx', DATOS), [])
  assert.deepEqual(nombres('interface P { onClick: () => void }', 'src/x.ts', DATOS), ['onClick'])
})
caso('los tipos de e2e y de las pruebas copian la API que prueban; sus variables no', () => {
  assert.deepEqual(nombres('interface Api { profile: string }', 'e2e/x.spec.ts'), [])
  assert.deepEqual(nombres('interface Api { openPath: string }\nconst openPath = 1', 'src/test-x.mts'), ['openPath'])
})
caso('módulos ambientales, require y parámetros que impone Promise', () => {
  assert.deepEqual(nombres('declare module "x" { export function profile(): void }'), [])
  assert.deepEqual(nombres('const profile = require("x")\nconst require = createRequire(import.meta.url)'), [])
  assert.deepEqual(nombres('const profile = require()\nconst openPath = foo()'), ['profile', 'openPath'])
  assert.deepEqual(nombres('new Promise((resolve, reject) => {})'), [])
  assert.deepEqual(nombres('function f(resolve: 1) {}'), ['resolve'])
})
caso('las claves de texto que no son identificadores no se miran, y data-… se mira sin el prefijo', () => {
  assert.deepEqual(nombres('interface X { "agent-accounts.json": string; "Content-Type": string; "data-open": string }'), ['data-open'])
})
caso('un tipo que solo tiene propiedades de estilo copia la forma del DOM; si tiene otra cosa, no', () => {
  assert.deepEqual(nombres('function f(): { left: number; top: number } { return { left: 1, top: 2 } }'), [])
  assert.deepEqual(nombres('interface Caja { left: number; openPath: string }'), ['left', 'openPath'])
})
caso('this como parámetro y los archivos .d.ts no cuentan', () => {
  assert.deepEqual(nombres('function f(this: Window) {}'), [])
  const medida = medirTextos([{ anterior: null, posterior: 'src/tipos.d.ts' }], () => 'const profileId = 1', DATOS, { archivos: 5, milisegundos: 1000 })
  assert.equal(medida.archivos, 0)
})

hr('AÑADIDOS, QUITADOS, UMBRAL Y TOPE')
const nombre = (n: string, clase = 'VariableDeclaration'): NombreIngles => ({ nombre: n, archivo: 'a.ts', linea: 1, clase, palabras: [], sinTraduccion: [], propuesta: null })
const limites = { archivos: TOPE_ARCHIVOS, milisegundos: 15000 }
const lector = (contenidos: Record<string, string>) => (lado: 'antes' | 'despues', ruta: string): string | null => contenidos[`${lado}:${ruta}`] ?? null
caso('restar cuenta las repeticiones', () => {
  assert.equal(restar([nombre('a'), nombre('a'), nombre('b')], [nombre('a')]).length, 2)
  assert.equal(restar([nombre('a')], [nombre('a', 'Parameter')]).length, 1)
})
caso('el saldo es lo que el commit añade menos lo que quita', () => {
  const medida = medirTextos([{ anterior: 'src/a.ts', posterior: 'src/a.ts' }], lector({
    'antes:src/a.ts': 'const profileId = 1\nconst nombre = 2',
    'despues:src/a.ts': 'const profileId = 1\nconst openPath = 2\nconst closeData = 3\nconst dataPath = 4'
  }), DATOS, limites)
  assert.deepEqual([medida.anadidos.length, medida.quitados.length, medida.saldo], [3, 0, 3])
  assert.equal(clasificar(medida.saldo, medida.omitido), 'detiene')
})
caso('un nombre que se mueve a otro archivo o con su archivo renombrado no cuenta', () => {
  const movido = medirTextos([{ anterior: 'src/a.ts', posterior: 'src/a.ts' }, { anterior: null, posterior: 'src/b.ts' }], lector({
    'antes:src/a.ts': 'const profileId = 1', 'despues:src/a.ts': '', 'despues:src/b.ts': 'const profileId = 1'
  }), DATOS, limites)
  assert.deepEqual([movido.anadidos.length, movido.quitados.length, movido.nuevos.length, movido.saldo], [1, 1, 0, 0])
  const renombrado = medirTextos([{ anterior: 'src/a.ts', posterior: 'src/c.ts' }], lector({ 'antes:src/a.ts': 'const profileId = 1', 'despues:src/c.ts': 'const profileId = 1' }), DATOS, limites)
  assert.equal(renombrado.saldo, 0)
})
caso('borrar un archivo con inglés baja el saldo', () => {
  const medida = medirTextos([{ anterior: 'src/a.ts', posterior: null }], lector({ 'antes:src/a.ts': 'const profileId = 1\nconst openPath = 1' }), DATOS, limites)
  assert.equal(medida.saldo, -2)
})
caso('el umbral: un saldo negativo o cero pasa, desde 1 detiene; un commit sin medir se omite', () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 9].map((saldo) => clasificar(saldo, null)), ['pasa', 'pasa', 'detiene', 'detiene', 'detiene', 'detiene'])
  assert.equal(UMBRAL_DETENER, 1)
  assert.equal(clasificar(50, 'archivos'), 'omitido')
})
caso('un solo nombre nuevo detiene con la medición y clasificación que usa el gancho', () => {
  const medida = medirTextos([{ anterior: null, posterior: 'src/a.ts' }], lector({
    'despues:src/a.ts': 'const openPath = 1'
  }), DATOS, limites)
  const veredicto = clasificar(medida.saldo, medida.omitido)
  assert.deepEqual([medida.anadidos.length, medida.quitados.length, medida.saldo, veredicto], [1, 0, 1, 'detiene'])
  const texto = mensajeDelCommit(medida, veredicto, false).join('\n')
  for (const parte of ['Desde 1 el commit se detiene', 'openPath  ->  abrirRuta', 'Cómo resolverlo']) assert.ok(texto.includes(parte), parte)
})
caso('un nombre quitado en otro archivo compensa uno nuevo y permite el commit con aviso', () => {
  const medida = medirTextos([{ anterior: 'src/a.ts', posterior: null }, { anterior: null, posterior: 'src/b.ts' }], lector({
    'antes:src/a.ts': 'const profileId = 1', 'despues:src/b.ts': 'const openPath = 1'
  }), DATOS, limites)
  const veredicto = clasificar(medida.saldo, medida.omitido)
  assert.deepEqual([medida.anadidos.length, medida.quitados.length, medida.nuevos.length, medida.saldo, veredicto], [1, 1, 1, 0, 'pasa'])
  assert.ok(mensajeDelCommit(medida, veredicto, false)[0].startsWith('AVISO idioma'))
})
caso('pasado el tope de archivos no se lee ningún archivo ni se bloquea', () => {
  const cambios = Array.from({ length: TOPE_ARCHIVOS + 1 }, (_, i) => ({ anterior: null, posterior: `src/m${i}.ts` }))
  let lecturas = 0
  const medida = medirTextos(cambios, () => { lecturas++; return 'const profileId = 1' }, DATOS, limites)
  assert.deepEqual([medida.omitido, lecturas, medida.analizados], ['archivos', 0, 0])
  assert.equal(clasificar(medida.saldo, medida.omitido), 'omitido')
})
caso('pasado el tope de tiempo se deja de medir y no se bloquea', () => {
  let reloj = 0
  const cambios = [0, 1, 2].map((i) => ({ anterior: null, posterior: `src/m${i}.ts` }))
  const medida = medirTextos(cambios, () => 'const profileId = 1\nconst openPath = 1', DATOS, { archivos: 10, milisegundos: 15000 }, () => (reloj += 10000))
  assert.equal(medida.omitido, 'tiempo')
  assert.ok(medida.analizados < 3)
})
caso('un archivo cuyo análisis falla se nombra, se salta y no detiene el commit', () => {
  const lectorQueFalla = (lado: 'antes' | 'despues', ruta: string): string | null => {
    if (ruta === 'src/roto.ts') throw new Error('no se pudo leer')
    return lado === 'despues' ? 'const profileId = 1' : null
  }
  const medida = medirTextos([{ anterior: null, posterior: 'src/roto.ts' }, { anterior: null, posterior: 'src/bueno.ts' }], lectorQueFalla, DATOS, limites)
  assert.deepEqual([medida.analizados, medida.saldo, medida.fallidos.length], [1, 1, 1])
  assert.ok(medida.fallidos[0].startsWith('src/roto.ts: no se pudo leer'))
  assert.ok(mensajeDelCommit(medida, clasificar(medida.saldo, medida.omitido), false)[0].includes('src/roto.ts'))
})
caso('un merge en curso no se mide ni se bloquea, y lo dice', () => {
  const sinGit = { mergeEnCurso: () => true, cambios: (): never => { throw new Error('no debía leer cambios') } }
  const medida = medirIndice(DATOS, sinGit)
  assert.deepEqual([medida.omitido, medida.saldo, clasificar(medida.saldo, medida.omitido)], ['merge', 0, 'omitido'])
  const texto = mensajeDelCommit(medida, 'omitido', false).join('\n')
  assert.ok(texto.startsWith('AVISO idioma') && texto.includes('merge en curso'))
  const sinMerge = medirIndice(DATOS, { mergeEnCurso: () => false, cambios: () => [] })
  assert.equal(sinMerge.omitido, null)
})
caso('si git pasa del tope de tiempo no se mide ni se bloquea, y lo dice', () => {
  const lento = (): never => { throw new TiempoAgotado('diff') }
  const medida = medirIndice(DATOS, { mergeEnCurso: () => false, cambios: lento })
  assert.deepEqual([medida.omitido, clasificar(medida.saldo, medida.omitido)], ['git', 'omitido'])
  assert.equal(medirIndice(DATOS, { mergeEnCurso: lento, cambios: () => [] }).omitido, 'git')
  assert.ok(mensajeDelCommit(medida, 'omitido', false)[0].includes('git pasó de 15 s'))
  assert.equal(medirContraGit(lento, REFERENCIAS_DEL_INDICE, DATOS).omitido, 'git')
  assert.throws(() => medirContraGit((): never => { throw new Error('otro fallo') }, REFERENCIAS_DEL_INDICE, DATOS), /otro fallo/)
})
caso('git: una orden con un tope agotado lanza TiempoAgotado', () => {
  assert.throws(() => leerObjetos(['HEAD:package.json'], 0.001), TiempoAgotado)
})
caso('un commit que borra tantos nombres como añade avisa de los nuevos aunque el saldo sea cero', () => {
  const medida = medirTextos([{ anterior: 'src/a.ts', posterior: 'src/a.ts' }], lector({
    'antes:src/a.ts': 'const profileId = 1\nconst openPath = 1',
    'despues:src/a.ts': 'const closeData = 1\nconst dataPath = 1'
  }), DATOS, limites)
  const veredicto = clasificar(medida.saldo, medida.omitido)
  assert.deepEqual([medida.saldo, medida.nuevos.length, veredicto], [0, 2, 'pasa'])
  const texto = mensajeDelCommit(medida, veredicto, false).join('\n')
  for (const parte of ['AVISO idioma', 'src/a.ts:1  closeData  ->  cerrarDatos', 'src/a.ts:2  dataPath', 'Cómo resolverlo']) assert.ok(texto.includes(parte), parte)
  const sinNuevos = medirTextos([{ anterior: 'src/a.ts', posterior: 'src/a.ts' }], lector({ 'antes:src/a.ts': 'const profileId = 1', 'despues:src/a.ts': 'const nombre = 1' }), DATOS, limites)
  assert.deepEqual(mensajeDelCommit(sinNuevos, 'pasa', false), [])
})
caso('git: los cambios se interpretan y los objetos se leen del índice y de HEAD', () => {
  const cambios = interpretarCambios('M\0a.ts\0R100\0b.ts\0c.ts\0A\0d.ts\0D\0e.ts\0')
  assert.deepEqual(cambios, [
    { anterior: 'a.ts', posterior: 'a.ts' }, { anterior: 'b.ts', posterior: 'c.ts' }, { anterior: null, posterior: 'd.ts' }, { anterior: 'e.ts', posterior: null }
  ])
  const objetos = leerObjetos(['HEAD:package.json', ':package.json', 'HEAD:no/existe.ts'])
  assert.ok(objetos.get('HEAD:package.json')?.includes('"name"'))
  assert.ok(objetos.get(':package.json')?.includes('"name"'))
  assert.equal(objetos.get('HEAD:no/existe.ts'), null)
})
caso('el mensaje dice qué nombre, dónde, qué propone y cómo se resuelve', () => {
  const medida = medirTextos([{ anterior: null, posterior: 'src/a.ts' }], lector({ 'despues:src/a.ts': 'const profileId = 1\nconst openPath = 1\nconst closeData = 1' }), DATOS, limites)
  const texto = mensajeDelCommit(medida, 'detiene', false).join('\n')
  for (const parte of ['src/a.ts:1', 'profileId  ->  perfilId', RUTA_GLOSARIO, 'se-queda', 'se-traduce', 'clave que se guarda o cruza de proceso', 'excepción con alcance en excepciones-idioma.tsv']) assert.ok(texto.includes(parte), parte)
  assert.ok(mensajeDelCommit({ ...medida, omitido: 'archivos' }, 'omitido', false)[0].startsWith('AVISO'))
  assert.equal(describir({ ...nombre('x'), sinTraduccion: ['sleep'] }).includes('sleep'), true)
})

hr('EL GLOSARIO DEL REPO')
const textoGlosario = readFileSync(path.join(RAIZ, RUTA_GLOSARIO), 'utf8')
const real = leerGlosario(textoGlosario)
caso('el archivo es válido, con fin de línea LF y sin palabras repetidas', () => {
  assert.ok(!textoGlosario.includes('\r'))
  assert.ok(real.traducciones.size > 400 && real.permitidas.size > 300)
})
caso('las decisiones de vocabulario: log se queda; stop, request y result se traducen; las abreviaturas admitidas no se marcan', () => {
  assert.ok(real.permitidas.has('log') && real.permitidas.has('logs'))
  assert.deepEqual(['stop', 'request', 'result'].map((p) => real.traducciones.get(p)), ['detener', 'peticion', 'resultado'])
  for (const abreviatura of ['req', 'res', 'msg', 'err', 'ev', 'deps', 'args', 'params', 'ctx', 'cfg', 'tmp', 'idx', 'len', 'buf', 'fn', 'cb']) assert.ok(real.permitidas.has(abreviatura), abreviatura)
})
caso('con el glosario real: perfilId, onCerrar y los términos del oficio', () => {
  const datos = cargarDatos(false)
  assert.ok(datos.claves.has('profileId'))
  const real2: DatosIdioma = { glosario: real, claves: new Set() }
  assert.deepEqual(nombres('const profileId = 1\nconst perfilId = 1\nconst commit = 1\nconst shell = 1\nfunction f(onClose: () => void, onCerrar: () => void) {}', 'src/x.ts', real2), ['profileId', 'onClose'])
})

hr('TÉRMINOS EXACTOS Y EXCEPCIONES CON ALCANCE')
const conExcepciones = (filas: string): DatosIdioma => ({ ...DATOS, claves: new Set(), excepciones: leerExcepciones(`archivo\tcontenedor\tnombre\tmotivo\n${filas}`) })
caso('un compuesto se compara entero, con mayúsculas exactas y límites de palabras', () => {
  const glosario = leerGlosario('palabra\tclase\ttraduccion\nSqlServer\tcompuesto\t\nsql\tse-traduce\tconsulta\nserver\tse-traduce\tservidor\nopen\tse-traduce\tabrir\n')
  const datos = { glosario, claves: new Set<string>() }
  assert.deepEqual(nombres('const SqlServer = 1; const abrirSqlServer = 1; const sql = 1; const server = 1; const sqlServer = 1; const SqlServerless = 1; const openSqlServer = 1', 'src/x.ts', datos), ['sql', 'server', 'sqlServer', 'SqlServerless', 'openSqlServer'])
  assert.throws(() => leerGlosario('palabra\tclase\ttraduccion\nSqlServer\tcompuesto\tservidor\n'), /no lleva traducción/)
})
caso('los compuestos del repo conservan sus palabras sueltas bajo vigilancia', () => {
  const datos = { ...cargarDatos(false), claves: new Set<string>(), excepciones: new Map() }
  assert.deepEqual(nombres('const abrirOpenSsh = 1; const KnownHosts = 1; const open = 1; const known = 1; const server = 1', 'src/ejemplo.ts', datos), ['open', 'known', 'server'])
  assert.deepEqual(nombres('const items = 1; const key = 1; const path = 1', 'src/ejemplo.ts', datos), ['items', 'key', 'path'])
})
caso('la excepción solo exime el nombre exacto de su archivo y contenedor', () => {
  const datos = conExcepciones('src/x.ts\tAjeno\topenPath\tapi-ajena\n')
  assert.deepEqual(nombres('interface Ajeno { openPath: string; openPaths: string }; interface Propio { openPath: string }', 'src/x.ts', datos), ['openPaths', 'openPath'])
  assert.deepEqual(nombres('interface Ajeno { openPath: string }', 'src/y.ts', datos), ['openPath'])
})
caso('el contenedor vacío corresponde al módulo y no a una función', () => {
  const datos = conExcepciones('src/x.ts\t\tprofileId\tnombre-propio\n')
  assert.deepEqual(nombres('const profileId = 1; function abrir() { const profileId = 2 }', 'src/x.ts', datos), ['profileId'])
})
caso('una excepción de atributo data- conserva el nombre exacto de la declaración', () => {
  const datos = conExcepciones('src/x.ts\tAjeno\tdata-open\tapi-ajena')
  assert.deepEqual(nombres('interface Ajeno { "data-open": string; "data-path": string }', 'src/x.ts', datos), ['data-path'])
})
caso('las excepciones sin uso fallan con el número de línea', () => {
  const datos = conExcepciones('src/x.ts\tAjeno\topenPath\tapi-ajena\n')
  assert.throws(() => nombres('interface Ajeno { ruta: string }', 'src/x.ts', datos), /línea 2: excepción sin uso/)
  assert.throws(() => nombres('', 'src/x.ts', datos), /excepción sin uso/)
})
caso('las categorías son obligatorias y cerradas; las filas tienen cuatro columnas', () => {
  for (const fila of ['src/x.ts\tAjeno\topenPath\tinventada', 'src/x.ts\tAjeno\topenPath\t', 'src/x.ts\tAjeno\topenPath\tapi-ajena\textra']) {
    assert.throws(() => conExcepciones(fila), /línea 2: fila inválida/)
  }
  assert.throws(() => leerExcepciones('archivo\tnombre\tmotivo'), /línea 1: cabecera inválida/)
  assert.throws(() => conExcepciones('../x.ts\t\topenPath\tapi-ajena'), /línea 2/)
  assert.throws(() => conExcepciones('src/x.ts\tA\tpath\tapi-ajena\nsrc/x.ts\tA\tpath\tapi-ajena'), /línea 3/)
})
caso('una variable local o un parámetro solo admite cruza-proceso o clave-guardada', () => {
  for (const motivo of ['api-ajena', 'formato-ajeno', 'nombre-propio']) {
    const datos = conExcepciones(`src/x.ts\tabrir\tpath\t${motivo}`)
    for (const codigo of ['function abrir() { const path = 1 }', 'function abrir(path: string) {}']) {
      assert.throws(() => nombres(codigo, 'src/x.ts', datos), /línea 2: categoría no permitida/)
    }
  }
  for (const motivo of ['cruza-proceso', 'clave-guardada']) {
    const datos = conExcepciones(`src/x.ts\tabrir\tpath\t${motivo}`)
    assert.deepEqual(nombres('function abrir() { const path = 1 }', 'src/x.ts', datos), [])
    assert.deepEqual(nombres('function abrir(path: string) {}', 'src/x.ts', datos), [])
  }
})
caso('las funciones flecha toman el contenedor de su variable', () => {
  const datos = conExcepciones('src/x.ts\tabrir\tpath\tclave-guardada')
  assert.deepEqual(nombres('const abrir = () => { const path = 1 }; const cerrar = () => { const path = 2 }', 'src/x.ts', datos), ['path'])
})
caso('el índice usa las excepciones y un dato inválido detiene la medición', () => {
  const cambios = [{ anterior: 'src/x.ts', posterior: 'src/x.ts' }]
  const datos = conExcepciones('src/x.ts\tAjeno\topenPath\tapi-ajena')
  const medida = medirTextos(cambios, () => 'interface Ajeno { openPath: string }; const path = 1', datos, limites)
  assert.equal(medida.saldo, 0)
  assert.equal(medida.fallidos.length, 0)
  assert.throws(() => medirTextos(cambios, () => '', datos, limites), /excepción sin uso/)
  const local = conExcepciones('src/x.ts\tabrir\tpath\tapi-ajena')
  assert.throws(() => medirTextos(cambios, () => 'function abrir(path: string) {}', local, limites), /categoría no permitida/)
})
caso('las interfaces que extienden tipos externos heredan la exención estructural', () => {
  assert.deepEqual(nombres('interface Evento extends KeyboardEvent { openPath: string }'), [])
  assert.deepEqual(nombres('interface Evento extends Event { openPath: string }'), [])
  assert.deepEqual(nombres('interface Base extends HTMLElement { openPath: string }; interface Derivada extends Base { closeData: string }'), [])
  assert.deepEqual(nombres('import { Base } from "ajena"; interface Evento extends Base { openPath: string }'), [])
  assert.deepEqual(nombres('interface Base { openPath: string }; interface Derivada extends Base { closeData: string }'), ['openPath', 'closeData'])
  assert.deepEqual(nombres('interface A extends B { openPath: string }; interface B extends A { closeData: string }'), ['openPath', 'closeData'])
})
caso('cambiar solo las excepciones valida sus archivos del índice, incluso los que no cambian', () => {
  const archivo = 'scripts/calidad/idiomaDeclaraciones.mts'
  const referencias = { antes: (ruta: string) => `HEAD:${ruta}`, despues: (ruta: string) => `HEAD:${ruta}` }
  const cambios = () => [{ anterior: RUTA_EXCEPCIONES, posterior: RUTA_EXCEPCIONES }]
  const datos = conExcepciones(`${archivo}\tDatosIdioma\tglosario\tapi-ajena`)
  const medida = medirContraGit(cambios, referencias, datos, limites, true)
  assert.deepEqual([medida.archivos, medida.saldo, medida.fallidos.length], [0, 0, 0])
  const sinUso = conExcepciones(`${archivo}\tDatosIdioma\tinexistente\tapi-ajena`)
  assert.throws(() => medirContraGit(cambios, referencias, sinUso, limites, true), /excepción sin uso/)
})
caso('borrar o renombrar el archivo de una excepción obliga a retirar su fila', () => {
  const datos = conExcepciones('src/inexistente-idioma.ts\tAjeno\tpath\tapi-ajena')
  const referencias = { antes: (ruta: string) => `HEAD:${ruta}`, despues: (ruta: string) => `HEAD:${ruta}` }
  assert.throws(() => medirContraGit(() => [{ anterior: 'src/inexistente-idioma.ts', posterior: null }], referencias, datos, limites, true), /excepción sin uso/)
})

hr('EL HISTORIAL')
caso('la cantidad de commits pedida es un entero de 1 en adelante, y el historial trae si cada commit tiene padre', () => {
  assert.equal(commitsPedidos('30'), 30)
  for (const mala of [undefined, '', '0', '-3', '2.5', 'abc', ' ']) assert.throws(() => commitsPedidos(mala), /número entero/, String(mala))
  assert.deepEqual(interpretarHistorial('aaa\t\tprimero\nbbb\taaa\tsegundo\tcon tab\nccc\taaa bbb\tmerge\n'), [
    { hash: 'aaa', asunto: 'primero', hayPadre: false }, { hash: 'bbb', asunto: 'segundo\tcon tab', hayPadre: true }, { hash: 'ccc', asunto: 'merge', hayPadre: true }
  ])
})
caso('la guardia mide hasta 30 commits de los que haya sin fallar y deja su recuento', () => {
  const commits = ultimosCommits(30)
  const datos = cargarDatos(false)
  const cuenta = { pasa: 0, detiene: 0, omitido: 0 }
  for (const { hash, hayPadre } of commits) {
    const medida = medirContraGit((limite) => cambiosDelCommit(hash, hayPadre, limite), referenciasDelCommit(hash, hayPadre), datos)
    assert.ok(Number.isInteger(medida.saldo) && medida.analizados <= medida.archivos)
    cuenta[clasificar(medida.saldo, medida.omitido)]++
  }
  console.log(`  ${commits.length} commits: ${cuenta.detiene} habría detenido, ${cuenta.omitido} sin medir, ${cuenta.pasa} sin novedad`)
  assert.ok(commits.length <= 30)
  assert.equal(Object.values(cuenta).reduce((a, b) => a + b, 0), commits.length)
})
caso('el índice vacío no suma nada', () => {
  const medida = medirContraGit(() => [], REFERENCIAS_DEL_INDICE, cargarDatos(false))
  assert.deepEqual([medida.archivos, medida.saldo], [0, 0])
})

console.log(`\n  ${casos} casos`)
cerrar('idioma-casos', casos, null, SIN_ARCHIVO)
