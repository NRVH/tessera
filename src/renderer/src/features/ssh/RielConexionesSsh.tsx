// =============================================================================
// El riel de conexiones SSH: la lista de conexiones fija, a la izquierda de la terminal, mientras está
// a pantalla completa. Una cabecera como la de los laterales (el título y cinco acciones: nueva
// conexión, nuevo grupo, importar de OpenSSH, exportar a OpenSSH y ocultar) sobre la MISMA `ListaConexionesSsh` en modo fijo, y un divisor
// para ensancharlo. Se monta la primera vez que se enseña y desde entonces se queda montado, oculto
// cuando no se enseña, para volver tal cual (`renderer/vivos-y-ocultos.md`). Lleva su propio límite de
// error, porque un fallo suyo no puede desmontar las terminales. Depende de `comun/`.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import './rielSsh.css'
import { memo, type CSSProperties } from 'react'
import { BotonCabecera } from '../../comun/BotonCabecera'
import { useCapaVisible } from '../../comun/capaVisible'
import { CapaViva, useVivosRecientes, useYaVisto } from '../../comun/useVivosRecientes'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { Splitter } from '../../comun/Splitter'
import { SSH_RIEL_ANCHO_MIN } from '../../../../shared/ajustesTerminal'
import { IconoOcultarLista } from './iconosRielSsh'
import { exportarAOpenSsh } from './exportacionSsh'
import { IconoExportar, IconoImportar, IconoServidorNuevo } from './iconosSsh'
import { importarDesdeOpenSsh } from './importacionSsh'
import { ListaConexionesSsh, type DatosListaConexionesSsh, type PropsListaConexionesSsh } from './ListaConexionesSsh'
import { ID_RIEL_SSH } from './rielSsh'
import { accionesSsh, useStoreSsh } from './store'
import { txSsh } from './textos.ts'

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
  const t = txSsh()
  return (
    <div className="sidebar-header">
      <span className="sidebar-title">{t.conexionesSsh}</span>
      <div className="sidebar-actions">
        <BotonCabecera titulo={t.nuevaConexionPie} motivo={avisoAjeno} onClick={() => accionesSsh.nuevaConexion(perfilId)}>
          <IconoServidorNuevo />
        </BotonCabecera>
        <BotonCabecera titulo={t.nuevoGrupoPie} motivo={avisoAjeno} onClick={() => accionesSsh.nuevoGrupo(perfilId)}>
          <IconoCarpetaNueva />
        </BotonCabecera>
        <BotonCabecera titulo={t.importarOpenSsh} motivo={avisoAjeno} onClick={() => void importarDesdeOpenSsh(perfilId)}>
          <IconoImportar />
        </BotonCabecera>
        <BotonCabecera titulo={t.exportarOpenSsh} motivo={avisoAjeno} onClick={() => void exportarAOpenSsh(perfilId)}>
          <IconoExportar />
        </BotonCabecera>
        <BotonCabecera titulo={t.ocultarLista} motivo={null} onClick={onOcultar}>
          <IconoOcultarLista />
        </BotonCabecera>
      </div>
    </div>
  )
}

/**
 * La lista de un perfil, viva aunque no se vea: oculta no se repinta por lo que le llega de fuera
 * (es del perfil que se ve, y nadie puede tocarla). Al volver a verse recibe las props vigentes.
 */
const ListaViva = memo(
  function ListaViva({ visible, ...lista }: PropsListaConexionesSsh & { visible: boolean }): React.JSX.Element {
    return <ListaConexionesSsh {...lista} oculta={!visible} />
  },
  (antes, ahora) => !antes.visible && !ahora.visible && antes.perfilId === ahora.perfilId
)

/** El riel de conexiones SSH del perfil y su divisor, uno detrás de otro (los dos son hijos de la fila de la terminal). */
function RielYDivisor({ ancho, anchoMax, onAncho, onOcultar, ...lista }: PropsRielConexionesSsh): React.JSX.Element {
  // Una lista por perfil, y vivas las de los últimos vistos: el filtro, la fila elegida y el
  // desplazamiento son de cada perfil y vuelven tal cual (`renderer/vivos-y-ocultos.md`).
  const vivas = useVivosRecientes({ clave: lista.perfilId }, null)
  // Con el riel entero oculto (`RielConexionesSshVivo`), tampoco se ve la lista del perfil.
  const rielSeVe = useCapaVisible()
  return (
    <>
      <aside id={ID_RIEL_SSH} className="ssh-riel" aria-label={txSsh().conexionesSsh} style={{ width: ancho }}>
        <CabeceraRiel perfilId={lista.perfilId} onOcultar={onOcultar} />
        <div className="ssh-riel-cuerpo">
          {vivas.map(({ clave }) => (
            <CapaViva key={clave} visible={clave === lista.perfilId}>
              <ListaViva {...lista} perfilId={clave} visible={clave === lista.perfilId && rielSeVe} modo="fijo" />
            </CapaViva>
          ))}
        </div>
      </aside>
      <Splitter
        orientation="vertical"
        className="splitter-hueco"
        size={ancho}
        min={SSH_RIEL_ANCHO_MIN}
        max={anchoMax}
        direction={1}
        onResize={onAncho}
        label={txSsh().redimensionar}
      />
    </>
  )
}

/**
 * El riel con su límite de error. El envoltorio no tiene caja (`display: contents`): solo le pasa su ancho
 * al aviso, que de por sí rellena el hueco y se repartiría la fila con la terminal (ver `rielSsh.css`).
 */
function RielConexionesSsh(props: PropsRielConexionesSsh): React.JSX.Element {
  return (
    <div className="ssh-riel-limite" style={{ '--ssh-riel-ancho': `${props.ancho}px` } as CSSProperties}>
      <ErrorBoundary label={txSsh().zonaLista} variant="pane">
        <RielYDivisor {...props} />
      </ErrorBoundary>
    </div>
  )
}

/** El riel oculto no se repinta por lo que le llega de fuera: al volver a enseñarse recibe las props vigentes. */
const RielQuieto = memo(
  function RielQuieto({ enVista: _enVista, ...props }: PropsRielConexionesSsh & { enVista: boolean }): React.JSX.Element {
    return <RielConexionesSsh {...props} />
  },
  (antes, ahora) => !antes.enVista && !ahora.enVista
)

/**
 * El riel, montado desde la primera vez que se enseña y oculto (`CapaViva`) cuando no: al volver a
 * pantalla completa, o a un perfil que lo enseña, sus listas están tal cual (filtro, fila elegida,
 * desplazamiento). Lo que no se ha enseñado nunca no se monta, y oculto no ocupa sitio en la fila.
 */
export function RielConexionesSshVivo({ visible, ...props }: PropsRielConexionesSsh & { visible: boolean }): React.JSX.Element | null {
  const montado = useYaVisto(visible)
  if (!montado) return null
  return (
    <CapaViva visible={visible}>
      <RielQuieto {...props} enVista={visible} />
    </CapaViva>
  )
}
