// =============================================================================
// Popover del botón de actualización: un bloque por lo que hay que contar (fallo
// de aplicación, versión aplicada, descarga o versión preparada, versión
// disponible, error de comprobación) y un pie con la última comprobación.
// Depende de `textoActualizacion.ts`; el estado y el reloj los posee `BotonActualizacion`.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { IconoCopiar } from '../../comun/iconosMenu'
import type { EstadoActualizacion } from '../../../../shared/update-ipc'
import { PopoverBarra } from '../../comun/PopoverBarra'
import { textoUltimoChequeo } from './textoActualizacion'
import { txActualizaciones } from './textos.ts'

/** Los textos del popover. */
const tx = (): ReturnType<typeof txActualizaciones>['popover'] => txActualizaciones().popover

interface PropsPopover {
  estado: EstadoActualizacion
  ahora: number
  copiado: boolean
  setCopiado: (v: boolean) => void
  cerrar: () => void
}

function BotonPopover({
  onClic,
  deshabilitado,
  children
}: {
  onClic: () => void
  deshabilitado?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" className="btn" disabled={deshabilitado} onClick={onClic}>
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

function BloqueFallo({ estado, cerrar }: { estado: EstadoActualizacion; cerrar: () => void }): React.JSX.Element | null {
  const { avisoFallo, versionActual: currentVersion, installerPath } = estado
  if (!avisoFallo) return null
  const t = tx()
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">{t.falloTitulo(avisoFallo.versionEsperada)}</div>
      <div className="actualizacion-pop-msg">
        {/* Cuando el fallo lo vimos NOSOTROS (el instalador ni arrancó) hay una causa
            concreta que contar; si se descubre al arrancar, el que falló fue un proceso
            que ya no existe y solo cabe la frase genérica. */}
        {avisoFallo.mensaje ?? t.sigues(currentVersion)}
        {avisoFallo.agotado ? t.agotado : t.reintento}
      </div>
      {avisoFallo.detalle ? <pre className="actualizacion-pop-detalle">{avisoFallo.detalle}</pre> : null}
      <div className="actualizacion-pop-acciones">
        <BotonPopover onClic={() => void window.tessera.actualizacion.abrirRegistro()}>
          {installerPath ? t.abrirInstalador : t.verRegistro}
        </BotonPopover>
        <BotonPopover
          onClic={() => {
            void window.tessera.actualizacion.descartar('fallo')
            cerrar()
          }}
        >
          {t.descartar}
        </BotonPopover>
      </div>
    </section>
  )
}

function BloqueAplicada({ estado, cerrar }: { estado: EstadoActualizacion; cerrar: () => void }): React.JSX.Element | null {
  const { avisoAplicada } = estado
  if (!avisoAplicada) return null
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">{tx().aplicadaTitulo}</div>
      <Versiones desde={avisoAplicada.desde} hasta={avisoAplicada.hasta} />
      <div className="actualizacion-pop-acciones">
        {/* Solo cierra: el descarte lo hace el cierre, venga de este botón o de un clic
            fuera. Se conserva porque una caja sin salida visible se siente rota. */}
        <BotonPopover onClic={cerrar}>{tx().entendido}</BotonPopover>
      </div>
    </section>
  )
}

/** Qué se promete de una versión descargada o bajando, según cómo se aplicará. */
function mensajePreparada({ fase: status, aplicable, seAplicaAlCerrar }: EstadoActualizacion): string {
  const t = tx()
  if (status === 'downloading') return t.bajando
  // Ni promete que se aplicará sola ni la da por perdida: el chequeo que la confirma
  // llega solo, y "Buscar ahora" lo adelanta.
  if (!aplicable) return t.faltaConfirmar
  if (seAplicaAlCerrar) return t.seAplicaAlCerrar
  return t.seAplicaAlPulsar
}

function BloquePreparada({ estado, cerrar }: { estado: EstadoActualizacion; cerrar: () => void }): React.JSX.Element | null {
  const { fase: status, versionActual: currentVersion, newVersion, percent, installerPath, preparadaDesdeArranque } = estado
  if (status !== 'ready' && status !== 'downloading') return null
  const t = tx()
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">
        {status === 'ready' ? t.preparadaTitulo : t.descargandoTitulo}
      </div>
      <Versiones desde={currentVersion} hasta={newVersion}>
        {status === 'downloading' ? <span className="actualizacion-pop-pct">{percent} %</span> : null}
      </Versiones>
      <div className="actualizacion-pop-msg">
        {mensajePreparada(estado)}
        {preparadaDesdeArranque ? t.venia : ''}
      </div>
      <div className="actualizacion-pop-acciones">
        <BotonPopover
          deshabilitado={status !== 'ready'}
          onClic={() => {
            void window.tessera.actualizacion.instalar()
            cerrar()
          }}
        >
          {t.actualizarAhora}
        </BotonPopover>
        {installerPath ? (
          <BotonPopover onClic={() => void window.tessera.actualizacion.abrirRegistro()}>{t.abrirInstalador}</BotonPopover>
        ) : null}
      </div>
    </section>
  )
}

function BloqueDisponible({ estado, cerrar }: { estado: EstadoActualizacion; cerrar: () => void }): React.JSX.Element | null {
  const { fase: status, versionActual: currentVersion, newVersion } = estado
  if (status !== 'available') return null
  const t = tx()
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">{t.disponibleTitulo}</div>
      <Versiones desde={currentVersion} hasta={newVersion ?? '—'} />
      <div className="actualizacion-pop-msg">
        {/* Ni "Reiniciar e instalar" ni "Abrir instalador": aquí no hay instalador. Lo
            que hay es un paquete que el usuario baja y arrastra; se dice tal cual para
            que nadie espere que la app se reabra sola con la versión nueva. */}
        {t.noSePuedeSola}
      </div>
      <div className="actualizacion-pop-acciones">
        <BotonPopover
          onClic={() => {
            void window.tessera.actualizacion.instalar()
            cerrar()
          }}
        >
          {t.descargar(newVersion ?? '').trim()}
        </BotonPopover>
      </div>
    </section>
  )
}

function BloqueError({
  estado,
  copiado,
  setCopiado,
  cerrar
}: Omit<PropsPopover, 'ahora'>): React.JSX.Element | null {
  const { fase: status, mensajeError: errorMessage, detalleError: errorDetail } = estado
  if (status !== 'error') return null
  const t = tx()
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">{t.errorTitulo}</div>
      <div className="actualizacion-pop-msg">{errorMessage}</div>
      {errorDetail ? <pre className="actualizacion-pop-detalle">{errorDetail}</pre> : null}
      <div className="actualizacion-pop-acciones">
        <BotonPopover
          onClic={() => {
            void window.tessera.actualizacion.comprobar()
            cerrar()
          }}
        >
          {t.reintentar}
        </BotonPopover>
        {errorDetail ? (
          <BotonPopover
            onClic={() => {
              void navigator.clipboard.writeText(errorDetail).then(() => {
                setCopiado(true)
                setTimeout(() => setCopiado(false), 1500)
              }).catch(() => undefined)
            }}
          >
            <IconoCopiar copiado={copiado} />{t.copiarDetalles}
          </BotonPopover>
        ) : null}
        <BotonPopover
          onClic={() => {
            void window.tessera.actualizacion.descartar('error')
            cerrar()
          }}
        >
          {t.descartar}
        </BotonPopover>
      </div>
    </section>
  )
}

/** El pie no deja comprobar mientras corre algo, ni con una versión ya preparada y confirmada. */
function comprobarDeshabilitado({ fase: status, aplicable }: EstadoActualizacion): boolean {
  return (
    status === 'checking' ||
    status === 'downloading' ||
    status === 'installing' ||
    (status === 'ready' && aplicable)
  )
}

function tituloComprobar({ fase: status, aplicable }: EstadoActualizacion): string | undefined {
  if (status !== 'ready') return undefined
  return aplicable ? tx().yaPreparada : tx().confirmarConServidor
}

function PieActualizacion({ estado, ahora }: { estado: EstadoActualizacion; ahora: number }): React.JSX.Element {
  return (
    <footer className="actualizacion-pop-pie">
      <span>{textoUltimoChequeo(estado.ultimoChequeoMs, ahora)}</span>
      {/* En `ready` `check()` sale temprano, salvo si la actualización viene del marcador
          y aún no está confirmada (`!aplicable`): ahí comprobar es lo único que hace
          falta, y deshabilitarlo dejaría al usuario sin palanca. */}
      <button
        type="button"
        className="actualizacion-pop-enlace"
        disabled={comprobarDeshabilitado(estado)}
        title={tituloComprobar(estado)}
        onClick={() => void window.tessera.actualizacion.comprobar()}
      >
        {tx().buscarAhora}
      </button>
    </footer>
  )
}

/** Popover del botón de actualización. */
export function Popover({ estado, ahora, copiado, setCopiado, cerrar }: PropsPopover): React.JSX.Element {
  return (
    <PopoverBarra etiqueta={tx().etiqueta}>
      <BloqueFallo estado={estado} cerrar={cerrar} />
      <BloqueAplicada estado={estado} cerrar={cerrar} />
      <BloquePreparada estado={estado} cerrar={cerrar} />
      <BloqueDisponible estado={estado} cerrar={cerrar} />
      <BloqueError estado={estado} copiado={copiado} setCopiado={setCopiado} cerrar={cerrar} />
      <PieActualizacion estado={estado} ahora={ahora} />
    </PopoverBarra>
  )
}
