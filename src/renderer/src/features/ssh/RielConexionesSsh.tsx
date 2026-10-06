// =============================================================================
// El riel de conexiones SSH: la lista de conexiones fija, a la izquierda de la terminal, mientras está
// a pantalla completa. Una cabecera como la de los laterales (el título y cuatro acciones: nueva
// conexión, nuevo grupo, importar de OpenSSH y ocultar) sobre la MISMA `ListaConexionesSsh` en modo fijo, y un divisor
// para ensancharlo. No tiene sesión que conservar: se monta al mostrarse. Lleva su propio límite de
// error, porque un fallo suyo no puede desmontar las terminales. Depende de `comun/`.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import './rielSsh.css'
import type { CSSProperties } from 'react'
import { BotonCabecera } from '../../comun/BotonCabecera'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { Splitter } from '../../comun/Splitter'
import { SSH_RIEL_ANCHO_MIN } from '../../../../shared/ajustesTerminal'
import { IconoOcultarLista } from './iconosRielSsh'
import { IconoImportar, IconoServidorNuevo } from './iconosSsh'
import { importarDesdeOpenSsh } from './importacionSsh'
import { ListaConexionesSsh, type DatosListaConexionesSsh } from './ListaConexionesSsh'
import { ID_RIEL_SSH } from './rielSsh'
import { accionesSsh, useStoreSsh } from './store'

/** Lo que recibe el riel: lo de la lista, su ancho con el tope que deja la terminal y cómo ocultarse. */
export interface PropsRielConexionesSsh extends DatosListaConexionesSsh {
  ancho: number
  anchoMax: number
  onAncho: (px: number) => void
  onOcultar: () => void
}

/** La cabecera: el título y las altas (que se apagan con el archivo de conexiones de una versión más nueva) y ocultar. */
function CabeceraRiel({ perfilId, onOcultar }: { perfilId: string; onOcultar: () => void }): React.JSX.Element {
  const avisoAjeno = useStoreSsh((s) => s.avisoFormatoAjeno)
  return (
    <div className="sidebar-header">
      <span className="sidebar-title">Conexiones SSH</span>
      <div className="sidebar-actions">
        <BotonCabecera titulo="Nueva conexión SSH…" motivo={avisoAjeno} onClick={() => accionesSsh.nuevaConexion(perfilId)}>
          <IconoServidorNuevo />
        </BotonCabecera>
        <BotonCabecera titulo="Nuevo grupo…" motivo={avisoAjeno} onClick={() => accionesSsh.nuevoGrupo(perfilId)}>
          <IconoCarpetaNueva />
        </BotonCabecera>
        <BotonCabecera titulo="Importar desde OpenSSH…" motivo={avisoAjeno} onClick={() => void importarDesdeOpenSsh(perfilId)}>
          <IconoImportar />
        </BotonCabecera>
        <BotonCabecera titulo="Ocultar la lista" motivo={null} onClick={onOcultar}>
          <IconoOcultarLista />
        </BotonCabecera>
      </div>
    </div>
  )
}

/** El riel de conexiones SSH del perfil y su divisor, uno detrás de otro (los dos son hijos de la fila de la terminal). */
function RielYDivisor({ ancho, anchoMax, onAncho, onOcultar, ...lista }: PropsRielConexionesSsh): React.JSX.Element {
  return (
    <>
      <aside id={ID_RIEL_SSH} className="ssh-riel" aria-label="Conexiones SSH" style={{ width: ancho }}>
        <CabeceraRiel perfilId={lista.perfilId} onOcultar={onOcultar} />
        <div className="ssh-riel-cuerpo">
          {/* Una lista por perfil: el texto del filtro no se lleva de un perfil al otro. */}
          <ListaConexionesSsh key={lista.perfilId} {...lista} modo="fijo" />
        </div>
      </aside>
      <Splitter
        orientation="vertical"
        size={ancho}
        min={SSH_RIEL_ANCHO_MIN}
        max={anchoMax}
        direction={1}
        onResize={onAncho}
        label="Redimensionar la lista de conexiones SSH"
      />
    </>
  )
}

/**
 * El riel con su límite de error. El envoltorio no tiene caja (`display: contents`): solo le pasa su ancho
 * al aviso, que de por sí rellena el hueco y se repartiría la fila con la terminal (ver `rielSsh.css`).
 */
export function RielConexionesSsh(props: PropsRielConexionesSsh): React.JSX.Element {
  return (
    <div className="ssh-riel-limite" style={{ '--ssh-riel-ancho': `${props.ancho}px` } as CSSProperties}>
      <ErrorBoundary label="la lista de conexiones" variant="pane">
        <RielYDivisor {...props} />
      </ErrorBoundary>
    </div>
  )
}
