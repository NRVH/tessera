// =============================================================================
// Aviso único de que existe la integración con el gestor de archivos («Abrir con
// Tessera» / «Abrir en Tessera»): viene apagada de fábrica y nadie la descubriría.
// Solo si se puede usar aquí y no está ya encendida; se da por avisado al enseñarlo.
// =============================================================================
import { useEffect } from 'react'
import { notify } from '../../comun/notifications'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { Plataforma } from '../../../../shared/plataforma'
import { useStoreAjustes } from './store'
import { txIntegracion } from './textosSistema.ts'

/** Pregunta la disponibilidad al canal de la plataforma y si ya está encendida. */
function estadoIntegracion(
  plataforma: Plataforma
): Promise<{ disponibilidad: string; yaEsta: boolean }> {
  if (plataforma === 'mac') {
    return window.tessera.servicioFinder.estado().then((e) => ({ ...e, yaEsta: e.instalado }))
  }
  if (plataforma === 'linux') {
    return window.tessera.escritorioLinux.estado().then((e) => ({ ...e, yaEsta: e.instalado }))
  }
  return window.tessera.shellWindows.integracionEstado().then((e) => ({
    ...e,
    yaEsta: e.aplicado.carpetas || e.aplicado.archivos || e.aplicado.extensiones.length > 0
  }))
}

/** Enseña una vez el aviso de la integración con el gestor de archivos. */
export function useAvisoIntegracion(): void {
  const settingsLoaded = useStoreAjustes((s) => s.settingsLoaded)
  const menuWindowsAvisado = useStoreAjustes((s) => s.menuWindowsAvisado)
  useEffect(() => {
    if (!settingsLoaded || menuWindowsAvisado) return
    let vivo = true
    const plataforma = window.tessera.plataforma
    const n = nombresSistema(plataforma)
    const esMac = plataforma === 'mac'
    // En Windows también se ofrece sobre archivos; en macOS y Linux, solo carpetas.
    const soloCarpetas = esMac || plataforma === 'linux'
    estadoIntegracion(plataforma)
      .then((e) => {
        if (!vivo || e.disponibilidad !== 'ok') return
        // Ya encendida: no se avisa y se da por avisado (si no, al apagarla llegaría el estreno).
        if (!e.yaEsta) {
          const t = txIntegracion().aviso
          notify('info', t.titulo(esMac, n.gestorArchivos), t.cuerpo(soloCarpetas))
        }
        useStoreAjustes.setState({ menuWindowsAvisado: true })
      })
      .catch(() => {
        /* si no se puede preguntar, no se avisa: se reintentará en el próximo arranque */
      })
    return () => {
      vivo = false
    }
  }, [settingsLoaded, menuWindowsAvisado])
}
