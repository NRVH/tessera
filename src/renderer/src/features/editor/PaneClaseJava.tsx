// =============================================================================
// PaneClaseJava: enseña el código Java de una clase compilada (.class), sacado con un
// descompilador externo. Editor de solo lectura con modelo propio (no usa el registro).
// La barra dice qué motor produjo el texto, con qué JVM y qué bytecode traía la clase.
// Estado y efectos en `useClaseJava`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { nombreDeRuta } from '../../../../shared/jarPath'
import { NOMBRE_MOTOR } from './modeloClaseJava'
import { txJava } from './textosVisores.ts'
import { useClaseJava } from './useClaseJava'
import type { ArchivoAbierto } from './paneCentral'
import type { ResultadoDescompilar } from '../../../../shared/java-ipc'

interface PropsPaneClaseJava {
  archivo: ArchivoAbierto
  visible: boolean
  /**
   * Clave del target (perfil|proyecto) dueño de esta pestaña. Los panes de todos los
   * proyectos viven montados y el main resuelve rutas contra el ACTIVO: solo el pane del
   * activo pide, o mostraría la clase de otro proyecto con un jar del mismo nombre.
   */
  claveDestino: string
  /** Clave del target activo ahora mismo. */
  claveDestinoActivo: string
  /**
   * Tick del watcher de ficheros. Evita enseñar el fuente de un jar viejo tras recompilar;
   * volver a pedir es barato (la caché va por mtime) y si el texto es idéntico no se toca el modelo.
   */
  fsTick: number
  onCerrar: () => void
}

type EstadoJava = ReturnType<typeof useClaseJava>

export function PaneClaseJava({
  archivo,
  visible,
  claveDestino,
  claveDestinoActivo,
  fsTick,
  onCerrar
}: PropsPaneClaseJava): React.JSX.Element {
  const j = useClaseJava({ archivo, visible, claveDestino, claveDestinoActivo, fsTick })
  const r = j.resultado

  return (
    // El aria-label es el nombre accesible del pane, ya que la cabecera no lleva rótulo.
    <section className={`editor java-class${visible ? '' : ' hidden'}`} aria-label={txJava().aria}>
      <CabeceraJava j={j} onCerrar={onCerrar} />

      <BarraProcedencia j={j} ruta={archivo.ruta} />

      {/* Con `!conFuente || mensaje` y no solo `mensaje`: un fallo puede llegar sin texto y la
          pestaña quedaría vacía y muda, sin los botones de recuperación. */}
      {!j.cargando && r !== null && (!j.conFuente || r.mensaje !== '') && <MensajeJava j={j} r={r} />}

      <div className="editor-host" ref={j.hostRef} style={{ display: j.conFuente ? undefined : 'none' }} />
    </section>
  )
}

function CabeceraJava({ j, onCerrar }: { j: EstadoJava; onCerrar: () => void }): React.JSX.Element {
  const nombre = NOMBRE_MOTOR[j.otroMotor] ?? j.otroMotor
  const t = txJava()
  return (
    <header className="panel-header editor-header">
      {/* Sin identidad a la izquierda: la pestaña ya dice nombre y ruta. La barra se queda por
          el reintento con el otro motor, que es contenido propio. */}
      <div className="panel-actions">
        <button
          className="btn btn-icon"
          title={t.volverADescompilar(nombre)}
          aria-label={t.volverADescompilar(nombre)}
          onClick={() => j.reintentar(j.otroMotor)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
            <path d="M20 4v7h-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="btn btn-icon" title={t.cerrar} aria-label={t.cerrar} onClick={onCerrar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}

/** Procedencia del texto: motor, JVM y bytecode de origen. */
function BarraProcedencia({ j, ruta }: { j: EstadoJava; ruta: string }): React.JSX.Element {
  const r = j.resultado
  const t = txJava()
  return (
    <div className="java-class-bar">
      {j.cargando ? (
        <span className="java-class-estado">{t.descompilando(nombreDeRuta(ruta))}</span>
      ) : r === null ? null : (
        <>
          {j.conFuente && r.motor !== null && (
            <span className="java-class-chip">
              {NOMBRE_MOTOR[r.motor] ?? r.motor} {r.motorVersion}
            </span>
          )}
          {r.versionMayorJava > 0 && <span className="java-class-chip">JVM {r.versionMayorJava}</span>}
          {r.bytecode !== null && (
            <span className="java-class-chip">
              bytecode {r.bytecode.major}.{r.bytecode.minor} ({r.bytecode.plataforma})
            </span>
          )}
          {j.conFuente && <span className="java-class-chip">{r.ms} ms</span>}
          {r.estado === 'cache' && <span className="java-class-chip">{t.enCache}</span>}
          {/* Sin LocalVariableTable los locales salen var1, var2… */}
          {j.conFuente && r.sinNombresLocales && (
            <span className="java-class-aviso" title={t.sinInfoDepuracion}>
              {t.sinNombresVariables}
            </span>
          )}
          {r.truncado && <span className="java-class-aviso">{t.recortado}</span>}
        </>
      )}
    </div>
  )
}

/** Error o degradación, con su explicación y las acciones de recuperación. */
function MensajeJava({ j, r }: { j: EstadoJava; r: ResultadoDescompilar }): React.JSX.Element {
  const otro = NOMBRE_MOTOR[j.otroMotor] ?? j.otroMotor
  const ocupado = j.accionEnCurso !== null
  const t = txJava()
  return (
    <div className={`java-class-mensaje${j.conFuente ? ' es-aviso' : ''}`}>
      <p>{r.mensaje !== '' ? r.mensaje : t.falloSinDetalle}</p>
      <div className="java-class-mensaje-acciones">
        {!j.conFuente && (
          <button className="btn" onClick={() => j.reintentar(j.otroMotor)}>
            {t.probarCon(otro)}
          </button>
        )}
        {/* Salida explícita para volver a sondear las JVM (~18 s) tras instalar un JDK. */}
        {!j.conFuente && (
          <button className="btn" disabled={ocupado} onClick={j.redetectar}>
            {j.accionEnCurso === 'redetectar' ? t.buscandoJava : t.volverADetectar}
          </button>
        )}
        {r.estado === 'sin-java' && (
          <button className="btn" disabled={ocupado} onClick={j.elegirJava}>
            {/* El nombre del binario cambia con el sistema. */}
            {window.tessera.plataforma === 'windows' ? t.elegirJavaExe : t.elegirJava}
          </button>
        )}
        {r.diagnostico !== '' && (
          <button className="btn" onClick={() => j.setDetalleAbierto((v) => !v)}>
            {j.detalleAbierto ? t.ocultarDetalle : t.verDetalle}
          </button>
        )}
      </div>
      {j.detalleAbierto && r.diagnostico !== '' && <pre className="java-class-detalle">{r.diagnostico}</pre>}
    </div>
  )
}
