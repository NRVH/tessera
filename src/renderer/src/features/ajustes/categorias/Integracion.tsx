// =============================================================================
// Categoría INTEGRACIÓN CON EL SISTEMA: que el clic derecho del gestor de archivos
// ofrezca abrir una carpeta con Tessera. Dos bloques con mecanismos distintos: el
// registro (Windows) y el servicio del Finder (macOS). Es la única categoría que
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
import { Casillas, CampoTexto, Fila, Grupo, Interruptor } from '../primitivas'
import type { PropsCategoria } from '../tipos'

/** Qué se le dice al usuario cuando esto no se puede hacer aquí (Windows). */
const MOTIVO: Record<Exclude<DisponibilidadShell, 'ok'>, string> = {
  'otro-sistema': 'Esta integración solo existe en Windows.',
  desarrollo:
    'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, ' +
    'así que la entrada del menú abriría un Electron vacío en vez de Tessera. Prueba ' +
    'esto en la Tessera instalada.',
  portable:
    'No disponible en la versión portable: su ejecutable corre desde una carpeta ' +
    'temporal que se borra al cerrar, así que la entrada del menú dejaría de funcionar ' +
    'en cuanto salieras.'
}

/** Lo mismo para el Finder. Sin `portable`: en macOS ese formato no existe. */
const MOTIVO_FINDER: Record<Exclude<DisponibilidadFinder, 'ok'>, string> = {
  'otro-sistema': 'Esta integración solo existe en macOS.',
  desarrollo:
    'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, ' +
    'así que la acción rápida abriría un Electron vacío en vez de Tessera. Prueba esto ' +
    'en la Tessera instalada.',
  'sin-bundle':
    'No se ha podido localizar el paquete de Tessera (el .app), así que la acción ' +
    'rápida no sabría qué abrir.'
}

export function Integracion(props: PropsCategoria): React.JSX.Element | null {
  const { ve } = props
  const veWindows =
    ve('menu-windows-carpetas') || ve('menu-windows-archivos') || ve('menu-windows-extensiones')
  const veFinder = ve('accion-rapida-finder')
  if (!veWindows && !veFinder) return null
  return (
    <>
      {veWindows && <MenuExplorador {...props} />}
      {veFinder && <AccionRapidaFinder {...props} />}
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
        setError(r.fallos[0] ?? 'Windows rechazó el cambio.')
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
  return (
    <Grupo
      titulo="Menú contextual del Explorador"
      ayuda="Añade «Abrir con Tessera» al menú del botón derecho. Se aplica al instante y se puede quitar igual de rápido: no hace falta reinstalar ni permisos de administrador. En Windows 11 aparece dentro de «Mostrar más opciones»."
    >
      {veCarpetas && (
        <Fila
          etiqueta="Carpetas y unidades"
          ayuda="Al hacer clic derecho sobre una carpeta, sobre el fondo de una carpeta abierta o sobre una unidad. Abre esa carpeta como proyecto."
          control={
            <Interruptor
              activo={menuWindowsCarpetas}
              deshabilitado={deshabilitado}
              onChange={() => void aplicar({ carpetas: !menuWindowsCarpetas })}
              etiqueta="Abrir con Tessera en carpetas y unidades"
            />
          }
        />
      )}
      {veArchivos && (
        <Fila
          etiqueta="Cualquier archivo"
          ayuda="Al hacer clic derecho sobre un archivo, sea del tipo que sea. Abre su carpeta como proyecto y el archivo en el editor."
          control={
            <Interruptor
              activo={menuWindowsArchivos}
              deshabilitado={deshabilitado}
              onChange={() => void aplicar({ archivos: !menuWindowsArchivos })}
              etiqueta="Abrir con Tessera en cualquier archivo"
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
  return (
    <Grupo
      titulo="Abrir con Tessera"
      ayuda={
        <>
          Las extensiones marcadas ofrecen Tessera en el «Abrir con» de Windows.{' '}
          <strong>No</strong> la convierten en la aplicación predeterminada: esa elección la
          firma Windows y solo puedes hacerla tú, desde su panel de aplicaciones
          predeterminadas.
        </>
      }
    >
      <Fila
        etiqueta="Extensiones sugeridas"
        ayuda="Las que se editan a diario. Marca las que quieras poder abrir con Tessera."
        control={
          <Casillas
            opciones={EXTENSIONES_SUGERIDAS}
            marcadas={new Set(extensiones)}
            deshabilitado={deshabilitado}
            onToggle={onToggleExtension}
            etiqueta="Extensiones asociadas a Tessera"
          />
        }
      />
      <Fila
        etiqueta="Otras extensiones"
        ayuda="Separadas por espacios o comas. El punto se pone solo."
        control={
          <CampoTexto
            valor={propiasCrudo}
            // Se PINTA en cada tecla y se APLICA al salir del campo o con Intro: cada
            // aplicación escribe en el registro, y hacerlo por pulsación dejaba claves
            // basura para cada prefijo a medio teclear.
            onChange={onPropiasCrudo}
            onConfirmar={onConfirmarPropias}
            etiqueta="Otras extensiones asociadas a Tessera"
            placeholder="p. ej. .bat .ini (Intro para aplicar)"
          />
        }
      />
      <FilaAppPredeterminada bloqueado={bloqueado} />
    </Grupo>
  )
}

function FilaAppPredeterminada({ bloqueado }: { bloqueado: boolean }): React.JSX.Element {
  return (
    <Fila
      etiqueta="Aplicación predeterminada"
      ayuda="Para que un doble clic abra Tessera directamente, elígela en el panel de Windows."
      control={
        <button
          type="button"
          className="btn"
          disabled={bloqueado}
          onClick={() => void window.tessera.shellWindows.abrirAppsPredeterminadas()}
        >
          Abrir ajustes de Windows
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
      <AvisoBloqueo texto={bloqueado ? MOTIVO[disponibilidad] : null} />

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
          No se pudo cambiar el registro de Windows: {error}
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
        setError(r.fallos[0] ?? 'macOS rechazó el cambio.')
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

  return (
    <>
      <AvisoBloqueo texto={bloqueado ? MOTIVO_FINDER[disponibilidad] : null} />

      <Grupo
        titulo="Menú contextual del Finder"
        ayuda={
          <>
            «Abrir con › Tessera» sobre un <strong>archivo</strong> ya funciona siempre: lo
            declara el propio paquete de la app y no hay nada que activar. Lo que se enciende
            aquí es la <strong>acción rápida</strong> para <strong>carpetas</strong>, que macOS
            no ofrece por su cuenta.
          </>
        }
      >
        <Fila
          etiqueta="Acción rápida «Abrir en Tessera»"
          ayuda="Añade «Abrir en Tessera» al menú del botón derecho sobre una carpeta, dentro de «Servicios» / «Acciones rápidas». Abre esa carpeta como proyecto. Se aplica al instante y se quita igual: se instala en tu carpeta personal, sin permisos de administrador."
          control={
            <Interruptor
              activo={instalado}
              deshabilitado={bloqueado || ocupado}
              onChange={() => void aplicar(!instalado)}
              etiqueta="Acción rápida «Abrir en Tessera» en el Finder"
            />
          }
        />
      </Grupo>

      {error !== null && (
        <p className="ajustes-error" role="alert">
          No se pudo cambiar la acción rápida del Finder: {error}
        </p>
      )}
    </>
  )
}
