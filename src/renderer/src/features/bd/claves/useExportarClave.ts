// =============================================================================
// «Exportar a JSON» de la pestaña de clave: lee la clave entera por el mismo canal que el visor, compone el
// documento (`exportarClave.ts`) y lo manda a guardar; el diálogo de guardar y la escritura son del main.
// Avisa del resultado con una notificación. Lo usa `DbClavePane`.
// Decisiones: docs/decisiones/bd/ui-claves-exportar-json.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbKvBytes } from '../../../../../shared/db-claves-ipc'
import { notify } from '../../../comun/notifications'
import { errorDeInvoke, textoError } from '../panesBd'
import { nuevaPeticion } from '../documentos/utilPanes'
import { pintarBytes } from './bytesClaves'
import { txVisorClaves } from './textosVisorClaves'
import { ELEMENTOS_POR_TROZO_EXPORTACION, documentoJsonDeClave, leerClaveEntera } from './exportarClave'

export interface ExportarClave {
  exportando: boolean
  exportar: () => Promise<void>
}

/** Cuánto del nombre de la clave entra en el nombre propuesto para el archivo. */
const LARGO_NOMBRE_ARCHIVO = 100

export function useExportarClave(conexionId: string, base: number, clave: DbKvBytes): ExportarClave {
  const [exportando, setExportando] = useState(false)
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  const exportar = useCallback(async (): Promise<void> => {
    setExportando(true)
    try {
      const lectura = await leerClaveEntera(
        async (desde) => {
          try {
            return await window.tessera.dbClaves.valor({
              conexionId,
              base,
              clave,
              ...(desde !== undefined ? { desde } : {}),
              cuantos: ELEMENTOS_POR_TROZO_EXPORTACION,
              peticionId: nuevaPeticion('exportar-clave')
            })
          } catch (err) {
            return { ok: false as const, error: errorDeInvoke(err) }
          }
        },
        // Cerrar la pestaña corta la lectura entre dos trozos.
        () => !montadoRef.current
      )
      if (!lectura.ok) {
        if (montadoRef.current) notify('error', txVisorClaves().noSePudoExportar, lectura.mensaje)
        return
      }
      const nombre = pintarBytes(clave).slice(0, LARGO_NOMBRE_ARCHIVO) || 'clave'
      const r = await window.tessera.dbClaves.guardarTexto({ conexionId, nombre, texto: documentoJsonDeClave(clave, lectura.valor) })
      if (!montadoRef.current) return
      if (!r.ok) notify('error', txVisorClaves().noSePudoExportar, textoError(r.error))
      else if (r.valor !== null) notify('success', txVisorClaves().claveExportada(r.valor.archivo))
    } catch (err) {
      if (montadoRef.current) notify('error', txVisorClaves().noSePudoExportar, textoError(errorDeInvoke(err)))
    } finally {
      if (montadoRef.current) setExportando(false)
    }
  }, [conexionId, base, clave])

  return { exportando, exportar }
}
