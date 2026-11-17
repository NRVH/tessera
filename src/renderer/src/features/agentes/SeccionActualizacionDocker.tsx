// =============================================================================
// La sección de Docker del actualizador de agentes y la acción de actualizar todo. Una sola sección para todas las
// cuentas, porque comparten imagen; lo que cortaría trabajo en curso se confirma en el mismo botón.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================
import type { EstadoAgentesDocker, VersionAgenteDocker } from '../../../../shared/agents-update-ipc'
import { Cruce, Presente } from '../../comun/Presente'
import {
  dockerAlDia,
  hayNovedadesDocker,
  necesitaConfirmar,
  nombreSesionDocker,
  seccionDockerVisible,
  textoAccionDocker,
  textoAccionTodo,
  textoConfirmar,
  type ModoActualizacion
} from './modeloActualizacionDocker'
import type { InfoSesionesAgentes } from './sesionesPopoverAgentes'
import {
  cancelarConfirmacionDocker,
  descartarResultadoDocker,
  ejecutarActualizacionDocker,
  solicitarActualizacionDocker,
  useStoreActualizacionDocker
} from './storeActualizacionDocker'
import { txActualizacion } from './textosActualizacion.ts'

/** Las dos filas, con el mismo espaciado que las de los agentes del equipo. */
function Versiones({ e, actualizados }: { e: EstadoAgentesDocker; actualizados?: { claude: boolean; codex: boolean } }): React.JSX.Element {
  return (
    <div className="agentes-nativos-clis">
      <FilaVersion etiqueta="Claude Code" v={e.claude} actualizado={actualizados?.claude ?? false} />
      <FilaVersion etiqueta="Codex" v={e.codex} actualizado={actualizados?.codex ?? false} />
    </div>
  )
}

function FilaVersion({ etiqueta, v, actualizado }: { etiqueta: string; v: VersionAgenteDocker; actualizado: boolean }): React.JSX.Element {
  const t = txActualizacion().docker
  return (
    <div className="agentes-nativos-cli actualizacion-pop-versiones">
      <span className="agentes-nativos-cli-nombre">{etiqueta}</span>
      <span>{v.instalada ?? t.desconocida}</span>
      {v.hayNueva && v.ultima ? (
        <>
          <span className="actualizacion-pop-flecha" aria-hidden="true">→</span>
          <strong>{v.ultima}</strong>
        </>
      ) : null}
      {actualizado ? <span className="actualizacion-pop-dia agentes-docker-ok">{t.actualizado}</span> : !v.hayNueva && v.instalada && v.ultima ? <span className="actualizacion-pop-dia">{txActualizacion().popover.alDia}</span> : null}
    </div>
  )
}

function ListaEnUso({ e, info }: { e: EstadoAgentesDocker; info: InfoSesionesAgentes }): React.JSX.Element {
  const t = txActualizacion().docker
  return (
    <div className="agentes-nativos-sesiones">
      <div className="agentes-nativos-subtitulo">{t.detendra}</div>
      <ul className="agentes-docker-lista">
        {e.sesiones.map((s) => (
          <li key={s.sesionId} className="agentes-nativos-sesion">
            <span className="agentes-docker-punto" aria-hidden="true" style={{ background: info.perfiles.get(s.perfilId)?.color ?? undefined }} />
            <span className="agentes-nativos-sesion-nombre">{nombreSesionDocker(s, info)}</span>
            {s.trabajando || s.esperandoRespuesta ? <span className="agentes-nativos-nota bloquea">{s.trabajando ? txActualizacion().popover.notaTrabajando : txActualizacion().popover.notaEspera}</span> : null}
          </li>
        ))}
        {e.tareas.map((tarea) => (
          <li key={tarea.id} className="agentes-nativos-sesion">
            <span className="agentes-docker-punto" aria-hidden="true" />
            <span className="agentes-nativos-sesion-nombre" title={tarea.resumen}>{t.tareaDelegada(tarea.resumen)}</span>
            <span className="agentes-nativos-nota bloquea">{t.enMarcha}</span>
          </li>
        ))}
      </ul>
      <div className="actualizacion-pop-msg agentes-docker-aviso">{t.corte}</div>
    </div>
  )
}

/** El botón que confirma en su sitio lo que se va a detener. */
function Confirmacion({ e, modo, alAceptar }: { e: EstadoAgentesDocker; modo: ModoActualizacion; alAceptar: () => void }): React.JSX.Element {
  return (
    <div className="actualizacion-pop-acciones agentes-nativos-acciones">
      <button type="button" className="btn danger" onClick={alAceptar}>{textoConfirmar(e, modo)}</button>
      <button type="button" className="btn btn-ghost" onClick={cancelarConfirmacionDocker}>{txActualizacion().docker.cancelar}</button>
    </div>
  )
}

/** Comprueba con datos frescos si cortaría algo; si no, actualiza. */
function pedirDocker(): void {
  void solicitarActualizacionDocker('docker').then((ya) => {
    if (ya) void ejecutarActualizacionDocker()
  })
}

function CuerpoReposo({ e, info }: { e: EstadoAgentesDocker; info: InfoSesionesAgentes }): React.JSX.Element {
  const t = txActualizacion().docker
  const { confirmando } = useStoreActualizacionDocker()
  const enUso = necesitaConfirmar(e)
  return (
    <div>
      <Versiones e={e} />
      {enUso && !dockerAlDia(e) ? <ListaEnUso e={e} info={info} /> : null}
      {dockerAlDia(e) ? null : (
        <>
          {enUso ? null : <div className="actualizacion-pop-msg">{e.dockerActivo ? t.explicacion : t.apagado(e.leidoEn !== null)}</div>}
          {confirmando === 'docker' ? (
            <Confirmacion e={e} modo="docker" alAceptar={() => void ejecutarActualizacionDocker()} />
          ) : (
            <div className="actualizacion-pop-acciones agentes-nativos-acciones">
              <button type="button" className="btn btn-perfil" onClick={pedirDocker}>{textoAccionDocker(e)}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CuerpoResultado({ e, conLinea, info }: { e: EstadoAgentesDocker; conLinea: string | null; info: InfoSesionesAgentes }): React.JSX.Element {
  const t = txActualizacion().docker
  const { resultado, confirmando } = useStoreActualizacionDocker()
  if (!resultado) return <div />
  if (!resultado.ok && confirmando === 'docker') {
    return (
      <div>
        <ListaEnUso e={e} info={info} />
        <Confirmacion e={e} modo="docker" alAceptar={() => void ejecutarActualizacionDocker()} />
      </div>
    )
  }
  if (!resultado.ok) {
    return (
      <div>
        <Versiones e={e} />
        <div className="agentes-nativos-error">{t.fallo(resultado.error ?? '')}</div>
        {conLinea ? <pre className="actualizacion-pop-detalle">{conLinea}</pre> : null}
        <div className="actualizacion-pop-acciones agentes-nativos-acciones">
          <button type="button" className="btn btn-perfil" onClick={pedirDocker}>{t.reintentar}</button>
          <button type="button" className="btn btn-ghost" onClick={descartarResultadoDocker}>{t.descartar}</button>
        </div>
      </div>
    )
  }
  return (
    <div>
      <Versiones e={e} actualizados={resultado.actualizados} />
      <div className="actualizacion-pop-msg">{e.conCapas ? `${t.listo} ${t.listoCapas}` : t.listo}</div>
    </div>
  )
}

function CuerpoProgreso(): React.JSX.Element {
  const t = txActualizacion().docker
  const { lineas } = useStoreActualizacionDocker()
  return (
    <div>
      <div className="actualizacion-pop-msg">{t.trabajando}</div>
      <div className="agentes-docker-barra" aria-hidden="true"><span /></div>
      <pre className="actualizacion-pop-detalle">{lineas.slice(-4).join('\n')}</pre>
    </div>
  )
}

/** La sección de los agentes en Docker. No se monta sin cuentas de Docker. */
export function SeccionDocker({ info }: { info: InfoSesionesAgentes }): React.JSX.Element {
  const t = txActualizacion().docker
  const { estado, corriendo, resultado, lineas } = useStoreActualizacionDocker()
  const visible = seccionDockerVisible(estado)
  const fase = corriendo ? 'progreso' : resultado ? 'resultado' : 'reposo'
  const nota = corriendo ? t.actualizando : resultado && !resultado.ok ? t.sinActualizar : resultado ? t.actualizadosTitulo : estado && !estado.dockerActivo ? t.detenido : estado ? t.cuentas(estado.cuentas, estado.perfiles) : ''
  return (
    <Presente visible={visible} como="section" className="mov-despliega actualizacion-pop-bloque">
      {estado ? (
        <>
          <div className="actualizacion-pop-titulo agentes-docker-titulo">
            <span>{t.titulo}</span>
            <span className="agentes-docker-nota">{nota}</span>
          </div>
          <Cruce clave={fase}>
            {corriendo ? <CuerpoProgreso /> : resultado ? <CuerpoResultado e={estado} conLinea={lineas.at(-2) ?? null} info={info} /> : <CuerpoReposo e={estado} info={info} />}
          </Cruce>
        </>
      ) : null}
    </Presente>
  )
}

/** «Actualizar todo»: solo con novedades en las dos secciones y si la del equipo puede ejecutarse. */
export function AccionActualizarTodo({ equipoPendiente, ejecutarEquipo }: { equipoPendiente: boolean; ejecutarEquipo: () => void }): React.JSX.Element {
  const { estado, corriendo, confirmando, resultado } = useStoreActualizacionDocker()
  const visible = equipoPendiente && !corriendo && resultado === null && hayNovedadesDocker(estado)
  const lanzar = (): void => {
    ejecutarEquipo()
    void ejecutarActualizacionDocker()
  }
  const pedir = (): void => {
    void solicitarActualizacionDocker('todo').then((ya) => {
      if (ya) lanzar()
    })
  }
  return (
    <Presente visible={visible} className="mov-despliega actualizacion-pop-bloque agentes-docker-todo">
      {estado && confirmando === 'todo' ? (
        <Confirmacion e={estado} modo="todo" alAceptar={lanzar} />
      ) : estado ? (
        <button type="button" className="btn primary" onClick={pedir}>{textoAccionTodo(estado)}</button>
      ) : null}
    </Presente>
  )
}
