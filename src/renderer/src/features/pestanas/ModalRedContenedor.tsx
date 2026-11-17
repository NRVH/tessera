// =============================================================================
// ModalRedContenedor: diálogo con el que se elige por dónde entran y salen las conexiones
// del contenedor de un perfil (red aislada o red del anfitrión), con el diagnóstico previo
// que llega del main ya redactado (`redContenedor.prevuelo`). «Aplicar» nunca se deshabilita.
// Depende de comun/Modal y de shared/nombresSistema; lo abre `DialogosPerfil`.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import './reglasPerfil.css'
import { useEffect, useRef, useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import type { ResultadoRedPrevuelo } from '../../../../shared/sandbox-red-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { ModalAviso, Modal, ModalPie } from '../../comun/Modal'
import { AYUDA, BotonAyuda } from '../academy'
import { txPestanas } from './textos.ts'

interface PropsModalRedContenedor {
  perfil: Perfil
  /**
   * Aplica: persiste el modo y recrea el contenedor (hibernar el perfil basta: el
   * despertar es perezoso y el próximo contenedor nace con la red nueva).
   */
  onAplicar: (redHost: boolean) => void
  onCancelar: () => void
}

type Eleccion = 'aislada' | 'anfitrion'

/**
 * Pide el prevuelo con dos candados: uno barato al abrir (¿el contenedor vivo corre con
 * otra red que la configurada?) y uno medido al elegir anfitrión (levanta un contenedor
 * efímero). El guard de la respuesta es «¿sigo montado?» y no una limpieza por ejecución:
 * ésta dejaba `midiendo` en true para siempre al alternar la elección mientras medía.
 */
function useRedPrevuelo(
  perfilId: string,
  eleccion: Eleccion
): { prevuelo: ResultadoRedPrevuelo | null; midiendo: boolean } {
  const [prevuelo, setPrevuelo] = useState<ResultadoRedPrevuelo | null>(null)
  const [midiendo, setMidiendo] = useState(false)
  const montado = useRef(true)
  useEffect(
    () => () => {
      montado.current = false
    },
    []
  )
  const pedidoBarato = useRef(false)
  const pedidoMedido = useRef(false)
  useEffect(() => {
    const medir = eleccion === 'anfitrion'
    if (medir ? pedidoMedido.current : pedidoBarato.current) return
    if (medir) pedidoMedido.current = true
    else pedidoBarato.current = true
    if (medir) {
      setMidiendo(true)
      // Fuera el resultado BARATO antes de medir: trae el tráfico en «desconocido» y
      // pintarlo mientras llega la medida enseñaría un diagnóstico peor que el real.
      setPrevuelo(null)
    }
    window.tessera.redContenedor
      .prevuelo({ perfilId, medirTrafico: medir })
      .then((r) => {
        if (montado.current) setPrevuelo(r)
      })
      .catch(() => {
        // Sin prevuelo se sigue pudiendo elegir: el diagnóstico ayuda, no manda.
      })
      .finally(() => {
        if (montado.current) setMidiendo(false)
      })
  }, [eleccion, perfilId])
  return { prevuelo, midiendo }
}

function ElegirRed({
  eleccion,
  tuEquipo,
  onElegir
}: {
  eleccion: Eleccion
  tuEquipo: string
  onElegir: (eleccion: Eleccion) => void
}): React.JSX.Element {
  const t = txPestanas().red
  return (
    <div className="project-mode-choices">
      <button
        className={`project-mode-choice${eleccion === 'aislada' ? ' seleccionada' : ''}`}
        aria-pressed={eleccion === 'aislada'}
        onClick={() => onElegir('aislada')}
      >
        <span className="project-mode-choice-label">{t.aislada}</span>
        <span className="project-mode-choice-hint">{t.aisladaPista}</span>
      </button>
      <button
        className={`project-mode-choice${eleccion === 'anfitrion' ? ' seleccionada' : ''}`}
        aria-pressed={eleccion === 'anfitrion'}
        onClick={() => onElegir('anfitrion')}
      >
        <span className="project-mode-choice-label">{t.anfitrion}</span>
        <span className="project-mode-choice-hint">{t.anfitrionPista(tuEquipo)}</span>
      </button>
    </div>
  )
}

/** Qué se pierde al entrar en modo anfitrión: lo que el usuario no puede deducir. */
function QueCambia({ tuEquipo }: { tuEquipo: string }): React.JSX.Element {
  const t = txPestanas().red
  return (
    <div className="red-bloque">
      <div className="red-bloque-titulo">{t.conRedAnfitrion(tuEquipo)}</div>
      <ul className="red-lista">
        <li>{t.puertos(tuEquipo)}</li>
        <li>{t.nombreEquipo}</li>
        <li>{t.soloTcp}</li>
        <li>{t.incompatible}</li>
        <li>{t.puenteBd}</li>
      </ul>
    </div>
  )
}

function Comprobaciones({
  prevuelo,
  midiendo
}: {
  prevuelo: ResultadoRedPrevuelo | null
  midiendo: boolean
}): React.JSX.Element {
  const t = txPestanas().red
  return (
    <div className="red-bloque">
      <div className="red-bloque-titulo">
        {t.comprobaciones} {midiendo && <span className="red-midiendo">{t.comprobando}</span>}
      </div>
      {prevuelo === null && !midiendo && (
        <div className="red-lista-vacia">{t.sinDiagnostico}</div>
      )}
      {prevuelo?.filas.map((f) => (
        <div key={f.id} className={`red-fila red-fila-${f.estado}`}>
          <span className="red-marca" aria-hidden="true">
            {f.estado === 'ok' ? '✓' : f.estado === 'falla' ? '✕' : '!'}
          </span>
          <span className="red-fila-cuerpo">
            <span className="red-fila-titulo">{f.titulo}</span>
            {f.remedio && <span className="red-fila-remedio">{f.remedio}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Todo lo que se enseña con «anfitrión» elegido: qué cambia, comprobaciones y avisos. */
function DetalleAnfitrion({
  prevuelo,
  midiendo,
  tuEquipo
}: {
  prevuelo: ResultadoRedPrevuelo | null
  midiendo: boolean
  tuEquipo: string
}): React.JSX.Element {
  const t = txPestanas().red
  return (
    <>
      <QueCambia tuEquipo={tuEquipo} />
      <Comprobaciones prevuelo={prevuelo} midiendo={midiendo} />

      {/* La salida por VPN va como información, nunca como comprobación en rojo: no se
          sabe qué host le importa al usuario, y darlo por caído sin probarlo sería mentir. */}
      {prevuelo?.notaSalidaVpn && (
        <ModalAviso tono="info"><strong>{t.salidaVpn}</strong>{'\n'}{prevuelo.notaSalidaVpn}</ModalAviso>
      )}

      {prevuelo?.otroPerfilEnAnfitrion && (
        <ModalAviso tono="error"><strong>{t.otroPerfil}</strong>{'\n'}{t.otroPerfilDetalle(tuEquipo)}</ModalAviso>
      )}
    </>
  )
}

/** Diálogo de red del contenedor de un perfil. */
export function ModalRedContenedor({
  perfil,
  onAplicar,
  onCancelar
}: PropsModalRedContenedor): React.JSX.Element {
  const n = nombresSistema(window.tessera.plataforma)
  const t = txPestanas().red
  const actual: Eleccion = perfil.sandbox?.redHost === true ? 'anfitrion' : 'aislada'
  const [eleccion, setEleccion] = useState<Eleccion>(actual)
  const { prevuelo, midiendo } = useRedPrevuelo(perfil.id, eleccion)

  const cambia = eleccion !== actual
  const conFallas = eleccion === 'anfitrion' && prevuelo?.hayFallas === true

  return (
    <Modal titulo={t.titulo(perfil.nombre)} ayuda={<BotonAyuda destino={AYUDA.redDelContenedor} />}
      tamano="m" className="red-modal" onCerrar={onCancelar} cierraConVelo={!cambia}
      pie={<ModalPie>
        <button className="btn btn-ghost" onClick={onCancelar}>{t.cancelar}</button>
        <button className="btn primary" onClick={() => onAplicar(eleccion === 'anfitrion')}>
          {conFallas ? t.aplicarIgualmente(perfil.nombre) : t.aplicar(perfil.nombre)}
        </button>
      </ModalPie>}>
        <div className="modal-message">{t.mensaje}</div>

        <ElegirRed eleccion={eleccion} tuEquipo={n.tuEquipo} onElegir={setEleccion} />

        {eleccion === 'anfitrion' && (
          <DetalleAnfitrion prevuelo={prevuelo} midiendo={midiendo} tuEquipo={n.tuEquipo} />
        )}

        {prevuelo?.pendiente === true && !cambia && (
          <ModalAviso tono="info"><strong>{t.sigueAnterior}</strong>{'\n'}{t.sigueAnteriorDetalle}</ModalAviso>
        )}

    </Modal>
  )
}
