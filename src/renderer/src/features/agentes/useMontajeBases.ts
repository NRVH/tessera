// =============================================================================
// Estado del popover de bases montadas de un pane del agente: abierto/cerrado, las
// conexiones del perfil (conocidas y ajenas) y el aviso de formato. La lista se pide al
// ABRIR el popover, no al montar el pane (hay N panes vivos), en los DOS modos.
// =============================================================================

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import { vistaPopoverMontaje } from '../bd'
import { SIN_CONEXIONES_MONTAJE } from './agentPaneTipos'

/** Lo que pinta el popover de montaje y cómo se abre. */
export interface MontajeBases {
  showDbMount: boolean
  setShowDbMount: Dispatch<SetStateAction<boolean>>
  dbAjenas: DbConexionAjena[]
  vistaMontaje: ReturnType<typeof vistaPopoverMontaje>
  /** `dbConexiones` o la lista vacía estable: solo es null en «Cargando…». */
  conexionesMontaje: readonly DbConnection[]
}

/** Carga las conexiones al abrir el popover y las recarga si cambian mientras está abierto. */
export function useMontajeBases(profileId: string, dbMounted: string[]): MontajeBases {
  const [showDbMount, setShowDbMount] = useState(false)
  const [dbConexiones, setDbConexiones] = useState<DbConnection[] | null>(null)
  // Las AJENAS que estén montadas se listan atenuadas para poder desmontarlas.
  const [dbAjenas, setDbAjenas] = useState<DbConexionAjena[]>([])
  const [dbAvisoFormato, setDbAvisoFormato] = useState<string | null>(null)
  useEffect(() => {
    if (!showDbMount) return
    let vivo = true
    // Conocidas y ajenas en UNA petición, de la misma lectura del registro.
    const cargar = (): void => {
      void window.tessera.db
        .listCompleta(profileId)
        .then((lista) => {
          if (!vivo) return
          setDbConexiones(lista.conexiones)
          setDbAjenas(lista.ajenas)
          setDbAvisoFormato(lista.formatoAjeno ? lista.aviso : null)
        })
        .catch(() => {
          if (!vivo) return
          setDbConexiones([])
          setDbAjenas([])
        })
    }
    cargar()
    // Probar una conexión en la vista Bases de datos la habilita aquí sin reabrir.
    const off = window.tessera.db.onChanged(cargar)
    return () => {
      vivo = false
      off()
    }
  }, [showDbMount, profileId])
  const vistaMontaje = vistaPopoverMontaje({
    conexiones: dbConexiones,
    ajenas: dbAjenas,
    montadas: dbMounted,
    avisoFormato: dbAvisoFormato
  })
  const conexionesMontaje = dbConexiones ?? SIN_CONEXIONES_MONTAJE
  return { showDbMount, setShowDbMount, dbAjenas, vistaMontaje, conexionesMontaje }
}
