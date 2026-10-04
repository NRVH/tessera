// =============================================================================
// DbArbol: el lateral de la vista de bases de datos — conexiones → (bases) → esquemas →
// carpetas por tipo → objetos → detalle, y la carpeta de consolas de cada conexión. El
// estado de la VISTA es de `useDbVista` y lo del SERVIDOR de `cacheMetaBd`; aquí vive lo
// efímero, en hooks llamados en orden fijo, y cada render arma un contexto (`CtxArbol`)
// para las piezas: cabecera, cuerpo, filas, menú, teclado y diálogos (`DbArbol*`, `FilaArbol*`).
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react'
import './arbol.css'
import type { DbArbolProps } from './propsBd'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { DialogosArbol } from './DbArbolDialogos'
import { CabeceraArbol } from './DbArbolCabecera'
import { AvisoArbolVista, BusquedaArbol, CuerpoArbol } from './DbArbolCuerpo'
import './claves/claves.css'
import { useArbolArrastre, useArbolAviso, useArbolEstado } from './useArbolEstado'
import { useArbolFilas } from './useArbolFilas'
import { useArbolBusqueda, useArbolDesplazar } from './useArbolDesplazar'
import { pistaAbrirDe } from './FilaArbolModelo'
import { peticionPorAtender } from './store'
import type { CtxArbol, DbArbolPropsExtra, EstadoDialogo, PropsArbol } from './DbArbolTipos'


/** Lista vacía con identidad ESTABLE: la composición de filas la tiene de dependencia. */
const SIN_AJENAS: readonly DbConexionAjena[] = []

/**
 * Últimos tokens de `useStoreBd` atendidos. A NIVEL DE MÓDULO a propósito: el lateral se
 * desmonta al cambiar de vista y, con un ref local, volver reabriría un diálogo ya atendido.
 * Vale porque el store nunca repite un token (ver `peticionPorAtender`).
 */
const atendidas: { nueva: number | null; editar: number | null } = { nueva: null, editar: null }

function propsConDefectos(props: DbArbolProps & DbArbolPropsExtra): PropsArbol {
  const { ajenas = SIN_AJENAS, avisoFormato = null } = props
  return { ...props, ajenas, avisoFormato }
}

/** El diálogo de la conexión y las peticiones de alta y edición que llegan del store. */
function useDialogoConexion(
  p: PropsArbol,
  porId: Map<string, DbConnection>
): [EstadoDialogo | null, Dispatch<SetStateAction<EstadoDialogo | null>>] {
  const { pedirNuevaConexion, pedirEditarConexion, perfilId, avisoFormato, cargandoConexiones } = p
  const [dialogo, setDialogo] = useState<EstadoDialogo | null>(null)

  useEffect(() => {
    const pedida = pedirNuevaConexion
    if (!peticionPorAtender(pedida, atendidas.nueva)) return
    atendidas.nueva = pedida.token
    // Con un registro de formato ajeno el alta no se ofrece en ningún sitio (el main la
    // rechazaría); si aun así llegara la petición, se consume sin abrir el diálogo.
    if (perfilId && avisoFormato === null) setDialogo({ conexionId: null })
  }, [pedirNuevaConexion, perfilId, avisoFormato])

  useEffect(() => {
    const pedida = pedirEditarConexion
    if (!peticionPorAtender(pedida, atendidas.editar)) return
    // Con la lista aún cargando, se espera: consumir el token ahora lo perdería.
    if (!porId.has(pedida.valor) && cargandoConexiones) return
    atendidas.editar = pedida.token
    if (porId.has(pedida.valor)) setDialogo({ conexionId: pedida.valor })
  }, [pedirEditarConexion, porId, cargandoConexiones])

  return [dialogo, setDialogo]
}

/** El lateral de bases de datos: cabecera, árbol de conexiones y lo que flota sobre él. */
export function DbArbol(props: DbArbolProps & DbArbolPropsExtra): React.JSX.Element {
  const p = propsConDefectos(props)
  const plataforma = window.tessera.plataforma
  const idBase = useId()
  // El orden de los hooks fija el de los efectos: cargas, desplazar, revelar, peticiones,
  // primera coincidencia, aviso y arrastre.
  const ui = useArbolEstado()
  const d = useArbolFilas(p, ui)
  const desplazar = useArbolDesplazar(d.filas, p.onSeleccion, p.revelar)
  const [dialogo, setDialogo] = useDialogoConexion(p, d.porId)
  useArbolBusqueda(ui.busqueda, d.filaSel, d.filas, desplazar.moverA)
  const [aviso, setAviso] = useArbolAviso()
  const [arrastre, setArrastre] = useArbolArrastre()

  const a: CtxArbol = {
    p,
    e: { ...ui, ...desplazar, dialogo, setDialogo, setAviso, arrastre, setArrastre },
    d,
    plataforma,
    almacen: nombresSistema(plataforma).almacenSecretos,
    dbx: window.tessera.dbExplorador,
    idBase,
    pistaAbrir: pistaAbrirDe(plataforma)
  }

  return (
    <aside className="sidebar db-arbol" style={p.varsDensidad}>
      <CabeceraArbol a={a} />
      {aviso && <AvisoArbolVista a={a} aviso={aviso} />}
      {ui.busqueda !== null && <BusquedaArbol a={a} busqueda={ui.busqueda} />}
      <CuerpoArbol a={a} />
      <DialogosArbol a={a} />
    </aside>
  )
}
