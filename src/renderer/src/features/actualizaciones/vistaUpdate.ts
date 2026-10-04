// =============================================================================
// Decisión de la VISTA del botón de actualización. Módulo PURO (sin React, JSX ni
// DOM) para probarlo con `node` a secas (`test-vista-update.mts`): devuelve una
// CLAVE de icono y `iconosUpdate.tsx` la traduce a SVG. Solo recibe el `UpdateState`;
// la plataforma no se mira: si esta copia no puede instalarse sola, el main dice `available`.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import type { UpdateState } from '../../../../shared/update-ipc.ts'

export type TonoUpdate = 'neutro' | 'acento' | 'verde' | 'rojo'

/**
 * Clave del glifo. El componente la traduce a SVG; aquí no puede haber JSX o el
 * test dejaría de poder importar este módulo.
 */
export type IconoUpdate =
  | 'buscar'
  | 'buscar-girando'
  | 'descarga'
  | 'aviso'
  | 'hecho'
  | 'anillo'
  | 'anillo-indeterminado'

export type AccionUpdate = 'instalar' | 'comprobar' | 'abrir' | 'nada'

export interface VistaUpdate {
  icono: IconoUpdate
  tono: TonoUpdate
  /** Lo que se despliega al pasar el ratón. Corto: la caja crece con él. */
  etiqueta: string
  /** Frase larga para el tooltip nativo y el lector de pantalla. */
  titulo: string
  accion: AccionUpdate
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
export function tieneContenido(s: UpdateState | null): boolean {
  if (s === null) return false
  if (s.avisoFallo !== null || s.avisoAplicada !== null) return true
  return (
    s.status === 'ready' ||
    s.status === 'downloading' ||
    s.status === 'available' ||
    s.status === 'error'
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
export function debeDescartarAlCerrar(s: UpdateState | null): boolean {
  return s !== null && s.avisoAplicada !== null
}

/** Deriva `punto` del tono en UN solo sitio. */
function vista(v: Omit<VistaUpdate, 'punto'>): VistaUpdate {
  return { ...v, punto: v.tono !== 'neutro' }
}

function vistaFallo(versionEsperada: string): VistaUpdate {
  return vista({
    icono: 'aviso',
    tono: 'rojo',
    etiqueta: 'La actualización falló',
    titulo: `La versión ${versionEsperada} no llegó a instalarse. Pulsa para ver por qué.`,
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaDescargando({ newVersion, percent }: UpdateState): VistaUpdate {
  return vista({
    icono: 'anillo',
    tono: 'acento',
    etiqueta: `Descargando ${newVersion ?? ''} · ${percent} %`.replace('  ', ' '),
    titulo: `Descargando Tessera ${newVersion ?? ''} en segundo plano (${percent} %).`,
    accion: 'abrir',
    deshabilitado: false
  })
}

/**
 * `available` describe una COPIA que no puede dar el último paso, no una plataforma. La
 * acción es `abrir` y no `instalar`: con `instalar` el clic iba directo a la descarga y el
 * popover que explica que hay que sustituir la app a mano no se abría jamás.
 */
function vistaDisponible({ newVersion }: UpdateState): VistaUpdate {
  // `newVersion` puede faltar: antes de inventar un "Tessera null", la frase se degrada.
  const quien = newVersion ? `Tessera ${newVersion}` : 'Una versión nueva de Tessera'
  return vista({
    icono: 'descarga',
    tono: 'acento',
    etiqueta: `Descargar ${newVersion ?? ''}`.trim(),
    titulo: `${quien} está disponible. Esta copia no puede instalarse sola: pulsa para ver cómo.`,
    accion: 'abrir',
    deshabilitado: false
  })
}

/**
 * `aplicable:false` = venía del marcador y aún no se ha confirmado con el feed. Se sigue
 * ofreciendo instalar (el main revalida antes de cerrar nada), pero el tooltip no puede
 * prometer que se aplicará sola.
 */
function vistaPreparada(s: UpdateState): VistaUpdate {
  const { newVersion } = s
  const titulo = !s.aplicable
    ? `Tessera ${newVersion} está preparada, pero falta confirmarla con el servidor. Pulsa para hacerlo e instalarla.`
    : s.seAplicaAlCerrar
      ? `Tessera ${newVersion} está preparada. Se aplicará sola al cerrar; pulsa para hacerlo ya.`
      : `Tessera ${newVersion} está preparada. Pulsa para reiniciar e instalarla.`
  return vista({
    icono: 'descarga',
    tono: 'acento',
    etiqueta: 'Actualizar ahora',
    titulo,
    accion: 'instalar',
    deshabilitado: false
  })
}

function vistaInstalando(): VistaUpdate {
  return vista({
    icono: 'anillo-indeterminado',
    tono: 'acento',
    etiqueta: 'Instalando…',
    titulo: 'Aplicando la actualización.',
    accion: 'nada',
    deshabilitado: true
  })
}

function vistaError(): VistaUpdate {
  return vista({
    icono: 'aviso',
    tono: 'rojo',
    etiqueta: 'No se pudo comprobar',
    titulo: 'La comprobación de actualizaciones falló. Pulsa para ver por qué.',
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaAplicada(desde: string, hasta: string): VistaUpdate {
  return vista({
    icono: 'hecho',
    tono: 'verde',
    etiqueta: `Actualizada a ${hasta}`,
    titulo: `Tessera se actualizó de ${desde} a ${hasta}.`,
    accion: 'abrir',
    deshabilitado: false
  })
}

function vistaBuscando(): VistaUpdate {
  return vista({
    icono: 'buscar-girando',
    tono: 'neutro',
    etiqueta: 'Buscando…',
    titulo: 'Comprobando si hay una versión nueva.',
    accion: 'nada',
    deshabilitado: true
  })
}

function vistaReposo(): VistaUpdate {
  return vista({
    icono: 'buscar',
    tono: 'neutro',
    etiqueta: 'Buscar actualizaciones',
    titulo: 'Comprobar si hay una versión nueva de Tessera.',
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
export function decidirVistaUpdate(s: UpdateState): VistaUpdate {
  const { status, avisoAplicada, avisoFallo } = s
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
