// =============================================================================
// Popover del botón de actualización: un bloque por lo que hay que contar (fallo
// de aplicación, versión aplicada, descarga o versión preparada, versión
// disponible, error de comprobación) y un pie con la última comprobación.
// Depende de `textoUpdate.ts`; el estado y el reloj los posee `BotonActualizacion`.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import type { UpdateState } from '../../../../shared/update-ipc'
import { PopoverBarra } from '../../comun/PopoverBarra'
import { textoUltimoChequeo } from './textoUpdate'

interface PopoverProps {
  state: UpdateState
  ahora: number
  copiado: boolean
  setCopiado: (v: boolean) => void
  cerrar: () => void
}

function BotonPop({
  onClick,
  disabled,
  children
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" className="btn" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** «desde → hasta», con un hueco al final para el porcentaje. */
function Versiones({
  desde,
  hasta,
  children
}: {
  desde: string
  hasta: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="actualizacion-pop-versiones">
      <span>{desde}</span>
      <span className="actualizacion-pop-flecha" aria-hidden="true">
        →
      </span>
      <strong>{hasta}</strong>
      {children}
    </div>
  )
}

function BloqueFallo({ state, cerrar }: { state: UpdateState; cerrar: () => void }): React.JSX.Element | null {
  const { avisoFallo, currentVersion, installerPath } = state
  if (!avisoFallo) return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">No se pudo aplicar la versión {avisoFallo.versionEsperada}</div>
      <div className="actualizacion-pop-msg">
        {/* Cuando el fallo lo vimos NOSOTROS (el instalador ni arrancó) hay una causa
            concreta que contar; si se descubre al arrancar, el que falló fue un proceso
            que ya no existe y solo cabe la frase genérica. */}
        {avisoFallo.mensaje ?? `Sigues en la ${currentVersion}. Tus datos y tu configuración están intactos.`}
        {avisoFallo.agotado
          ? ' Se dejó de intentar; publicar una versión superior lo desatasca.'
          : ' Se volverá a intentar la próxima vez que cierres Tessera.'}
      </div>
      {avisoFallo.detalle ? <pre className="actualizacion-pop-detalle">{avisoFallo.detalle}</pre> : null}
      <div className="actualizacion-pop-acciones">
        <BotonPop onClick={() => void window.tessera.update.openLog()}>
          {installerPath ? 'Abrir instalador' : 'Ver registro'}
        </BotonPop>
        <BotonPop
          onClick={() => {
            void window.tessera.update.dismiss('fallo')
            cerrar()
          }}
        >
          Descartar
        </BotonPop>
      </div>
    </section>
  )
}

function BloqueAplicada({ state, cerrar }: { state: UpdateState; cerrar: () => void }): React.JSX.Element | null {
  const { avisoAplicada } = state
  if (!avisoAplicada) return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">Tessera se actualizó</div>
      <Versiones desde={avisoAplicada.desde} hasta={avisoAplicada.hasta} />
      <div className="actualizacion-pop-acciones">
        {/* Solo cierra: el descarte lo hace el cierre, venga de este botón o de un clic
            fuera. Se conserva porque una caja sin salida visible se siente rota. */}
        <BotonPop onClick={cerrar}>Entendido</BotonPop>
      </div>
    </section>
  )
}

/** Qué se promete de una versión descargada o bajando, según cómo se aplicará. */
function mensajePreparada({ status, aplicable, seAplicaAlCerrar }: UpdateState): string {
  if (status === 'downloading') return 'Se está bajando en segundo plano; puedes seguir trabajando.'
  // Ni promete que se aplicará sola ni la da por perdida: el chequeo que la confirma
  // llega solo, y "Buscar ahora" lo adelanta.
  if (!aplicable) return 'Está descargada, pero falta confirmarla con el servidor antes de poder aplicarla.'
  if (seAplicaAlCerrar) return 'Se aplicará sola cuando cierres Tessera. No se volverá a abrir sola.'
  return 'Se aplicará cuando pulses “Actualizar ahora”.'
}

function BloquePreparada({ state, cerrar }: { state: UpdateState; cerrar: () => void }): React.JSX.Element | null {
  const { status, currentVersion, newVersion, percent, installerPath, preparadaDesdeArranque } = state
  if (status !== 'ready' && status !== 'downloading') return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">
        {status === 'ready' ? 'Actualización preparada' : 'Descargando actualización'}
      </div>
      <Versiones desde={currentVersion} hasta={newVersion}>
        {status === 'downloading' ? <span className="actualizacion-pop-pct">{percent} %</span> : null}
      </Versiones>
      <div className="actualizacion-pop-msg">
        {mensajePreparada(state)}
        {preparadaDesdeArranque ? ' Venía preparada del arranque anterior.' : ''}
      </div>
      <div className="actualizacion-pop-acciones">
        <BotonPop
          disabled={status !== 'ready'}
          onClick={() => {
            void window.tessera.update.install()
            cerrar()
          }}
        >
          Actualizar ahora
        </BotonPop>
        {installerPath ? (
          <BotonPop onClick={() => void window.tessera.update.openLog()}>Abrir instalador</BotonPop>
        ) : null}
      </div>
    </section>
  )
}

function BloqueDisponible({ state, cerrar }: { state: UpdateState; cerrar: () => void }): React.JSX.Element | null {
  const { status, currentVersion, newVersion } = state
  if (status !== 'available') return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">Versión nueva disponible</div>
      <Versiones desde={currentVersion} hasta={newVersion ?? '—'} />
      <div className="actualizacion-pop-msg">
        {/* Ni "Reiniciar e instalar" ni "Abrir instalador": aquí no hay instalador. Lo
            que hay es un paquete que el usuario baja y arrastra; se dice tal cual para
            que nadie espere que la app se reabra sola con la versión nueva. */}
        Esta copia no puede instalarse sola: descárgala y sustituye la app.
      </div>
      <div className="actualizacion-pop-acciones">
        <BotonPop
          onClick={() => {
            void window.tessera.update.install()
            cerrar()
          }}
        >
          {`Descargar ${newVersion ?? ''}`.trim()}
        </BotonPop>
      </div>
    </section>
  )
}

function BloqueError({
  state,
  copiado,
  setCopiado,
  cerrar
}: Omit<PopoverProps, 'ahora'>): React.JSX.Element | null {
  const { status, errorMessage, errorDetail } = state
  if (status !== 'error') return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">No se pudo comprobar</div>
      <div className="actualizacion-pop-msg">{errorMessage}</div>
      {errorDetail ? <pre className="actualizacion-pop-detalle">{errorDetail}</pre> : null}
      <div className="actualizacion-pop-acciones">
        <BotonPop
          onClick={() => {
            void window.tessera.update.check()
            cerrar()
          }}
        >
          Reintentar
        </BotonPop>
        {errorDetail ? (
          <BotonPop
            onClick={() => {
              void navigator.clipboard.writeText(errorDetail)
              setCopiado(true)
              setTimeout(() => setCopiado(false), 1500)
            }}
          >
            {copiado ? 'Copiado' : 'Copiar detalles'}
          </BotonPop>
        ) : null}
        <BotonPop
          onClick={() => {
            void window.tessera.update.dismiss('error')
            cerrar()
          }}
        >
          Descartar
        </BotonPop>
      </div>
    </section>
  )
}

/** El pie no deja comprobar mientras corre algo, ni con una versión ya preparada y confirmada. */
function comprobarDeshabilitado({ status, aplicable }: UpdateState): boolean {
  return (
    status === 'checking' ||
    status === 'downloading' ||
    status === 'installing' ||
    (status === 'ready' && aplicable)
  )
}

function tituloComprobar({ status, aplicable }: UpdateState): string | undefined {
  if (status !== 'ready') return undefined
  return aplicable
    ? 'Ya hay una versión preparada: no hay nada más que buscar.'
    : 'Confirma con el servidor la versión que ya está descargada.'
}

function PieUpdate({ state, ahora }: { state: UpdateState; ahora: number }): React.JSX.Element {
  return (
    <footer className="actualizacion-pop-pie">
      <span>{textoUltimoChequeo(state.ultimoChequeoMs, ahora)}</span>
      {/* En `ready` `check()` sale temprano, salvo si la actualización viene del marcador
          y aún no está confirmada (`!aplicable`): ahí comprobar es lo único que hace
          falta, y deshabilitarlo dejaría al usuario sin palanca. */}
      <button
        type="button"
        className="actualizacion-pop-enlace"
        disabled={comprobarDeshabilitado(state)}
        title={tituloComprobar(state)}
        onClick={() => void window.tessera.update.check()}
      >
        Buscar ahora
      </button>
    </footer>
  )
}

/** Popover del botón de actualización. */
export function Popover({ state, ahora, copiado, setCopiado, cerrar }: PopoverProps): React.JSX.Element {
  return (
    <PopoverBarra etiqueta="Actualizaciones de Tessera">
      <BloqueFallo state={state} cerrar={cerrar} />
      <BloqueAplicada state={state} cerrar={cerrar} />
      <BloquePreparada state={state} cerrar={cerrar} />
      <BloqueDisponible state={state} cerrar={cerrar} />
      <BloqueError state={state} copiado={copiado} setCopiado={setCopiado} cerrar={cerrar} />
      <PieUpdate state={state} ahora={ahora} />
    </PopoverBarra>
  )
}
