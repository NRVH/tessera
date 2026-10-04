// =============================================================================
// Prueba del teclado del lateral de BD en puro (node src/renderer/src/features/bd/test-arbol-teclado.mts):
// qué gesto es cada tecla, en su ORDEN (abrir antes que navegar, el retroceso de la búsqueda
// antes que borrar), por plataforma y con sus mitades negativas; y adónde lleva cada tecla de
// navegación (salta los «Cargando…», RePág/AvPág por página, sin filas no se usa).
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================
import { destinoNavegacion, esTeclaNavegacion, gestoDeTecla, type ContextoTecla, type TeclaArbol } from './arbolTeclado.ts'
import type { FilaArbol } from './filasArbolBd.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

function tecla(key: string, mods: Partial<Omit<TeclaArbol, 'key'>> = {}): TeclaArbol {
  return { key, code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }
}

const WIN: ContextoTecla = { plataforma: 'windows', hayFilas: true, busquedaAbierta: false }
const MAC: ContextoTecla = { plataforma: 'mac', hayFilas: true, busquedaAbierta: false }

function gesto(t: TeclaArbol, c: ContextoTecla = WIN): string {
  return String(gestoDeTecla(t, c))
}

hr('(1) gestos, en orden')
{
  check('ContextMenu y Mayús+F10: menú por teclado', gesto(tecla('ContextMenu')) === 'menuTeclado' && gesto(tecla('F10', { shiftKey: true })) === 'menuTeclado', gesto(tecla('F10', { shiftKey: true })))
  check('NEGATIVO: F10 a secas no es nada', gesto(tecla('F10')) === 'null', gesto(tecla('F10')))
  check('Enter y F4 abren', gesto(tecla('Enter')) === 'abrir' && gesto(tecla('F4')) === 'abrir', gesto(tecla('F4')))
  check('Mac: ⌘↓ ABRE (va antes que navegar)', gesto(tecla('ArrowDown', { metaKey: true }), MAC) === 'abrir', gesto(tecla('ArrowDown', { metaKey: true }), MAC))
  check('NEGATIVO Windows: Ctrl+↓ no abre ni navega', gesto(tecla('ArrowDown', { ctrlKey: true })) === 'null', gesto(tecla('ArrowDown', { ctrlKey: true })))
  check('↓ ↑ Inicio Fin RePág AvPág navegan', ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].every((k) => gesto(tecla(k)) === 'navegar'), 'ok')
  const sinFilas = { ...WIN, hayFilas: false }
  check('NEGATIVO: sin filas las teclas de navegación no se usan', gesto(tecla('ArrowDown'), sinFilas) === 'null' && gesto(tecla('Home'), sinFilas) === 'null', gesto(tecla('Home'), sinFilas))
  check('→ y ← son laterales; con Alt, nada', gesto(tecla('ArrowRight')) === 'lateral' && gesto(tecla('ArrowLeft', { altKey: true })) === 'null', gesto(tecla('ArrowLeft', { altKey: true })))
  check('Esc es escape aunque no haya búsqueda', gesto(tecla('Escape')) === 'escape', gesto(tecla('Escape')))
  const buscando = { ...WIN, busquedaAbierta: true }
  check('con búsqueda, ⌫ la edita (no borra la fila)', gesto(tecla('Backspace'), buscando) === 'retroceso', gesto(tecla('Backspace'), buscando))
  check('sin búsqueda, ⌫ y Supr borran', gesto(tecla('Backspace')) === 'borrar' && gesto(tecla('Delete')) === 'borrar', gesto(tecla('Delete')))
  check('Mac: ⌘⌫ borra', gesto(tecla('Backspace', { metaKey: true }), MAC) === 'borrar', gesto(tecla('Backspace', { metaKey: true }), MAC))
  check('NEGATIVO Windows: Ctrl+⌫ no borra', gesto(tecla('Backspace', { ctrlKey: true })) === 'null', gesto(tecla('Backspace', { ctrlKey: true })))
  check('F2 renombra; Mayús+F2 no', gesto(tecla('F2')) === 'renombrar' && gesto(tecla('F2', { shiftKey: true })) === 'null', gesto(tecla('F2', { shiftKey: true })))
  check('Ctrl+C copia en Windows y ⌘C en Mac', gesto(tecla('c', { ctrlKey: true })) === 'copiar' && gesto(tecla('C', { metaKey: true }), MAC) === 'copiar', 'ok')
  check('NEGATIVO: Ctrl+C en Mac y Ctrl+Mayús+C no copian', gesto(tecla('c', { ctrlKey: true }), MAC) === 'null' && gesto(tecla('C', { ctrlKey: true, shiftKey: true })) === 'null', 'ok')
  check('espacio despliega sin búsqueda; con ella, se escribe', gesto(tecla(' ')) === 'espacio' && gesto(tecla(' '), buscando) === 'buscar', gesto(tecla(' '), buscando))
  check('una letra abre la búsqueda; AltGr (Ctrl+Alt) no', gesto(tecla('a')) === 'buscar' && gesto(tecla('@', { ctrlKey: true, altKey: true })) === 'null', 'ok')
}

hr('(2) destino de la navegación')
{
  const fila = (key: string): FilaArbol => ({ kind: 'esquema', key, depth: 1, expandida: false }) as unknown as FilaArbol
  const cargando = { kind: 'placeholder', key: 'p', depth: 2, variante: 'loading', padre: 'x' } as unknown as FilaArbol
  const filas = [fila('a'), cargando, fila('b'), fila('c')]
  let paginas = 0
  const porPagina = (n: number) => (): number => {
    paginas++
    return n
  }
  const d = (k: string, actual: number, n = 2): number | null => destinoNavegacion(tecla(k), filas, actual, porPagina(n))
  check('↓ sin selección va a la primera', d('ArrowDown', -1) === 0, String(d('ArrowDown', -1)))
  check('↓ salta «Cargando…»', d('ArrowDown', 0) === 2, String(d('ArrowDown', 0)))
  check('↑ sin selección va a la última', d('ArrowUp', -1) === 3, String(d('ArrowUp', -1)))
  check('↓ en la última se queda', d('ArrowDown', 3) === 3, String(d('ArrowDown', 3)))
  check('Inicio y Fin', d('Home', 2) === 0 && d('End', 0) === 3, `${d('Home', 2)} ${d('End', 0)}`)
  check('las flechas no piden la página', paginas === 0, String(paginas))
  const avPag = d('PageDown', 0, 2)
  check('AvPág avanza una página de navegables (y pide la página una vez)', avPag === 3 && paginas === 1, `${avPag} ${paginas}`)
  check('RePág retrocede', d('PageUp', 3, 1) === 2, String(d('PageUp', 3, 1)))
  check('NEGATIVO: con modificador, una flecha no navega', d('ArrowDown', 0) !== null && destinoNavegacion(tecla('ArrowDown', { altKey: true }), filas, 0, porPagina(1)) === null, 'ok')
  check('NEGATIVO: una letra no navega; sin filas nada navega', destinoNavegacion(tecla('a'), filas, 0, porPagina(1)) === null && destinoNavegacion(tecla('End'), [], -1, porPagina(1)) === null, 'ok')
  check('Inicio con modificador sí navega (solo las flechas lo exigen)', esTeclaNavegacion(tecla('Home', { ctrlKey: true })), 'ok')
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
