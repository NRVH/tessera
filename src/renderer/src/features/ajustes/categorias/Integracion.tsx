// =============================================================================
// Categoría INTEGRACIÓN CON EL SISTEMA: que el clic derecho del gestor de archivos
// ofrezca abrir una carpeta con Tessera. Un bloque por mecanismo: el registro (Windows),
// el servicio del Finder (macOS) y el `.desktop` (Linux, en `IntegracionLinux.tsx`). Es la única categoría que
// escribe fuera de Tessera: viene apagada y cada cambio se aplica por su canal.
// Quién enseña qué lo decide `catalogo.categoriasVisibles`; aquí solo se mira `ve(id)`.
// Decisiones: docs/decisiones/renderer/integracion-con-el-sistema.md
// =============================================================================

import { useEffect, useState } from 'react'
import {
  EXTENSIONES_SUGERIDAS,
  normalizarExtensiones
} from '../../../../../shared/extensionesShell'
import type { DisponibilidadShell } from '../../../../../shared/shell-windows-ipc'
import type { DisponibilidadFinder } from '../../../../../shared/servicio-finder-ipc'
import { Casillas, CampoTexto, Fila, Grupo, Interruptor, TextoMarcado } from '../primitivas'
import { txIntegracion } from '../textosSistema.ts'
import type { PropsCategoria } from '../tipos'
import { AbrirConLinux } from './IntegracionLinux'

/** Qué se le dice al usuario cuando esto no se puede hacer aquí (Windows). */
function motivoWindows(d: Exclude<DisponibilidadShell, 'ok'>): string {
  const t = txIntegracion().windows
  const motivos: Record<Exclude<DisponibilidadShell, 'ok'>, string> = {
    'otro-sistema': t.soloWindows,
    desarrollo: t.desarrollo,
    portable: t.portable
  }
  return motivos[d]
}

/** Lo mismo para el Finder. Sin `portable`: en macOS ese formato no existe. */
function motivoFinder(d: Exclude<DisponibilidadFinder, 'ok'>): string {
  const t = txIntegracion().finder
  const motivos: Record<Exclude<DisponibilidadFinder, 'ok'>, string> = {
    'otro-sistema': t.soloMac,
    desarrollo: t.desarrollo,
    'sin-bundle': t.sinBundle
  }
  return motivos[d]
}

export function Integracion(props: PropsCategoria): React.JSX.Element | null {
  const { ve } = props
  const veWindows =
    ve('menu-windows-carpetas') || ve('menu-windows-archivos') || ve('menu-windows-extensiones')
  const veFinder = ve('accion-rapida-finder')
  const veLinux = ve('abrir-con-linux')
  if (!veWindows && !veFinder && !veLinux) return null
  return (
    <>
      {veWindows && <MenuExplorador {...props} />}
      {veFinder && <AccionRapidaFinder {...props} />}
      {veLinux && <AbrirConLinux />}
    </>
  )
}

/** Aviso de por qué la integración no está disponible; nada si lo está (o aún no se sabe). */
function AvisoBloqueo({ texto }: { texto: string | null }): React.JSX.Element | null {
  if (texto === null) return null
  return (
    <p className="ajustes-aviso" role="note">
      {texto}
    </p>
  )
}

/** Disponibilidad de la integración de Windows; la sabe el MAIN (`app.isPackaged`, portable). */
function useDisponibilidadShell(): DisponibilidadShell | null {
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadShell | null>(null)
  // Se pregunta al montar; el modal se desmonta al cerrarse, así que nunca queda rancia.
  useEffect(() => {
    let vivo = true
    window.tessera.shellWindows
      .integracionEstado()
      .then((e) => {
        if (vivo) setDisponibilidad(e.disponibilidad)
      })
      .catch(() => {
        if (vivo) setDisponibilidad('otro-sistema')
      })
    return () => {
      vivo = false
    }
  }, [])
  return disponibilidad
}

interface CambioMenu {
  carpetas?: boolean
  archivos?: boolean
  extensiones?: string[]
}

/** Aplica el estado completo del menú en el main y refleja el resultado (ocupado, error). */
function useAplicarMenu({
  menuWindowsCarpetas,
  menuWindowsArchivos,
  menuWindowsExtensiones,
  onChangeMenuWindows
}: PropsCategoria): {
  error: string | null
  ocupado: boolean
  aplicar: (cambio: CambioMenu) => Promise<void>
} {
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function aplicar(cambio: CambioMenu): Promise<void> {
    const estado = {
      carpetas: cambio.carpetas ?? menuWindowsCarpetas,
      archivos: cambio.archivos ?? menuWindowsArchivos,
      extensiones: cambio.extensiones ?? menuWindowsExtensiones
    }
    setOcupado(true)
    setError(null)
    try {
      const r = await window.tessera.shellWindows.integracionAplicar(estado)
      if (r.ok) {
        // Solo se recuerda lo que de verdad se escribió: si `reg.exe` falló, el
        // interruptor tiene que volver a su sitio en vez de mentir.
        onChangeMenuWindows(estado)
      } else {
        setError(r.fallos[0] ?? txIntegracion().windows.rechazo)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }
  return { error, ocupado, aplicar }
}

function GrupoMenuContextual({
  props,
  veCarpetas,
  veArchivos,
  deshabilitado,
  aplicar
}: {
  props: PropsCategoria
  veCarpetas: boolean
  veArchivos: boolean
  deshabilitado: boolean
  aplicar: (cambio: CambioMenu) => Promise<void>
}): React.JSX.Element {
  const { menuWindowsCarpetas, menuWindowsArchivos } = props
  const t = txIntegracion().windows
  return (
    <Grupo titulo={t.grupoMenu} ayuda={t.grupoMenuAyuda}>
      {veCarpetas && (
        <Fila
          etiqueta={t.carpetas}
          ayuda={t.carpetasAyuda}
          control={
            <Interruptor
              activo={menuWindowsCarpetas}
              deshabilitado={deshabilitado}
              onChange={() => void aplicar({ carpetas: !menuWindowsCarpetas })}
              etiqueta={t.carpetasEtiqueta}
            />
          }
        />
      )}
      {veArchivos && (
        <Fila
          etiqueta={t.archivos}
          ayuda={t.archivosAyuda}
          control={
            <Interruptor
              activo={menuWindowsArchivos}
              deshabilitado={deshabilitado}
              onChange={() => void aplicar({ archivos: !menuWindowsArchivos })}
              etiqueta={t.archivosEtiqueta}
            />
          }
        />
      )}
    </Grupo>
  )
}

function GrupoAbrirCon({
  extensiones,
  propiasCrudo,
  onPropiasCrudo,
  deshabilitado,
  bloqueado,
  onToggleExtension,
  onConfirmarPropias
}: {
  extensiones: string[]
  propiasCrudo: string
  onPropiasCrudo: (texto: string) => void
  deshabilitado: boolean
  bloqueado: boolean
  onToggleExtension: (ext: string) => void
  onConfirmarPropias: (texto: string) => void
}): React.JSX.Element {
  const t = txIntegracion().windows
  return (
    <Grupo titulo={t.grupoAbrirCon} ayuda={<TextoMarcado partes={t.abrirConAyuda} />}>
      <Fila
        etiqueta={t.sugeridas}
        ayuda={t.sugeridasAyuda}
        control={
          <Casillas
            opciones={EXTENSIONES_SUGERIDAS}
            marcadas={new Set(extensiones)}
            deshabilitado={deshabilitado}
            onToggle={onToggleExtension}
            etiqueta={t.sugeridasEtiqueta}
          />
        }
      />
      <Fila
        etiqueta={t.otrasExtensiones}
        ayuda={t.otrasAyuda}
        control={
          <CampoTexto
            valor={propiasCrudo}
            // Se PINTA en cada tecla y se APLICA al salir del campo o con Intro: cada
            // aplicación escribe en el registro, y hacerlo por pulsación dejaba claves
            // basura para cada prefijo a medio teclear.
            onChange={onPropiasCrudo}
            onConfirmar={onConfirmarPropias}
            etiqueta={t.otrasEtiqueta}
            placeholder={t.otrasPlaceholder}
          />
        }
      />
      <FilaAppPredeterminada bloqueado={bloqueado} />
    </Grupo>
  )
}

function FilaAppPredeterminada({ bloqueado }: { bloqueado: boolean }): React.JSX.Element {
  const t = txIntegracion().windows
  return (
    <Fila
      etiqueta={t.appPredeterminada}
      ayuda={t.appPredeterminadaAyuda}
      control={
        <button
          type="button"
          className="btn"
          disabled={bloqueado}
          onClick={() => void window.tessera.shellWindows.abrirAppsPredeterminadas()}
        >
          {t.abrirAjustesWindows}
        </button>
      }
    />
  )
}

/** El bloque de Windows: tres superficies del registro. */
function MenuExplorador(props: PropsCategoria): React.JSX.Element | null {
  const { ve, menuWindowsExtensiones } = props
  const disponibilidad = useDisponibilidadShell()
  const { error, ocupado, aplicar } = useAplicarMenu(props)

  // El campo libre lleva estado local en CRUDO: con el valor normalizado como `value`
  // no se puede teclear, porque el punto que falta se añade en el mismo render y el
  // cursor salta. Son las extensiones que no están entre las sugeridas.
  const propias = menuWindowsExtensiones.filter((e) => !EXTENSIONES_SUGERIDAS.includes(e))
  const [propiasCrudo, setPropiasCrudo] = useState(() => propias.join(' '))

  const veCarpetas = ve('menu-windows-carpetas')
  const veArchivos = ve('menu-windows-archivos')
  const veExtensiones = ve('menu-windows-extensiones')
  if (!veCarpetas && !veArchivos && !veExtensiones) return null

  const bloqueado = disponibilidad !== null && disponibilidad !== 'ok'

  function alternarExtension(ext: string): void {
    const set = new Set(menuWindowsExtensiones)
    if (set.has(ext)) set.delete(ext)
    else set.add(ext)
    void aplicar({ extensiones: [...set].sort() })
  }

  /**
   * Aplica lo que hay en el campo libre. No con otra aplicación en vuelo: `aplicar`
   * compone el estado desde las props, que aún no incluyen lo que esa aplicación va a
   * confirmar, y la segunda desharía la primera. Tampoco si la lista es la misma:
   * `onBlur` salta en cada pérdida de foco y costaría una ronda de `reg.exe` en balde.
   */
  function cambiarPropias(texto: string): void {
    if (bloqueado || ocupado) return
    const sugeridasMarcadas = menuWindowsExtensiones.filter((e) =>
      EXTENSIONES_SUGERIDAS.includes(e)
    )
    const extensiones = [
      ...new Set([...sugeridasMarcadas, ...normalizarExtensiones(texto)])
    ].sort()
    if (extensiones.join(' ') === [...menuWindowsExtensiones].sort().join(' ')) return
    void aplicar({ extensiones })
  }

  return (
    <>
      <AvisoBloqueo texto={bloqueado ? motivoWindows(disponibilidad) : null} />

      {(veCarpetas || veArchivos) && (
        <GrupoMenuContextual
          props={props}
          veCarpetas={veCarpetas}
          veArchivos={veArchivos}
          deshabilitado={bloqueado || ocupado}
          aplicar={aplicar}
        />
      )}

      {veExtensiones && (
        <GrupoAbrirCon
          extensiones={menuWindowsExtensiones}
          propiasCrudo={propiasCrudo}
          onPropiasCrudo={setPropiasCrudo}
          deshabilitado={bloqueado || ocupado}
          bloqueado={bloqueado}
          onToggleExtension={alternarExtension}
          onConfirmarPropias={cambiarPropias}
        />
      )}

      {error !== null && (
        <p className="ajustes-error" role="alert">
          {txIntegracion().windows.errorRegistro(error)}
        </p>
      )}
    </>
  )
}

/**
 * Estado del servicio del Finder. El interruptor se siembra con el DISCO (`estado()` mira
 * si existe el `.workflow`) y no con el ajuste persistido: si el usuario borra el servicio
 * desde fuera, el JSON mentiría. Lo persistido solo evita el parpadeo hasta la respuesta.
 */
function useServicioFinder({
  accionRapidaFinder,
  onChangeAccionRapidaFinder
}: PropsCategoria): {
  disponibilidad: DisponibilidadFinder | null
  instalado: boolean
  error: string | null
  ocupado: boolean
  aplicar: (activo: boolean) => Promise<void>
} {
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadFinder | null>(null)
  const [instalado, setInstalado] = useState(accionRapidaFinder)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    window.tessera.servicioFinder
      .estado()
      .then((e) => {
        if (!vivo) return
        setDisponibilidad(e.disponibilidad)
        setInstalado(e.instalado)
        // Si el disco y lo persistido no coinciden, manda el disco y se persiste.
        if (e.instalado !== accionRapidaFinder) onChangeAccionRapidaFinder(e.instalado)
      })
      .catch(() => {
        if (vivo) setDisponibilidad('otro-sistema')
      })
    return () => {
      vivo = false
    }
    // Sólo al montar: el modal se desmonta al cerrarse, así que el estado nunca queda
    // rancio, y depender de `accionRapidaFinder` re-preguntaría en cada aplicación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function aplicar(activo: boolean): Promise<void> {
    setOcupado(true)
    setError(null)
    try {
      const r = await window.tessera.servicioFinder.aplicar(activo)
      if (r.ok) {
        setInstalado(activo)
        onChangeAccionRapidaFinder(activo)
      } else {
        setError(r.fallos[0] ?? txIntegracion().finder.rechazo)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }
  return { disponibilidad, instalado, error, ocupado, aplicar }
}

/** El bloque de macOS: UN interruptor, el servicio del Finder. */
function AccionRapidaFinder(props: PropsCategoria): React.JSX.Element {
  const { disponibilidad, instalado, error, ocupado, aplicar } = useServicioFinder(props)
  const bloqueado = disponibilidad !== null && disponibilidad !== 'ok'
  const t = txIntegracion().finder

  return (
    <>
      <AvisoBloqueo texto={bloqueado ? motivoFinder(disponibilidad) : null} />

      <Grupo titulo={t.grupo} ayuda={<TextoMarcado partes={t.ayuda} />}>
        <Fila
          etiqueta={t.accion}
          ayuda={t.accionAyuda}
          control={
            <Interruptor
              activo={instalado}
              deshabilitado={bloqueado || ocupado}
              onChange={() => void aplicar(!instalado)}
              etiqueta={t.accionEtiqueta}
            />
          }
        />
      </Grupo>

      {error !== null && (
        <p className="ajustes-error" role="alert">
          {t.errorAccion(error)}
        </p>
      )}
    </>
  )
}
