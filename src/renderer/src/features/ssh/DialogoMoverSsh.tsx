// =============================================================================
// «Mover a grupo…» con varias conexiones marcadas en el riel: un selector de grupo («Sin grupo», los del perfil
// y «Nuevo grupo…», que lleva a crearlo con ellas dentro) y «Mover». Es la vía de teclado del arrastre. Las
// pasa el main de una vez (`ssh.mover`). Lo puro (qué cambia de grupo) vive en `seleccionListaSsh.ts`.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import '../../comun/formularioModal.css'
import './conexionesSsh.css'
import { useId, useState } from 'react'
import { notify } from '../../comun/notifications'
import { alClicEnVelo, useDialogo } from '../../comun/useDialogo'
import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc'
import { mensajeDeErrorSsh } from './erroresSsh'
import { ID_SIN_GRUPO, NOMBRE_SIN_GRUPO, compararNombres } from './listaSsh'
import { cuantasConexiones, grupoIdDeDestino, idsQueCambian } from './seleccionListaSsh'
import { accionesSsh, datosDePerfil, useStoreSsh } from './store'

/** El valor de «Nuevo grupo…» en el selector: no choca con una id, que es un UUID. */
const OPCION_NUEVO = '__nuevo__'

interface PropsCampoDestino {
  grupos: readonly SshGrupo[]
  destino: string
  ocupado: boolean
  onElegir: (destino: string) => void
  /** «Nuevo grupo…»: cambia este diálogo por el de crear el grupo con ellas dentro. */
  onNuevo: () => void
}

/** El grupo al que van: «Sin grupo», los del perfil y «Nuevo grupo…». */
function CampoDestino({ grupos, destino, ocupado, onElegir, onNuevo }: PropsCampoDestino): React.JSX.Element {
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">Al grupo</span>
      <select autoFocus value={destino} disabled={ocupado} onChange={(e) => (e.target.value === OPCION_NUEVO ? onNuevo() : onElegir(e.target.value))}>
        <option value={ID_SIN_GRUPO}>{NOMBRE_SIN_GRUPO}</option>
        {grupos.map((g) => (
          <option key={g.id} value={g.id}>
            {g.nombre}
          </option>
        ))}
        <option value={OPCION_NUEVO}>Nuevo grupo…</option>
      </select>
    </label>
  )
}

/** El grupo elegido, lo que cambiaría y el movimiento: al acabar se cierra; si el main no puede, lo dice. */
function useMoverConexiones(perfilId: string, conexiones: readonly SshConexion[]) {
  const datos = useStoreSsh((s) => datosDePerfil(s, perfilId))
  const grupos = [...datos.grupos].sort((a, b) => compararNombres(a.nombre, b.nombre))
  const [destino, setDestino] = useState<string>(grupos[0]?.id ?? ID_SIN_GRUPO)
  const [ocupado, setOcupado] = useState(false)
  const ids = conexiones.map((c) => c.id)
  const cambian = idsQueCambian(ids, destino, datos.conexiones, new Set(datos.grupos.map((g) => g.id)))
  const mover = async (): Promise<void> => {
    if (ocupado || cambian.length === 0) return
    setOcupado(true)
    try {
      await window.tessera.ssh.mover({ ids: cambian, profileId: perfilId, grupoId: grupoIdDeDestino(destino) })
      accionesSsh.cerrarDialogo()
    } catch (err) {
      notify('error', 'No se pudieron mover las conexiones', mensajeDeErrorSsh(err))
      setOcupado(false)
    }
  }
  return { grupos, destino, setDestino, ocupado, ids, cambian, mover }
}

export function DialogoMoverSsh({ perfilId, conexiones }: { perfilId: string; conexiones: readonly SshConexion[] }): React.JSX.Element {
  const idTitulo = useId()
  const { grupos, destino, setDestino, ocupado, ids, cambian, mover } = useMoverConexiones(perfilId, conexiones)
  const dialogo = useDialogo({ onClose: accionesSsh.cerrarDialogo, cerrable: !ocupado })
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(accionesSsh.cerrarDialogo)}>
      <div
        ref={dialogo.ref}
        className="modal-card db-conexion-modal ssh-conexion-modal ssh-mover-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={dialogo.alPulsarTecla}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form
          className="dbc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void mover()
          }}
        >
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">
              Mover {cuantasConexiones(conexiones.length)}
            </div>
          </div>
          <div className="dbc-cuerpo">
            <CampoDestino grupos={grupos} destino={destino} ocupado={ocupado} onElegir={setDestino} onNuevo={() => accionesSsh.nuevoGrupoCon(perfilId, ids)} />
            {cambian.length === 0 && <p className="dbc-ayuda">Ya están todas en ese grupo.</p>}
          </div>
          <div className="modal-actions dbc-acciones">
            <span className="dbc-hueco" />
            <button type="button" className="btn btn-ghost" onClick={accionesSsh.cerrarDialogo} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={ocupado || cambian.length === 0}>
              {ocupado ? 'Moviendo…' : 'Mover'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
