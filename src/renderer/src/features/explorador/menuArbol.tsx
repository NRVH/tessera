// =============================================================================
// Menú contextual del árbol: apertura (con el sondeo previo del portapapeles), cierre
// y las entradas por grupos de consecuencia. El objetivo de las acciones en plural se
// congela al abrir para que la etiqueta prometa lo que se hace. Reciben el `Arbol`.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import {
  IconoAbrirFuera,
  IconoArchivoNuevo,
  IconoCarpetaNueva,
  IconoCopiar,
  IconoCortar,
  IconoDescartar,
  IconoEliminar,
  IconoHistorial,
  IconoPegar,
  IconoRenombrar,
  IconoRuta
} from '../../comun/iconosMenu'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { esRutaVirtual } from '../../../../shared/jarPath'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { motorPorNombreDeArchivo, IconoBd } from '../bd'
import { basename } from './posixPath'
import { destinoPegado, type FuentePegado } from './fileClipboard'
import { resolverClicDerecho, rutasLegibles } from './seleccionArbol'
import { abrirDialogoBorrado } from './operacionesArbol'
import { ofreceDescartar } from './ofertaMenuArbol'
import { abrirEnGestor, copiarOCortar, copiarRutas, pegarEn, resolverPegable } from './portapapelesArbol'
import type { Arbol, EstadoMenu, MenuTarget } from './tiposArbol'

// La plataforma no cambia en caliente: constante de módulo y no una llamada por render.
const { gestorArchivos } = nombresSistema(window.tessera.plataforma)

/**
 * Abre el menú sondeando antes el portapapeles: el menú se construye de forma síncrona
 * y «¿hay algo que pegar?» exige un viaje al main. El contador de generación descarta
 * las respuestas que llegan tarde (otro clic derecho, o un clic que cancela).
 */
export async function abrirMenu(a: Arbol, x: number, y: number, target: MenuTarget): Promise<void> {
  const gen = ++a.menuGenRef.current
  const { basesDeArchivo } = a.props
  let pegable: FuentePegado = { kind: 'ninguno' }
  // Un archivo de base de datos pregunta al main, en paralelo con el portapapeles, si ya
  // está montado en este proyecto: el menú ofrece montarlo o desmontarlo.
  const esArchivoBd =
    basesDeArchivo !== undefined &&
    target.kind === 'nodo' &&
    !target.isDir &&
    !esRutaVirtual(target.path) &&
    motorPorNombreDeArchivo(basename(target.path)) !== null
  const montada =
    esArchivoBd && target.kind === 'nodo' ? basesDeArchivo.montadaDe(target.path).catch(() => null) : null
  try {
    pegable = await resolverPegable(a)
  } catch {
    // Un portapapeles ilegible no debe impedir abrir el menú: sale sin «Pegar».
  }
  const bd = montada ? { montadaId: await montada } : null
  if (gen !== a.menuGenRef.current) return
  a.setMenu({ x, y, target, pegable, bd })
}

/**
 * Clic derecho sobre una fila: si estaba marcada no se toca la selección, y si no pasa a
 * ser solo ella. El objetivo se calcula con la selección NUEVA: `seleccion` sigue siendo
 * la vieja en este tick.
 */
export function abrirMenuDeFila(a: Arbol, x: number, y: number, clave: string, isDir: boolean): void {
  const nueva = resolverClicDerecho(a.seleccion, clave)
  a.setSeleccion(nueva)
  void abrirMenu(a, x, y, {
    kind: 'nodo',
    path: clave,
    isDir,
    objetivo: a.rutasHoja(nueva.claves),
    legibles: rutasLegibles(nueva.claves, a.filaPorClave)
  })
}

/**
 * Cierra el menú y devuelve el foco al árbol: al desmontarse, el foco cae a `<body>` y
 * los atajos del árbol (su `keydown` va en el div) dejarían de llegar.
 */
function cerrarMenu(a: Arbol): void {
  a.setMenu(null)
  a.menuGenRef.current++
  a.treeRef.current?.focus()
}

interface ContextoMenu {
  a: Arbol
  target: MenuTarget
  esRaiz: boolean
  path: string
  isDir: boolean
  /** Sobre qué actúan las acciones que ESCRIBEN (cortar, copiar, eliminar). */
  objetivo: string[]
  /** Sobre qué actúan las que solo LEEN («Copiar ruta»); incluye lo de dentro de un .jar. */
  legibles: string[]
  /** Elementos del objetivo. */
  n: number
  /** Dentro de un .jar no se escribe nada: sus acciones se ocultan, no se deshabilitan. */
  enJar: boolean
  pegable: FuentePegado
  bd: EstadoMenu['bd']
}

function contextoDe(a: Arbol, menu: EstadoMenu): ContextoMenu {
  const { target } = menu
  const esRaiz = target.kind === 'raiz'
  // Sobre el vacío todo va contra la raíz del proyecto ("" = raíz).
  const path = esRaiz ? '' : target.path
  const objetivo = esRaiz ? [] : target.objetivo
  return {
    a,
    target,
    esRaiz,
    path,
    isDir: esRaiz || target.isDir,
    objetivo,
    legibles: esRaiz ? [] : target.legibles,
    n: objetivo.length,
    enJar: esRutaVirtual(path),
    pegable: menu.pegable,
    bd: menu.bd
  }
}

function entradasCrear(c: ContextoMenu): ContextMenuEntry[] {
  if (!c.isDir || c.enJar) return []
  const { path } = c
  return [
    {
      icon: <IconoArchivoNuevo />,
      label: 'Nuevo archivo',
      onClick: () => c.a.setDialog({ kind: 'newFile', dir: path })
    },
    {
      icon: <IconoCarpetaNueva />,
      label: 'Nueva carpeta',
      onClick: () => c.a.setDialog({ kind: 'newFolder', dir: path })
    },
    SEP
  ]
}

function entradasAbrir(c: ContextoMenu): ContextMenuEntry[] {
  const { a, path, esRaiz, enJar } = c
  const { basesDeArchivo, onOpenFileHistory } = a.props
  const items: ContextMenuEntry[] = [
    {
      icon: <IconoAbrirFuera />,
      // Dentro de un jar el main colapsa al contenedor: revelar el .jar es lo que ocurre.
      label: enJar ? `Abrir el .jar en ${gestorArchivos}` : `Abrir en ${gestorArchivos}`,
      onClick: () => void abrirEnGestor(a, esRaiz, path)
    }
  ]
  if (!esRaiz && !c.isDir && !enJar) {
    items.push({
      icon: <IconoHistorial />,
      label: 'Historial del archivo',
      onClick: () => onOpenFileHistory(path)
    })
  }
  // Montar un archivo de base de datos es otra forma de abrirlo; de fila sola.
  if (c.bd && basesDeArchivo && c.n <= 1) {
    const id = c.bd.montadaId
    items.push(
      id !== null
        ? {
            icon: <IconoBd />,
            label: 'Desmontar la base de datos',
            onClick: () => basesDeArchivo.desmontar(id)
          }
        : {
            icon: <IconoBd />,
            label: 'Montar como base de datos',
            onClick: () => void basesDeArchivo.montar(path)
          }
    )
  }
  return items
}

function entradasPortapapeles(c: ContextoMenu): ContextMenuEntry[] {
  const { a, objetivo, n, pegable } = c
  const items: ContextMenuEntry[] = []
  const cuantos = n > 1 ? ` ${n} elementos` : ''
  if (!c.esRaiz && !c.enJar && n > 0) {
    items.push({
      icon: <IconoCortar />,
      label: `Cortar${cuantos}`,
      onClick: () => void copiarOCortar(a, objetivo, 'cortar')
    })
    items.push({
      icon: <IconoCopiar />,
      label: `Copiar${cuantos}`,
      onClick: () => void copiarOCortar(a, objetivo, 'copiar')
    })
  }
  // «Pegar» solo aparece si hay algo pegable: con texto suelto no hay nada que hacer.
  if (pegable.kind !== 'ninguno' && !c.enJar) {
    items.push({
      icon: <IconoPegar />,
      label: pegable.kind === 'imagen' ? 'Pegar imagen' : 'Pegar',
      onClick: () => void pegarEn(a, destinoPegado(c.path, c.isDir), pegable)
    })
  }
  return items
}

function entradasRutas(c: ContextoMenu): ContextMenuEntry[] {
  // Copiar la ruta lee y no escribe, así que va sobre `legibles`; el conteo de la
  // etiqueta sale de esa misma lista. Sobre la raíz se copia la del proyecto.
  const rutas = c.legibles.length > 0 ? c.legibles : [c.path]
  const nRutas = rutas.length
  return [
    {
      icon: <IconoRuta />,
      label: nRutas > 1 ? `Copiar ${nRutas} rutas` : 'Copiar ruta',
      onClick: () => void copiarRutas(c.a, rutas, true)
    },
    {
      icon: <IconoRuta />,
      label: nRutas > 1 ? `Copiar ${nRutas} rutas relativas` : 'Copiar ruta relativa',
      onClick: () => void copiarRutas(c.a, rutas, false)
    }
  ]
}

function entradasDestructivas(c: ContextoMenu): ContextMenuEntry[] {
  if (c.esRaiz || c.enJar) return []
  const { a, path, n, objetivo } = c
  const items: ContextMenuEntry[] = []
  // Renombrar y descartar son de fila sola: no significan nada para varios elementos.
  if (n <= 1) {
    items.push(SEP, {
      icon: <IconoRenombrar />,
      label: 'Renombrar…',
      onClick: () => a.setDialog({ kind: 'rename', path, name: basename(path) })
    })
  }
  items.push(SEP)
  // Descartar cambios pierde trabajo no commiteado: destructivo, como eliminar.
  if (ofreceDescartar(a.props.decorations?.byPath.get(path), n, c.isDir)) {
    items.push({
      icon: <IconoDescartar />,
      label: 'Descartar cambios…',
      onClick: () => a.props.onDiscardChanges(path),
      danger: true
    })
  }
  if (n > 0) {
    items.push({
      icon: <IconoEliminar />,
      label: n > 1 ? `Eliminar ${n} elementos…` : c.isDir ? 'Eliminar carpeta…' : 'Eliminar archivo…',
      // El objetivo congelado al abrir, no la selección de ahora.
      onClick: () => abrirDialogoBorrado(a, objetivo),
      danger: true
    })
  }
  return items
}

/**
 * Entradas por grupos: [crear] | [abrir] | [cortar·copiar·pegar] | [copiar ruta] |
 * [renombrar] | [descartar·eliminar]. Los separadores sobrantes los poda `ContextMenu`.
 */
function entradasDelMenu(a: Arbol, menu: EstadoMenu): ContextMenuEntry[] {
  const c = contextoDe(a, menu)
  return [
    ...entradasCrear(c),
    ...entradasAbrir(c),
    SEP,
    ...entradasPortapapeles(c),
    SEP,
    ...entradasRutas(c),
    ...entradasDestructivas(c)
  ]
}

/** El menú contextual abierto, o nada. */
export function MenuContextualArbol({ arbol }: { arbol: Arbol }): React.JSX.Element | null {
  const { menu } = arbol
  if (!menu) return null
  return <ContextMenu x={menu.x} y={menu.y} items={entradasDelMenu(arbol, menu)} onClose={() => cerrarMenu(arbol)} />
}
