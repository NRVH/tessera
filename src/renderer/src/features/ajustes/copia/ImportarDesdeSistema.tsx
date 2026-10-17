// =============================================================================
// El importar de la configuración cuando el archivo llega del SISTEMA (doble clic en un `.tessera`,
// con la app cerrada o abierta): recoge la copia que el main ya abrió y monta `ModalImportar`, esté o
// no Configuración abierta. Espera a los ajustes y las pestañas, que son contra lo que se fusiona.
// Un archivo que no es una copia se avisa con el mismo error que al elegirlo a mano.
// Decisiones: docs/decisiones/configuracion/archivos-tessera-del-sistema.md
// =============================================================================
import { useEffect, useState } from 'react'
import type { AbrirResult } from '../../../../../shared/copia-configuracion-ipc'
import { notify } from '../../../comun/notifications'
import { useStorePestanas } from '../../pestanas'
import { useStoreAjustes } from '../store'
import { ModalImportar, useHayImportarAbierto } from './ModalImportar'
import { txCopia } from './textosCopia.ts'

type Abierto = Extract<AbrirResult, { estado: 'abierto' }>

/** Monta el importar con la copia que llegó del sistema; sin copia, nada. */
export function ImportarDesdeSistema(): React.JSX.Element | null {
  const ajustesCargados = useStoreAjustes((s) => s.settingsLoaded)
  const pestanasCargadas = useStorePestanas((s) => s.pestanasCargadas)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const importando = useHayImportarAbierto()
  const listo = ajustesCargados && pestanasCargadas

  // Recogida al estar listo (el arranque en frío: la copia ya esperaba) y en cada aviso del main.
  // Con un importar abierto no se recoge: abrir la copia nueva soltaría en el main la que se está
  // importando y sus perfiles quedarían a medias. Al cerrarse, el efecto vuelve y la recoge.
  useEffect(() => {
    if (!listo || importando) return
    let vivo = true
    const recoger = async (): Promise<void> => {
      const r = await window.tessera.copiaConfiguracion.tomarPendiente()
      if (!vivo || r === null || r.estado === 'cancelado') return
      if (r.estado === 'error') notify('warn', txCopia().importar.noSeAbrio, r.error)
      else setAbierto(r)
    }
    void recoger()
    const dejar = window.tessera.copiaConfiguracion.onPendiente(() => void recoger())
    return () => {
      vivo = false
      dejar()
    }
  }, [listo, importando])

  if (abierto === null) return null
  return <ModalImportar key={abierto.token} abierto={abierto} onCerrar={() => setAbierto(null)} />
}
