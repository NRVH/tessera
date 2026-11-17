// =============================================================================
// Estado del popover de bases montadas de un pane del agente: abierto/cerrado, las
// conexiones del perfil (conocidas y ajenas) y el aviso de formato. La lista se pide al
// ABRIR el popover, no al montar el pane (hay N panes vivos), en los DOS modos.
// =============================================================================

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { DbConexionAjena, ConexionBd } from '../../../../shared/db-ipc'
import { vistaPopoverMontaje } from '../bd'
import { SIN_CONEXIONES_MONTAJE } from './tiposPaneAgente'

/** Lo que pinta el popover de montaje y cómo se abre. */
export interface MontajeBases {
  verMontajeDb: boolean
  setVerMontajeDb: Dispatch<SetStateAction<boolean>>
  dbAjenas: DbConexionAjena[]
  vistaMontaje: ReturnType<typeof vistaPopoverMontaje>
  /** `dbConexiones` o la lista vacía estable: solo es null en «Cargando…». */
  conexionesMontaje: readonly ConexionBd[]
}

/** Carga las conexiones al abrir el popover y las recarga si cambian mientras está abierto. */
export function useMontajeBases(perfilId: string, basesMontadas: string[]): MontajeBases {
  const [verMontajeDb, setVerMontajeDb] = useState(false)
  const [dbConexiones, setDbConexiones] = useState<ConexionBd[] | null>(null)
  // Las AJENAS que estén montadas se listan atenuadas para poder desmontarlas.
  const [dbAjenas, setDbAjenas] = useState<DbConexionAjena[]>([])
  const [dbAvisoFormato, setDbAvisoFormato] = useState<string | null>(null)
  useEffect(() => {
    if (!verMontajeDb) return
    let vivo = true
    // Conocidas y ajenas en UNA petición, de la misma lectura del registro.
    const cargar = (): void => {
      void window.tessera.db
        .listarCompleta(perfilId)
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
    const off = window.tessera.db.alCambiar(cargar)
    return () => {
      vivo = false
      off()
    }
  }, [verMontajeDb, perfilId])
  const vistaMontaje = vistaPopoverMontaje({
    conexiones: dbConexiones,
    ajenas: dbAjenas,
    montadas: basesMontadas,
    avisoFormato: dbAvisoFormato
  })
  const conexionesMontaje = dbConexiones ?? SIN_CONEXIONES_MONTAJE
  return { verMontajeDb, setVerMontajeDb, dbAjenas, vistaMontaje, conexionesMontaje }
}
