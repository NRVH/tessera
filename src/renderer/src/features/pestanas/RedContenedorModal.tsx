// =============================================================================
// RedContenedorModal: diálogo con el que se elige por dónde entran y salen las conexiones
// del contenedor de un perfil (red aislada o red del anfitrión), con el diagnóstico previo
// que llega del main ya redactado (`redContenedor.prevuelo`). «Aplicar» nunca se deshabilita.
// Depende de comun/AvisoCaja, comun/useDialogo y de shared/nombresSistema; lo abre `ProfileTabs`.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import type { ResultadoRedPrevuelo } from '../../../../shared/sandbox-red-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { useDialogo } from '../../comun/useDialogo'

interface RedContenedorModalProps {
  profile: Profile
  /**
   * Aplica: persiste el modo y recrea el contenedor (hibernar el perfil basta: el
   * despertar es perezoso y el próximo contenedor nace con la red nueva).
   */
  onAplicar: (redHost: boolean) => void
  onCancel: () => void
}

type Eleccion = 'aislada' | 'anfitrion'

/**
 * Pide el prevuelo con dos candados: uno barato al abrir (¿el contenedor vivo corre con
 * otra red que la configurada?) y uno medido al elegir anfitrión (levanta un contenedor
 * efímero). El guard de la respuesta es «¿sigo montado?» y no una limpieza por ejecución:
 * ésta dejaba `midiendo` en true para siempre al alternar la elección mientras medía.
 */
function useRedPrevuelo(
  profileId: string,
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
      .prevuelo({ profileId, medirTrafico: medir })
      .then((r) => {
        if (montado.current) setPrevuelo(r)
      })
      .catch(() => {
        // Sin prevuelo se sigue pudiendo elegir: el diagnóstico ayuda, no manda.
      })
      .finally(() => {
        if (montado.current) setMidiendo(false)
      })
  }, [eleccion, profileId])
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
  return (
    <div className="project-mode-choices">
      <button
        className={`project-mode-choice${eleccion === 'aislada' ? ' seleccionada' : ''}`}
        aria-pressed={eleccion === 'aislada'}
        onClick={() => onElegir('aislada')}
      >
        <span className="project-mode-choice-label">Aislada</span>
        <span className="project-mode-choice-hint">Recomendada · red y puertos propios</span>
      </button>
      <button
        className={`project-mode-choice${eleccion === 'anfitrion' ? ' seleccionada' : ''}`}
        aria-pressed={eleccion === 'anfitrion'}
        onClick={() => onElegir('anfitrion')}
      >
        <span className="project-mode-choice-label">Del anfitrión</span>
        <span className="project-mode-choice-hint">
          --network host · comparte la red de {tuEquipo}
        </span>
      </button>
    </div>
  )
}

/** Qué se pierde al entrar en modo anfitrión: lo que el usuario no puede deducir. */
function QueCambia({ tuEquipo }: { tuEquipo: string }): React.JSX.Element {
  return (
    <div className="red-bloque">
      <div className="red-bloque-titulo">Con la red del anfitrión</div>
      <ul className="red-lista">
        <li>Los puertos que abra el contenedor quedan en {tuEquipo}, en el mismo número.</li>
        <li>
          El contenedor pierde su nombre de equipo propio y comparte el espacio de puertos con los
          demás perfiles.
        </li>
        <li>
          Sólo lleva TCP y UDP: nada por debajo, y un proceso del contenedor no puede escuchar por
          debajo del puerto 1024.
        </li>
        <li>Es incompatible con «Enhanced Container Isolation» de Docker Desktop.</li>
        <li>El puente de bases de datos no cambia: no usa puertos.</li>
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
  return (
    <div className="red-bloque">
      <div className="red-bloque-titulo">
        Comprobaciones {midiendo && <span className="red-midiendo">comprobando…</span>}
      </div>
      {prevuelo === null && !midiendo && (
        <div className="red-lista-vacia">No se pudo completar el diagnóstico.</div>
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
  return (
    <>
      <QueCambia tuEquipo={tuEquipo} />
      <Comprobaciones prevuelo={prevuelo} midiendo={midiendo} />

      {/* La salida por VPN va como información, nunca como comprobación en rojo: no se
          sabe qué host le importa al usuario, y darlo por caído sin probarlo sería mentir. */}
      {prevuelo?.notaEgress && (
        <AvisoCaja titulo="Salida a la VPN" sugerencia={prevuelo.notaEgress} tono="info" />
      )}

      {prevuelo?.otroPerfilEnAnfitrion && (
        <AvisoCaja
          titulo="Otro perfil ya usa la red del anfitrión"
          sugerencia={`En este modo los contenedores comparten el espacio de puertos de ${tuEquipo}, así que el login por navegador de Codex sólo podrá completarse en uno de los dos.`}
          tono="error"
        />
      )}
    </>
  )
}

/** Diálogo de red del contenedor de un perfil. */
export function RedContenedorModal({
  profile,
  onAplicar,
  onCancel
}: RedContenedorModalProps): React.JSX.Element {
  // Esc cierra aunque esté «comprobando…» mientras Docker contesta: el modal no tiene ningún
  // estado que impida abandonarlo (el prevuelo se descarta al desmontar), así que siempre `cerrable`.
  const dlg = useDialogo({ onClose: onCancel })
  const n = nombresSistema(window.tessera.plataforma)
  const actual: Eleccion = profile.sandbox?.redHost === true ? 'anfitrion' : 'aislada'
  const [eleccion, setEleccion] = useState<Eleccion>(actual)
  const { prevuelo, midiendo } = useRedPrevuelo(profile.id, eleccion)

  const cambia = eleccion !== actual
  const conFallas = eleccion === 'anfitrion' && prevuelo?.hayFallas === true

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div ref={dlg.ref} className="modal-card red-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Red del contenedor de “{profile.nombre}”</div>
        <div className="modal-message">
          Decide por dónde entran y salen las conexiones de este perfil. El cambio se aplica al
          reiniciar su contenedor.
        </div>

        <ElegirRed eleccion={eleccion} tuEquipo={n.tuEquipo} onElegir={setEleccion} />

        {eleccion === 'anfitrion' && (
          <DetalleAnfitrion prevuelo={prevuelo} midiendo={midiendo} tuEquipo={n.tuEquipo} />
        )}

        {prevuelo?.pendiente === true && !cambia && (
          <AvisoCaja
            titulo="El contenedor sigue con la red anterior"
            sugerencia="Ya está elegido este modo, pero el contenedor que está corriendo nació con el otro. Reinícialo para aplicarlo."
            tono="info"
          />
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          {/* Nunca deshabilitado: la sonda puede dar un falso negativo, y con el mismo modo
              elegido el botón sigue siendo una forma legítima de reiniciar el contenedor. */}
          <button className="btn" onClick={() => onAplicar(eleccion === 'anfitrion')}>
            {conFallas ? 'Aplicar de todas formas y reiniciar' : 'Aplicar y reiniciar el contenedor'}
          </button>
        </div>
      </div>
    </div>
  )
}
