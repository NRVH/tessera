// =============================================================================
// «Probar» (o «Guardar y probar») en el diálogo de una conexión SSH: se prueba SIEMPRE lo guardado, así
// que con cambios primero se guarda; y «Olvidar la huella guardada…», con su confirmación anidada, que
// olvida y vuelve a probar. El guardado lo pone `useDialogoConexionSsh`; aquí, el estado de la prueba.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { useState } from 'react'
import type { SshConexion, SshResultadoPrueba } from '../../../../shared/ssh-ipc'
import { mensajeDeErrorSsh } from './erroresSsh'

/** El estado de la prueba: si está en curso, lo último que salió y la confirmación de olvidar la huella. */
export interface EstadoPruebaSsh {
  probando: boolean
  resultado: SshResultadoPrueba | null
  confirmarOlvido: boolean
}

/** Lo que necesita del diálogo. */
export interface OpcionesPruebaSsh {
  /** La conexión guardada que se probaría ya (sin cambios), o `null` si hay que guardar antes. */
  guardadaSinCambios: () => string | null
  /** Guarda el borrador; `null` si no se pudo (el error ya está a la vista). */
  guardar: () => Promise<SshConexion | null>
  /** Deja un error del main a la vista. */
  ponerError: (mensaje: string | null) => void
}

/** Lo que el diálogo pinta y llama. */
export interface PruebaSsh {
  prueba: EstadoPruebaSsh
  probar: () => Promise<void>
  pedirOlvidoHuella: () => void
  cancelarOlvidoHuella: () => void
  olvidarHuellaYProbar: () => Promise<void>
}

/** «Probar» y «Olvidar la huella guardada» del diálogo de una conexión SSH. */
export function usePruebaConexionSsh(o: OpcionesPruebaSsh): PruebaSsh {
  const [prueba, setPrueba] = useState<EstadoPruebaSsh>({ probando: false, resultado: null, confirmarOlvido: false })

  const probarId = async (id: string): Promise<void> => {
    setPrueba({ probando: true, resultado: null, confirmarOlvido: false })
    try {
      const resultado = await window.tessera.ssh.probar({ id })
      setPrueba({ probando: false, resultado, confirmarOlvido: false })
    } catch (err) {
      o.ponerError(mensajeDeErrorSsh(err))
      setPrueba({ probando: false, resultado: null, confirmarOlvido: false })
    }
  }

  const probar = async (): Promise<void> => {
    if (prueba.probando) return
    const id = o.guardadaSinCambios() ?? (await o.guardar())?.id
    if (id !== undefined) await probarId(id)
  }

  const olvidarHuellaYProbar = async (): Promise<void> => {
    const id = o.guardadaSinCambios() ?? (await o.guardar())?.id
    setPrueba((p) => ({ ...p, confirmarOlvido: false }))
    if (id === undefined) return
    try {
      await window.tessera.ssh.olvidarHuella({ id })
    } catch (err) {
      o.ponerError(mensajeDeErrorSsh(err))
      return
    }
    await probarId(id)
  }

  return {
    prueba,
    probar,
    pedirOlvidoHuella: () => setPrueba((p) => ({ ...p, confirmarOlvido: true })),
    cancelarOlvidoHuella: () => setPrueba((p) => ({ ...p, confirmarOlvido: false })),
    olvidarHuellaYProbar
  }
}
