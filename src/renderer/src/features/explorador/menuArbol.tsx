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
import { MenuContextual, SEP, type EntradaMenuContextual } from '../../comun/MenuContextual'
import { esRutaVirtual } from '../../../../shared/jarPath'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { motorPorNombreDeArchivo, IconoBd } from '../bd'
import { basename } from './rutaPosix'
import { destinoPegado, type FuentePegado } from './portapapelesArchivos'
import { resolverClicDerecho, rutasLegibles } from './seleccionArbol'
import { abrirDialogoBorrado } from './operacionesArbol'
import { ofreceDescartar } from './ofertaMenuArbol'
import { abrirEnGestor, copiarOCortar, copiarRutas, pegarEn, resolverPegable } from './portapapelesArbol'
import type { Arbol, EstadoMenu, DestinoMenu } from './tiposArbol'
import { txExplorador } from './textos.ts'

// El nombre del gestor depende del idioma activo: se pide al construir el menú, no al cargar el módulo.
const gestorDelSistema = (): string => nombresSistema(window.tessera.plataforma).gestorArchivos

/**
 * Abre el menú sondeando antes el portapapeles: el menú se construye de forma síncrona
 * y «¿hay algo que pegar?» exige un viaje al main. El contador de generación descarta
 * las respuestas que llegan tarde (otro clic derecho, o un clic que cancela).
 */
export async function abrirMenu(a: Arbol, x: number, y: number, destino: DestinoMenu): Promise<void> {
  const gen = ++a.menuGenRef.current
  const { basesDeArchivo } = a.props
  let pegable: FuentePegado = { tipo: 'ninguno' }
  // Un archivo de base de datos pregunta al main, en paralelo con el portapapeles, si ya
  // está montado en este proyecto: el menú ofrece montarlo o desmontarlo.
  const esArchivoBd =
    basesDeArchivo !== undefined &&
    destino.tipo === 'nodo' &&
    !destino.esDir &&
    !esRutaVirtual(destino.ruta) &&
    motorPorNombreDeArchivo(basename(destino.ruta)) !== null
  const montada =
    esArchivoBd && destino.tipo === 'nodo' ? basesDeArchivo.montadaDe(destino.ruta).catch(() => null) : null
  try {
    pegable = await resolverPegable(a)
  } catch {
    // Un portapapeles ilegible no debe impedir abrir el menú: sale sin «Pegar».
  }
  const bd = montada ? { montadaId: await montada } : null
  if (gen !== a.menuGenRef.current) return
  a.setMenu({ x, y, destino, pegable, bd })
}

/**
 * Clic derecho sobre una fila: si estaba marcada no se toca la selección, y si no pasa a
 * ser solo ella. El objetivo se calcula con la selección NUEVA: `seleccion` sigue siendo
 * la vieja en este tick.
 */
export function abrirMenuDeFila(a: Arbol, x: number, y: number, clave: string, esDir: boolean): void {
  const nueva = resolverClicDerecho(a.seleccion, clave)
  a.setSeleccion(nueva)
  void abrirMenu(a, x, y, {
    tipo: 'nodo',
    ruta: clave,
    esDir,
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
  a.arbolRef.current?.focus()
}

interface ContextoMenu {
  a: Arbol
  destino: DestinoMenu
  esRaiz: boolean
  ruta: string
  esDir: boolean
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
  const { destino } = menu
  const esRaiz = destino.tipo === 'raiz'
  // Sobre el vacío todo va contra la raíz del proyecto ("" = raíz).
  const ruta = esRaiz ? '' : destino.ruta
  const objetivo = esRaiz ? [] : destino.objetivo
  return {
    a,
    destino,
    esRaiz,
    ruta,
    esDir: esRaiz || destino.esDir,
    objetivo,
    legibles: esRaiz ? [] : destino.legibles,
    n: objetivo.length,
    enJar: esRutaVirtual(ruta),
    pegable: menu.pegable,
    bd: menu.bd
  }
}

function entradasCrear(c: ContextoMenu): EntradaMenuContextual[] {
  if (!c.esDir || c.enJar) return []
  const { ruta } = c
  const t = txExplorador()
  return [
    {
      icon: <IconoArchivoNuevo />,
      label: t.nuevoArchivoMenu,
      onClick: () => c.a.setDialogo({ tipo: 'newFile', dir: ruta })
    },
    {
      icon: <IconoCarpetaNueva />,
      label: t.nuevaCarpetaMenu,
      onClick: () => c.a.setDialogo({ tipo: 'newFolder', dir: ruta })
    },
    SEP
  ]
}

function entradasAbrir(c: ContextoMenu): EntradaMenuContextual[] {
  const { a, ruta, esRaiz, enJar } = c
  const { basesDeArchivo, onAbrirHistorialArchivo } = a.props
  const t = txExplorador()
  const gestorArchivos = gestorDelSistema()
  const entradas: EntradaMenuContextual[] = [
    {
      icon: <IconoAbrirFuera />,
      // Dentro de un jar el main colapsa al contenedor: revelar el .jar es lo que ocurre.
      label: enJar ? t.abrirJarEn(gestorArchivos) : t.abrirEn(gestorArchivos),
      onClick: () => void abrirEnGestor(a, esRaiz, ruta)
    }
  ]
  if (!esRaiz && !c.esDir && !enJar) {
    entradas.push({
      icon: <IconoHistorial />,
      label: t.historialArchivo,
      onClick: () => onAbrirHistorialArchivo(ruta)
    })
  }
  // Montar un archivo de base de datos es otra forma de abrirlo; de fila sola.
  if (c.bd && basesDeArchivo && c.n <= 1) {
    const id = c.bd.montadaId
    entradas.push(
      id !== null
        ? {
            icon: <IconoBd />,
            label: t.desmontarBd,
            onClick: () => basesDeArchivo.desmontar(id)
          }
        : {
            icon: <IconoBd />,
            label: t.montarBd,
            onClick: () => void basesDeArchivo.montar(ruta)
          }
    )
  }
  return entradas
}

function entradasPortapapeles(c: ContextoMenu): EntradaMenuContextual[] {
  const { a, objetivo, n, pegable } = c
  const entradas: EntradaMenuContextual[] = []
  const t = txExplorador()
  if (!c.esRaiz && !c.enJar && n > 0) {
    entradas.push({
      icon: <IconoCortar />,
      label: t.cortar(n),
      onClick: () => void copiarOCortar(a, objetivo, 'cortar')
    })
    entradas.push({
      icon: <IconoCopiar />,
      label: t.copiar(n),
      onClick: () => void copiarOCortar(a, objetivo, 'copiar')
    })
  }
  // «Pegar» solo aparece si hay algo pegable: con texto suelto no hay nada que hacer.
  if (pegable.tipo !== 'ninguno' && !c.enJar) {
    entradas.push({
      icon: <IconoPegar />,
      label: pegable.tipo === 'imagen' ? t.pegarImagen : t.pegar,
      onClick: () => void pegarEn(a, destinoPegado(c.ruta, c.esDir), pegable)
    })
  }
  return entradas
}

function entradasRutas(c: ContextoMenu): EntradaMenuContextual[] {
  // Copiar la ruta lee y no escribe, así que va sobre `legibles`; el conteo de la
  // etiqueta sale de esa misma lista. Sobre la raíz se copia la del proyecto.
  const rutas = c.legibles.length > 0 ? c.legibles : [c.ruta]
  const nRutas = rutas.length
  const t = txExplorador()
  return [
    {
      icon: <IconoRuta />,
      label: t.copiarRutas(nRutas),
      onClick: () => void copiarRutas(c.a, rutas, true)
    },
    {
      icon: <IconoRuta />,
      label: t.copiarRutasRelativas(nRutas),
      onClick: () => void copiarRutas(c.a, rutas, false)
    }
  ]
}

function entradasDestructivas(c: ContextoMenu): EntradaMenuContextual[] {
  if (c.esRaiz || c.enJar) return []
  const { a, ruta, n, objetivo } = c
  const entradas: EntradaMenuContextual[] = []
  const t = txExplorador()
  // Renombrar y descartar son de fila sola: no significan nada para varios elementos.
  if (n <= 1) {
    entradas.push(SEP, {
      icon: <IconoRenombrar />,
      label: t.renombrarPuntos,
      onClick: () => a.setDialogo({ tipo: 'rename', ruta, nombre: basename(ruta) })
    })
  }
  entradas.push(SEP)
  // Descartar cambios pierde trabajo no commiteado: destructivo, como eliminar.
  if (ofreceDescartar(a.props.decoraciones?.porRuta.get(ruta), n, c.esDir)) {
    entradas.push({
      icon: <IconoDescartar />,
      label: t.descartarCambios,
      onClick: () => a.props.onDescartarCambios(ruta),
      danger: true
    })
  }
  if (n > 0) {
    entradas.push({
      icon: <IconoEliminar />,
      label: n > 1 ? t.eliminarElementosPuntos(n) : c.esDir ? t.eliminarCarpetaPuntos : t.eliminarArchivoPuntos,
      // El objetivo congelado al abrir, no la selección de ahora.
      onClick: () => abrirDialogoBorrado(a, objetivo),
      danger: true
    })
  }
  return entradas
}

/**
 * Entradas por grupos: [crear] | [abrir] | [cortar·copiar·pegar] | [copiar ruta] |
 * [renombrar] | [descartar·eliminar]. Los separadores sobrantes los poda `MenuContextual`.
 */
function entradasDelMenu(a: Arbol, menu: EstadoMenu): EntradaMenuContextual[] {
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
  return <MenuContextual x={menu.x} y={menu.y} items={entradasDelMenu(arbol, menu)} onCerrar={() => cerrarMenu(arbol)} />
}
