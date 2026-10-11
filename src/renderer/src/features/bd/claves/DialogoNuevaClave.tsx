// =============================================================================
// El diálogo de «Nueva clave» del árbol de Redis: nombre, tipo y el primer valor, y el comando EXACTO que
// se va a ejecutar. Comprueba antes que el nombre esté libre (una clave nueva nunca pisa una que ya
// existe) y envía por la misma ruta que las ediciones del visor (`useEdicionClave`), que confirma lo que el
// main pida; en producción lleva la franja y el botón «Ejecutar en producción».
// Lo pinta `DialogosArbol` por encima del lateral; los comandos salen de `edicionElementos.ts`.
// Decisiones: docs/decisiones/bd/ui-claves-edicion-elementos.md
// =============================================================================

import { useEffect, useId, useState } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { esProduccion } from '../consola/produccionConsola'
import { useDialogo } from '../../../comun/useDialogo'
import { errorDeInvoke, textoError } from '../panesBd'
import { bytesDeTexto } from './bytesClaves'
import type { EntradasClave } from './edicionClaves'
import { TIPOS_CREABLES, comandoCrear, cuadrosDeCreacion, type TipoCreable } from './edicionElementos'
import { Botones, ComandoPrevio, Cuadro, Estado, MarcoDialogo } from './DialogoEdicionClave'
import { useEdicionClave } from './useEdicionClave'
import { etiquetaTipo } from './visorClaves'

export interface PropsDialogoNuevaClave {
  conexion: DbConnection
  base: number
  onCerrar: () => void
  /** La clave se creó: su nombre (texto), para refrescar el árbol y abrirla. */
  alCrear: (nombre: string) => void
}

/** ¿Hay ya una clave con ese nombre? Un texto si no se pudo saber o si existe; null si está libre. */
async function motivoOcupada(conexionId: string, base: number, nombre: string): Promise<string | null> {
  try {
    const r = await window.tessera.dbClaves.valor({ conexionId, base, clave: bytesDeTexto(nombre), cuantos: 1 })
    if (!r.ok) return textoError(r.error)
    return r.valor.contenido.tipo === 'noExiste' ? null : 'Ya existe una clave con ese nombre.'
  } catch (err) {
    return textoError(errorDeInvoke(err))
  }
}

export function DialogoNuevaClave(p: PropsDialogoNuevaClave): React.JSX.Element {
  const { conexion, base } = p
  const idBase = useId()
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoCreable>('string')
  const [e, setE] = useState<EntradasClave>({ uno: '', dos: '' })
  const [comprobando, setComprobando] = useState(false)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const edicion = useEdicionClave(conexion, base, (_a, nuevo) => {
    p.onCerrar()
    p.alCrear(nuevo ?? nombre)
  })
  const dlg = useDialogo({ onClose: p.onCerrar, cerrable: !edicion.enviando && !comprobando })
  // La acción abierta es lo que habilita `ejecutar` del hook; el contenido lo pone este diálogo.
  const { abrir } = edicion
  useEffect(() => {
    abrir({ tipo: 'crear' })
  }, [abrir])

  const cuadros = cuadrosDeCreacion(tipo)
  const cmd = comandoCrear(nombre, tipo, e)
  const produccion = esProduccion(conexion.entorno)
  const ejecutar = (): void => {
    if (!cmd.ok || comprobando || edicion.enviando) return
    setComprobando(true)
    setOcupada(null)
    void motivoOcupada(conexion.id, base, nombre).then((motivo) => {
      setComprobando(false)
      if (motivo !== null) setOcupada(motivo)
      else edicion.ejecutar(cmd.texto, nombre)
    })
  }

  return (
    <MarcoDialogo dlg={dlg} conexion={conexion} titulo="Nueva clave" base={base} onCerrar={p.onCerrar}>
      <Cuadro id={`${idBase}-nombre`} etiqueta="Nombre" valor={nombre} multilinea={false} foco onCambio={setNombre} onEnter={() => undefined} />
      <label className="modal-label" htmlFor={`${idBase}-tipo`}>
        Tipo
      </label>
      <select id={`${idBase}-tipo`} className="modal-input" value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoCreable)}>
        {TIPOS_CREABLES.map((t) => (
          <option key={t} value={t}>
            {etiquetaTipo(t)}
          </option>
        ))}
      </select>
      <Cuadro id={`${idBase}-uno`} etiqueta={cuadros.etiqueta} valor={e.uno} multilinea={cuadros.multilinea} foco={false} onCambio={(uno) => setE((x) => ({ ...x, uno }))} onEnter={() => undefined} />
      {cuadros.etiquetaDos && (
        <Cuadro id={`${idBase}-dos`} etiqueta={cuadros.etiquetaDos} valor={e.dos} multilinea={false} foco={false} onCambio={(dos) => setE((x) => ({ ...x, dos }))} onEnter={ejecutar} />
      )}
      <ComandoPrevio base={base} texto={cmd.ok ? cmd.texto : '—'} />
      <Estado edicion={edicion} motivo={cmd.ok ? null : cmd.motivo} errorPropio={ocupada} />
      <Botones
        edicion={edicion}
        clase={produccion ? 'db-envio-btn-prod' : 'primary'}
        texto={edicion.aviso ? edicion.aviso.confirmar : produccion ? 'Ejecutar en producción' : 'Crear'}
        listo={cmd.ok && !comprobando}
        focoEnEjecutar={false}
        onEjecutar={ejecutar}
        onCancelar={p.onCerrar}
      />
    </MarcoDialogo>
  )
}
