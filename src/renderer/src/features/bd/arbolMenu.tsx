// =============================================================================
// Menú contextual del lateral de BD: una función por tipo de fila, elegida por una TABLA
// de despacho (`MENU_POR_TIPO`), y el menú del hueco bajo la última fila. Cada entrada
// actúa con el contexto del render en que se abrió el menú (`CtxArbol`). «Ver DDL» va
// en todo objeto; una conexión ajena solo ofrece eliminar.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoAbrir, IconoAjustes, IconoCopiar, IconoEliminar, IconoRed, IconoRenombrar, IconoRuta } from '../../comun/iconosMenu'
import {
  IconoDdl,
  IconoDefinicion,
  IconoDesconectar,
  IconoEsquema,
  IconoFiltro,
  IconoNuevaConexion,
  IconoNuevaConsola,
  IconoPlegarTodo,
  IconoRefrescar
} from './iconosBd'
import { claveBd, kindAbreTipo, paneDdlDeFila, type FilaBd } from './arbolBd'
import {
  accionesDeAjena,
  conexionDeFila,
  motivoSinConsola,
  nombreCualificadoDeFila,
  nombreDeFila,
  tieneSesiones,
  type FilaArbol
} from './filasArbolBd'
import { escaparGlob } from './arbolClaves'
import { etiquetaAcorde } from '../../util/atajos'
import { esMotorSql } from '../../../../shared/motores/index'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import { copiar, desconectar, probar, refrescar, refrescarCabecera } from './DbArbolAcciones'
import {
  abrirPane,
  abrirPopover,
  accionDeFilaError,
  activarFila,
  anclaDe,
  aplicarFiltroClaves,
  cargarMasClaves,
  ejecutarAccionError,
  idFila,
  idInsignia,
  idInsigniaBase
} from './DbArbolNavegacion'
import type { CtxArbol } from './DbArbolTipos'

type FilaDe<K extends FilaBd['kind']> = Extract<FilaBd, { kind: K }>

/** Lo que comparten los menús de fila: dónde se abrió, su conexión y «Copiar nombre». */
interface MenuFila {
  a: CtxArbol
  c: DbConnection | undefined
  x: number
  y: number
  copiarNombre: ContextMenuEntry
}

function itemNuevaConsola(a: CtxArbol, conexionId: string): ContextMenuEntry {
  return { label: 'Nueva consola', icon: <IconoNuevaConsola />, onClick: () => a.p.onNuevaConsola(conexionId) }
}

function itemRefrescar(onClick: () => void): ContextMenuEntry {
  return { label: 'Refrescar', icon: <IconoRefrescar />, onClick }
}

/** El menú de una ajena: solo lo que `accionesDeAjena` ofrece (eliminar, con confirmación). */
function itemsAjena(a: CtxArbol, ajena: DbConexionAjena): ContextMenuEntry[] {
  return accionesDeAjena().map((acc) => ({
    label: acc.etiqueta,
    icon: <IconoEliminar />,
    danger: true,
    onClick: () => a.e.setConfirmacion({ tipo: 'ajena', ajena })
  }))
}

/** «Esquemas visibles…» (o «Bases visibles…» con nivel «Bases»), anclado a la insignia o a la fila. */
function itemVisibles(fila: FilaDe<'conexion'>, { a, x, y }: MenuFila): ContextMenuEntry {
  const con = fila.conexion
  return {
    label: fila.nivelBases ? 'Bases visibles…' : 'Esquemas visibles…',
    icon: <IconoEsquema />,
    onClick: () =>
      abrirPopover(
        a,
        con.id,
        anclaDe(document.getElementById(idInsignia(a, con.id)) ?? document.getElementById(idFila(a, a.d.filas.indexOf(fila))), x, y),
        fila.nivelBases ? 'bases' : undefined
      )
  }
}

function menuConexion(fila: FilaDe<'conexion'>, m: MenuFila): ContextMenuEntry[] {
  const { a } = m
  const con = fila.conexion
  // Los esquemas visibles son solo de SQL; la consola, de toda familia que la tenga.
  const sinConsola = motivoSinConsola(con) !== null
  const sinEsquemas = !esMotorSql(con.motor)
  const items: ContextMenuEntry[] = [
    ...(sinConsola ? [] : [itemNuevaConsola(a, con.id)]),
    itemRefrescar(() => refrescar(a, con.id)),
    SEP,
    ...(sinEsquemas ? [] : [itemVisibles(fila, m)]),
    { label: 'Editar conexión…', icon: <IconoAjustes />, onClick: () => a.e.setDialogo({ conexionId: con.id }) },
    {
      label: a.e.probando === con.id ? 'Probando…' : 'Probar conexión',
      icon: <IconoRed />,
      disabled: a.e.probando !== null,
      onClick: () => void probar(a, con)
    }
  ]
  if (tieneSesiones(a.p.sesiones, con.id)) {
    items.push({ label: 'Desconectar', icon: <IconoDesconectar />, onClick: () => void desconectar(a, con) })
  }
  items.push(SEP, {
    label: 'Eliminar conexión…',
    icon: <IconoEliminar />,
    danger: true,
    onClick: () => a.e.setConfirmacion({ tipo: 'conexion', conexion: con })
  })
  return items
}

function menuCarpetaConsolas(fila: FilaDe<'carpeta-consolas'>, { a, c }: MenuFila): ContextMenuEntry[] {
  return [...(motivoSinConsola(c) !== null ? [] : [itemNuevaConsola(a, fila.conexionId)]), itemRefrescar(() => a.p.onConsolasCambiaron())]
}

function menuConsola(fila: FilaDe<'consola'>, { a }: MenuFila): ContextMenuEntry[] {
  const k = fila.consola
  return [
    { label: 'Abrir', icon: <IconoAbrir />, onClick: () => activarFila(a, fila) },
    {
      label: 'Renombrar…',
      icon: <IconoRenombrar />,
      onClick: () => a.e.setRenombrando({ consola: k, error: null })
    },
    SEP,
    {
      label: 'Eliminar consola…',
      icon: <IconoEliminar />,
      danger: true,
      onClick: () => a.e.setConfirmacion({ tipo: 'consola', consola: k })
    }
  ]
}

/** Una base del nivel «Bases»: sus esquemas visibles se eligen aquí (configuración de la conexión). */
function menuBase(fila: FilaDe<'base'>, { a, x, y, copiarNombre }: MenuFila): ContextMenuEntry[] {
  return [
    itemNuevaConsola(a, fila.conexionId),
    itemRefrescar(() => refrescar(a, fila.conexionId, undefined, fila.base)),
    SEP,
    {
      label: 'Esquemas visibles…',
      icon: <IconoEsquema />,
      disabled: !fila.accesible,
      onClick: () =>
        abrirPopover(
          a,
          fila.conexionId,
          anclaDe(
            document.getElementById(idInsigniaBase(a, fila.conexionId, fila.base)) ?? document.getElementById(idFila(a, a.d.filas.indexOf(fila))),
            x,
            y
          ),
          'esquemas',
          fila.base
        )
    },
    copiarNombre
  ]
}

function menuEsquema(fila: FilaDe<'esquema'>, { a, copiarNombre }: MenuFila): ContextMenuEntry[] {
  return [itemNuevaConsola(a, fila.conexionId), itemRefrescar(() => refrescar(a, fila.conexionId, fila.esquema, fila.base)), copiarNombre]
}

function menuCarpeta(fila: FilaDe<'carpeta' | 'carpeta-detalle'>, { a }: MenuFila): ContextMenuEntry[] {
  return [itemRefrescar(() => refrescar(a, fila.conexionId, fila.esquema, fila.base))]
}

/** «Abrir datos» y, en una vista, «Ver definición». */
function itemsDatosObjeto(a: CtxArbol, fila: FilaDe<'objeto'>, acorde: string): ContextMenuEntry[] {
  const o = fila.objeto
  const items: ContextMenuEntry[] = [{ label: `Abrir datos (${acorde})`, icon: <IconoAbrir />, onClick: () => void abrirPane(a, fila) }]
  if (o.tipo === 'vista' || o.tipo === 'vistaMaterializada') {
    items.push({
      label: 'Ver definición',
      icon: <IconoDefinicion />,
      onClick: () =>
        a.p.onAbrir({
          kind: 'fuente',
          conexionId: fila.conexionId,
          esquema: fila.esquema,
          objeto: o.nombre,
          tipo: o.tipo,
          ...(fila.base !== undefined ? { base: fila.base } : {})
        })
    })
  }
  return items
}

function menuObjeto(fila: FilaDe<'objeto'>, { a, c, copiarNombre }: MenuFila): ContextMenuEntry[] {
  const abre = kindAbreTipo(fila.objeto.tipo)
  const cualificado: ContextMenuEntry = {
    label: 'Copiar nombre cualificado',
    icon: <IconoRuta />,
    onClick: () => copiar(a, c ? nombreCualificadoDeFila(fila, c.motor) : null)
  }
  const acorde = etiquetaAcorde('abrirNodo', a.plataforma)
  // «Ver DDL» en TODO objeto, justo detrás de lo que abre. Un sinónimo enseña SU DDL (CREATE
  // SYNONYM), no el del objeto al que apunta: para ese está «Abrir datos», que lo resuelve.
  const paneDdl = paneDdlDeFila(fila)
  const verDdl: ContextMenuEntry[] = paneDdl ? [{ label: 'Ver DDL', icon: <IconoDdl />, onClick: () => a.p.onAbrir(paneDdl) }] : []
  if (abre === 'datos') {
    return [...itemsDatosObjeto(a, fila, acorde), ...verDdl, itemNuevaConsola(a, fila.conexionId), SEP, copiarNombre, cualificado]
  }
  if (abre === 'fuente') {
    return [
      { label: `Abrir fuente (${acorde})`, icon: <IconoDefinicion />, onClick: () => void abrirPane(a, fila) },
      ...verDdl,
      SEP,
      copiarNombre,
      cualificado
    ]
  }
  return verDdl.length > 0 ? [...verDdl, SEP, copiarNombre, cualificado] : [copiarNombre, cualificado]
}

function menuHoja(_fila: FilaDe<'columna' | 'indice' | 'restriccion'>, { copiarNombre }: MenuFila): ContextMenuEntry[] {
  return [copiarNombre]
}

function menuPlaceholder(fila: FilaDe<'placeholder'>, { a }: MenuFila): ContextMenuEntry[] {
  const acc = accionDeFilaError(a, fila)
  return acc ? [{ label: acc.etiqueta, onClick: () => ejecutarAccionError(a, fila) }] : []
}

// Documentos: la consola nace en la base de la conexión (elegir la de la fila pediría que
// `onNuevaConsola` recibiera la base).
function menuDocBase(fila: FilaDe<'doc-base'>, { a, copiarNombre }: MenuFila): ContextMenuEntry[] {
  return [itemNuevaConsola(a, fila.conexionId), itemRefrescar(() => refrescar(a, fila.conexionId)), copiarNombre]
}

function menuKvBase(fila: FilaDe<'kv-base'>, { a, copiarNombre }: MenuFila): ContextMenuEntry[] {
  const filtro = { conexionId: fila.conexionId, indice: fila.indice, clave: fila.key }
  return [
    itemNuevaConsola(a, fila.conexionId),
    itemRefrescar(() => refrescar(a, fila.conexionId)),
    SEP,
    { label: 'Filtrar claves…', icon: <IconoFiltro />, onClick: () => a.e.setFiltrandoClaves({ ...filtro, actual: fila.patron }) },
    ...(fila.patron !== '' ? [{ label: 'Quitar el filtro', onClick: () => aplicarFiltroClaves(a, filtro, '') }] : []),
    SEP,
    copiarNombre
  ]
}

function menuKvCarpeta(fila: FilaDe<'kv-carpeta'>, { a }: MenuFila): ContextMenuEntry[] {
  const filtro = { conexionId: fila.conexionId, indice: fila.indice, clave: claveBd.kvBase(fila.conexionId, fila.indice) }
  return [
    // El prefijo es LITERAL (escapado: `[`, `*`… de un nombre no son comodines) y el `*`
    // de detrás, el comodín; con él el texto ya es un patrón y `patronDeFiltro` no lo toca.
    { label: `Filtrar por ${fila.prefijo}*`, icon: <IconoFiltro />, onClick: () => aplicarFiltroClaves(a, filtro, `${escaparGlob(fila.prefijo)}*`) },
    itemRefrescar(() => refrescar(a, fila.conexionId)),
    SEP,
    { label: 'Copiar prefijo', icon: <IconoCopiar />, onClick: () => copiar(a, nombreDeFila(fila)) }
  ]
}

function menuKvMas(fila: FilaDe<'kv-mas'>, { a }: MenuFila): ContextMenuEntry[] {
  return fila.cargando ? [] : [{ label: fila.vista.accion, onClick: () => cargarMasClaves(a, fila.conexionId, fila.indice) }]
}

/** Una colección o una clave: se abren en su pestaña. */
function menuAbrible(fila: FilaDe<'coleccion' | 'kv-clave'>, { a, copiarNombre }: MenuFila): ContextMenuEntry[] {
  return [
    { label: `Abrir (${etiquetaAcorde('abrirNodo', a.plataforma)})`, icon: <IconoAbrir />, onClick: () => activarFila(a, fila) },
    itemNuevaConsola(a, fila.conexionId),
    SEP,
    copiarNombre
  ]
}

const MENU_POR_TIPO: { [K in FilaBd['kind']]: (fila: FilaDe<K>, m: MenuFila) => ContextMenuEntry[] } = {
  conexion: menuConexion,
  'carpeta-consolas': menuCarpetaConsolas,
  consola: menuConsola,
  base: menuBase,
  esquema: menuEsquema,
  carpeta: menuCarpeta,
  'carpeta-detalle': menuCarpeta,
  objeto: menuObjeto,
  columna: menuHoja,
  indice: menuHoja,
  restriccion: menuHoja,
  placeholder: menuPlaceholder,
  'doc-base': menuDocBase,
  'kv-base': menuKvBase,
  'kv-carpeta': menuKvCarpeta,
  'kv-mas': menuKvMas,
  coleccion: menuAbrible,
  'kv-clave': menuAbrible
}

/** Las entradas del menú contextual de una fila. */
export function itemsDe(a: CtxArbol, fila: FilaArbol, x: number, y: number): ContextMenuEntry[] {
  if (fila.kind === 'ajena') return itemsAjena(a, fila.ajena)
  const c = a.d.porId.get(conexionDeFila(fila) ?? '')
  const copiarNombre: ContextMenuEntry = {
    label: 'Copiar nombre',
    icon: <IconoCopiar />,
    onClick: () => copiar(a, nombreDeFila(fila))
  }
  const menu = MENU_POR_TIPO[fila.kind] as (fila: FilaBd, m: MenuFila) => ContextMenuEntry[]
  return menu(fila, { a, c, x, y, copiarNombre })
}

/** Menú del hueco del árbol (clic derecho debajo de la última fila). */
export function itemsVacio(a: CtxArbol): ContextMenuEntry[] {
  const { conexiones, expandidos, onNuevaConsola, onPlegarTodo } = a.p
  const { motivos, motivoNuevaConsola, conexionSel } = a.d
  return [
    {
      label: 'Nueva conexión…',
      icon: <IconoNuevaConexion />,
      // Sin perfil, o con un registro de formato ajeno (el main rechazaría el alta).
      disabled: motivos.nuevaConexion !== null,
      onClick: () => a.e.setDialogo({ conexionId: null })
    },
    {
      label: 'Nueva consola',
      icon: <IconoNuevaConsola />,
      disabled: motivoNuevaConsola !== null || conexiones.length === 0,
      onClick: () => onNuevaConsola(conexionSel)
    },
    SEP,
    { label: 'Refrescar', icon: <IconoRefrescar />, disabled: conexiones.length === 0, onClick: () => refrescarCabecera(a) },
    { label: 'Plegar todo', icon: <IconoPlegarTodo />, disabled: expandidos.size === 0, onClick: onPlegarTodo }
  ]
}

/** Abre el menú de una fila en (x, y), si tiene alguna entrada. */
export function abrirMenu(a: CtxArbol, fila: FilaArbol, x: number, y: number): void {
  const items = itemsDe(a, fila, x, y)
  if (items.length > 0) a.e.setMenu({ x, y, items })
}
