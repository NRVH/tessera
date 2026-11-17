// =============================================================================
// Lógica de la guardia de claves persistidas: cierre transitivo de las rutas serializadas desde las
// raíces de `src/main/raicesPersistidas.ts`, lectura y comparación de la lista versionada y mensajes de
// los hallazgos; los spreads, en `spreadsPersistidos.mts`. Sin E/S: la guardia y su autoprueba le dan el programa.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import path from 'node:path'
import type ts from 'typescript'
import { RAIZ } from './comun.mts'
import { esWindows } from '../../src/shared/plataforma.ts'

export interface Fila { ruta: string; forma: string; declaraciones: ts.Declaration[] }
export interface Entrada { ruta: string; forma: string; estado: string; nota: string }
export type Lista = Entrada[]
export interface Cierre extends Set<ts.Declaration> { artefactos?: Map<ts.Declaration, Set<string>> }
export interface Hallazgo {
  clase: string; ruta: string; forma?: string; anterior?: string; nota?: string
  posibles?: string[]; padre?: string; nombre?: string; destino?: string; origen?: string
  declaracion?: string; artefacto?: string; cantidad?: number
}
const FORMAS = new Set('texto numero booleano objeto lista literal abierto recursivo fecha ajeno valor'.split(' '))
const ESTADOS = new Set(['vigente', 'retirada', 'descartada'])
const NO_SERIALIZABLES = new Set(['Map', 'Set', 'ReadonlyMap', 'ReadonlySet', 'WeakMap', 'WeakSet', 'Promise', 'RegExp', 'Function'])
const ordenar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const artefacto = (ruta: string): string => ruta.split('#')[0]
// El valor de una fila `=` puede llevar puntos (`=".sql"`): el padre se corta en la ruta, antes del valor.
const padre = (ruta: string): string => {
  const camino = ruta.split('=')[0]
  return camino.slice(0, Math.max(camino.lastIndexOf('.'), camino.indexOf('#')))
}
const nombreFinal = (ruta: string): string => ruta.split('=')[0].split(/[.#]/).at(-1)!.replaceAll('[]', '')
export const ubicacion = (n: ts.Node): string => {
  const fuente = n.getSourceFile()
  const p = fuente.getLineAndCharacterOfPosition(n.getStart(fuente))
  return `${path.relative(RAIZ, fuente.fileName).split(path.sep).join('/')}:${p.line + 1}:${p.character + 1}`
}

function rutaComparable(archivo: string): string {
  const absoluta = path.resolve(RAIZ, archivo)
  return esWindows() ? absoluta.toLowerCase() : absoluta
}

class Recorrido {
  compilador: typeof ts
  verificador: ts.TypeChecker
  filas = new Map<string, { formas: Set<string>; declaraciones: Set<ts.Declaration> }>()
  hallazgos: Hallazgo[] = []
  padres = new Map<string, string>()
  enCierre = Object.assign(new Set<ts.Declaration>(), { artefactos: new Map<ts.Declaration, Set<string>>() })
  constructor(compilador: typeof ts, verificador: ts.TypeChecker) {
    this.compilador = compilador
    this.verificador = verificador
  }
  anotar(ruta: string, forma?: string, declaraciones: readonly ts.Declaration[] = []): void {
    ruta = ruta.replace('#.', '#')
    const fila = this.filas.get(ruta) ?? { formas: new Set<string>(), declaraciones: new Set<ts.Declaration>() }
    if (forma) fila.formas.add(forma)
    for (const d of declaraciones) {
      fila.declaraciones.add(d); this.enCierre.add(d)
      const archivos = this.enCierre.artefactos.get(d) ?? new Set<string>()
      archivos.add(artefacto(ruta)); this.enCierre.artefactos.set(d, archivos)
    }
    this.filas.set(ruta, fila)
  }
  propiedad(simbolo: ts.Symbol, ruta: string, pila: ts.Type[], profundidad: number): void {
    if (simbolo.flags & (this.compilador.SymbolFlags.GetAccessor | this.compilador.SymbolFlags.SetAccessor)) return
    const tipo = this.verificador.getTypeOfSymbol(simbolo)
    if (tipo.getCallSignatures().length && !tipo.isUnion()) return
    const declaraciones = simbolo.declarations ?? []
    const propia = (d: ts.Declaration): boolean => {
      const relativa = path.relative(path.resolve(RAIZ, 'src'), d.getSourceFile().fileName)
      return !relativa.startsWith('..') && !path.isAbsolute(relativa)
    }
    const siguiente = `${ruta}.${simbolo.getName()}`
    if (declaraciones.length && !declaraciones.some(propia)) { this.anotar(siguiente, 'ajeno'); return }
    this.anotar(siguiente, undefined, declaraciones)
    this.expandir(tipo, siguiente, pila, profundidad + 1)
  }
  nombreDe(tipo: ts.Type, ruta: string): string {
    const simbolo = tipo.getSymbol()
    const declaracion = simbolo?.declarations?.[0]
    if (declaracion) this.padres.set(ruta.replace('#.', '#'), `${ubicacion(declaracion)} (${this.verificador.typeToString(tipo)})`)
    return simbolo?.getName() ?? ''
  }
  objeto(tipo: ts.Type, ruta: string, pila: ts.Type[], profundidad: number): void {
    if (this.verificador.isArrayType(tipo) || this.verificador.isTupleType(tipo)) {
      this.anotar(ruta, 'lista')
      for (const t of this.verificador.getTypeArguments(tipo as ts.TypeReference)) this.expandir(t, ruta + '[]', pila, profundidad + 1)
      return
    }
    const nombre = this.nombreDe(tipo, ruta)
    if (nombre === 'Date') { this.anotar(ruta, 'fecha'); return }
    if (NO_SERIALIZABLES.has(nombre)) { this.hallazgos.push({ clase: 'NO SERIALIZABLE', ruta, nombre }); return }
    if (tipo.getCallSignatures().length) return
    if (pila.includes(tipo)) { this.anotar(ruta, 'recursivo'); return }
    const propiedades = this.verificador.getPropertiesOfType(tipo)
    const indices = this.verificador.getIndexInfosOfType(tipo)
    this.anotar(ruta, propiedades.length || indices.length ? 'objeto' : 'abierto')
    const siguiente = [...pila, tipo]
    for (const indice of indices) this.expandir(indice.type, ruta + '.*', siguiente, profundidad + 1)
    for (const p of propiedades) this.propiedad(p, ruta, siguiente, profundidad)
  }
  primitivo(tipo: ts.Type, ruta: string): boolean {
    const f = tipo.flags
    const F = this.compilador.TypeFlags
    if (f & (F.Any | F.Unknown | F.NonPrimitive)) this.anotar(ruta, 'abierto')
    else if (f & (F.StringLiteral | F.NumberLiteral | F.BooleanLiteral | F.EnumLiteral)) {
      const valor = f & F.BooleanLiteral ? this.verificador.typeToString(tipo) : JSON.stringify((tipo as ts.LiteralType).value)
      this.anotar(ruta, 'literal'); this.anotar(`${ruta}=${valor}`, 'valor')
    } else if (f & (F.String | F.TemplateLiteral)) this.anotar(ruta, 'texto')
    else if (f & F.Number) this.anotar(ruta, 'numero')
    else if (f & F.Boolean) this.anotar(ruta, 'booleano')
    else return false
    return true
  }
  expandir(tipo: ts.Type, ruta: string, pila: ts.Type[], profundidad: number): void {
    if (profundidad > 25) { this.hallazgos.push({ clase: 'PROFUNDIDAD', ruta: ruta.replace('#.', '#') }); return }
    const partes = (tipo.isUnion() ? tipo.types : [tipo]).filter((t) => !(t.flags & (this.compilador.TypeFlags.Undefined | this.compilador.TypeFlags.Null | this.compilador.TypeFlags.Void)))
    const booleanos = partes.filter((t) => t.flags & this.compilador.TypeFlags.BooleanLiteral)
    if (booleanos.length === 2) this.anotar(ruta, 'booleano')
    for (const t of partes) {
      if (booleanos.length === 2 && booleanos.includes(t)) continue
      if (!this.primitivo(t, ruta)) this.objeto(t, ruta, pila, profundidad)
    }
  }
}

export function calcularFilas(compilador: typeof ts, programa: ts.Program) {
  const verificador = programa.getTypeChecker()
  const recorrido = new Recorrido(compilador, verificador)
  const { filas, hallazgos, enCierre } = recorrido
  const fuente = programa.getSourceFiles().find((f) => rutaComparable(f.fileName) === rutaComparable('src/main/raicesPersistidas.ts'))
  const declaracion = fuente?.statements.find((n): n is ts.InterfaceDeclaration => compilador.isInterfaceDeclaration(n) && n.name.text === 'RaicesPersistidas')
  if (!fuente || !declaracion) throw new Error('sin raíces: la guardia no vigila nada')
  const raices = verificador.getPropertiesOfType(verificador.getTypeAtLocation(declaracion.name))
  if (!raices.length) throw new Error('sin raíces: la guardia no vigila nada')
  for (const d of programa.getSemanticDiagnostics(fuente)) {
    const raiz = raices.find((r) => r.declarations?.some((n) => d.start !== undefined && d.start >= n.pos && d.start < n.end))
    hallazgos.push({ clase: 'RAÍZ ROTA', ruta: raiz?.getName() ?? raices.map((r) => r.getName()).join(', '), forma: 'error', nota: compilador.flattenDiagnosticMessageText(d.messageText, '\n') })
  }
  for (const r of raices) {
    const tipo = verificador.getTypeOfSymbol(r)
    if (tipo.flags & (compilador.TypeFlags.Any | compilador.TypeFlags.Unknown)) {
      hallazgos.push({ clase: 'RAÍZ ROTA', ruta: r.getName(), forma: verificador.typeToString(tipo), nota: 'El tipo raíz no se resuelve.' })
    } else recorrido.expandir(tipo, r.getName() + '#', [], 0)
  }
  const resultado = [...filas].filter(([ruta, f]) => !ruta.endsWith('#') && f.formas.size > 0).map(([ruta, f]) => ({
    ruta,
    forma: [...f.formas].sort(ordenar).join('|'),
    declaraciones: [...(ruta.includes('=') ? filas.get(ruta.split('=')[0])?.declaraciones ?? f.declaraciones : f.declaraciones)]
  }))
  const calculadas = Object.assign(resultado.sort((a, b) => ordenar(a.ruta, b.ruta)), {
    raices: new Set(raices.map((r) => r.getName())), padres: recorrido.padres
  })
  return { filas: calculadas, hallazgos, enCierre }
}

function formaValida(ruta: string, forma: string): boolean {
  const formas = forma.split('|')
  if (formas.includes('valor')) return forma === 'valor' && ruta.includes('=')
  return !!forma && formas.every((f) => FORMAS.has(f)) && [...new Set(formas)].sort(ordenar).join('|') === forma && (forma === 'valor') === ruta.includes('=')
}

export function leerLista(texto: string): Lista {
  const lista: Lista = []
  let cabecera = false
  for (const [i, linea] of texto.split(/\r?\n/).entries()) {
    if (!linea || linea.startsWith('#')) continue
    const error = (motivo: string): never => { throw new Error(`claves-persistidas.tsv:${i + 1}: ${motivo}`) }
    if (!cabecera) {
      if (linea !== 'ruta\tforma\testado\tnota') error('faltan columnas')
      cabecera = true; continue
    }
    const columnas = linea.split('\t')
    if (columnas.length !== 4) error('faltan columnas')
    const [ruta, forma, estado, nota] = columnas
    if (!formaValida(ruta, forma)) error(`forma desconocida «${forma}»`)
    if (!ESTADOS.has(estado)) error(`estado desconocido «${estado}»`)
    const anterior = lista.at(-1)?.ruta
    if (anterior === ruta) error('duplicada')
    if (anterior && anterior > ruta) error('desordenada respecto a la anterior')
    lista.push({ ruta, forma, estado, nota })
  }
  if (!cabecera) throw new Error('claves-persistidas.tsv:1: faltan columnas')
  return lista
}

function validarRetirada(f: Entrada, existeYContiene: (archivo: string, literal: string) => boolean): Hallazgo[] {
  if (f.estado === 'retirada' && (!f.nota.startsWith('lector: ') || !existeYContiene(f.nota.slice(8), nombreFinal(f.ruta)))) return [{ clase: 'RETIRADA SIN LECTOR', ruta: f.ruta, nota: f.nota, nombre: nombreFinal(f.ruta) }]
  if (f.estado === 'descartada' && (!f.nota.startsWith('motivo: ') || !f.nota.slice(8).trim())) return [{ clase: 'DESCARTADA SIN MOTIVO', ruta: f.ruta }]
  return []
}

function declaracionDelPadre(ruta: string, filas: Fila[]): string {
  const declaraciones = filas.find((f) => f.ruta.startsWith(padre(ruta) + '.'))?.declaraciones ?? []
  return [...new Set(declaraciones.map((d) => {
    const propietario = d.parent
    const nombre = 'name' in propietario ? (propietario.name as ts.Identifier)?.getText() : ''
    return nombre ? `${ubicacion(propietario)} (${nombre})` : ubicacion(d)
  }))].join(', ')
}

export function compararConLista(filas: Fila[] & { raices?: Set<string>; padres?: Map<string, string> }, lista: Lista, existeYContiene: (archivo: string, literal: string) => boolean): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const calculadas = new Map(filas.map((f) => [f.ruta, f]))
  const guardadas = new Map(lista.map((f) => [f.ruta, f]))
  const raices = filas.raices ?? new Set(filas.map((f) => artefacto(f.ruta)))
  const quitadas = new Set(lista.filter((f) => f.estado === 'vigente' && !raices.has(artefacto(f.ruta))).map((f) => artefacto(f.ruta)))
  const nuevas = filas.filter((f) => !guardadas.has(f.ruta))
  for (const ruta of quitadas) hallazgos.push({ clase: 'RAÍZ QUITADA', ruta, cantidad: lista.filter((f) => artefacto(f.ruta) === ruta && f.estado === 'vigente').length })
  for (const f of filas) {
    const vieja = guardadas.get(f.ruta)
    if (!vieja) hallazgos.push({ clase: 'NUEVA', ruta: f.ruta, forma: f.forma })
    else if (vieja.estado !== 'vigente') hallazgos.push({ clase: 'REAPARECE', ruta: f.ruta, nota: vieja.estado })
    else if (vieja.forma !== f.forma) hallazgos.push({ clase: 'FORMA', ruta: f.ruta, anterior: vieja.forma, forma: f.forma })
  }
  for (const f of lista) {
    if (f.estado === 'vigente' && !calculadas.has(f.ruta)) {
      hallazgos.push({
        clase: 'FALTA', ruta: f.ruta, nota: f.nota,
        padre: filas.padres?.get(padre(f.ruta)) ?? declaracionDelPadre(f.ruta, filas),
        posibles: nuevas.filter((n) => padre(n.ruta) === padre(f.ruta)).map((n) => n.ruta)
      })
    }
    hallazgos.push(...validarRetirada(f, existeYContiene))
  }
  return hallazgos
}

export function insertarNuevas(texto: string, filas: Fila[]): string {
  texto = texto.replaceAll('\r\n', '\n')
  const conocidas = new Set(leerLista(texto).map((f) => f.ruta))
  const nuevas = filas.filter((f) => !conocidas.has(f.ruta)).sort((a, b) => ordenar(a.ruta, b.ruta))
  if (!nuevas.length) return texto
  const lineas = texto.split('\n')
  for (const f of nuevas) {
    const indice = lineas.findIndex((l) => l && !l.startsWith('#') && !l.startsWith('ruta\t') && l.split('\t')[0] > f.ruta)
    const final = lineas.at(-1) === '' ? lineas.length - 1 : lineas.length
    lineas.splice(indice < 0 ? final : indice, 0, `${f.ruta}\t${f.forma}\tvigente\t`)
  }
  return lineas.join('\n')
}

function mensajeFalta(h: Hallazgo): string {
  const titulo = `FALTA  ${h.ruta}`
  return `${titulo}
  Esta clave está en disco en los equipos de los usuarios y esta versión ya no la escribe ni la lee
  con ese nombre. El registro aparta lo que no reconoce: al actualizar no habrá error, pero la app no
  leerá el valor guardado y usará el de por defecto (pérdida silenciosa).
${h.nota ? `  Se declaraba en: ${h.nota}.\n` : ''}${h.padre ? `  Su padre se declara en ${h.padre}.\n` : ''}${h.posibles?.length ? `  Posible nombre nuevo:\n  ${h.posibles.join('\n  ')}\n` : ''}  Si fue sin querer (un renombrado, un Omit, un spread): deshágase en el tipo persistido; en memoria
  puede llamarse distinto con un adaptador. Si es a propósito: la lectura del nombre viejo y la fila
  como \`retirada\` con \`lector: <archivo>\`, en este commit (docs/decisiones/calidad/claves-persistidas.md).`
}

export function mensaje(h: Hallazgo): string {
  const titulo = `${h.clase}  ${h.ruta}`
  switch (h.clase) {
    case 'FALTA': return mensajeFalta(h)
    case 'RAÍZ QUITADA': return `${titulo} (${h.cantidad} claves)
  La lista vigila este archivo y src/main/raicesPersistidas.ts ya no lo declara: la guardia dejaría de
  protegerlo. Si el archivo sigue escribiéndose, devuelva su raíz; si dejó de existir, pase sus filas a
  \`descartada\` con su motivo.`
    case 'RAÍZ ROTA': return `${titulo}
  Su tipo en src/main/raicesPersistidas.ts no se resuelve (${h.forma}): ${h.nota}.
  Sin raíz no hay vigilancia, así que la guardia no da verde. Corrija el import o la declaración.`
    case 'NUEVA': return `${titulo}  (${h.forma})
  Se escribe en disco y no está en scripts/calidad/claves-persistidas.tsv. En cuanto se publique, su
  nombre queda fijado para siempre. Añádala en este commit: npm run test:claves-persistidas -- --actualizar`
    case 'FORMA': return `${titulo}: ${h.anterior} → ${h.forma}
  Los archivos ya escritos traen el valor con la forma anterior. El lector de esta versión tiene que
  aceptar las dos; después, cambie la columna \`forma\` de la fila a mano.`
    case 'REAPARECE': return `${titulo}
  Esta clave está como \`${h.nota}\` y vuelve a escribirse. Si es a propósito, devuelva la fila a \`vigente\`;
  si no, es un nombre viejo que se reutiliza con otro sentido.`
    case 'RETIRADA SIN LECTOR': return `${titulo}
  La fila dice \`${h.nota}\`, pero ese archivo no contiene el literal
  '${h.nombre}'. Sin una lectura del nombre viejo, los datos ya guardados se pierden.`
    case 'DESCARTADA SIN MOTIVO': return `${titulo}
  Una clave descartada lleva \`motivo: …\`: renunciar a un dato del usuario se decide por escrito.`
    case 'SOBRANTE': return `${titulo}  ...${h.origen} → ${h.destino}
  El origen trae «${h.nombre}», que ${h.destino} no declara. ${h.destino} se guarda
  en ${h.artefacto}: tsc no revisa las claves de un spread, así que la sobrante se escribe con su
  nombre nuevo y la que espera el lector falta. Probablemente era: ${h.posibles?.join(', ') || '(sin candidata)'} (opcional).
  El origen se declara en ${h.declaracion}.
  Use en el origen el mismo nombre que el tipo persistido (o derívelo con Pick/Omit), o mapee la clave.`
    case 'NO SERIALIZABLE': return `${titulo} (${h.nombre})
  JSON.stringify escribe un ${h.nombre} como {}: el dato no llega a disco. Conviértalo en objeto o lista.`
    case 'PROFUNDIDAD': return `${titulo}
  El cierre pasa de 25 niveles sin repetir tipo; la guardia no da verde sobre lo que no ha recorrido.`
    default: throw new Error(`hallazgo desconocido: ${h.clase}`)
  }
}
