// =============================================================================
// Qué declaraciones de código no se miran en la guardia de idioma porque su nombre no lo elige quien las
// escribe: lo impone una API (DOM, JSX, Node, bibliotecas), una convención del proyecto, el molde de las
// pruebas o un contrato guardado en disco. Trabaja sobre nodos del compilador de TypeScript.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import ts from 'typescript'

/** Lo que un archivo aporta a las exenciones: sus importaciones externas, sus clases y las claves guardadas. */
export interface Contexto {
  archivo: string
  claves: Set<string>
  prueba: boolean
  jsx: boolean
  e2e: boolean
  /** Nombres importados de un módulo que no es del proyecto. */
  externos: Set<string>
  clasesLocales: Map<string, ts.ClassLikeDeclaration | ts.InterfaceDeclaration>
}

/** Atributos y eventos del DOM y de React que un componente reenvía a un elemento. */
const ATRIBUTOS_DOM = new Set([
  'className', 'htmlFor', 'style', 'id', 'title', 'disabled', 'hidden', 'type', 'checked', 'open', 'placeholder', 'tabIndex', 'role',
  'href', 'src', 'alt', 'autoFocus', 'readOnly', 'maxLength', 'rows', 'cols', 'required', 'selected', 'draggable', 'spellCheck',
  'multiple', 'target', 'rel', 'loading', 'download', 'colSpan', 'rowSpan', 'onClick', 'onDoubleClick', 'onChange', 'onInput',
  'onSubmit', 'onReset', 'onFocus', 'onBlur', 'onKeyDown', 'onKeyUp', 'onKeyPress', 'onMouseDown', 'onMouseUp', 'onMouseEnter',
  'onMouseLeave', 'onMouseMove', 'onMouseOver', 'onPointerDown', 'onPointerUp', 'onPointerMove', 'onPointerEnter', 'onPointerLeave',
  'onPointerCancel', 'onDrag', 'onDragStart', 'onDragEnd', 'onDragOver', 'onDragEnter', 'onDragLeave', 'onDrop', 'onScroll',
  'onWheel', 'onContextMenu', 'onSelect', 'onCopy', 'onCut', 'onPaste', 'onLoad', 'onError', 'onToggle', 'onTouchStart',
  'onTouchEnd', 'onTouchMove', 'onAnimationEnd', 'onTransitionEnd'
])

/** Parámetros que el contrato de una función pasada como argumento (Promise, manejadores) nombra en inglés. */
const PARAMETROS_CONVENCIONALES = new Set(['resolve', 'reject', 'req', 'res', 'next'])

/** Clases base del lenguaje y de la plataforma: una clase que las extiende hereda sus nombres. */
const BASES_GLOBALES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Promise', 'Event', 'CustomEvent',
  'EventTarget', 'Component', 'PureComponent', 'Object', 'String', 'Number', 'Date', 'RegExp', 'Function', 'Buffer', 'Uint8Array',
  'AbortController', 'Worker', 'Element', 'Node', 'Transform', 'Readable', 'Writable', 'Duplex',
  'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'InputEvent', 'DOMRect', 'Window', 'CSSStyleDeclaration', 'Navigator'
])

/** El molde de las pruebas (`hr`, `check`, el informe y el veredicto), con sus nombres fijos. */
const MOLDE_PRUEBAS = new Set([
  'hr', 'check', 'pass', 'evidence', 'results', 'allPass', 'failed', 'passed', 'detail', 'VEREDICTO', 'CheckResult'
])

/** Funciones del molde cuyos parámetros `name` y `title` también son del molde. */
const FUNCIONES_DEL_MOLDE = new Set(['check', 'hr'])

export const esArchivoPrueba = (archivo: string): boolean => /(?:^|\/)test-[^/]+\.[cm]?[jt]s$/.test(archivo) || /\.spec\.[cm]?[jt]s$/.test(archivo)

export const esArchivoJsx = (archivo: string): boolean => /\.[jt]sx$/.test(archivo)

type Miembro = ts.PropertyDeclaration | ts.PropertySignature | ts.MethodDeclaration | ts.MethodSignature | ts.AccessorDeclaration

/** Propiedades, métodos y accesores de una clase, interfaz, tipo literal u objeto literal. */
export function esMiembro(nodo: ts.Node): nodo is Miembro {
  return ts.isPropertyDeclaration(nodo) || ts.isPropertySignature(nodo) || ts.isMethodDeclaration(nodo) || ts.isMethodSignature(nodo) ||
    ts.isGetAccessor(nodo) || ts.isSetAccessor(nodo)
}

/** Recoge lo que el recorrido de un archivo necesita antes de mirar sus declaraciones. */
export function crearContexto(archivo: string, fuente: ts.SourceFile, claves: Set<string>): Contexto {
  const ctx: Contexto = {
    archivo, claves, prueba: esArchivoPrueba(archivo), jsx: esArchivoJsx(archivo), e2e: archivo.startsWith('e2e/'),
    externos: new Set(), clasesLocales: new Map()
  }
  const preparar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier) && !/^[./]/.test(nodo.moduleSpecifier.text)) {
      const enlaces = nodo.importClause?.namedBindings
      if (nodo.importClause?.name) ctx.externos.add(nodo.importClause.name.text)
      if (enlaces && ts.isNamespaceImport(enlaces)) ctx.externos.add(enlaces.name.text)
      else if (enlaces && ts.isNamedImports(enlaces)) enlaces.elements.forEach((elemento) => ctx.externos.add(elemento.name.text))
    }
    if ((ts.isClassDeclaration(nodo) || ts.isInterfaceDeclaration(nodo)) && nodo.name) ctx.clasesLocales.set(nodo.name.text, nodo)
    ts.forEachChild(nodo, preparar)
  }
  preparar(fuente)
  return ctx
}

/** Una clase hereda o implementa algo ajeno (importado, global o un elemento del DOM): sus miembros reflejan esa API. */
export function herenciaExterna(ctx: Contexto, clase: ts.Node, vistas = new Set<ts.Node>()): boolean {
  if ((!ts.isClassLike(clase) && !ts.isInterfaceDeclaration(clase)) || vistas.has(clase)) return false
  vistas.add(clase)
  const bases = clase.heritageClauses?.flatMap((clausula) => [...clausula.types]) ?? []
  return bases.some((base) => {
    const nombre = base.expression.getText().split('.')[0]
    if (ctx.externos.has(nombre) || BASES_GLOBALES.has(nombre) || /^(?:HTML|SVG)\w*Element$/.test(nombre)) return true
    const local = ctx.clasesLocales.get(nombre)
    return local ? herenciaExterna(ctx, local, vistas) : false
  })
}

function enModuloAmbiental(nodo: ts.Node): boolean {
  for (let actual: ts.Node | undefined = nodo; actual; actual = actual.parent) {
    if (ts.isModuleDeclaration(actual) && ts.isStringLiteral(actual.name)) return true
  }
  return false
}

/** La función de la que un parámetro lo es, si viaja como argumento de una llamada o de un `new`. */
function esArgumentoDeLlamada(parametro: ts.ParameterDeclaration): boolean {
  const funcion = parametro.parent
  if (!ts.isArrowFunction(funcion) && !ts.isFunctionExpression(funcion)) return false
  const llamada = funcion.parent
  return (ts.isCallExpression(llamada) || ts.isNewExpression(llamada)) && (llamada.arguments?.includes(funcion) ?? false)
}

function exentoPorConvencion(nodo: ts.Node, nombre: string): boolean {
  if (ts.isParameter(nodo)) return PARAMETROS_CONVENCIONALES.has(nombre) && esArgumentoDeLlamada(nodo)
  if (!ts.isVariableDeclaration(nodo)) return false
  const iniciador = nodo.initializer
  const llamada = iniciador && ts.isCallExpression(iniciador) ? iniciador : undefined
  const argumento = llamada?.arguments.at(0)
  const cargaModulo = llamada !== undefined && llamada.expression.getText() === 'require' && argumento !== undefined && ts.isStringLiteral(argumento)
  // `require` es el nombre que un módulo ESM da al que crea con `createRequire`; `XXX_CHANNELS` declara los canales IPC.
  return Boolean(cargaModulo) || nombre === 'require' || /^[A-Z0-9_]+_CHANNELS$/.test(nombre)
}

/** El nombre de la función que declara un parámetro (`function check(…)` o `const check = (…) =>`). */
function duenoDelParametro(parametro: ts.ParameterDeclaration): string {
  const funcion = parametro.parent as ts.FunctionLikeDeclaration
  if (funcion.name && ts.isIdentifier(funcion.name)) return funcion.name.text
  return ts.isVariableDeclaration(funcion.parent) ? funcion.parent.name.getText() : ''
}

const esTipoDeMiembros = (padre: ts.Node): boolean => ts.isTypeLiteralNode(padre) || ts.isInterfaceDeclaration(padre)

/** En pruebas y en `e2e/`, los tipos locales copian la API del código que prueban o simulan. */
function exentoEnPruebas(ctx: Contexto, nodo: ts.Node, nombre: string): boolean {
  if (esMiembro(nodo) && esTipoDeMiembros(nodo.parent) && (ctx.prueba || ctx.e2e)) return true
  if (!ctx.prueba) return false
  if (MOLDE_PRUEBAS.has(nombre)) return true
  return ts.isParameter(nodo) && ['name', 'title'].includes(nombre) && FUNCIONES_DEL_MOLDE.has(duenoDelParametro(nodo))
}

/** Atributos del DOM que un componente reenvía a un elemento, y `children` de React. */
function exentoPorDom(ctx: Contexto, nodo: ts.Node, nombre: string): boolean {
  if (esMiembro(nodo) && nombre === 'children' && nodo.type && /(?:React\.)?ReactNode/.test(nodo.type.getText())) return true
  return ctx.jsx && (esMiembro(nodo) || ts.isParameter(nodo)) && ATRIBUTOS_DOM.has(nombre)
}

/** Propiedades de estilo y de geometría del DOM (`DOMRect`, `style`): un tipo que solo las tiene copia esa forma. */
const PROPIEDADES_DE_ESTILO = new Set([
  'x', 'y', 'top', 'left', 'right', 'bottom', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'
])

function exentoPorEstilo(nodo: ts.Node): boolean {
  if (!esMiembro(nodo) || !esTipoDeMiembros(nodo.parent)) return false
  const miembros = (nodo.parent as ts.TypeLiteralNode | ts.InterfaceDeclaration).members
  return miembros.every((miembro) => miembro.name !== undefined && PROPIEDADES_DE_ESTILO.has(miembro.name.getText()))
}

/** Una propiedad cuyo nombre es el de una clave guardada: su tipo describe el archivo. Una variable homónima no lo es. */
const esClaveGuardada = (ctx: Contexto, nodo: ts.Node, nombre: string): boolean => esMiembro(nodo) && ctx.claves.has(nombre)

export function exento(ctx: Contexto, nodo: ts.Node, nombre: string): boolean {
  return enModuloAmbiental(nodo) || exentoPorConvencion(nodo, nombre) || exentoEnPruebas(ctx, nodo, nombre) ||
    exentoPorDom(ctx, nodo, nombre) || exentoPorEstilo(nodo) || esClaveGuardada(ctx, nodo, nombre)
}
