// =============================================================================
// CuerpoRepo: los archivos de UN repo en sus cuatro secciones de `git status`
// (Conflictos, Preparados, Cambios, Sin versionar), como una lista plana con la
// carpeta en gris detrás del nombre. Un archivo MM está en Preparados Y en Cambios,
// con la letra de su eje en cada una. Solo calcula el OBJETIVO de los menús: los
// ejecuta `CambiosPorRepo`. Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import type { EstadoRepo, CambioWorktree } from '../../../../shared/git-ipc'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { EsperaCarga } from '../../comun/IndicadorCarga'
import { Cruce } from '../../comun/Presente'
import { ListaVirtual } from '../../comun/ListaVirtual'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { FilaArbolArchivo } from './FilaArbolArchivo'
import { IconoLote, IconoTodoLimpio } from './iconos'
import { precargarDiff } from './modelo/cacheBlobs'
import type { Seccion } from './modelo/estadoRepos'
import { resolverDestinoDiffWorktree } from './modelo/resolverDestinoDiffWorktree'
import {
  ejeDe,
  type FilaRef,
  type ElementoCambio,
  type ManejadoresArchivo,
  type ObjetivoMenu
} from './modelo/seccionesCambios'
import { txGit } from './textos.ts'
import { useListaCambios, type ListaCambios } from './useListaCambios'
import { useEntradaContenido } from '../../comun/useEntradaContenido'

interface PropsCuerpoRepo {
  /** En una .repo-section (multi-repo) no se virtualiza: el scroll es del padre. */
  anidado: boolean
  estado: EstadoRepo | null
  cargando: boolean
  /** Alto de fila / de cabecera en px: los decide el tamaño de letra de la interfaz. */
  altoFila: number
  altoCabecera: number
  seleccionada: FilaRef | null
  activa: FilaRef | null
  /** Claves `${seccion} ${ruta}` marcadas en TODO el panel (ver CambiosPorRepo). */
  marcadas: ReadonlySet<string>
  onAlternarMarcas: (claves: readonly string[], marcar: boolean) => void
  /** Los manejadores de lote, solo para saber qué botones tienen sentido. */
  acciones: ManejadoresArchivo
  onSeleccionar: (cambio: CambioWorktree, seccion: Seccion) => void
  onAbrirDiff: (cambio: CambioWorktree, seccion: Seccion) => void
  // Preparar/quitar/descartar no bajan hasta aquí: los ejecuta el menú de CambiosPorRepo.
  onMenu: (x: number, y: number, datos: ObjetivoMenu) => void
}

/** Cuerpo de UN repo: sus archivos en las secciones de git status, o su estado vacío/de carga. */
export function CuerpoRepo(props: PropsCuerpoRepo): React.JSX.Element {
  const { anidado, estado, cargando, altoFila, altoCabecera, marcadas, acciones } = props
  const cambios = estado?.cambios ?? null
  const entradaRef = useEntradaContenido(claveContenido(estado))
  const lista = useListaCambios(cambios, marcadas, altoCabecera, altoFila, anidado)
  const raiz = useRaizDelProyecto()
  const pintarElemento = (elemento: ElementoCambio): React.JSX.Element => {
    if (elemento.tipo === 'header') return cabeceraSubseccion(elemento, lista, acciones)
    return filaCambio(elemento, lista, props, raiz)
  }
  const estados = estadosTransitorios(estado, cargando)
  // Working-tree LIMPIO: un vacío de verdad. Solo en el modo NO anidado: dentro de
  // una sección de repo el centrado de 100% empujaría a los repos de abajo.
  const limpio = estado !== null && !estado.error && cambios?.length === 0
  const t = txGit()
  const claveEstado = estado?.error ? 'error' : !estado && cargando ? 'cargando' : limpio ? 'limpio' : 'lista'

  // ANIDADO (multi-repo): sin scroll propio -> lista plana.
  if (anidado) {
    return (
      <div ref={entradaRef} className="working-changes-list">
        <Cruce clave={claveEstado}>
          {estados}
          {limpio && <div className="git-state-inline">{t.sinCambiosLinea}</div>}
        </Cruce>
        {lista.elementos.map((elemento) => (
          <div key={elemento.id}>{pintarElemento(elemento)}</div>
        ))}
      </div>
    )
  }

  // REPO ÚNICO: la lista es su propio scroller -> VIRTUALIZADA.
  return (
    <div ref={entradaRef} className="git-lista-con-estado">
      <ListaVirtual<ElementoCambio>
        className="working-changes-list"
        etiquetaAria={t.cambiosWorktree}
        elementos={lista.elementos}
        altoElemento={lista.altoElemento}
        obtenerClave={(elemento) => elemento.id}
        cabecera={<Cruce clave={claveEstado}>{estados}</Cruce>}
        pintarElemento={(elemento) => pintarElemento(elemento)}
      />
      <Cruce className="git-lista-tapa" clave={limpio ? 'limpio' : 'lista'}>
        {limpio ? <EstadoVacio icono={<IconoTodoLimpio />} titulo={t.sinCambiosTitulo} pista={t.sinCambiosPista} /> : null}
      </Cruce>
    </div>
  )
}

function claveContenido(estado: EstadoRepo | null): string {
  return JSON.stringify([estado?.repo, estado?.rama])
}

/** Qué archivos toca el menú abierto desde una fila (ver ObjetivoMenu). */
function objetivoDe(seccion: Seccion, ruta: string, lista: ListaCambios): ObjetivoMenu {
  const { cambioPorRuta, marcadasPorSeccion, marcadasOrdenadas } = lista
  const cambio = cambioPorRuta.get(`${seccion}:${ruta}`) ?? null
  // Fila MARCADA -> toda la selección de esa sección; SIN marcar -> solo ella.
  const objetivo = marcadasPorSeccion[seccion].has(ruta) ? marcadasOrdenadas(seccion) : [ruta]
  const nuevos = objetivo.filter(
    (p) => cambioPorRuta.get(`${seccion}:${p}`)?.estadoWorktree === '?'
  )
  return { seccion, cambio, objetivo, nuevos }
}

function cabeceraSubseccion(
  elemento: Extract<ElementoCambio, { tipo: 'header' }>,
  lista: ListaCambios,
  acciones: ManejadoresArchivo
): React.JSX.Element {
  const seleccion = lista.marcadasOrdenadas(elemento.seccion)
  const n = seleccion.length
  return (
    <div className="working-subsection-header">
      <span className="subseccion-titulo">
        {elemento.etiqueta} ({elemento.total})
      </span>
      <Cruce className="subseccion-marcadas" clave={String(n)}><span>{n > 0 ? `· ${n}` : '\u00a0'}</span></Cruce>
      <AccionesLote seccion={elemento.seccion} seleccion={seleccion} acciones={acciones} />
    </div>
  )
}

/**
 * Los botones de lote de una sección sobre sus archivos marcados; nada sin marcas. Los usan la
 * cabecera de cada sección y, cuando «Cambios» va sin cabecera, la del repo (`CambiosPorRepo`).
 */
export function AccionesLote({
  seccion,
  seleccion,
  acciones
}: {
  seccion: Seccion
  seleccion: string[]
  acciones: ManejadoresArchivo
}): React.JSX.Element {
  const n = seleccion.length
  const puedePreparar = seccion !== 'staged' && acciones.onStageVarios
  // Descartar no se ofrece en conflictos: el lote lo revertiría a HEAD y perdería la resolución.
  const puedeDescartar = seccion !== 'staged' && seccion !== 'conflict' && acciones.onDescartarVarios
  const t = txGit()
  const etiquetaPreparar = seccion === 'conflict' ? t.marcarResueltosN(n) : t.prepararN(n)
  return (
    <span className={`subseccion-acciones${n > 0 ? ' visible' : ''}`} aria-hidden={n === 0}>
      {seccion === 'staged' && acciones.onUnstageVarios && (
        <BotonLote accion="quitar" texto={t.quitarN(n)} titulo={t.quitarNTitulo(n)} onClic={() => acciones.onUnstageVarios?.(seleccion)} />
      )}
      {puedePreparar && (
        <BotonLote
          accion="preparar"
          texto={etiquetaPreparar}
          titulo={seccion === 'conflict' ? t.marcarResueltosNTitulo(n) : t.prepararNTitulo(n)}
          onClic={() => acciones.onStageVarios?.(seleccion)}
        />
      )}
      {puedeDescartar && (
        <BotonLote
          accion="descartar"
          texto={t.descartarN(n)}
          titulo={t.descartarNTitulo(n)}
          onClic={() => acciones.onDescartarVarios?.(seleccion)}
        />
      )}
    </span>
  )
}

/**
 * Un botón de lote: icono y texto. Si la columna es estrecha el CSS esconde el texto y queda el
 * icono, con el texto en el tooltip y como nombre accesible, que no cambia con el ancho.
 */
function BotonLote(p: { accion: 'preparar' | 'quitar' | 'descartar'; texto: string; titulo: string; onClic: () => void }): React.JSX.Element {
  return (
    <button
      className={`subseccion-btn${p.accion === 'descartar' ? ' danger' : ''}`}
      onClick={p.onClic}
      title={p.titulo}
      aria-label={p.texto}
    >
      <IconoLote accion={p.accion} />
      <span className="subseccion-btn-texto">{p.texto}</span>
    </button>
  )
}

function filaCambio(
  elemento: Extract<ElementoCambio, { tipo: 'fila' }>,
  lista: ListaCambios,
  props: PropsCuerpoRepo,
  raiz: string
): React.JSX.Element {
  const { seleccionada, activa, onAlternarMarcas, onSeleccionar, onAbrirDiff, onMenu } = props
  const { fila, seccion } = elemento
  const ruta = fila.nodo.ruta
  const cambio = lista.cambioPorRuta.get(`${seccion}:${ruta}`)
  if (!cambio) return <div className="git-arbol-fila" />
  const marcada = lista.marcadasPorSeccion[seccion].has(ruta)
  return (
    <FilaArbolArchivo
      fila={fila}
      plana
      repo={props.anidado ? { prefijo: props.estado?.prefijo } : undefined}
      marca={marcada ? 'llena' : 'vacia'}
      seleccionada={seleccionada?.ruta === ruta && seleccionada.seccion === seccion}
      activa={activa?.ruta === ruta && activa.seccion === seccion}
      onAlternarMarca={() => onAlternarMarcas([`${seccion} ${ruta}`], !marcada)}
      onSeleccionar={() => onSeleccionar(cambio, seccion)}
      onAbrir={() => onAbrirDiff(cambio, seccion)}
      onPrecargar={() => {
        const t = resolverDestinoDiffWorktree(cambio, ejeDe(seccion))
        precargarDiff(t.antes, t.despues, raiz)
      }}
      onMenu={(x, y) => onMenu(x, y, objetivoDe(seccion, ruta, lista))}
    />
  )
}

// Estados TRANSITORIOS (error y carga), comunes a los dos modos. Siguen siendo
// líneas: centrar un "cargando" hace saltar el layout al llegar los datos.
function estadosTransitorios(estado: EstadoRepo | null, cargando: boolean): React.JSX.Element {
  const t = txGit()
  return (
    <>
      {estado?.error && (
        // `title`: dentro de una sección de repo la línea se recorta a una fila; el texto entero vive aquí.
        <div className="git-error" title={estado.error}>
          {t.errorCambios(estado.error)}
        </div>
      )}
      {/* Una sola línea: la sección tiene el alto medido de una fila mientras carga. */}
      {!estado && cargando && <EsperaCarga texto={t.cargandoCambios} variante="fila" className="git-state-inline" />}
    </>
  )
}
