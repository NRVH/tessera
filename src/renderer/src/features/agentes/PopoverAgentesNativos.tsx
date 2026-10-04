// =============================================================================
// Popover del botón de los agentes nativos: antes de ejecutar enseña cada CLI, las
// sesiones que se reiniciarán y la acción con su motivo si no se puede; mientras
// corre y al terminar, el progreso y el resumen (`ProgresoAgentesNativos.tsx`).
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import { useState } from 'react'
import type { EstadoCli, SesionNativa } from '../../../../shared/agentes-nativos-ipc'
import type { NombresSistema } from '../../../../shared/nombresSistema'
import { PopoverBarra } from '../../comun/PopoverBarra'
import { textoUltimoChequeo } from '../actualizaciones'
import { PuntoMosaico } from '../mosaico'
import { ETIQUETA_AGENTE } from './actualizacionNativa'
import { BloqueProgreso, BloqueResumen } from './ProgresoAgentesNativos'
import { nombreSesion, ordenar, type InfoSesionesAgentes } from './sesionesPopoverAgentes'
import type { PlanActualizacion } from './tipos'
import type { UseActualizacionNativa } from './useActualizacionNativa'
import { textoAccion } from './vistaBotonAgentes'

interface PopoverProps {
  act: UseActualizacionNativa
  info: InfoSesionesAgentes
  nombres: NombresSistema
  ahora: number
  corriendo: boolean
}

/** El panel que abre el botón de los agentes nativos. */
export function Popover({ act, info, nombres, ahora, corriendo }: PopoverProps): React.JSX.Element {
  const { estado, plan, planForzado, resumen } = act

  const comprobadoEn = estado
    ? Math.max(estado.claude.comprobadoEn ?? 0, estado.codex.comprobadoEn ?? 0) || null
    : null

  return (
    <PopoverBarra etiqueta={`Agentes de ${nombres.tuEquipo}`} clase="agentes-nativos-pop">
      {corriendo ? (
        <BloqueProgreso act={act} info={info} nombres={nombres} />
      ) : (
        <>
          {resumen ? <BloqueResumen act={act} info={info} /> : null}
          {estado && plan && planForzado ? (
            <BloquePreparacion act={act} info={info} nombres={nombres} />
          ) : (
            <section className="actualizacion-pop-bloque">
              <div className="actualizacion-pop-titulo">Agentes de {nombres.tuEquipo}</div>
              <div className="actualizacion-pop-msg">
                {act.errorComprobar ?? (act.comprobando ? 'Comprobando las versiones…' : 'Aún no hay datos de versiones.')}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="actualizacion-pop-pie">
        <span>{act.comprobando ? 'Comprobando…' : textoUltimoChequeo(comprobadoEn, ahora)}</span>
        <button
          type="button"
          className="actualizacion-pop-enlace"
          disabled={act.comprobando || corriendo}
          onClick={act.abrir}
        >
          Comprobar ahora
        </button>
      </footer>
    </PopoverBarra>
  )
}

// --- Antes de ejecutar ---------------------------------------------------------

function BloquePreparacion({
  act,
  info,
  nombres
}: {
  act: UseActualizacionNativa
  info: InfoSesionesAgentes
  nombres: NombresSistema
}): React.JSX.Element | null {
  const { estado, plan, planForzado } = act
  if (!estado || !plan || !planForzado) return null

  // Con un CLI que se instala a mano o bloqueado, el plan también sale sin nada que
  // instalar, pero decir «al día» sería mentir.
  const alDia = plan.todoAlDia && plan.manuales.length === 0 && plan.bloqueadores.length === 0
  // Con nada que instalar ni atrasar, la lista y la acción son las de «Reiniciar igualmente».
  const planAccion = plan.todoAlDia ? planForzado : plan

  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">
        {alDia
          ? 'Todo al día'
          : plan.todoAlDia
            ? 'Nada que Tessera pueda instalar ahora'
            : `Agentes de ${nombres.tuEquipo}`}
      </div>
      {act.errorComprobar ? <div className="agentes-nativos-error">{act.errorComprobar}</div> : null}

      <div className="agentes-nativos-clis">
        <FilaCli cli={estado.claude} plan={plan} />
        <FilaCli cli={estado.codex} plan={plan} />
      </div>

      <ListaSesiones plan={planAccion} info={info} />

      <div className="actualizacion-pop-acciones agentes-nativos-acciones">
        <button
          type="button"
          className="btn"
          disabled={!planAccion.puedeEjecutar}
          onClick={() => act.ejecutar(planAccion.forzado)}
        >
          {planAccion.forzado ? `Reiniciar igualmente (${planAccion.reiniciar.length})` : textoAccion(planAccion)}
        </button>
        {planAccion.motivoNoEjecutar ? (
          <span className="agentes-nativos-motivo">{planAccion.motivoNoEjecutar}</span>
        ) : null}
      </div>
    </section>
  )
}

type Manual = PlanActualizacion['manuales'][number]
type Bloqueo = PlanActualizacion['bloqueadores'][number]

/** Qué se hará con un CLI, dicho en una frase. */
function queHaraCli(cli: EstadoCli, plan: PlanActualizacion, manual: Manual | undefined, bloqueo: Bloqueo | undefined): React.ReactNode {
  const instalacion = plan.instalar.find((i) => i.agente === cli.agente)
  const atrasadas = plan.reiniciar.filter((s) => s.agente === cli.agente && s.atrasada).length
  if (instalacion) {
    return instalacion.fase === 'B'
      ? 'Se detendrán sus sesiones antes de instalar (su ejecutable en uso bloquea la carpeta) y volverán solas en su conversación.'
      : 'Se instala con sus sesiones abiertas; después se reinician.'
  }
  if (manual) {
    return (
      <>
        {manual.motivo}
        {manual.orden ? '. Orden a mano:' : '.'}
      </>
    )
  }
  if (bloqueo) return 'No se instalará: otros programas tienen abierta su carpeta. Ciérralos y vuelve a comprobar.'
  if (cli.instalada === null) return cli.error ?? 'No está instalado o no responde.'
  if (atrasadas > 0) {
    return `Ya está instalada; ${atrasadas === 1 ? 'hay 1 sesión' : `hay ${atrasadas} sesiones`} con una versión anterior.`
  }
  if (cli.ultima === null) return cli.error ?? 'No se pudo consultar la última versión.'
  return 'Al día.'
}

function VersionesCli({ cli, etq }: { cli: EstadoCli; etq: string }): React.JSX.Element {
  return (
    <div className="actualizacion-pop-versiones">
      <span className="agentes-nativos-cli-nombre">{etq}</span>
      <span>{cli.instalada ?? '—'}</span>
      {cli.hayNueva && cli.ultima ? (
        <>
          <span className="actualizacion-pop-flecha" aria-hidden="true">
            →
          </span>
          <strong>{cli.ultima}</strong>
        </>
      ) : null}
      {cli.canal && cli.canal !== 'latest' ? <span className="agentes-nativos-canal">canal {cli.canal}</span> : null}
    </div>
  )
}

function ProcesosBloqueo({ bloqueo, etq }: { bloqueo: Bloqueo; etq: string }): React.JSX.Element {
  return (
    <ul className="agentes-nativos-procesos">
      {bloqueo.procesos.map((p) => (
        <li key={p.pid} title={p.ruta}>
          <span className="agentes-nativos-pid">{p.pid}</span>
          {p.esDemonio ? `demonio de ${etq} (${p.nombre})` : p.nombre}
          <span className="agentes-nativos-ruta">{p.ruta}</span>
        </li>
      ))}
    </ul>
  )
}

/** Una fila por CLI: versiones y qué se hará con él. */
function FilaCli({ cli, plan }: { cli: EstadoCli; plan: PlanActualizacion }): React.JSX.Element {
  const [copiado, setCopiado] = useState(false)
  const etq = ETIQUETA_AGENTE[cli.agente]
  const manual = plan.manuales.find((m) => m.agente === cli.agente)
  const bloqueo = plan.bloqueadores.find((b) => b.agente === cli.agente)

  return (
    <div className="agentes-nativos-cli">
      <VersionesCli cli={cli} etq={etq} />
      <div className="actualizacion-pop-msg">{queHaraCli(cli, plan, manual, bloqueo)}</div>
      {manual?.orden ? (
        <div className="agentes-nativos-orden">
          <code>{manual.orden}</code>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(manual.orden ?? '')
              setCopiado(true)
              setTimeout(() => setCopiado(false), 1500)
            }}
          >
            {copiado ? 'Copiada' : 'Copiar'}
          </button>
        </div>
      ) : null}
      {bloqueo ? <ProcesosBloqueo bloqueo={bloqueo} etq={etq} /> : null}
    </div>
  )
}

/** La nota que acompaña a una sesión en la lista, o null si no tiene nada que avisar. */
function notaSesion(s: SesionNativa, textoSinEnviar: ReadonlySet<string>, sinRevisar: ReadonlySet<string>): string | null {
  if (s.trabajando) return 'trabajando'
  if (s.esperandoRespuesta) return 'espera tu respuesta'
  if (textoSinEnviar.has(s.sessionId)) return 'puede tener texto sin enviar'
  if (sinRevisar.has(s.sessionId)) return 'terminó sin revisar'
  return null
}

/**
 * Las sesiones que se reiniciarán, en el orden del mosaico y con su punto. La que
 * espera tu respuesta se nombra aparte porque la desbloquea contestarle, y su punto
 * lleva el halo de «pide tu atención», no el latido de trabajo.
 */
function ListaSesiones({ plan, info }: { plan: PlanActualizacion; info: InfoSesionesAgentes }): React.JSX.Element | null {
  if (plan.reiniciar.length === 0) return null
  const textoSinEnviar = new Set(plan.avisos.filter((a) => a.tipo === 'texto-sin-enviar').map((a) => a.sessionId))
  const sinRevisar = new Set(plan.avisos.filter((a) => a.tipo === 'sin-revisar').map((a) => a.sessionId))
  return (
    <div className="agentes-nativos-sesiones">
      <div className="agentes-nativos-subtitulo">
        {plan.reiniciar.length === 1 ? 'Se reiniciará' : `Se reiniciarán ${plan.reiniciar.length}`}
      </div>
      <ul>
        {ordenar(plan.reiniciar, info).map((s: SesionNativa) => {
          const nota = notaSesion(s, textoSinEnviar, sinRevisar)
          const bloquea = s.trabajando || s.esperandoRespuesta
          return (
            <li key={s.sessionId} className="agentes-nativos-sesion">
              <PuntoMosaico
                color={info.perfiles.get(s.profileId)?.color ?? null}
                trabajando={s.trabajando}
                sinVer={sinRevisar.has(s.sessionId) || s.esperandoRespuesta}
              />
              <span className="agentes-nativos-sesion-nombre">{nombreSesion(s, info)}</span>
              {nota ? (
                <span className={`agentes-nativos-nota${bloquea ? ' bloquea' : ''}`}>{nota}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
