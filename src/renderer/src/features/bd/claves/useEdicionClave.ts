// =============================================================================
// El estado de la edición del visor de clave: qué acción tiene el diálogo abierto, y su envío por la
// consola de Redis del main en una sesión propia del visor (`visor-<uuid>`, que se cierra al
// desmontarse). En producción el botón del diálogo ya es la confirmación; si aun así el main devuelve
// el comando sin enviar ('peligroso', 'produccion'), el diálogo lo dice y el siguiente clic lo confirma.
// Lo usa `DbClavePane`; los comandos y los textos salen de `edicionClaves.ts`.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { PREFIJO_CONSOLA_VISOR, type DbKvEjecutar } from '../../../../../shared/db-claves-ipc'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'
import { confirmacionLoteProduccion, esProduccion } from '../consola/produccionConsola'
import { errorDeInvoke, textoError } from '../panesBd'
import { notify } from '../../../comun/notifications'
import { confirmacionPeligroso, verboComando } from './consolaClaves'
import { resultadoDeAccion, type AccionClave } from './edicionClaves'
import { txConsolaClaves } from './textosConsolaClaves'

/** Lo que el main pidió confirmar antes de enviar: el texto del aviso y el botón que lo acepta. */
export interface AvisoEdicion {
  titulo: string
  mensaje: string
  confirmar: string
}

export interface EdicionClave {
  accion: AccionClave | null
  abrir: (a: AccionClave) => void
  cerrar: () => void
  /** `nuevoNombre`: al renombrar, el nombre escrito (la pestaña pasa a esa clave). */
  ejecutar: (comando: string, nuevoNombre?: string) => void
  enviando: boolean
  error: string | null
  aviso: AvisoEdicion | null
}

type Confirmaciones = Pick<DbKvEjecutar, 'confirmado' | 'confirmadoPeligroso'>

/** El aviso del rechazo y la marca que lo acepta, o null si el rechazo no es de los que se confirman. */
function avisoDeRechazo(e: DbErrorSql, comando: string, con: DbConnection, base: number, conf: Confirmaciones): { aviso: AvisoEdicion; marca: Confirmaciones } | null {
  const produccion = esProduccion(con.entorno)
  if (e.motivo === 'peligroso' && !conf.confirmadoPeligroso) {
    const t = confirmacionPeligroso({ verbo: verboComando(comando), alias: con.alias, base, mensaje: e.mensaje, produccion })
    return { aviso: { titulo: t.titulo, mensaje: t.mensaje, confirmar: t.confirmar }, marca: { confirmadoPeligroso: true } }
  }
  if (e.motivo === 'produccion' && !conf.confirmado) {
    const t = confirmacionLoteProduccion({ alias: con.alias, total: 1, escrituras: [{ indice: 0, verbo: verboComando(comando) || txConsolaClaves().escritura }] })
    return { aviso: { titulo: t.titulo, mensaje: t.mensaje, confirmar: t.confirmar }, marca: { confirmado: true } }
  }
  return null
}

/**
 * La edición de la clave de la pestaña. `alTerminar` se llama tras una acción que entró, con ella y,
 * al renombrar, el nombre nuevo
 * (la pestaña vuelve a leer la clave).
 */
export function useEdicionClave(conexion: DbConnection, base: number, alTerminar: (a: AccionClave, nuevoNombre?: string) => void): EdicionClave {
  const [accion, setAccion] = useState<AccionClave | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<AvisoEdicion | null>(null)
  // Lo que el usuario confirmó vale para ESE comando: si cambia lo escrito, se vuelve a preguntar.
  const confRef = useRef<{ comando: string; conf: Confirmaciones } | null>(null)
  // Un id corto y propio: el de la pestaña lleva la clave entera en base64 y el main acota su largo.
  const [consolaId] = useState(() => `${PREFIJO_CONSOLA_VISOR}${crypto.randomUUID()}`)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      void window.tessera.dbExplorador.cerrarSesionConsola(conexion.profileId, consolaId).catch(() => undefined)
    }
  }, [conexion.profileId, consolaId])

  const abrir = useCallback((a: AccionClave): void => {
    confRef.current = null
    setError(null)
    setAviso(null)
    setAccion(a)
  }, [])
  const cerrar = useCallback((): void => {
    if (!enviando) setAccion(null)
  }, [enviando])

  const ejecutar = (comando: string, nuevoNombre?: string): void => {
    if (!accion || enviando) return
    const a = accion
    // El botón de un diálogo en producción ya dice «Ejecutar en producción».
    const previas = confRef.current?.comando === comando ? confRef.current.conf : {}
    if (confRef.current && confRef.current.comando !== comando) setAviso(null)
    const conf: Confirmaciones = { ...(esProduccion(conexion.entorno) ? { confirmado: true } : {}), ...previas }
    setEnviando(true)
    setError(null)
    void window.tessera.dbClaves
      .ejecutarConsola({ perfilId: conexion.profileId, consolaId, conexionId: conexion.id, base, texto: comando, desplazamiento: 0, ...conf })
      .catch((err: unknown) => ({ ok: false as const, error: errorDeInvoke(err) }))
      .then((r) => {
        if (!montadoRef.current) return
        setEnviando(false)
        if (!r.ok) {
          const rechazo = avisoDeRechazo(r.error, comando, conexion, base, conf)
          if (rechazo) {
            confRef.current = { comando, conf: { ...previas, ...rechazo.marca } }
            setAviso(rechazo.aviso)
          } else setError(textoError(r.error))
          return
        }
        const res = resultadoDeAccion(a, comando, r.valor.respuesta)
        if (!res.ok) return setError(res.mensaje)
        setAccion(null)
        notify('success', res.aviso)
        alTerminar(a, nuevoNombre)
      })
  }

  return { accion, abrir, cerrar, ejecutar, enviando, error, aviso }
}
