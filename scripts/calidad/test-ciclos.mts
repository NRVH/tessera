#!/usr/bin/env node
// =============================================================================
// Guardia de CICLOS de importación del renderer (npm run test:ciclos [-- rutas]).
// 1) Entre FEATURES no hay ciclos: lo que arrastra el `index.ts` de una no vuelve a ella
//    (umbral `MAX_FEATURES_EN_CICLO`). 2) En un ciclo de módulos, ninguno usa AL CARGARSE un
//    binding del ciclo que no sea `function` (un `const`, una `class` o un `memo()` sin
//    inicializar dejan la ventana en blanco), también a través de las funciones llamadas.
// Regla en docs/ESTANDAR_CODIGO.md («Ciclos de importación»). Se prueba a sí misma.
// =============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RAIZ, cerrar, check, hr, informar, leerArgumentos } from './comun.mts'
import type { Hallazgo } from './comun.mts'

/** Carpeta del renderer: el grafo se arma siempre entero, las rutas solo filtran el informe. */
const RENDERER = 'src/renderer/src'

/**
 * Máximo de features en un mismo ciclo entre barriles. 1 = ninguno: C13 los rompió todos
 * (docs/decisiones/renderer/barriles-sin-ciclos.md). Un ciclo entre dos `index.ts` arrastra a
 * todo lo que cuelga de ambos, y entonces cualquier `const` leído al cargar es una ventana en
 * blanco. Subirlo es aceptar uno: va con sus features y su motivo en el estándar.
 */
const MAX_FEATURES_EN_CICLO = 1

type Tipo = 'funcion' | 'const' | 'let' | 'var' | 'class' | 'namespace'

interface Binding {
  mod: string
  nombre: string
  tipo: Tipo
  /** Cuerpo que corre si se LLAMA al binding (declaración `function` o `const f = () =>`). */
  cuerpo: ts.Node | null
  linea: number
}

interface Destino {
  mod: string
  nombre: string
}

interface Modulo {
  sf: ts.SourceFile
  deps: Set<string>
  imp: Map<string, Destino>
  reexp: Map<string, Destino>
  estrella: string[]
  locales: Map<string, Binding>
  /** `export { a as b }` sin `from`: nombre exportado → nombre local. */
  alias: Map<string, string>
}

/** Los fuentes del renderer (sin pruebas ni `.d.ts`), leídos del disco. */
function leerRenderer(raiz: string): Map<string, string> {
  const fuentes = new Map<string, string>()
  const recorrer = (rel: string): void => {
    for (const e of readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      const hijo = `${rel}/${e.name}`
      if (e.isDirectory()) recorrer(hijo)
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.startsWith('test-') && !e.name.endsWith('.d.ts')) {
        fuentes.set(hijo, readFileSync(path.join(raiz, hijo), 'utf8'))
      }
    }
  }
  if (existsSync(path.join(raiz, RENDERER))) recorrer(RENDERER)
  return fuentes
}

function nombresDe(b: ts.BindingName): string[] {
  if (ts.isIdentifier(b)) return [b.text]
  return b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : nombresDe(e.name)))
}

/** Un nodo de tipo; el `extends` de una clase también es un nodo de tipo, pero corre. */
function esTipo(n: ts.Node): boolean {
  if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent) && ts.isClassLike(n.parent.parent)) {
    return n.parent.token !== ts.SyntaxKind.ExtendsKeyword
  }
  return ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
}

/** Un identificador en posición de tipo (esbuild lo borra: no es un uso de valor). */
function esPosicionDeTipo(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (esTipo(p)) return true
    if (ts.isStatement(p) && !ts.isVariableStatement(p)) return false
  }
  return false
}

/** Un identificador que NOMBRA algo (propiedad, parámetro, declaración) y no lo lee. */
function esNombre(n: ts.Identifier): boolean {
  const p = n.parent
  if (!p) return false
  return (
    ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isJsxAttribute(p)) && p.name === n) ||
    ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) && p.name === n) ||
    ((ts.isParameter(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n) ||
    (ts.isBindingElement(p) && (p.name === n || p.propertyName === n)) ||
    ((ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  )
}

/** Un parámetro o una variable de una función que lo envuelve tapa al del módulo. */
function estaSombreado(id: ts.Identifier): boolean {
  for (let p: ts.Node | undefined = id.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p) && p.parameters.some((pa) => nombresDe(pa.name).includes(id.text))) return true
    if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      for (const st of p.statements) {
        if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => nombresDe(d.name).includes(id.text))) return true
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === id.text) return true
      }
    }
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) && p.initializer && ts.isVariableDeclarationList(p.initializer)) {
      if (p.initializer.declarations.some((d) => nombresDe(d.name).includes(id.text))) return true
    }
    if (ts.isCatchClause(p) && p.variableDeclaration && nombresDe(p.variableDeclaration.name).includes(id.text)) return true
  }
  return false
}

function tieneModificador(n: ts.Node, k: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === k)
}

/**
 * Analiza el grafo de `fuentes` y devuelve sus ciclos de módulos, los ciclos entre features y
 * los usos al cargar dentro de los ciclos de módulos.
 */
export function analizarCiclos(fuentes: Map<string, string>): { ciclos: string[][]; ciclosFeatures: string[][]; hallazgos: Hallazgo[] } {
  const resolver = (desde: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(desde), spec.split('?')[0]))
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (fuentes.has(c)) return c
    return null
  }
  const modulos = new Map<string, Modulo>()
  for (const [f, texto] of fuentes) modulos.set(f, leerModulo(f, texto, resolver))

  const ciclos = componentesFuertes(modulos.keys(), (v) => modulos.get(v)?.deps ?? [])
  const ciclosFeatures = ciclosEntreFeatures(modulos)
  const cicloDe = new Map<string, number>()
  ciclos.forEach((c, i) => c.forEach((f) => cicloDe.set(f, i)))

  const origen = (mod: string, nombre: string, visto = new Set<string>()): Binding | null => {
    const clave = `${mod}#${nombre}`
    const m = modulos.get(mod)
    if (!m || visto.has(clave)) return null
    visto.add(clave)
    if (nombre === '*') return { mod, nombre, tipo: 'namespace', cuerpo: null, linea: 1 }
    const local = m.alias.get(nombre) ?? nombre
    if (m.locales.has(local)) return m.locales.get(local) ?? null
    const via = m.reexp.get(nombre) ?? m.imp.get(local)
    if (via) return origen(via.mod, via.nombre, visto)
    for (const e of m.estrella) {
      const o = origen(e, nombre, visto)
      if (o) return o
    }
    return null
  }

  const hallazgos = new Map<string, Hallazgo>()
  for (const [M, ciclo] of cicloDe) {
    const mm = modulos.get(M)
    if (!mm) continue
    const lineaDe = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

    /**
     * Recorre lo que corre al cargar. `ajeno` = el contexto es una función de un módulo al que
     * se llegó por el ciclo: ese módulo puede no haberse evaluado, así que ningún binding que
     * no sea `function` está garantizado.
     */
    const recorrer = (raiz: ts.Node, ctx: string, ajeno: boolean, pila: string[], lineaM: number, dentro: Set<string>): void => {
      const mc = modulos.get(ctx)
      if (!mc) return
      // La línea que se informa es la del uso en el NIVEL SUPERIOR de M, que es donde se arregla.
      const lineaDelUso = (id: ts.Identifier) => (pila.length === 0 ? lineaDe(mc.sf, id) : lineaM)
      const marcar = (b: Binding, id: ts.Identifier) => {
        const clave = `${M}#${b.mod}#${b.nombre}`
        if (hallazgos.has(clave)) return
        const linea = lineaDelUso(id)
        const camino = pila.length ? ` por ${pila.join(' > ')}` : ''
        hallazgos.set(clave, {
          archivo: M,
          linea,
          clase: 'carga-en-ciclo',
          detalle: `lee al cargar «${id.text}» (${b.tipo} de ${b.mod}:${b.linea})${camino}; ese módulo está en su ciclo de importación y puede no haberse evaluado`
        })
      }
      const entrar = (b: Binding, id: ts.Identifier, ajenoNuevo: boolean) => {
        const clave = `${b.mod}#${b.nombre}#${ajenoNuevo}`
        if (!b.cuerpo || dentro.has(clave)) return
        dentro.add(clave)
        recorrer(b.cuerpo, b.mod, ajenoNuevo, [...pila, `${id.text}()`], lineaDelUso(id), dentro)
      }
      const leer = (id: ts.Identifier) => {
        if (estaSombreado(id)) return
        const llamado = esLlamada(id)
        const local = mc.locales.get(id.text)
        if (local) {
          if (ajeno && local.tipo !== 'funcion') marcar(local, id)
          else if (llamado) entrar(local, id, ajeno)
          return
        }
        const via = mc.imp.get(id.text)
        if (!via) return
        const porCiclo = ajeno || cicloDe.get(via.mod) === ciclo
        if (!porCiclo) return
        const b = origen(via.mod, via.nombre)
        if (!b) return
        if (b.tipo !== 'funcion') marcar(b, id)
        else if (llamado) entrar(b, id, true)
      }
      const visitar = (n: ts.Node, corre: boolean): void => {
        if (esTipo(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return
        if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
          visitarClase(n, corre)
          return
        }
        if (n !== raiz && esFuncion(n)) corre = corre && seEjecutaYa(n)
        if (corre && ts.isIdentifier(n) && !esPosicionDeTipo(n) && !esNombre(n)) leer(n)
        ts.forEachChild(n, (h) => visitar(h, corre))
      }
      const visitarClase = (c: ts.ClassLikeDeclaration, corre: boolean) => {
        for (const h of c.heritageClauses ?? []) if (h.token === ts.SyntaxKind.ExtendsKeyword) visitar(h, corre)
        for (const miembro of c.members) {
          if (ts.isClassStaticBlockDeclaration(miembro)) visitar(miembro.body, corre)
          else if (ts.isPropertyDeclaration(miembro) && miembro.initializer && tieneModificador(miembro, ts.SyntaxKind.StaticKeyword)) {
            visitar(miembro.initializer, corre)
          }
        }
      }
      visitar(raiz, true)
    }

    mm.sf.statements.forEach((st) => {
      if (ts.isFunctionDeclaration(st) || ts.isImportDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) return
      recorrer(st, M, false, [], lineaDe(mm.sf, st), new Set())
    })
  }
  return { ciclos, ciclosFeatures, hallazgos: [...hallazgos.values()].sort((a, b) => a.archivo.localeCompare(b.archivo) || a.linea - b.linea) }
}

function esFuncion(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessor(n) ||
    ts.isSetAccessor(n) ||
    ts.isConstructorDeclaration(n)
  )
}

/** Una función que se pasa como argumento (`.map(cb)`, `create(cb)`) o una IIFE: corre al cargar. */
function seEjecutaYa(fn: ts.Node): boolean {
  const p = fn.parent
  if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.some((a) => a === fn)) return true
  return !!p && ts.isParenthesizedExpression(p) && !!p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p
}

function esLlamada(id: ts.Identifier): boolean {
  const p = id.parent
  return !!p && (((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === id) || (ts.isTaggedTemplateExpression(p) && p.tag === id))
}

function leerModulo(f: string, texto: string, resolver: (desde: string, spec: string) => string | null): Modulo {
  const sf = ts.createSourceFile(f, texto, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const usoValor = new Set<string>()
  const juntarUsos = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || esTipo(n)) return
    if (ts.isIdentifier(n) && !esPosicionDeTipo(n)) usoValor.add(n.text)
    if (ts.isExportSpecifier(n) && !n.isTypeOnly) usoValor.add((n.propertyName ?? n.name).text)
    if (ts.isExportAssignment(n) && ts.isIdentifier(n.expression)) usoValor.add(n.expression.text)
    ts.forEachChild(n, juntarUsos)
  }
  juntarUsos(sf)
  const m: Modulo = { sf, deps: new Set(), imp: new Map(), reexp: new Map(), estrella: [], locales: new Map(), alias: new Map() }
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const local = (nombre: string, tipo: Tipo, cuerpo: ts.Node | null, n: ts.Node) => m.locales.set(nombre, { mod: f, nombre, tipo, cuerpo, linea: linea(n) })
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) leerImport(st, f, m, usoValor, resolver)
    else if (ts.isExportDeclaration(st)) leerExport(st, f, m, resolver)
    else if (ts.isFunctionDeclaration(st)) {
      const cuerpo = st.body ?? null
      if (st.name) local(st.name.text, 'funcion', cuerpo, st)
      if (tieneModificador(st, ts.SyntaxKind.DefaultKeyword)) local('default', 'funcion', cuerpo, st)
    } else if (ts.isClassDeclaration(st)) {
      if (st.name) local(st.name.text, 'class', null, st)
      if (tieneModificador(st, ts.SyntaxKind.DefaultKeyword)) local('default', 'class', null, st)
    } else if (ts.isEnumDeclaration(st)) local(st.name.text, 'const', null, st)
    else if (ts.isExportAssignment(st)) local('default', 'const', null, st)
    else if (ts.isVariableStatement(st)) {
      const fl = st.declarationList.flags
      const tipo: Tipo = fl & ts.NodeFlags.Const ? 'const' : fl & ts.NodeFlags.Let ? 'let' : 'var'
      for (const d of st.declarationList.declarations) {
        const ini = d.initializer
        const cuerpo = ini && (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)) ? ini.body : null
        for (const nombre of nombresDe(d.name)) local(nombre, tipo, cuerpo, d)
      }
    }
  }
  return m
}

function leerImport(st: ts.ImportDeclaration, f: string, m: Modulo, usoValor: Set<string>, resolver: (d: string, s: string) => string | null): void {
  const cl = st.importClause
  const r = resolver(f, (st.moduleSpecifier as ts.StringLiteral).text)
  if (!r || cl?.isTypeOnly) return
  if (!cl) {
    m.deps.add(r)
    return
  }
  let valor = false
  if (cl.name && usoValor.has(cl.name.text)) {
    valor = true
    m.imp.set(cl.name.text, { mod: r, nombre: 'default' })
  }
  const nb = cl.namedBindings
  if (nb && ts.isNamespaceImport(nb) && usoValor.has(nb.name.text)) {
    valor = true
    m.imp.set(nb.name.text, { mod: r, nombre: '*' })
  }
  if (nb && ts.isNamedImports(nb)) {
    for (const el of nb.elements) {
      if (el.isTypeOnly || !usoValor.has(el.name.text)) continue
      valor = true
      m.imp.set(el.name.text, { mod: r, nombre: (el.propertyName ?? el.name).text })
    }
  }
  if (valor) m.deps.add(r)
}

function leerExport(st: ts.ExportDeclaration, f: string, m: Modulo, resolver: (d: string, s: string) => string | null): void {
  if (st.isTypeOnly) return
  const nb = st.exportClause
  if (!st.moduleSpecifier) {
    if (nb && ts.isNamedExports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) m.alias.set(el.name.text, (el.propertyName ?? el.name).text)
    return
  }
  const r = ts.isStringLiteral(st.moduleSpecifier) ? resolver(f, st.moduleSpecifier.text) : null
  if (!r) return
  if (!nb) {
    m.estrella.push(r)
    m.deps.add(r)
    return
  }
  if (!ts.isNamedExports(nb)) return
  for (const el of nb.elements) {
    if (el.isTypeOnly) continue
    m.reexp.set(el.name.text, { mod: r, nombre: (el.propertyName ?? el.name).text })
    m.deps.add(r)
  }
}

/** La feature de un módulo del renderer (`features/<feature>/…`), o null si no es de una. */
function featureDe(mod: string): string | null {
  const prefijo = `${RENDERER}/features/`
  if (!mod.startsWith(prefijo)) return null
  const resto = mod.slice(prefijo.length)
  const barra = resto.indexOf('/')
  return barra > 0 ? resto.slice(0, barra) : null
}

/**
 * Ciclos entre FEATURES. A depende de B si algo que arrastra el `index.ts` de A (lo que se
 * alcanza desde él sin salir de A) importa de B. Lo que solo cuelga de `app.ts` no cuenta: lo
 * importa App.tsx, que no está en ningún ciclo porque nadie lo importa.
 */
function ciclosEntreFeatures(modulos: Map<string, Modulo>): string[][] {
  const deps = new Map<string, Set<string>>()
  for (const f of modulos.keys()) {
    const a = featureDe(f)
    if (!a || deps.has(a)) continue
    const salida = new Set<string>()
    deps.set(a, salida)
    const pila = ['index.ts', 'index.tsx'].map((i) => `${RENDERER}/features/${a}/${i}`).filter((m) => modulos.has(m))
    const visto = new Set(pila)
    for (let m = pila.pop(); m !== undefined; m = pila.pop()) {
      for (const d of modulos.get(m)?.deps ?? []) {
        const b = featureDe(d)
        if (b !== a) {
          if (b) salida.add(b)
        } else if (!visto.has(d)) {
          visto.add(d)
          pila.push(d)
        }
      }
    }
  }
  return componentesFuertes(deps.keys(), (v) => deps.get(v) ?? [])
}

/** Tarjan: los componentes fuertemente conexos de más de un nodo (los ciclos). */
function componentesFuertes(nodos: Iterable<string>, ady: (v: string) => Iterable<string>): string[][] {
  let indice = 0
  const pila: string[] = []
  const enPila = new Set<string>()
  const ind = new Map<string, number>()
  const bajo = new Map<string, number>()
  const salida: string[][] = []
  const fuerte = (v: string): void => {
    ind.set(v, indice)
    bajo.set(v, indice)
    indice++
    pila.push(v)
    enPila.add(v)
    for (const w of ady(v)) {
      if (!ind.has(w)) {
        fuerte(w)
        bajo.set(v, Math.min(bajo.get(v) ?? 0, bajo.get(w) ?? 0))
      } else if (enPila.has(w)) bajo.set(v, Math.min(bajo.get(v) ?? 0, ind.get(w) ?? 0))
    }
    if (bajo.get(v) !== ind.get(v)) return
    const c: string[] = []
    let w: string | undefined
    do {
      w = pila.pop()
      if (w === undefined) break
      enPila.delete(w)
      c.push(w)
    } while (w !== v)
    if (c.length > 1) salida.push(c.sort())
  }
  for (const f of nodos) if (!ind.has(f)) fuerte(f)
  return salida
}

function autoprueba(): void {
  const R = RENDERER
  const casos: [string, Record<string, string>, string[]][] = [
    [
      'const del ciclo leído al cargar',
      { 'a.ts': "import { K } from './b'\nexport const X = K + 1\nexport function fa() {}", 'b.ts': "import { fa } from './a'\nexport const K = 1\nexport function g() { fa() }" },
      ['a.ts:2 K']
    ],
    [
      'function del ciclo en un mapa al cargar: seguro',
      { 'a.ts': "import { f } from './b'\nexport const MAPA = { f }\nexport function fa() {}", 'b.ts': "import { fa } from './a'\nexport function f() { fa() }" },
      []
    ],
    [
      'llamada al cargar a una function del ciclo que lee su const (transitivo)',
      {
        'a.ts': "import { formato } from './b'\nfunction etiqueta(n: number) { return formato(n) }\nexport const OPC = [1].map((n) => etiqueta(n))\nexport function fa() {}",
        'b.ts': "import { fa } from './a'\nconst SEP = ' '\nexport function formato(n: number) { fa(); return SEP + n }"
      },
      ['a.ts:3 SEP']
    ],
    [
      'la misma lectura dentro de una función que no corre al cargar: segura',
      { 'a.ts': "import { K } from './b'\nexport function fa() { return K }", 'b.ts': "import { fa } from './a'\nexport const K = 1\nexport function g() { fa() }" },
      []
    ],
    [
      'memo() del ciclo leído al cargar, a través de un index',
      {
        'a.ts': "import { Memo } from './i'\nexport const PANELES = { m: Memo }\nexport function fa() {}",
        'i.ts': "export { Memo } from './b'",
        'b.ts': "import { fa } from './a'\nconst memo = (x: unknown) => x\nexport const Memo = memo(fa)"
      },
      ['a.ts:2 Memo']
    ],
    [
      'class extends de un binding del ciclo',
      { 'a.ts': "import { Base } from './b'\nexport class Hija extends Base {}\nexport function fa() {}", 'b.ts': "import { fa } from './a'\nexport class Base { m() { fa() } }" },
      ['a.ts:2 Base']
    ],
    [
      'const leído al cargar de un módulo FUERA del ciclo: seguro',
      { 'a.ts': "import { K } from './c'\nexport const X = K + 1", 'c.ts': 'export const K = 1' },
      []
    ],
    [
      'import solo de tipo: no hace ciclo',
      { 'a.ts': "import { K } from './b'\nexport const X: K = 1\nexport function fa() {}", 'b.ts': "import { fa } from './a'\nexport type K = number\nexport function g() { fa() }" },
      []
    ]
  ]
  for (const [nombre, archivos, esperado] of casos) {
    const fuentes = new Map(Object.entries(archivos).map(([f, t]) => [`${R}/${f}`, t]))
    const { hallazgos } = analizarCiclos(fuentes)
    const obtenido = hallazgos.map((h) => `${h.archivo.slice(R.length + 1)}:${h.linea} ${/«([^»]+)»/.exec(h.detalle)?.[1] ?? ''}`)
    check(`autoprueba: ${nombre}`, obtenido.join(',') === esperado.join(','), `esperado «${esperado.join(',')}», obtenido «${obtenido.join(',')}»`)
  }
  const dosFeatures = (a: Record<string, string>): Record<string, string> => ({
    'features/b/index.ts': "export { fb, Visor } from './fb'",
    'features/b/fb.ts': "import { fa } from '../a'\nexport function fb() { fa() }\nexport function Visor() { return null }",
    ...a
  })
  const casosFeatures: [string, Record<string, string>, string][] = [
    [
      'dos features que se importan por su index.ts',
      dosFeatures({ 'features/a/index.ts': "export { fa } from './fa'", 'features/a/fa.ts': "import { fb } from '../b'\nexport function fa() { fb() }" }),
      'a b'
    ],
    [
      'lo que solo cuelga de app.ts no cierra ciclo',
      dosFeatures({
        'features/a/index.ts': "export { fa } from './fa'",
        'features/a/fa.ts': 'export function fa() {}',
        'features/a/app.ts': "export { useA } from './useA'",
        'features/a/useA.ts': "import { fb } from '../b'\nexport function useA() { fb() }"
      }),
      ''
    ],
    [
      'un componente que llega por prop con `import type` y `typeof` no cierra ciclo',
      dosFeatures({
        'features/a/index.ts': "export { fa } from './fa'",
        'features/a/fa.ts': "import type { Visor } from '../b'\nexport function fa(v?: typeof Visor) { return v }"
      }),
      ''
    ]
  ]
  for (const [nombre, archivos, esperado] of casosFeatures) {
    const fuentes = new Map(Object.entries(archivos).map(([f, t]) => [`${R}/${f}`, t]))
    const obtenido = analizarCiclos(fuentes).ciclosFeatures.map((c) => c.join(' ')).join(',')
    check(`autoprueba: ${nombre}`, obtenido === esperado, `esperado «${esperado}», obtenido «${obtenido}»`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const fuentes = leerRenderer(RAIZ)
const { ciclos, ciclosFeatures, hallazgos: todos } = analizarCiclos(fuentes)
const enAmbito = (f: string) => op.rutas.length === 0 || op.rutas.some((r) => r === '.' || f === r || f.startsWith(r + '/'))
const hallazgos = todos.filter((h) => enAmbito(h.archivo))
hr(`Ciclos de importación del renderer: ${fuentes.size} módulo(s)`)
check('hay módulos en el renderer', fuentes.size > 0, `${fuentes.size} módulo(s)`)
console.log(`  ${ciclos.length} ciclo(s): ${ciclos.map((c) => `${c.length} módulos`).join(', ') || 'ninguno'}`)
if (op.detalle) ciclos.forEach((c, i) => console.log(`  ciclo ${i + 1}: ${c.map((f) => f.slice(RENDERER.length + 1)).join(' ')}`))
const entreFeatures = ciclosFeatures.map((c) => c.join(' ↔ ')).join('; ') || 'ninguno'
console.log(`  ciclos entre features: ${entreFeatures}`)
check(
  `ningún ciclo entre barriles de más de ${MAX_FEATURES_EN_CICLO} feature(s)`,
  ciclosFeatures.every((c) => c.length <= MAX_FEATURES_EN_CICLO),
  entreFeatures
)
informar(hallazgos, op)
cerrar('ciclos', fuentes.size, hallazgos, op)
