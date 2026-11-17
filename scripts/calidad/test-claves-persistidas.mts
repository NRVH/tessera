// =============================================================================
// Guardia de claves persistidas: compara las claves que alcanzan las raíces de
// `src/main/raicesPersistidas.ts` con `scripts/calidad/claves-persistidas.tsv` y busca claves sobrantes
// en los spreads hacia un tipo persistido. Uso: [--programa node|web] [--actualizar] [--detalle] [--json x].
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RAIZ, hr, check, cerrar } from './comun.mts'
import { calcularFilas, leerLista, compararConLista, insertarNuevas, mensaje, ubicacion } from './clavesPersistidas.mts'
import { sobrantesEnSpreads } from './spreadsPersistidos.mts'
import type { Fila, Hallazgo } from './clavesPersistidas.mts'

function opciones(argv: string[]) {
  const op = { programas: ['node', 'web'], actualizar: false, detalle: false, json: null as string | null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--detalle') op.detalle = true
    else if (a === '--actualizar') op.actualizar = true
    else if (a === '--programa' && ['node', 'web'].includes(argv[i + 1])) op.programas = [argv[++i]]
    else if (a === '--json' && argv[i + 1] && !argv[i + 1].startsWith('-')) op.json = argv[++i]
    else throw new Error(`opción desconocida o sin valor: ${a}`)
  }
  return op
}

function programa(cual: string): ts.Program {
  const configuracion = ts.getParsedCommandLineOfConfigFile(path.join(RAIZ, `tsconfig.${cual}.json`), { composite: false, noEmit: true }, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')) }
  })
  if (!configuracion || configuracion.errors.length) throw new Error('no se pudo leer la configuración de tipos')
  return ts.createProgram([...configuracion.fileNames, path.join(RAIZ, 'src', 'main', 'raicesPersistidas.ts')], configuracion.options)
}

function existeYContiene(archivo: string, literal: string): boolean {
  const absoluta = path.resolve(RAIZ, archivo)
  if (path.relative(RAIZ, absoluta).startsWith('..') || !existsSync(absoluta)) return false
  const texto = readFileSync(absoluta, 'utf8')
  return ["'", '"', '`'].some((comilla) => texto.includes(comilla + literal + comilla))
}

function ejecutar(): void {
  const op = opciones(process.argv.slice(2))
  const archivoLista = path.join(RAIZ, 'scripts', 'calidad', 'claves-persistidas.tsv')
  let texto = readFileSync(archivoLista, 'utf8')
  leerLista(texto)
  const hallazgos: Hallazgo[] = []
  let filas: Fila[] = []
  hr('CLAVES PERSISTIDAS')
  for (const cual of op.programas) {
    const actual = programa(cual)
    const cierre = calcularFilas(ts, actual)
    hallazgos.push(...cierre.hallazgos)
    filas = cierre.filas
    if (cual === 'node') {
      if (op.actualizar) {
        texto = insertarNuevas(texto, filas)
        writeFileSync(archivoLista, texto)
      }
      hallazgos.push(...compararConLista(filas, leerLista(texto), existeYContiene))
    }
    const carpetas = cual === 'web' ? ['renderer'] : ['main', 'shared', 'preload']
    const dentroDe = (archivo: string): boolean => carpetas.some((carpeta) => {
      const relativa = path.relative(path.join(RAIZ, 'src', carpeta), archivo)
      return !relativa.startsWith('..') && !path.isAbsolute(relativa)
    })
    hallazgos.push(...sobrantesEnSpreads(ts, actual, cierre.enCierre, dentroDe))
  }
  const unicos = [...new Map(hallazgos.map((h) => [JSON.stringify(h), h])).values()]
  for (const h of op.detalle ? unicos : unicos.slice(0, 25)) console.log(mensaje(h))
  if (!op.detalle && unicos.length > 25) console.log(`… y ${unicos.length - 25} más (--detalle para verlos todos)`)
  if (op.json) writeFileSync(op.json, JSON.stringify({ filas: filas.map((f) => ({ ...f, declaraciones: f.declaraciones.map(ubicacion) })), hallazgos: unicos }, null, 2))
  check('claves y spreads', unicos.length === 0, `${filas.length} filas; ${unicos.length} hallazgo(s)`)
  cerrar('claves-persistidas', filas.length, null, { detalle: op.detalle, rutas: [], json: null, privados: null })
}

try { ejecutar() } catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
