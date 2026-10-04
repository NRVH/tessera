// =============================================================================
// Aviso único de que existe la integración con el gestor de archivos («Abrir con
// Tessera» / «Abrir en Tessera»): viene apagada de fábrica y nadie la descubriría.
// Solo si se puede usar aquí y no está ya encendida; se da por avisado al enseñarlo.
// =============================================================================
import { useEffect } from 'react'
import { notify } from '../../comun/notifications'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { useStoreAjustes } from './store'

/** Pregunta la disponibilidad al canal de la plataforma y si ya está encendida. */
function estadoIntegracion(esMac: boolean): Promise<{ disponibilidad: string; yaEsta: boolean }> {
  return esMac
    ? window.tessera.servicioFinder.estado().then((e) => ({ ...e, yaEsta: e.instalado }))
    : window.tessera.shellWindows.integracionEstado().then((e) => ({
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
    const n = nombresSistema(window.tessera.plataforma)
    const esMac = window.tessera.plataforma === 'mac'
    estadoIntegracion(esMac)
      .then((e) => {
        if (!vivo || e.disponibilidad !== 'ok') return
        // Ya encendida: no se avisa y se da por avisado (si no, al apagarla llegaría el estreno).
        if (!e.yaEsta) {
          notify(
            'info',
            `Nuevo: «${esMac ? 'Abrir en' : 'Abrir con'} Tessera» en ${n.gestorArchivos}`,
            'Actívalo en Configuración › Integración con el sistema para abrir ' +
              (esMac ? 'una carpeta' : 'una carpeta o un archivo') +
              ' desde el botón derecho.'
          )
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
