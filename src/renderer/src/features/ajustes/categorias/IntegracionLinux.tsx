// =============================================================================
// El bloque de Linux de «Integración con el sistema»: UN interruptor que instala o borra el
// `tessera.desktop` propio por `window.tessera.escritorioLinux`. El estado es el del disco, que
// el main lee al montar; no hay ajuste persistido porque el usuario puede borrar el archivo.
// Lo monta `Integracion.tsx` cuando `ve('abrir-con-linux')`.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { useEffect, useState } from 'react'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import type { DisponibilidadEscritorioLinux } from '../../../../../shared/escritorio-linux-ipc'
import { Fila, Grupo, Interruptor } from '../primitivas'

/** Qué se le dice al usuario cuando esto no se puede hacer aquí. */
const MOTIVO: Record<Exclude<DisponibilidadEscritorioLinux, 'ok'>, string> = {
  'otro-sistema': 'Esta integración solo existe en Linux.',
  desarrollo:
    'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, así que ' +
    'la entrada abriría un Electron vacío en vez de Tessera. Prueba esto en la Tessera instalada.'
}

interface EstadoLinux {
  disponibilidad: DisponibilidadEscritorioLinux | null
  instalado: boolean
  ajeno: boolean
  error: string | null
  ocupado: boolean
  aplicar: (activo: boolean) => Promise<void>
}

function useEscritorioLinux(): EstadoLinux {
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadEscritorioLinux | null>(null)
  const [instalado, setInstalado] = useState(false)
  const [ajeno, setAjeno] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Se pregunta al montar; el modal se desmonta al cerrarse, así que nunca queda rancio.
  useEffect(() => {
    let vivo = true
    window.tessera.escritorioLinux
      .estado()
      .then((e) => {
        if (!vivo) return
        setDisponibilidad(e.disponibilidad)
        setInstalado(e.instalado)
        setAjeno(e.ajeno)
      })
      .catch(() => {
        if (vivo) setDisponibilidad('otro-sistema')
      })
    return () => {
      vivo = false
    }
  }, [])

  async function aplicar(activo: boolean): Promise<void> {
    setOcupado(true)
    setError(null)
    try {
      const r = await window.tessera.escritorioLinux.aplicar(activo)
      if (r.ok) setInstalado(activo)
      else setError(r.fallos[0] ?? 'El sistema rechazó el cambio.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }
  return { disponibilidad, instalado, ajeno, error, ocupado, aplicar }
}

export function AbrirConLinux(): React.JSX.Element {
  const { disponibilidad, instalado, ajeno, error, ocupado, aplicar } = useEscritorioLinux()
  const gestor = nombresSistema(window.tessera.plataforma).gestorArchivos
  const bloqueado = disponibilidad !== null && disponibilidad !== 'ok'

  return (
    <>
      {bloqueado && (
        <p className="ajustes-aviso" role="note">
          {MOTIVO[disponibilidad]}
        </p>
      )}
      {!bloqueado && ajeno && !instalado && (
        <p className="ajustes-aviso" role="note">
          Ya hay un tessera.desktop en tu carpeta de aplicaciones que no creó Tessera; no se
          sustituye. Bórralo si quieres que Tessera instale el suyo.
        </p>
      )}

      <Grupo
        titulo="Gestor de archivos"
        ayuda={`Añade «Abrir con Tessera» al menú del botón derecho sobre una carpeta en ${gestor} y pone Tessera en el lanzador de aplicaciones. No la convierte en la aplicación predeterminada para abrir carpetas.`}
      >
        <Fila
          etiqueta="«Abrir con Tessera» en carpetas"
          ayuda="Abre esa carpeta como proyecto. Se aplica al instante y se quita igual: se instala en tu carpeta personal, sin permisos de administrador."
          control={
            <Interruptor
              activo={instalado}
              deshabilitado={disponibilidad !== 'ok' || ocupado}
              onChange={() => void aplicar(!instalado)}
              etiqueta={`«Abrir con Tessera» en ${gestor}`}
            />
          }
        />
      </Grupo>

      {error !== null && (
        <p className="ajustes-error" role="alert">
          No se pudo cambiar «Abrir con Tessera»: {error}
        </p>
      )}
    </>
  )
}
