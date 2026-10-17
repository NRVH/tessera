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
import { txIntegracion } from '../textosSistema.ts'

/** Qué se le dice al usuario cuando esto no se puede hacer aquí. */
function motivo(d: Exclude<DisponibilidadEscritorioLinux, 'ok'>): string {
  const t = txIntegracion().linux
  return d === 'otro-sistema' ? t.soloLinux : t.desarrollo
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
      else setError(r.fallos[0] ?? txIntegracion().linux.rechazo)
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
  const t = txIntegracion().linux

  return (
    <>
      {bloqueado && (
        <p className="ajustes-aviso" role="note">
          {motivo(disponibilidad)}
        </p>
      )}
      {!bloqueado && ajeno && !instalado && (
        <p className="ajustes-aviso" role="note">
          {t.ajeno}
        </p>
      )}

      <Grupo titulo={t.grupo} ayuda={t.grupoAyuda(gestor)}>
        <Fila
          etiqueta={t.fila}
          ayuda={t.filaAyuda}
          control={
            <Interruptor
              activo={instalado}
              deshabilitado={disponibilidad !== 'ok' || ocupado}
              onChange={() => void aplicar(!instalado)}
              etiqueta={t.filaEtiqueta(gestor)}
            />
          }
        />
      </Grupo>

      {error !== null && (
        <p className="ajustes-error" role="alert">
          {t.errorAbrirCon(error)}
        </p>
      )}
    </>
  )
}
