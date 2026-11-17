// =============================================================================
// Decisión de la VISTA del botón de actualización. Módulo PURO (sin React, JSX ni
// DOM) para probarlo con `node` a secas (`test-vista-actualizacion.mts`): devuelve una
// CLAVE de icono y `iconosActualizacion.tsx` la traduce a SVG. Solo recibe el `EstadoActualizacion`;
// la plataforma no se mira: si esta copia no puede instalarse sola, el main dice `available`.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import type { EstadoActualizacion } from '../../../../shared/update-ipc.ts'
import { txActualizaciones } from './textos.ts'

/** Los textos de la vista del botón. */
const tx = (): ReturnType<typeof txActualizaciones>['vista'] => txActualizaciones().vista

export type TonoActualizacion = 'neutro' | 'acento' | 'verde' | 'rojo'

/**
 * Clave del glifo. El componente la traduce a SVG; aquí no puede haber JSX o el
 * test dejaría de poder importar este módulo.
 */
export type IconoActualizacion =
  | 'buscar'
  | 'buscar-girando'
  | 'descarga'
  | 'aviso'
  | 'hecho'
  | 'anillo'
  | 'anillo-indeterminado'

export type AccionActualizacion = 'instalar' | 'comprobar' | 'abrir' | 'nada'

export interface VistaActualizacion {
  icono: IconoActualizacion
  tono: TonoActualizacion
  /** Lo que se despliega al pasar el ratón. Corto: la caja crece con él. */
  etiqueta: string
  /** Frase larga para el tooltip nativo y el lector de pantalla. */
  titulo: string
  accion: AccionActualizacion
  deshabilitado: boolean
  /**
   * ¿Se pinta el punto de color? Es exactamente `tono !== 'neutro'`, pero expuesto
   * como campo propio para que el test pueda afirmarlo sin re-derivar la regla.
   */
  punto: boolean
}

/**
 * ¿Tiene el popover algo que enseñar? Si no, no puede quedarse abierto: sería un
 * popover vacío y sin salida (el cierre por clic-fuera ignora los clics de dentro).
 */
export function tieneContenido(s: EstadoActualizacion | null): boolean {
  if (s === null) return false
  if (s.avisoFallo !== null || s.avisoAplicada !== null) return true
  return (
    s.fase === 'ready' ||
    s.fase === 'downloading' ||
    s.fase === 'available' ||
    s.fase === 'error'
  )
}

/**
 * ¿Cerrar el popover cuenta como haber LEÍDO una noticia, y por tanto hay que retirarla?
 *
 * Solo para `avisoAplicada`, una noticia que se acaba al leerla. `avisoFallo` y
 * `status:'error'` piden algo (reintentar, abrir el instalador) y conservan su «Descartar».
 * Solo lo usa el popover: el desmontaje de la categoría de Configuración no distingue
 * «el usuario se fue» de «React recolocó el árbol».
 */
export function debeDescartarAlCerrar(s: EstadoActualizacion | null): boolean {
  return s !== null && s.avisoAplicada !== null
}

/** Deriva `punto` del tono en UN solo sitio. */
function vista(v: Omit<VistaActualizacion, 'punto'>): VistaActualizacion {
  return { ...v, punto: v.tono !== 'neutro' }
}

function vistaFallo(versionEsperada: string): VistaActualizacion {
  return vista({
    icono: 'aviso',
    tono: 'rojo',
    etiqueta: tx().falloEtiqueta,
    titulo: tx().falloTitulo(versionEsperada),
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaDescargando({ newVersion, percent }: EstadoActualizacion): VistaActualizacion {
  return vista({
    icono: 'anillo',
    tono: 'acento',
    etiqueta: tx().descargandoEtiqueta(newVersion ?? '', percent).replace('  ', ' '),
    titulo: tx().descargandoTitulo(newVersion ?? '', percent),
    accion: 'abrir',
    deshabilitado: false
  })
}

/**
 * `available` describe una COPIA que no puede dar el último paso, no una plataforma. La
 * acción es `abrir` y no `instalar`: con `instalar` el clic iba directo a la descarga y el
 * popover que explica que hay que sustituir la app a mano no se abría jamás.
 */
function vistaDisponible({ newVersion }: EstadoActualizacion): VistaActualizacion {
  // `newVersion` puede faltar: antes de inventar un "Tessera null", la frase se degrada.
  const t = tx()
  const quien = newVersion ? t.quienConVersion(newVersion) : t.quienSinVersion
  return vista({
    icono: 'descarga',
    tono: 'acento',
    etiqueta: t.descargar(newVersion ?? '').trim(),
    titulo: t.disponibleTitulo(quien),
    accion: 'abrir',
    deshabilitado: false
  })
}

/**
 * `aplicable:false` = venía del marcador y aún no se ha confirmado con el feed. Se sigue
 * ofreciendo instalar (el main revalida antes de cerrar nada), pero el tooltip no puede
 * prometer que se aplicará sola.
 */
function vistaPreparada(s: EstadoActualizacion): VistaActualizacion {
  const { newVersion } = s
  const t = tx()
  const titulo = !s.aplicable
    ? t.sinConfirmar(newVersion)
    : s.seAplicaAlCerrar
      ? t.alCerrar(newVersion)
      : t.preparada(newVersion)
  return vista({
    icono: 'descarga',
    tono: 'acento',
    etiqueta: t.actualizarAhora,
    titulo,
    accion: 'instalar',
    deshabilitado: false
  })
}

function vistaInstalando(): VistaActualizacion {
  return vista({
    icono: 'anillo-indeterminado',
    tono: 'acento',
    etiqueta: tx().instalando,
    titulo: tx().aplicando,
    accion: 'nada',
    deshabilitado: true
  })
}

function vistaError(): VistaActualizacion {
  return vista({
    icono: 'aviso',
    tono: 'rojo',
    etiqueta: tx().errorEtiqueta,
    titulo: tx().errorTitulo,
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaAplicada(desde: string, hasta: string): VistaActualizacion {
  return vista({
    icono: 'hecho',
    tono: 'verde',
    etiqueta: tx().aplicadaEtiqueta(hasta),
    titulo: tx().aplicadaTitulo(desde, hasta),
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaBuscando(): VistaActualizacion {
  return vista({
    icono: 'buscar-girando',
    tono: 'neutro',
    etiqueta: tx().buscando,
    titulo: tx().comprobando,
    accion: 'nada',
    deshabilitado: true
  })
}

function vistaReposo(): VistaActualizacion {
  return vista({
    icono: 'buscar',
    tono: 'neutro',
    etiqueta: tx().buscar,
    titulo: tx().comprobar,
    accion: 'comprobar',
    deshabilitado: false
  })
}

/**
 * Vista del botón. Precedencia: fallo > downloading > available > ready > installing >
 * error > aplicada > checking > reposo. `avisoAplicada` va por encima de `checking` y de
 * nada más: un chequeo de fondo no puede apagar el punto de una noticia sin leer ni
 * bloquear el botón que la abre, y lo que pide algo al usuario no puede taparse con ella.
 */
export function decidirVistaActualizacion(s: EstadoActualizacion): VistaActualizacion {
  const { fase: status, avisoAplicada, avisoFallo } = s
  if (avisoFallo) return vistaFallo(avisoFallo.versionEsperada)
  if (status === 'downloading') return vistaDescargando(s)
  if (status === 'available') return vistaDisponible(s)
  if (status === 'ready') return vistaPreparada(s)
  if (status === 'installing') return vistaInstalando()
  if (status === 'error') return vistaError()
  if (avisoAplicada) return vistaAplicada(avisoAplicada.desde, avisoAplicada.hasta)
  if (status === 'checking') return vistaBuscando()
  return vistaReposo()
}
