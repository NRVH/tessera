// =============================================================================
// El explorador SFTP de una pestaña: abre la sesión al montarse, enseña «Conectando…» o el error con
// «Reintentar» / «Reconectar» y, con la sesión viva, la barra, la lista de la carpeta remota (con su
// teclado, su menú y el soltar archivos), los avisos de las acciones puntuales, la tira de operaciones
// y los diálogos. Las rutas son siempre remotas y los nombres, texto. Cada pestaña monta el suyo y
// al desmontarse cierra su sesión. Compone los hooks de la feature; depende de `comun/`.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================

import './sftp.css'
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { ContextMenu } from '../../comun/ContextMenu'
import { esModPrincipal } from '../../util/atajos'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { TerminalExitReason } from '../../../../shared/terminal-ipc'
import { BarraSftp } from './BarraSftp'
import { DialogosSftp } from './DialogosSftp'
import { esDescargable, esNavegable } from './listadoSftp'
import { ListaSftp } from './ListaSftp'
import { itemsMenuSftp } from './menuSftp'
import { asegurarFila, moverActivo, SELECCION_VACIA, seleccionarConClic, seleccionarTodo } from './seleccionSftp'
import { accionTecla } from './teclasSftp'
import { TiraOperacionesSftp } from './TiraOperacionesSftp'
import { useAccionesSftp, type AccionesSftp } from './useAccionesSftp'
import { useArrastreSftp } from './useArrastreSftp'
import { useOperacionesSftp } from './useOperacionesSftp'
import { useSeleccionSftp } from './useSeleccionSftp'
import { useSesionSftp, type FalloSftp, type ListadoSftp, type SesionSftp } from './useSesionSftp'

export interface PropsExploradorSftp {
  /** La id estable de la pestaña: también la de la sesión SFTP. */
  sesionId: string
  profileId: string
  conexionId: string
  /** Alto de una fila en px (de la densidad base): la lista virtual lo necesita en JS. */
  altoFila: number
  /** El texto del motivo clasificado de un fallo SSH (huella cambiada…): lo pone quien aloja el explorador. */
  textoMotivo: (motivo: TerminalExitReason) => string
}

/** El fallo de abrir la sesión o de su caída, con la salida de volver a intentarlo. */
function EstadoFallo({ fallo, textoMotivo, onReintentar }: { fallo: FalloSftp; textoMotivo: PropsExploradorSftp['textoMotivo']; onReintentar: () => void }): React.JSX.Element {
  const titulo = fallo.motivo ? textoMotivo(fallo.motivo) : fallo.caida ? 'Se cortó la conexión' : 'No se pudo abrir el explorador SFTP'
  return (
    <div className="sftp sftp-centrado">
      <AvisoCaja tono="error" titulo={titulo} sugerencia={fallo.error} />
      <button type="button" className="btn" onClick={onReintentar}>
        {fallo.caida ? 'Reconectar' : 'Reintentar'}
      </button>
    </div>
  )
}

interface PropsListo {
  p: PropsExploradorSftp
  sesion: SesionSftp
  listado: ListadoSftp
}

/** Las acciones del menú contextual sobre la selección de ahora. */
function useMenuSftp(acciones: AccionesSftp, vista: ReturnType<typeof useSeleccionSftp>, listado: ListadoSftp, sesion: SesionSftp) {
  const [posicion, setPosicion] = useState<{ x: number; y: number } | null>(null)
  const elegidas = listado.entradas.filter((e) => vista.seleccion.nombres.has(e.nombre))
  const items = itemsMenuSftp({
    elegidos: elegidas.length,
    unicaEsCarpeta: elegidas.length === 1 && esNavegable(elegidas[0]),
    descargables: elegidas.filter(esDescargable).length,
    onAbrir: acciones.abrirSeleccion,
    onDescargar: acciones.descargar,
    onRenombrar: acciones.pedirRenombrar,
    onEliminar: acciones.pedirBorrar,
    onNuevaCarpeta: acciones.pedirCarpeta,
    onSubirArchivos: () => acciones.subir(false),
    onSubirCarpeta: () => acciones.subir(true),
    onActualizar: sesion.actualizar
  })
  return { posicion, items, abrir: setPosicion, cerrar: () => setPosicion(null) }
}

/** La sesión viva: barra, lista, avisos, operaciones, diálogos y menú. */
function ExploradorListo({ p, sesion, listado }: PropsListo): React.JSX.Element {
  const plataforma = window.tessera.plataforma
  const vista = useSeleccionSftp(listado)
  const operaciones = useOperacionesSftp(p.sesionId, listado.ruta, sesion.actualizar, sesion.avisar)
  const acciones = useAccionesSftp({ sesionId: p.sesionId, ruta: listado.ruta, entradas: listado.entradas, seleccion: vista.elegidos, sesion, operaciones })
  const arrastre = useArrastreSftp(acciones.soltar, true)
  const menu = useMenuSftp(acciones, vista, listado, sesion)
  const listaRef = useRef<HTMLDivElement>(null)
  const elegidas = listado.entradas.filter((e) => vista.seleccion.nombres.has(e.nombre))

  const alClic = (nombre: string, e: MouseEvent): void => {
    vista.cambiar((s, orden) => seleccionarConClic(s, orden, nombre, { mod: esModPrincipal(e, plataforma), mayus: e.shiftKey }))
  }
  const alMenu = (x: number, y: number, nombre: string | null): void => {
    vista.cambiar((s) => (nombre === null ? SELECCION_VACIA : asegurarFila(s, nombre)))
    menu.abrir({ x, y })
  }
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>): void => {
    const a = accionTecla(e, plataforma)
    if (a === null) return
    e.preventDefault()
    if (a.tipo === 'mover') vista.cambiar((s, orden) => moverActivo(s, orden, a.mov, a.extender))
    else if (a.tipo === 'seleccionarTodo') vista.cambiar((s, orden) => seleccionarTodo(s, orden))
    else if (a.tipo === 'abrir') acciones.abrirSeleccion()
    else if (a.tipo === 'subirNivel') sesion.subirNivel()
    else if (a.tipo === 'borrar') acciones.pedirBorrar()
    else if (a.tipo === 'renombrar') acciones.pedirRenombrar()
    else sesion.actualizar()
  }

  return (
    <div className="sftp">
      <BarraSftp
        ruta={listado.ruta}
        cargando={sesion.cargando}
        elegidos={elegidas.length}
        descargables={elegidas.filter(esDescargable).length}
        atajoBorrar={plataforma === 'mac' ? '⌘⌫' : 'Supr'}
        onIr={sesion.navegar}
        onSubirNivel={sesion.subirNivel}
        onActualizar={sesion.actualizar}
        onNuevaCarpeta={acciones.pedirCarpeta}
        onSubirArchivos={() => acciones.subir(false)}
        onSubirCarpeta={() => acciones.subir(true)}
        onDescargar={acciones.descargar}
        onRenombrar={acciones.pedirRenombrar}
        onEliminar={acciones.pedirBorrar}
      />
      {sesion.aviso !== null && (
        <div className="sftp-aviso" role="alert">
          <span className="sftp-aviso-texto">{sesion.aviso}</span>
          <button type="button" className="sftp-operacion-cerrar" aria-label="Cerrar el aviso" title="Cerrar el aviso" onClick={() => sesion.avisar(null)}>
            ×
          </button>
        </div>
      )}
      <ListaSftp
        entradas={listado.entradas}
        seleccion={vista.seleccion}
        altoFila={p.altoFila}
        cargando={sesion.cargando}
        soltando={arrastre.soltando}
        carpetaSoltar={arrastre.carpeta}
        scrollRef={listaRef}
        onClic={alClic}
        onAbrir={acciones.abrirEntrada}
        onMenu={alMenu}
        onTecla={alTeclear}
        onFondo={() => vista.cambiar(() => SELECCION_VACIA)}
        onArrastre={arrastre.manejadores}
      />
      <TiraOperacionesSftp
        operaciones={operaciones.operaciones}
        gestorArchivos={nombresSistema(plataforma).gestorArchivos}
        onCancelar={operaciones.cancelar}
        onMostrar={operaciones.mostrarDescarga}
        onCerrar={operaciones.cerrar}
      />
      <DialogosSftp acciones={acciones} plan={operaciones.plan} onResolverPlan={operaciones.resolverPlan} />
      {menu.posicion && (
        <EnCapaFlotante>
          <ContextMenu x={menu.posicion.x} y={menu.posicion.y} items={menu.items} disparador={listaRef} onClose={menu.cerrar} />
        </EnCapaFlotante>
      )}
    </div>
  )
}

/** El explorador SFTP de una pestaña. */
export function ExploradorSftp(p: PropsExploradorSftp): React.JSX.Element {
  const sesion = useSesionSftp(p)
  if (sesion.fase === 'error' && sesion.fallo) {
    return <EstadoFallo fallo={sesion.fallo} textoMotivo={p.textoMotivo} onReintentar={sesion.reabrir} />
  }
  if (sesion.fase === 'conectando' || sesion.listado === null) {
    return (
      <div className="sftp sftp-centrado">
        <div className="sftp-conectando" role="status">
          Conectando…
        </div>
      </div>
    )
  }
  return <ExploradorListo p={p} sesion={sesion} listado={sesion.listado} />
}
