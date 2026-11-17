// =============================================================================
// Autoprueba de la guardia de claves persistidas: tipos sintéticos y mutaciones de los tipos del repo
// servidas por un CompilerHost en memoria. Comprueba cierre, lista y spreads sin modificar fuentes.
// Depende del compilador y de la lógica pura de la guardia.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { esWindows } from '../../src/shared/plataforma.ts'
import ts from 'typescript'
import { hr, cerrar, RAIZ } from './comun.mts'
import { calcularFilas, leerLista, compararConLista, insertarNuevas, mensaje, ubicacion } from './clavesPersistidas.mts'
import { sobrantesEnSpreads } from './spreadsPersistidos.mts'
import type { Fila, Hallazgo } from './clavesPersistidas.mts'
import {
  archivoRaices, caso, programaEnMemoria, sobrantesSinteticos, nodosQue, unico, textoMutado, expansionReal, hallazgosDelRepo
} from './apoyoClavesPersistidas.mts'

const cabecera = 'ruta\tforma\testado\tnota\n'
const calcular = (texto: string) => calcularFilas(ts, programaEnMemoria(texto))
const pares = (filas: Fila[]): string[] => filas.map((f) => `${f.ruta}\t${f.forma}`)
const fila = (ruta: string, forma = 'numero'): Fila => ({ ruta, forma, declaraciones: [] })
const comparar = (filas: Fila[], texto: string, lector = false): Hallazgo[] => compararConLista(filas, leerLista(cabecera + texto), () => lector)

hr('CASOS SINTÉTICOS')
caso('extends, Omit, Pick y Partial conservan la declaración original', () => {
  const cierre = calcular(`interface Base { identificador: string; secreto: string }
    interface Hija extends Base { orden: number }
    export interface RaicesPersistidas {
      'omitir.json': Omit<Hija, 'secreto'>; 'elegir.json': Pick<Hija, 'identificador'>
      'parcial.json': Partial<Pick<Hija, 'identificador'>>
    }`)
  assert.deepEqual(pares(cierre.filas), ['elegir.json#identificador\ttexto', 'omitir.json#identificador\ttexto', 'omitir.json#orden\tnumero', 'parcial.json#identificador\ttexto'])
  const declaraciones = cierre.filas.filter((f) => f.ruta.endsWith('identificador')).map((f) => f.declaraciones[0])
  assert(declaraciones.every((d) => d === declaraciones[0]))
  const propietaria = declaraciones[0].parent
  assert(ts.isInterfaceDeclaration(propietaria))
  assert.equal(propietaria.name.getText(), 'Base')
  assert.equal(cierre.hallazgos.length, 0)
})
caso('unión discriminada funde rutas y literales', () => {
  assert.deepEqual(pares(calcular(`export interface RaicesPersistidas {
    'figura.json': { modo: 'redondo'; radio: number } | { modo: 'cuadrado'; lado: string }
  }`).filas), ['figura.json#lado\ttexto', 'figura.json#modo\tliteral', 'figura.json#modo="cuadrado"\tvalor', 'figura.json#modo="redondo"\tvalor', 'figura.json#radio\tnumero'])
})
caso('listas, tuplas, Record, opcionales, null, enumerados, plantillas y Date', () => {
  const cierre = calcular('enum Color { Azul = "azul", Verde = "verde" }\n' +
    'export interface RaicesPersistidas { "tipos.json": { lista: string[]; tupla: [string, number]; mapa: Record<string, number>; claves: Record<"equis" | "ye", boolean>; opcional?: string | null; color: Color; plantilla: `p:${number}`; fecha: Date; fijo: true; version: 1 } }')
  assert.deepEqual(pares(cierre.filas), [
    'tipos.json#claves\tobjeto', 'tipos.json#claves.equis\tbooleano', 'tipos.json#claves.ye\tbooleano',
    'tipos.json#color\tliteral', 'tipos.json#color="azul"\tvalor', 'tipos.json#color="verde"\tvalor',
    'tipos.json#fecha\tfecha', 'tipos.json#fijo\tliteral', 'tipos.json#fijo=true\tvalor',
    'tipos.json#lista\tlista', 'tipos.json#lista[]\ttexto', 'tipos.json#mapa\tobjeto', 'tipos.json#mapa.*\tnumero',
    'tipos.json#opcional\ttexto', 'tipos.json#plantilla\ttexto', 'tipos.json#tupla\tlista', 'tipos.json#tupla[]\tnumero|texto',
    'tipos.json#version\tliteral', 'tipos.json#version=1\tvalor'
  ])
  assert.equal(cierre.hallazgos.length, 0)
})
caso('abiertos, recursión, no serializables y miembros que JSON omite', () => {
  const cierre = calcular(`interface Nodo { siguiente?: Nodo }
    class Clase { campo = 1; metodo(): void {} get calculado(): number { return 2 } }
    export interface RaicesPersistidas { 'raro.json': { cualquiera: any; desconocido: unknown; vacio: object; objeto: {}; nodo: Nodo; mapa: Map<string, number>; conjunto: Set<string>; clase: Clase } }`)
  assert.deepEqual(pares(cierre.filas).filter((p) => !/mapa|conjunto/.test(p)), [
    'raro.json#clase\tobjeto', 'raro.json#clase.campo\tnumero', 'raro.json#cualquiera\tabierto',
    'raro.json#desconocido\tabierto', 'raro.json#nodo\tobjeto', 'raro.json#nodo.siguiente\trecursivo',
    'raro.json#objeto\tabierto', 'raro.json#vacio\tabierto'
  ])
  assert.deepEqual(cierre.hallazgos.map((h) => [h.clase, h.nombre]), [['NO SERIALIZABLE', 'Map'], ['NO SERIALIZABLE', 'Set']])
  assert(cierre.filas.every((f) => f.forma.length > 0))
})
caso('fallo cerrado: import roto, raíz any/unknown y ausencia de raíces', () => {
  assert(calcular(`import type { Inexistente } from './tipo-inventado.ts'; export interface RaicesPersistidas { 'rota.json': Inexistente }`).hallazgos.some((h) => h.clase === 'RAÍZ ROTA'))
  for (const tipo of ['any', 'unknown']) assert(calcular(`export interface RaicesPersistidas { 'rota.json': ${tipo} }`).hallazgos.some((h) => h.clase === 'RAÍZ ROTA'))
  assert.throws(() => calcular('export interface Otra {}'), /sin raíces: la guardia no vigila nada/)
  assert.throws(() => calcular('export interface RaicesPersistidas {}'), /sin raíces/)
})
caso('profundidad excesiva y propiedades ajenas', () => {
  const profundo = '{ siguiente: '.repeat(27) + 'number' + ' }'.repeat(27)
  assert(calcular(`export interface RaicesPersistidas { 'profundo.json': ${profundo} }`).hallazgos.some((h) => h.clase === 'PROFUNDIDAD'))
  assert(calcular(`export interface RaicesPersistidas { 'ajeno.json': Error }`).filas.every((f) => f.forma === 'ajeno'))
})
caso('lista: NUEVA, FALTA con candidata, FORMA y REAPARECE', () => {
  const h = comparar([fila('uno.json#padre.nueva')], 'uno.json#padre.vieja\tnumero\tvigente\tdeclaración inventada\n')
  assert.deepEqual(h.map((h) => h.clase), ['NUEVA', 'FALTA'])
  assert(mensaje(h[1]).includes('Posible nombre nuevo:\n  uno.json#padre.nueva'))
  assert(mensaje(h[1]).includes('Se declaraba en: declaración inventada.'))
  assert.equal(comparar([fila('uno.json#clave', 'texto')], 'uno.json#clave\tnumero\tvigente\t\n')[0].clase, 'FORMA')
  assert.equal(comparar([fila('uno.json#clave')], 'uno.json#clave\tnumero\tretirada\tlector: lector.ts\n', true)[0].clase, 'REAPARECE')
})
caso('RAÍZ QUITADA y todas sus filas FALTA', () => {
  const h = comparar([], 'uno.json#primera\tnumero\tvigente\t\nuno.json#segunda\ttexto\tvigente\t\n')
  assert.deepEqual(h.map((h) => h.clase), ['RAÍZ QUITADA', 'FALTA', 'FALTA'])
  assert.equal(h[0].cantidad, 2)
  const vacia = calcular(`export interface RaicesPersistidas { 'uno.json': {} }`)
  assert.deepEqual(compararConLista(vacia.filas, leerLista(cabecera + 'uno.json#primera\tnumero\tvigente\t\n'), () => false).map((h) => h.clase), ['FALTA'])
})
caso('retiradas y descartadas necesitan lectura o motivo', () => {
  const retirada = 'uno.json#vieja\tnumero\tretirada\tlector: lector-inventado.ts\n'
  assert.equal(comparar([], retirada, true).length, 0)
  assert.equal(comparar([], retirada)[0].clase, 'RETIRADA SIN LECTOR')
  assert.equal(comparar([], retirada.replace('lector: lector-inventado.ts', ''), true)[0].clase, 'RETIRADA SIN LECTOR')
  assert.equal(comparar([], 'uno.json#vieja\tnumero\tdescartada\tmotivo: ajuste eliminado\n').length, 0)
  assert.equal(comparar([], 'uno.json#vieja\tnumero\tdescartada\tmotivo: \n')[0].clase, 'DESCARTADA SIN MOTIVO')
})
caso('lista mal formada: orden, duplicados, formas, estados y columnas', () => {
  const linea = 'uno.json#clave\tnumero\tvigente\t\n'
  for (const [texto, motivo] of [
    [linea + linea, 'duplicada'], [linea + linea.replace('#clave', '#anterior'), 'desordenada respecto a la anterior'],
    [linea.replace('numero', 'extraña'), 'forma desconocida'], [linea.replace('vigente', 'otro'), 'estado desconocido'],
    [linea.replace('\tvigente\t', ''), 'faltan columnas'], [linea.replace('numero', 'texto|numero'), 'forma desconocida'],
    [linea.replace('numero', 'valor'), 'forma desconocida']
  ]) assert.throws(() => leerLista(cabecera + texto), (e: Error) => e.message.startsWith('claves-persistidas.tsv:') && e.message.includes(motivo))
})
caso('lista CRLF: cabecera, nota y escritura en LF', () => {
  const texto = cabecera + 'uno.json#clave\tnumero\tvigente\tconservar\n'
  const crlf = texto.replaceAll('\n', '\r\n')
  assert.deepEqual(leerLista(crlf), leerLista(texto))
  assert.equal(insertarNuevas(crlf, [fila('uno.json#otra')]).includes('\r'), false)
  assert.equal(insertarNuevas(crlf, []).includes('\r'), false)
})
caso('rutas desde una subcarpeta y caja de unidad en Windows', () => {
  const programa = programaEnMemoria(`export interface RaicesPersistidas { 'uno.json': { clave: number } }`)
  const esperado = calcularFilas(ts, programa)
  const referencia = ubicacion(esperado.filas[0].declaraciones[0])
  const directorio = process.cwd()
  try {
    process.chdir(path.join(RAIZ, 'scripts'))
    assert.deepEqual(pares(calcularFilas(ts, programa).filas), pares(esperado.filas))
    assert.equal(ubicacion(esperado.filas[0].declaraciones[0]), referencia)
  } finally { process.chdir(directorio) }
  if (esWindows()) {
    const fuente = programa.getSourceFile(archivoRaices)!
    const nombre = fuente.fileName
    try {
      fuente.fileName = nombre[0].toLowerCase() + nombre.slice(1)
      assert.deepEqual(pares(calcularFilas(ts, programa).filas), pares(esperado.filas))
    } finally { fuente.fileName = nombre }
  }
})
caso('hook: una lista sin preparar impide el commit', () => {
  const texto = readFileSync(path.join(RAIZ, 'scripts/calidad/antesDelCommit.mjs'), 'utf8')
  const prefijo = texto.slice(texto.indexOf('const CODIGO'), texto.indexOf('// Las rutas'))
  for (const pendiente of [false, true]) {
    const errores: string[] = []
    const llamadas: string[][] = []
    let salida: number | undefined
    try {
      runInNewContext(prefijo, {
        execFileSync: (_orden: string, argumentos: string[]) => {
          llamadas.push(argumentos)
          if (argumentos.includes('--cached')) return 'src/main/raicesPersistidas.ts\n'
          assert.deepEqual(Array.from(argumentos), ['diff', '--quiet', '--', 'scripts/calidad/claves-persistidas.tsv'])
          if (pendiente) throw Object.assign(new Error(), { status: 1 })
          return ''
        },
        process: { exit: (codigo: number) => { salida = codigo; throw new Error('salida del hook') } },
        console: { error: (mensaje: string) => errores.push(mensaje) }
      })
    } catch (error) { assert.equal((error as Error).message, 'salida del hook') }
    assert.equal(salida, pendiente ? 1 : undefined)
    assert(llamadas.some((args) => args.includes('--quiet')))
    if (pendiente) assert(errores.join('\n').includes('Añada la lista al commit'))
  }
})
caso('insertarNuevas preserva el texto y solo inserta filas nuevas en orden', () => {
  const texto = '# Cabecera inventada\n' + cabecera + 'uno.json#be\tnumero\tdescartada\tmotivo: eliminado\n# Nota funcional\nuno.json#de\ttexto\tvigente\tconservar\n'
  const nuevas = [fila('uno.json#ce'), fila('uno.json#a'), fila('uno.json#e'), fila('uno.json#de', 'numero')]
  const actualizado = insertarNuevas(texto, nuevas)
  assert.deepEqual(leerLista(actualizado).map((f) => f.ruta), ['uno.json#a', 'uno.json#be', 'uno.json#ce', 'uno.json#de', 'uno.json#e'])
  assert.equal(actualizado.split('\n').filter((l) => !/^uno.json#(a|ce|e)\t/.test(l)).join('\n'), texto)
  assert.equal(insertarNuevas(actualizado, nuevas), actualizado)
  assert.equal(compararConLista(nuevas, leerLista(actualizado), () => false).some((h) => h.clase === 'FORMA'), true)
})
caso('spreads: independiente, Pick, disco a DTO y destino abierto', () => {
  const programa = programaEnMemoria(`interface Disco { nombre: string; orden?: number }
    interface Local { nombre: string; ordenNuevo?: number }
    declare const local: Local; declare const parcial: Pick<Disco, 'nombre'>; declare const disco: Disco
    export const malo: Disco = { ...local }
    export const bueno: Disco = { ...parcial }
    export const dto: Pick<Disco, 'nombre'> = { ...disco }
    export const abierto: Disco & Record<string, unknown> = { ...local }
    export interface RaicesPersistidas { 'disco.json': Disco }`)
  const cierre = calcularFilas(ts, programa)
  assert.deepEqual(cierre.hallazgos, [])
  const h = sobrantesEnSpreads(ts, programa, cierre.enCierre, (f) => path.resolve(f) === path.resolve(archivoRaices))
  assert.equal(h.length, 1)
  assert.equal(h[0].nombre, 'ordenNuevo')
  assert.deepEqual(h[0].posibles, ['orden'])
  assert(mensaje(h[0]).includes('Probablemente era: orden (opcional).'))
  assert(mensaje(h[0]).includes('en disco.json:'))
})

caso('spread condicional: revisa cada miembro de la unión', () => {
  const programa = programaEnMemoria(`interface Disco { nombre?: string }
    declare const condicion: boolean
    export const malo: Disco = { ...(condicion ? { nombreNuevo: 'valor' } : {} as {}) }
    export interface RaicesPersistidas { 'disco.json': Disco }`)
  const cierre = calcularFilas(ts, programa)
  const h = sobrantesEnSpreads(ts, programa, cierre.enCierre, () => true)
  assert.deepEqual(h.map((h) => h.nombre), ['nombreNuevo'])
})
caso('spread entre artefactos: solo exime claves del destino', () => {
  const programa = programaEnMemoria(`interface Disco { nombre?: string }
    interface Ssh { clave?: string }
    declare const ssh: Ssh
    export const malo: Disco = { ...ssh }
    export interface RaicesPersistidas { 'disco.json': Disco; 'ssh.json': Ssh }`)
  const cierre = calcularFilas(ts, programa)
  const h = sobrantesEnSpreads(ts, programa, cierre.enCierre, () => true)
  assert.deepEqual(h.map((h) => [h.nombre, h.artefacto]), [['clave', 'disco.json']])
})
caso('spread en una unión discriminada: solo la variante que fija el literal', () => {
  const variantes = `interface Uno { tipo: 'uno'; codigo?: number }; interface Dos { tipo: 'dos'; otra?: number }
    export interface RaicesPersistidas { 'disco.json': Uno | Dos }`
  const sobrantes = (codigo: string): Hallazgo[] => {
    const p = programaEnMemoria(variantes + codigo)
    return sobrantesEnSpreads(ts, p, calcularFilas(ts, p).enCierre, () => true)
  }
  assert.deepEqual(sobrantes(`declare const local: { codigo?: number }; const dato: Uno | Dos = { tipo: 'uno', ...local }`), [])
  const renombrada = sobrantes(`declare const local: { codigoNuevo?: number }; const dato: Uno | Dos = { tipo: 'uno', ...local }`)
  assert.deepEqual(renombrada.map((h) => [h.nombre, h.destino, h.posibles]), [['codigoNuevo', 'Uno', ['codigo']]])
  const variable = sobrantes(`declare const tipo: 'uno' | 'dos'; declare const local: { codigoNuevo?: number }
    const dato: Uno | Dos = { tipo, ...local }`)
  assert.deepEqual(variable.map((h) => h.destino).sort(), ['Dos', 'Uno'])
  const ninguna = sobrantes(`declare const local: { codigoNuevo?: number }
    // @ts-expect-error discriminante que no admite ninguna variante
    const dato: Uno | Dos = { tipo: 'tres', ...local }`)
  assert.deepEqual(ninguna.map((h) => h.destino).sort(), ['Dos', 'Uno'])
})
caso('spread entre tipos que solo comparten un artefacto contenedor: no se exime', () => {
  const tipos = `interface Bd { motor?: string }; interface Ssh { usuario?: string }
    declare const ssh: Ssh; export const dato: Bd = { ...ssh }\n`
  for (const raices of [`'bd.json': Bd; 'ssh.json': Ssh`, `'bd.json': Bd; 'ssh.json': Ssh; 'copia': { bd: Bd[]; ssh: Ssh[] }`, `'uso': Bd | Ssh`]) {
    assert.deepEqual(sobrantesSinteticos(tipos + `export interface RaicesPersistidas { ${raices} }`).map((h) => [h.nombre, h.destino]), [['usuario', 'Bd']], raices)
  }
})
caso('spread del disco a su DTO y del tipo del que hereda el destino: no es sobrante', () => {
  const h = sobrantesSinteticos(`interface Dto { nombre: string; secreto?: string }
    interface Disco extends Omit<Dto, 'secreto'> { orden?: number }
    interface Ajeno { orden?: number }
    interface Hermano extends Omit<Dto, 'secreto'> { otro?: number }
    declare const disco: Disco; declare const dto: Dto; declare const ajeno: Ajeno; declare const hermano: Hermano
    export const alDto: Dto = { ...disco }
    export const alDisco: Disco = { ...dto }
    export const refinado = (d: Dto & { secreto: string }): number => d.nombre.length + refinado({ ...disco, secreto: '' })
    export const malo: Dto = { ...ajeno }
    export const entreHermanos: Disco = { ...hermano }
    export interface RaicesPersistidas { 'disco.json': Disco; 'dto.json': Dto; 'hermano.json': Hermano; 'copia': { disco: Disco[]; ajeno: Ajeno[] } }`)
  assert.deepEqual(h.map((h) => [h.nombre, h.origen]), [['orden', 'ajeno'], ['otro', 'hermano']])
})
caso('discriminantes booleanos y null eligen la variante', () => {
  const tipos = `type Resultado = { ok: true; valor?: number } | { ok: false; error?: string }
    type Lectura = { error: null; datos?: number } | { error: string; codigo?: number }
    export interface RaicesPersistidas { 'resultado.json': Resultado; 'lectura.json': Lectura }\n`
  assert.deepEqual(sobrantesSinteticos(tipos + `declare const local: { valor?: number }; export const a: Resultado = { ok: true, ...local }
    declare const otro: { datos?: number }; export const b: Lectura = { error: null, ...otro }`), [])
  const renombrada = sobrantesSinteticos(tipos + 'declare const local: { valorNuevo?: number }; export const a: Resultado = { ok: true, ...local }')
  assert.deepEqual(renombrada.map((h) => [h.nombre, h.posibles]), [['valorNuevo', ['valor']]])
})
caso('discriminante abreviado, dentro del spread o frente a una variante con él opcional', () => {
  const tipos = `interface Uno { tipo: 'uno'; codigo?: number }; interface Dos { tipo: 'dos'; otra?: number }
    interface UnoOpcional { tipo?: 'uno'; codigo?: number }
    export interface RaicesPersistidas { 'disco.json': Uno | Dos; 'opcional.json': UnoOpcional | Dos }
    const tipo = 'uno' as const\n`
  assert.deepEqual(sobrantesSinteticos(tipos + `declare const local: { codigo?: number }; export const abreviado: Uno | Dos = { tipo, ...local }
    declare const base: { tipo: 'uno'; codigo?: number }; export const enSpread: Uno | Dos = { ...base }
    declare const otra: { otra?: number }; export const opcional: UnoOpcional | Dos = { tipo: 'dos', ...otra }`), [])
  const renombradas = sobrantesSinteticos(tipos + `declare const local: { codigoNuevo?: number }; export const abreviado: Uno | Dos = { tipo, ...local }
    declare const base: { tipo: 'uno'; codigoNuevo?: number }; export const enSpread: Uno | Dos = { ...base }
    declare const otra: { otraNueva?: number }; export const opcional: UnoOpcional | Dos = { tipo: 'dos', ...otra }`)
  assert.deepEqual(renombradas.map((h) => [h.nombre, h.destino]), [['codigoNuevo', 'Uno'], ['codigoNuevo', 'Uno'], ['otraNueva', 'Dos']])
})
caso('FALTA de un valor con punto: padre y candidatas por la ruta, no por el valor', () => {
  const cierre = calcular(`export interface RaicesPersistidas { 'uno.json': { padre: { extension?: '.sql' | 'txt' } } }`)
  const lista = 'uno.json#padre\tobjeto\tvigente\t\nuno.json#padre.extension\tliteral\tvigente\t\n' +
    'uno.json#padre.extension=".sql"\tvalor\tvigente\t\nuno.json#padre.extension=".txt"\tvalor\tvigente\t\n'
  const h = compararConLista(cierre.filas, leerLista(cabecera + lista), () => false)
  assert.deepEqual(h.map((h) => h.clase), ['NUEVA', 'FALTA'])
  assert.deepEqual(h[1].posibles, ['uno.json#padre.extension="txt"'])
  assert(h[1].padre && h[1].padre === cierre.filas.padres.get('uno.json#padre'), h[1].padre)
  assert(mensaje(h[1]).includes(`Su padre se declara en ${h[1].padre}.`))
})

hr('MUTACIONES EN MEMORIA')
caso('repo sin mutar: verde', () => {
  const programa = programaEnMemoria(readFileSync(archivoRaices, 'utf8'), true)
  assert.deepEqual(hallazgosDelRepo(programa), [])
  const filas = calcularFilas(ts, programa).filas
  assert(filas.length > 0)
  assert(filas.filter((f) => f.ruta.includes('motor=')).every((f) => f.declaraciones.length > 0))
  assert(filas.flatMap((f) => f.declaraciones.map(ubicacion)).every((u) => /:\d+:\d+$/.test(u)))
})
const mutaciones = [
  ['M1', 'src/main/db/conservarAlEditar.ts', 'ConexionPersistida', 'orden', 'ordenUsuario', 'db-connections.json#connections[].orden'],
  ['M2', 'src/shared/db-ipc.ts', 'ConexionBd', 'profileId', 'perfilId', 'db-connections.json#connections[].profileId'],
  ['M3', 'src/shared/db-ipc.ts', 'DbTls', 'cifrar', 'cifrado', 'db-connections.json#connections[].tls.cifrar'],
  ['M4', 'src/main/db/conservarAlEditar.ts', 'ConexionPersistida', 'notas', 'omitir', 'db-connections.json#connections[].notas'],
  ['M5', 'src/main/db/opcionalesConexion.ts', 'OpcionalesGuardados', 'srv', 'usarSrv', 'src/main/db/controlador/validacionConexion.ts', 'opcionalesAGuardar'],
  ['M6', 'src/shared/semaforoContenedores.ts', 'normalizarCupo', 'limiteContenedores', 'limiteDeContenedores', 'src/shared/workspace-state-ipc.ts', 'normalizarCupo'],
  ['M8', 'src/shared/delegacion-ipc.ts', 'CuentaDelegable', 'enMarcha', 'activas', 'puente:ctx.cuentas#[].enMarcha'],
  ['M9', 'src/main/uso/credencialesClaude.ts', 'CredencialesClaude', 'accessToken', 'tokenAcceso', 'ajeno:~/.claude/.credentials.json#claudeAiOauth.accessToken'],
  ['M11', 'src/main/db/explorador/AlmacenConsolas.ts', 'ArchivoIndiceConsolas', 'consolas', 'entradas', 'conexiones/*/consolas/indice.json#consolas'],
  ['M12', 'src/shared/delegacion-ipc.ts', 'VistaTareaConResultado', 'resultado', 'salida', 'puente:ctx.tarea#resultado'],
  ['M13', 'src/main/agentes/delegacion/ServicioDelegacion.ts', 'ResultadoModelos', 'leido', 'leidos', 'puente:ctx.modelos#leido']
]
for (const [nombre, archivo, declaracion, propiedad, nuevo, destino, funcion] of mutaciones) caso(nombre, () => {
  const texto = textoMutado(archivo, declaracion, propiedad, nuevo)
  const programa = programaEnMemoria(texto, true, path.join(RAIZ, archivo), funcion ? destino : undefined)
  const hallazgos = hallazgosDelRepo(programa)
  const ruta = funcion ? ubicacion(expansionReal(programa, destino, funcion)).replace(/:\d+$/, '') : destino
  const esperado = hallazgos.find((h) => h.clase === (funcion ? 'SOBRANTE' : 'FALTA') && h.ruta === ruta)
  assert(esperado, JSON.stringify(hallazgos))
  // El nombre nuevo sale en la misma ruta: la raíz sigue al tipo renombrado, no a una copia de su forma.
  if (!funcion && nuevo !== 'omitir') assert(hallazgos.some((h) => h.clase === 'NUEVA' && h.ruta === destino.replace(/[^.#]+$/, nuevo)), JSON.stringify(hallazgos))
  if (nombre === 'M2') {
    const copia = hallazgos.find((h) => h.clase === 'FALTA' && h.ruta === 'copia.tessera(contenido)#bd[].registro.profileId')
    assert(copia, JSON.stringify(hallazgos))
    console.log(`M2 (copia): rojo esperado\n${mensaje(copia)}`)
  }
  if (funcion) assert(esperado.posibles?.includes(propiedad))
  // El literal que escribe el índice está anotado con el tipo de la raíz: ya no compila con la clave vieja.
  if (nombre === 'M11') assert(programa.getSemanticDiagnostics(programa.getSourceFile(path.join(RAIZ, archivo))).some((d) => /'consolas'/.test(ts.flattenDiagnosticMessageText(d.messageText, '\n'))))
  console.log(`${nombre}: rojo esperado\n${mensaje(esperado)}`)
})
caso('M7: literal de modo persistido bajo Record', () => {
  const archivo = 'src/shared/workspace-state-ipc.ts'
  const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const ajustes = unico(fuente.statements.filter((n) => ts.isInterfaceDeclaration(n) && n.name.text === 'AjustesWorkspace'), 'AjustesWorkspace')
  const propiedad = unico(nodosQue(ajustes, ts.isPropertySignature).filter((n) => n.name.getText(fuente) === 'agentModeByTarget'), 'AjustesWorkspace.agentModeByTarget')
  const literal = unico(nodosQue(propiedad, ts.isStringLiteral).filter((n) => n.text === 'nativo'), 'agentModeByTarget: nativo')
  const mutado = '\n\n' + texto.slice(0, literal.getStart(fuente)) + "'nativa'" + texto.slice(literal.end)
  const h = hallazgosDelRepo(programaEnMemoria(mutado, true, path.join(RAIZ, archivo)))
  const falta = h.find((h) => h.clase === 'FALTA' && h.ruta === 'workspace-state.json#settings.agentModeByTarget.*="nativo"')
  assert(falta, JSON.stringify(h))
  assert(h.some((h) => h.clase === 'NUEVA' && h.ruta === 'workspace-state.json#settings.agentModeByTarget.*="nativa"'))
  console.log(`M7: rojo esperado\n${mensaje(falta)}`)
})
caso('condicional real con rama vacía de tipo explícito', () => {
  const archivo = 'src/main/db/controlador/validacionConexion.ts'
  const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const funcion = unico(nodosQue(fuente, ts.isFunctionDeclaration).filter((n) => n.name?.text === 'camposAGuardar'), 'camposAGuardar')
  const propiedad = unico(nodosQue(funcion, ts.isShorthandPropertyAssignment).filter((n) => n.name.text === 'archivo'), 'camposAGuardar: archivo condicional')
  const condicional = propiedad.parent.parent
  assert(ts.isConditionalExpression(condicional), 'No se puede aplicar la mutación: archivo ya no está en un condicional. Revise el caso.')
  const mutado = '\n\n' + texto.slice(0, propiedad.getStart(fuente)) + 'archivoNuevo: archivo' +
    texto.slice(propiedad.end, condicional.whenFalse.end) + ' as {}' + texto.slice(condicional.whenFalse.end)
  const h = hallazgosDelRepo(programaEnMemoria(mutado, true, path.join(RAIZ, archivo)))
  assert(h.some((h) => h.clase === 'SOBRANTE' && h.nombre === 'archivoNuevo' && h.origen?.includes('archivoNuevo')))
})
caso('M10: clave renombrada en el spread de una variante de logs/salud.jsonl', () => {
  const archivo = 'src/main/salud/RegistroSalud.ts'
  const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const oyente = unico(nodosQue(fuente, ts.isPropertyAssignment).filter((n) => n.name.getText(fuente) === 'rendererCaido'), 'rendererCaido')
  const propiedad = unico(nodosQue(oyente, ts.isShorthandPropertyAssignment).filter((n) => n.name.text === 'exitCode'), 'rendererCaido: exitCode')
  const mutado = '\n\n' + texto.slice(0, propiedad.getStart(fuente)) + 'codigoSalida: exitCode' + texto.slice(propiedad.end)
  const sobrantes = hallazgosDelRepo(programaEnMemoria(mutado, true, path.join(RAIZ, archivo))).filter((h) => h.clase === 'SOBRANTE')
  assert.deepEqual(sobrantes.map((h) => [h.nombre, h.destino]), [['codigoSalida', 'CaidaSalud']], JSON.stringify(sobrantes))
  assert(sobrantes[0].posibles?.includes('exitCode'))
  console.log(`M10: rojo esperado\n${mensaje(sobrantes[0])}`)
})
cerrar('claves-persistidas-casos', 0, null, { detalle: false, rutas: [], json: null, privados: null })
