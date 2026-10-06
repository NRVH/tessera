// =============================================================================
// Todo lo que sabe y hace la lista de conexiones SSH de un perfil: el filtro, la fila activa, qué
// filas se pintan (en el lanzador, con un solo grupo abierto y las conexiones recientes), el menú de una
// fila y las acciones (conectar, plegar, editar, eliminar…) que salen del teclado, del ratón y del menú.
// El teclado lo decide `accionTeclaLista` (puro); aquí se ejecuta. Devuelve la VISTA que pinta
// `ListaConexionesSsh`. Depende del store de SSH.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { anclaDelFoco } from '../../comun/anclaDelFoco'
import type { ContextMenuEntry } from '../../comun/ContextMenu'
import type { SshConexion } from '../../../../shared/ssh-ipc'
import {
  accionTeclaLista,
  construirFilas,
  plegadosDeAcordeon,
  primeraConexion,
  recientesDe,
  siguienteGrupoAbierto,
  type AccionLista,
  type FilaConexion,
  type FilaGrupo,
  type FilaLista
} from './listaSsh'
import { itemsMenuConexion, itemsMenuGrupo, type MenuFilaAbierto } from './menuListaSsh'
import { accionesSsh, datosDePerfil, useStoreSsh, type DatosPerfilSsh } from './store'

/** Lo que la lista recibe de quien la aloja. */
export interface OpcionesListaSsh {
  perfilId: string
  /** 'flotante': el lanzador, con un solo grupo abierto y sus recientes. 'fijo': el riel, con cada grupo por su cuenta. */
  modo: 'flotante' | 'fijo'
  /** Cuántas pestañas SSH hay abiertas de cada conexión (id -> n). */
  abiertasPorConexion: Readonly<Record<string, number>>
  /** La conexión de la pestaña SSH que se ve, si se ve una: su fila se marca (`aria-current`). */
  conexionActivaId?: string | null
  /** Abre una pestaña SSH nueva con esa conexión. */
  onConectar: (conexion: SshConexion) => void
  /** Abre una pestaña con el explorador SFTP de esa conexión (opción del menú de la fila). */
  onAbrirSftp: (conexion: SshConexion) => void
  /** Lleva a la pestaña ya abierta de esa conexión. */
  onIrASesion: (conexionId: string) => void
  /** Se abrió un diálogo desde la lista: quien la aloje (el popover) se retira. */
  alAbrirDialogo?: () => void
}

/** Qué enseña la lista en lugar de las filas, si algo. */
export type EstadoListaSsh = 'cargando' | 'formatoAjeno' | 'vacia' | 'sinCoincidencias' | 'filas'

function estadoDe(cargado: boolean, ajeno: string | null, datos: DatosPerfilSsh, filas: readonly FilaLista[], filtro: string): EstadoListaSsh {
  if (ajeno !== null) return 'formatoAjeno'
  if (!cargado) return 'cargando'
  if (datos.conexiones.length === 0 && datos.grupos.length === 0) return 'vacia'
  return filas.length === 0 && filtro.trim() !== '' ? 'sinCoincidencias' : 'filas'
}

/** La fila activa: la que dice la clave guardada o, si ya no está, la primera conexión. */
function indiceActivoDe(filas: readonly FilaLista[], clave: string | null): number {
  const i = clave === null ? -1 : filas.findIndex((f) => f.clave === clave)
  return i !== -1 ? i : primeraConexion(filas)
}

/** Dónde abrir el menú de una fila pedido por teclado: bajo la fila si está montada, junto al foco si no. */
function anclaDeFila(idFila: string): { x: number; y: number } {
  const el = document.getElementById(idFila)
  if (!el) return anclaDelFoco()
  const r = el.getBoundingClientRect()
  return { x: r.left + 24, y: r.bottom - 2 }
}

/** El estado de la lista: lo guardado, lo derivado y lo que se teclea. */
function useEstadoListaSsh(o: OpcionesListaSsh) {
  const { perfilId } = o
  const flotante = o.modo === 'flotante'
  const datos = useStoreSsh((s) => datosDePerfil(s, perfilId))
  const plegadosGuardados = useStoreSsh((s) => s.plegadosPorPerfil[perfilId])
  const recientesGuardados = useStoreSsh((s) => s.recientesPorPerfil[perfilId])
  const avisos = useStoreSsh(useShallow((s) => ({ cargado: s.cargado, ajeno: s.avisoFormatoAjeno, recuperado: s.avisoRecuperado })))
  const [filtro, setFiltro] = useState('')
  const [activoClave, setActivoClave] = useState<string | null>(null)
  // El único grupo abierto del lanzador: nace sin ninguno (con «Recientes» arriba no hace falta ver el resto) y no se recuerda.
  const [abierto, fijarAbierto] = useState<string | null>(null)
  const plegados = useMemo(
    () => (flotante ? plegadosDeAcordeon(datos.grupos, abierto) : new Set(plegadosGuardados ?? [])),
    [flotante, datos.grupos, abierto, plegadosGuardados]
  )
  const recientes = useMemo(() => (flotante ? recientesDe(recientesGuardados, datos.conexiones) : []), [flotante, recientesGuardados, datos.conexiones])
  const filas = useMemo(
    () => construirFilas({ grupos: datos.grupos, conexiones: datos.conexiones, filtro, plegados, recientes }),
    [datos, filtro, plegados, recientes]
  )
  const estado = estadoDe(avisos.cargado, avisos.ajeno, datos, filas, filtro)
  return { datos, avisos, filtro, setFiltro, setActivoClave, filas, estado, indiceActivo: indiceActivoDe(filas, activoClave), abierto, fijarAbierto }
}

type EstadoLista = ReturnType<typeof useEstadoListaSsh>

/** Abre un diálogo del store y avisa a quien aloja la lista (el popover se retira). */
function conDialogo(o: OpcionesListaSsh, abrir: () => void): void {
  abrir()
  o.alAbrirDialogo?.()
}

/** Las opciones del menú de la fila `f`. */
function itemsDeFila(o: OpcionesListaSsh, datos: DatosPerfilSsh, f: FilaGrupo | FilaConexion): ContextMenuEntry[] {
  if (f.tipo === 'conexion') {
    const c = f.conexion
    return itemsMenuConexion({
      onConectar: () => o.onConectar(c),
      onAbrirSftp: () => o.onAbrirSftp(c),
      onIrASesion: (o.abiertasPorConexion[c.id] ?? 0) > 0 ? () => o.onIrASesion(c.id) : null,
      onEditar: () => conDialogo(o, () => accionesSsh.editarConexion(c)),
      onMoverAGrupo: () => conDialogo(o, () => accionesSsh.editarConexion(c, true)),
      onEliminar: () => conDialogo(o, () => accionesSsh.pedirEliminarConexion(c))
    })
  }
  const g = datos.grupos.find((x) => x.id === f.grupoId)
  return itemsMenuGrupo({
    real: f.real && g !== undefined,
    onNuevaConexion: () => conDialogo(o, () => accionesSsh.nuevaConexion(o.perfilId, f.real ? f.grupoId : null)),
    onRenombrar: () => g && conDialogo(o, () => accionesSsh.renombrarGrupo(g)),
    onEliminar: () => g && conDialogo(o, () => accionesSsh.pedirEliminarGrupo(g, datos.conexiones.filter((c) => c.grupoId === g.id).length))
  })
}

/** Lo que una acción de teclado necesita para ejecutarse. */
interface ContextoAccion {
  o: OpcionesListaSsh
  e: EstadoLista
  abrirMenuDe: (indice: number) => void
  plegarGrupo: (grupoId: string, plegar: boolean) => void
}

/** Lo que una tecla pide sobre una conexión: conectar, editar o eliminar. */
function accionDeConexion(a: Extract<AccionLista, { conexionId: string }>, { o, e }: ContextoAccion): void {
  const conexion = e.datos.conexiones.find((c) => c.id === a.conexionId)
  if (!conexion) return
  if (a.tipo === 'conectar') o.onConectar(conexion)
  else if (a.tipo === 'editar') conDialogo(o, () => accionesSsh.editarConexion(conexion))
  else conDialogo(o, () => accionesSsh.pedirEliminarConexion(conexion))
}

/** Lo que una tecla pide sobre un grupo: renombrarlo o eliminarlo. */
function accionDeGrupo(a: Extract<AccionLista, { tipo: 'renombrarGrupo' | 'eliminarGrupo' }>, { o, e }: ContextoAccion): void {
  const grupo = e.datos.grupos.find((g) => g.id === a.grupoId)
  if (!grupo) return
  if (a.tipo === 'renombrarGrupo') conDialogo(o, () => accionesSsh.renombrarGrupo(grupo))
  else conDialogo(o, () => accionesSsh.pedirEliminarGrupo(grupo, e.datos.conexiones.filter((c) => c.grupoId === grupo.id).length))
}

/** Hace lo que una tecla pidió (`accionTeclaLista`). */
function ejecutarAccion(a: AccionLista, c: ContextoAccion): void {
  switch (a.tipo) {
    case 'mover':
      return c.e.setActivoClave(c.e.filas[a.indice]?.clave ?? null)
    case 'plegar':
      return c.plegarGrupo(a.grupoId, a.plegar)
    case 'menu':
      return c.abrirMenuDe(a.indice)
    case 'renombrarGrupo':
    case 'eliminarGrupo':
      return accionDeGrupo(a, c)
    default:
      return accionDeConexion(a, c)
  }
}

/** La vista de la lista de conexiones SSH de un perfil, y sus acciones. */
export function useListaSsh(o: OpcionesListaSsh, filtroRef: RefObject<HTMLInputElement>) {
  const e = useEstadoListaSsh(o)
  const idBase = useId()
  const [menu, setMenu] = useState<MenuFilaAbierto | null>(null)
  const idFila = (f: FilaLista): string => `${idBase}-${f.clave}`

  const abrirMenu = (f: FilaLista, x: number, y: number): void => {
    if (f.tipo === 'seccion') return
    e.setActivoClave(f.clave)
    // «Sin grupo» no tiene menú: sin opciones no se abre nada.
    const items = itemsDeFila(o, e.datos, f)
    setMenu(items.length > 0 ? { x, y, items } : null)
  }
  const abrirMenuDe = (indice: number): void => {
    const f = e.filas[indice]
    if (!f) return
    const ancla = anclaDeFila(idFila(f))
    abrirMenu(f, ancla.x, ancla.y)
  }
  /** Pliega o despliega un grupo: en el lanzador solo cabe uno abierto; en el riel, cada grupo va por su cuenta. */
  const plegarGrupo = (grupoId: string, plegar: boolean): void => {
    if (o.modo === 'flotante') e.fijarAbierto(siguienteGrupoAbierto(e.abierto, grupoId, plegar))
    else accionesSsh.plegar(o.perfilId, grupoId, plegar)
  }
  const alTeclear = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.nativeEvent.isComposing) return
    const contexto = { filas: e.filas, activo: e.indiceActivo, filtroVacio: e.filtro === '' }
    const a = accionTeclaLista(ev, contexto, window.tessera.plataforma)
    if (!a) return
    ev.preventDefault()
    ejecutarAccion(a, { o, e, abrirMenuDe, plegarGrupo })
  }
  /** Clic en una fila: una conexión conecta; una cabecera pliega (con filtro no: lo ignora). */
  const alPulsar = (f: FilaLista): void => {
    if (f.tipo === 'seccion') return
    e.setActivoClave(f.clave)
    filtroRef.current?.focus()
    if (f.tipo === 'conexion') o.onConectar(f.conexion)
    else if (e.filtro === '') plegarGrupo(f.grupoId, f.abierto)
  }
  const cambiarFiltro = (texto: string): void => {
    e.setFiltro(texto)
    e.setActivoClave(null)
  }
  return {
    ...e,
    idBase,
    idFila,
    menu,
    cerrarMenu: () => setMenu(null),
    abrirMenu,
    alTeclear,
    alPulsar,
    cambiarFiltro,
    nuevaConexion: () => conDialogo(o, () => accionesSsh.nuevaConexion(o.perfilId)),
    nuevoGrupo: () => conDialogo(o, () => accionesSsh.nuevoGrupo(o.perfilId))
  }
}

export type VistaListaSsh = ReturnType<typeof useListaSsh>
