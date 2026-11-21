// =============================================================================
// Las reglas de un nivel del contexto: un solo texto para Claude Code y Codex, con su contador contra el tope, un
// aviso ámbar con icono cuando se acercan a él (con el camino a Documentos) y Guardar. Avisa al diálogo de si tiene cambios sin guardar, y de una propuesta pendiente de un agente para este
// nivel con el botón para revisarla. Lo que llega de fuera mientras no hay cambios propios se muestra al momento.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import './contexto.css'
import { useEffect, useId, useRef, useState } from 'react'
import { MAX_REGLAS_PERFIL, normalizarReglas, reglasCercaDelTope } from '../../../../../shared/reglasPerfil'
import { BotonDescartar } from '../../../comun/BotonDescartar'
import { BotonGuardar } from '../../../comun/BotonGuardar'
import { ModalAviso } from '../../../comun/Modal'
import { Presente } from '../../../comun/Presente'
import { useUltimoValor } from '../../../comun/presencia.ts'
import { txContexto } from './textosContexto.ts'

interface EstadoGuardado {
  guardando: boolean
  /** Cuántas veces se guardó bien: el botón lo confirma en sí mismo cada vez. */
  exitos: number
  error: string | null
}

const REPOSO: EstadoGuardado = { guardando: false, exitos: 0, error: null }

/** El texto en edición frente al vigente, su tope y cómo guardarlo. */
function useEdicionReglas(vigentes: string, onGuardar: (texto: string) => Promise<void>, onSinGuardar: (hay: boolean) => void) {
  const t = txContexto()
  const [texto, setTexto] = useState(vigentes)
  const [estado, setEstado] = useState<EstadoGuardado>(REPOSO)
  const normalizado = normalizarReglas(texto)
  const cambios = normalizado !== normalizarReglas(vigentes)
  const largo = normalizado.length
  const excedido = largo > MAX_REGLAS_PERFIL
  useEffect(() => onSinGuardar(cambios), [cambios, onSinGuardar])
  // Lo que cambió fuera (una propuesta aceptada, otra ventana) se ve si aquí no hay nada a medias.
  const cambiosRef = useRef(cambios)
  cambiosRef.current = cambios
  useEffect(() => {
    if (!cambiosRef.current) setTexto(vigentes)
  }, [vigentes])
  const guardar = (): void => {
    if (excedido || !cambios) return
    setEstado((e) => ({ ...e, guardando: true, error: null }))
    onGuardar(texto)
      .then(() => setEstado((e) => ({ guardando: false, exitos: e.exitos + 1, error: null })))
      .catch((err: unknown) => setEstado((e) => ({ ...e, guardando: false, error: t.errorGuardar(err instanceof Error ? err.message : String(err)) })))
  }
  const editar = (nuevo: string): void => {
    setTexto(nuevo)
    if (estado.error) setEstado((e) => ({ ...e, error: null }))
  }
  return { texto, estado, cambios, largo, excedido, guardar, editar, descartar: () => setTexto(vigentes) }
}

function Pie(p: { largo: number; excedido: boolean; cambios: boolean; estado: EstadoGuardado; onGuardar: () => void; onDescartar: () => void }): React.JSX.Element {
  const t = txContexto()
  return (
    <div className="contexto-pie">
      <span className={`contexto-contador${p.excedido ? ' excedido' : reglasCercaDelTope(p.largo) ? ' cerca-tope' : ''}`} role={p.excedido ? 'alert' : undefined} data-testid="reglas-contador">
        {p.excedido && `${t.excedido} `}
        {t.contador(p.largo, MAX_REGLAS_PERFIL)}
      </span>
      <span className="dbc-hueco" />
      <BotonDescartar visible={p.cambios} etiqueta={t.descartarCambios} onClic={p.onDescartar} />
      <BotonGuardar
        exitos={p.estado.exitos}
        guardando={p.estado.guardando}
        deshabilitado={!p.cambios || p.excedido}
        textos={{ guardar: t.guardar, guardando: t.guardando, guardado: t.guardado }}
        onClic={p.onGuardar}
      />
    </div>
  )
}

export function PanelReglas(p: {
  /** Cómo se nombra el nivel para el lector de pantalla. */
  nombreNivel: string
  vigentes: string
  onGuardar: (texto: string) => Promise<void>
  onSinGuardar: (hay: boolean) => void
  /** Si hay una propuesta pendiente para este nivel, cómo abrir su revisión. */
  onRevisarPropuesta?: () => void
  /** Cómo ir a los documentos del nivel, que se ofrecen cuando las reglas se acercan al tope. */
  onIrADocumentos?: () => void
}): React.JSX.Element {
  const t = txContexto()
  const idAyuda = useId()
  const e = useEdicionReglas(p.vigentes, p.onGuardar, p.onSinGuardar)
  // El error se sigue leyendo mientras su aviso se pliega.
  const ultimoError = useUltimoValor(e.estado.error)
  return (
    <div className="contexto-panel">
      <p id={idAyuda} className="dbc-ayuda">
        {t.reglasAyuda}
      </p>
      {/* Los avisos se despliegan y se pliegan (`movimiento.css`) en vez de empujar el texto de golpe. */}
      <Presente visible={p.onRevisarPropuesta !== undefined} className="contexto-aviso-propuesta mov-despliega" role="status">
        <span>{t.hayPropuesta}</span>
        <button type="button" className="btn btn-ghost" onClick={() => p.onRevisarPropuesta?.()}>
          {t.revisarPropuesta}
        </button>
      </Presente>
      <textarea
        className="contexto-reglas-texto"
        value={e.texto}
        spellCheck={false}
        placeholder={t.reglasPlaceholder}
        aria-label={t.reglasEtiqueta(p.nombreNivel)}
        aria-describedby={idAyuda}
        data-testid="contexto-reglas"
        onChange={(ev) => e.editar(ev.target.value)}
        onKeyDown={(ev) => {
          if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
            ev.preventDefault()
            e.guardar()
          }
        }}
      />
      <Presente visible={reglasCercaDelTope(e.largo)} className="contexto-aviso-tope mov-despliega" data-testid="reglas-cerca-tope">
        <ModalAviso tono="aviso">
          <span>{t.cercaDelTope}</span>
          {p.onIrADocumentos && (
            <button type="button" className="btn btn-ghost" onClick={p.onIrADocumentos}>
              {t.irADocumentos}
            </button>
          )}
        </ModalAviso>
      </Presente>
      <Presente visible={e.estado.error !== null} como="p" className="config-agente-error mov-despliega" role="alert">
        {ultimoError}
      </Presente>
      <Pie largo={e.largo} excedido={e.excedido} cambios={e.cambios} estado={e.estado} onGuardar={e.guardar} onDescartar={e.descartar} />
    </div>
  )
}
