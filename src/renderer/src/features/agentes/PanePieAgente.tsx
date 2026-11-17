// =============================================================================
// Pie del pane del agente: uso de la cuenta y contexto de la conversación (solo en
// pantalla y con cuenta; en uno manual, su contexto si tiene fuente), dónde vive el agente
// (proyecto, datos, terminal o la carpeta del usuario de una ventana de agente) y el botón de
// reinicio, abajo y lejos de maximizar porque es
// destructivo. Qué ofrece el botón lo decide `botonReinicio` (puro, con prueba); un agente que no
// es pestaña y está hibernado ofrece en su lugar «Despertar» (`puedeDespertarseAMano`).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { botonReinicio, textosReinicio } from '../terminales'
import { useStorePestanas } from '../pestanas'
import { ControlAnilloContexto } from './ControlAnilloContexto'
import { ContextoManual } from './ContextoManual'
import { despertarAlVerse, puedeDespertarseAMano } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas } from './store'
import { BarrasUso } from './BarrasUso'
import { CUENTA_HOST_ID, MAX_INTENTOS_RECUPERACION_CONTENEDOR, agenteManualDe } from './tiposPaneAgente'
import { txPane } from './textosPane.ts'
import { IconoRecargarAgente } from './iconosPaneAgente'
import { IconoArchivos, IconoCasa, IconoTerminal } from '../../comun/iconosPanel'
import { IconoBd } from '../bd'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import { compactarConversacion } from './terminalAgente'
import type { ModeloPaneAgente } from './usePaneAgente'

/**
 * Qué ofrece el botón. `puedeAbrir` replica las condiciones del reconcile, y «preparado
 * para actualizar» cuenta como un reinicio en vuelo con otro gerundio.
 */
function estadoBoton(m: ModeloPaneAgente): ReturnType<typeof botonReinicio> {
  const { p, s } = m
  const t = txPane().pie
  const { agente } = p.target
  // Un agente manual solo retoma la conversación si su definición trae cómo reanudar.
  const retoma = !esAgenteManual(agente) || !!agenteManualDe(p.pestanasAgente, agente)?.reanudar
  return botonReinicio({
    textos: textosReinicio(retoma),
    estadoTerminal: s.estado,
    sesionId: s.sesionId,
    recargando: s.recargando || s.actualizando,
    recuperando: s.recuperando,
    faseRecuperacion: s.recuperacion?.fase ?? null,
    intentoRecuperacion: s.recuperacion?.fase === 'recovering' ? s.recuperacion.intento : 0,
    maxIntentos: MAX_INTENTOS_RECUPERACION_CONTENEDOR,
    hibernado: p.hibernado,
    puedeAbrir: p.basesListas && (p.modoNativo || !!p.cuentaSeleccionadaId),
    etiquetaNormal: t.reiniciar,
    etiquetaProgreso: s.actualizando ? t.actualizando : t.reiniciando,
    // Sólo en nativo: las de contenedor llevan el CLI de la imagen y su propio botón.
    versiones: p.modoNativo ? p.versionesAgente : null
  })
}

/**
 * Uso (cuenta) y contexto (chat), agrupados para que al estrecharse el pie la pieza que
 * queda siga anclada a la izquierda. Los dos se callan fuera de pantalla (keep-alive y
 * columna plegada) y se ponen al día al volver a mostrarse.
 */
function EstadisticasPie({ m }: { m: ModeloPaneAgente }): React.JSX.Element | null {
  const { p, s, r, activado, verSelector } = m
  const { agente, projectHostPath: rutaHostProyecto } = p.target
  // Un agente manual no tiene uso de cuenta; su contexto, solo si el usuario dijo de dónde sale.
  if (esAgenteManual(agente)) {
    const def = agenteManualDe(p.pestanasAgente, agente)
    if (!def?.contexto) return null
    return (
      <div className="agent-footer-stats">
        <ContextoManual nombre={def.nombre} sesionId={s.estado === 'live' ? s.sesionId : null} habilitado={p.enPantallaReal && activado} />
      </div>
    )
  }
  const cuentaId = p.modoNativo ? CUENTA_HOST_ID : p.cuentaSeleccionadaId
  const modo = p.modoNativo ? 'host' : 'container'
  return (
    <div className="agent-footer-stats">
      <BarrasUso
        perfilId={p.target.profileId}
        agente={agente}
        cuentaId={cuentaId}
        modo={modo}
        habilitado={p.enPantallaReal && activado && !verSelector}
      >
        <ControlAnilloContexto
          agente={agente}
          cuentaId={cuentaId}
          modo={modo}
          rutaHostProyecto={rutaHostProyecto}
          habilitado={p.enPantallaReal && activado && !verSelector}
          epocaConversacion={s.epocaConversacion}
          // Compactar escribe en el pty: exige sesión VIVA. El % se lee del disco.
          puedeCompactar={!!s.sesionId && s.estado === 'live' && !s.actualizando}
          onCompactar={() => compactarConversacion(r)}
        />
      </BarrasUso>
    </div>
  )
}

/**
 * «Despertar» en el sitio del botón de reinicio: un agente que no es pestaña (el de datos, el de la
 * terminal) hibernado no tiene una pestaña cuyo clic lo despierte, y si se estaba mirando al hibernar,
 * tampoco «volver a verlo». Lo desmarca y su pane abre otra sesión.
 */
function BotonDespertar({ clave }: { clave: string }): React.JSX.Element {
  return (
    <button
      className="btn btn-icon boton-reinicio agent-reload-btn"
      onClick={() => actualizarHibernadosFueraDePestanas((marcados) => despertarAlVerse(marcados, clave))}
      title={txPane().pie.despertarTitulo}
    >
      <IconoRecargarAgente />
      {txPane().pie.despertar}
    </button>
  )
}

/** Último tramo de la ruta del proyecto: el nombre de su carpeta. */
function nombreDeCarpeta(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? ruta
}

/**
 * Dónde vive el agente, con el icono de su vista en el riel: los tres panes son iguales y el de la
 * terminal a pantalla completa se confunde con el de un proyecto. Va al final, en la esquina: el botón,
 * que se esconde en reposo, queda a su izquierda sin dejar un hueco al lado del rótulo, y al desplegar
 * su etiqueta crece hacia el hueco libre sin moverlo.
 */
function RotuloLugar({ m }: { m: ModeloPaneAgente }): React.JSX.Element {
  const t = txPane().pie
  const { lugar, target: destino } = m.p
  const proyecto = nombreDeCarpeta(destino.projectHostPath)
  const [icono, texto, titulo] =
    lugar === 'terminal'
      ? [<IconoTerminal key="i" />, t.lugarTerminal, t.lugarTerminal]
      : lugar === 'datos'
        ? [<IconoBd key="i" />, t.lugarDatos, t.lugarDatos]
        : lugar === 'ventana'
          ? [<IconoCasa key="i" />, t.lugarVentana, t.lugarVentanaTitulo]
          : [<IconoArchivos key="i" />, proyecto, t.lugarProyectoTitulo(proyecto)]
  return (
    <span className="agent-footer-lugar" title={titulo}>
      {icono}
      <span className="agent-footer-lugar-texto">{texto}</span>
    </span>
  )
}

/**
 * Pie del pane. El botón es de ICONO en reposo y despliega su nombre al pasar el ratón;
 * cuando el estado tiene algo que decir («Reintentar», «Recuperando… (1/2)») la
 * etiqueta va fija y el hover no añade nada.
 */
export function PanePieAgente({ m }: { m: ModeloPaneAgente }): React.JSX.Element {
  const boton = estadoBoton(m)
  const etiquetaReinicio = txPane().pie.etiquetaReinicio
  const perfilHibernando = useStorePestanas((s) => s.hibernando.has(m.p.target.profileId))
  if (puedeDespertarseAMano(m.p.lugar, m.p.hibernado, perfilHibernando)) {
    return (
      <footer className="agent-pane-footer">
        <EstadisticasPie m={m} />
        <BotonDespertar clave={m.p.target.key} />
        <RotuloLugar m={m} />
      </footer>
    )
  }
  return (
    <footer className="agent-pane-footer">
      <EstadisticasPie m={m} />
      <button
        className={`btn btn-icon boton-reinicio agent-reload-btn${boton.soloIcono ? ' solo-icono' : ''}`}
        onClick={() => m.sesion.reiniciar(boton.accion)}
        disabled={!boton.habilitado}
        title={boton.titulo}
        aria-label={boton.soloIcono ? etiquetaReinicio : boton.etiqueta}
      >
        <IconoRecargarAgente />
        {boton.soloIcono ? (
          // El `<span>` de dentro no es decorativo: la caja de fuera anima
          // `grid-template-columns` y ésta es la que recorta (ver el CSS).
          <span className="boton-reinicio-etiqueta">
            <span>{etiquetaReinicio}</span>
          </span>
        ) : (
          boton.etiqueta
        )}
      </button>
      <RotuloLugar m={m} />
    </footer>
  )
}
