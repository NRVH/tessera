// =============================================================================
// Documento y ventana que contienen un nodo, guardas entre ventanas (cross-realm)
// y registro de ventanas secundarias (franjas desacopladas). Puro sin React: los
// tests de lógica lo cargan directo bajo `node`.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================

/** Documento y ventana de un nodo, incluso tras adoptarlo a otra ventana. */
export function ventanaDe(nodo: Node): { documento: Document; ventana: Window | null } {
  const documento = nodo.ownerDocument ?? (nodo as Document)
  return { documento, ventana: documento.defaultView }
}

/** Documento de `nodo`, o `defecto` si es nulo. */
export function documentoDe(nodo: Node | null | undefined, defecto: Document = document): Document {
  if (!nodo) return defecto
  return nodo.ownerDocument ?? (nodo as Document)
}

/** Ventana de `nodo`, o `defecto` si es nulo o su documento no tiene vista. */
export function ventanaDeNodo(nodo: Node | null | undefined, defecto: Window = window): Window {
  if (!nodo) return defecto
  return ventanaDe(nodo).ventana ?? defecto
}

/** `true` si `valor` es un `Node` de cualquier ventana. */
export function esNodo(valor: unknown): valor is Node {
  return typeof valor === 'object' && valor !== null && typeof (valor as { nodeType?: unknown }).nodeType === 'number'
}

/** `true` si `valor` es un `Element` (`nodeType === 1`) de cualquier ventana. */
export function esElemento(valor: unknown): valor is Element {
  return esNodo(valor) && valor.nodeType === 1
}

/**
 * `true` si `valor` es un `HTMLElement` de cualquier ventana: compara contra el constructor
 * `HTMLElement` de la ventana del propio nodo, y sin vista descarta nodos SVG/XML.
 */
export function esElementoHtml(valor: unknown): valor is HTMLElement {
  if (!esElemento(valor)) return false
  const vista = valor.ownerDocument?.defaultView as { HTMLElement?: unknown } | null | undefined
  if (typeof vista?.HTMLElement === 'function') {
    return valor instanceof (vista.HTMLElement as typeof HTMLElement)
  }
  return (
    typeof (valor as { focus?: unknown }).focus === 'function' &&
    'style' in valor &&
    valor.namespaceURI !== 'http://www.w3.org/2000/svg'
  )
}

/** `true` si `valor` es un `<button>` de cualquier ventana. */
export function esBotonHtml(valor: unknown): valor is HTMLButtonElement {
  return esElementoHtml(valor) && valor.tagName === 'BUTTON'
}

/** `true` si `valor` es un `<input>` de cualquier ventana. */
export function esCampoHtml(valor: unknown): valor is HTMLInputElement {
  return esElementoHtml(valor) && valor.tagName === 'INPUT'
}

/** `true` si `valor` es una `CSSAnimation` de cualquier ventana (por su propiedad propia `animationName`). */
export function esAnimacionCss(valor: unknown): valor is CSSAnimation {
  return typeof valor === 'object' && valor !== null && typeof (valor as { animationName?: unknown }).animationName === 'string'
}

/** Crea un `ResizeObserver` en la ventana del propio `nodo` para no depender del ciclo de pintado de otra ventana. */
export function crearObservadorTamano(nodo: Element, alCambiar: ResizeObserverCallback): ResizeObserver {
  const vista = ventanaDe(nodo).ventana as (Window & { ResizeObserver?: typeof ResizeObserver }) | null
  const Observador = vista?.ResizeObserver ?? ResizeObserver
  return new Observador(alCambiar)
}

export const CAMBIO_VENTANA_ANFITRION = 'tessera:cambio-ventana-anfitrion'

export function alCambiarVentanaAnfitrion(nodo: Element, avisar: () => void): () => void {
  const anfitrion = nodo.closest('[data-anfitrion-movil]')
  anfitrion?.addEventListener(CAMBIO_VENTANA_ANFITRION, avisar)
  return () => anfitrion?.removeEventListener(CAMBIO_VENTANA_ANFITRION, avisar)
}

/** Sigue observando el tamaño en la ventana que aloja el nodo. */
export function observarTamanoEnAnfitrion(nodo: Element, alCambiar: ResizeObserverCallback): () => void {
  let observador: ResizeObserver
  const observar = (): void => {
    observador?.disconnect()
    observador = crearObservadorTamano(nodo, alCambiar)
    observador.observe(nodo)
  }
  observar()
  const dejarDeEscuchar = alCambiarVentanaAnfitrion(nodo, observar)
  return () => {
    dejarDeEscuchar()
    observador.disconnect()
  }
}

// ---------------------------------------------------------------------------
// Registro de ventanas secundarias (hijas abiertas con `window.open`).
// ---------------------------------------------------------------------------
const secundarias = new Set<Window>()
const porClave = new Map<string, Window>()
const oyentesSecundarias = new Set<() => void>()
let fotoSecundarias: readonly Window[] = []

function emitirSecundarias(): void {
  fotoSecundarias = [...secundarias]
  for (const cb of oyentesSecundarias) cb()
}

/** Registra una ventana hija (con clave opcional, p. ej. el perfil) y devuelve su baja idempotente. */
export function registrarVentanaSecundaria(ventana: Window, clave?: string): () => void {
  secundarias.add(ventana)
  if (clave) porClave.set(clave, ventana)
  emitirSecundarias()
  let dadaDeBaja = false
  return () => {
    if (dadaDeBaja) return
    dadaDeBaja = true
    secundarias.delete(ventana)
    if (clave && porClave.get(clave) === ventana) porClave.delete(clave)
    emitirSecundarias()
  }
}

/** Foto estable de las ventanas secundarias vivas (apta para `useSyncExternalStore`). */
export function ventanasSecundarias(): readonly Window[] {
  return fotoSecundarias
}

/** Ventana secundaria asociada a `clave` si sigue abierta. */
export function ventanaSecundariaDe(clave: string): Window | undefined {
  const v = porClave.get(clave)
  return v && !v.closed ? v : undefined
}

/** Suscribe a altas y bajas de ventanas secundarias; devuelve la baja. */
export function suscribirVentanasSecundarias(cb: () => void): () => void {
  oyentesSecundarias.add(cb)
  return () => {
    oyentesSecundarias.delete(cb)
  }
}

/** Todas las ventanas vivas: la principal seguida de las secundarias abiertas. */
export function todasLasVentanas(principal: Window = window): Window[] {
  const salida: Window[] = [principal]
  for (const v of secundarias) {
    if (!v.closed && v !== principal) salida.push(v)
  }
  return salida
}

/** Todos los documentos vivos: el principal seguido de los de las secundarias abiertas. */
export function todosLosDocumentos(principal: Document = document): Document[] {
  const salida: Document[] = [principal]
  for (const v of secundarias) {
    if (!v.closed && v.document && v.document !== principal) salida.push(v.document)
  }
  return salida
}

/** Ventana de Tessera que tiene el foco ahora, o `principal` si ninguna secundaria lo tiene. */
export function ventanaEnfocada(principal: Window = window): Window {
  for (const v of secundarias) {
    if (!v.closed && v.document?.hasFocus?.()) return v
  }
  return principal
}

/** Documento de la ventana enfocada ahora, o `principal` si ninguna secundaria tiene el foco. */
export function documentoEnfocado(principal: Document = document): Document {
  for (const v of secundarias) {
    if (!v.closed && v.document?.hasFocus?.()) return v.document
  }
  return principal
}

/** Devuelve `doc` si su ventana secundaria sigue registrada y abierta; si no, usa `defecto`. */
export function documentoVivo(
  doc: Document | null | undefined,
  defecto: Document = document,
  ventanas: readonly Window[] = ventanasSecundarias()
): Document {
  if (!doc) return defecto
  const vista = doc.defaultView
  return vista && ventanas.includes(vista) && !vista.closed ? doc : defecto
}
