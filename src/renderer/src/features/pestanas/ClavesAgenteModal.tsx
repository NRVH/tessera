// =============================================================================
// Qué claves SSH pueden usar los agentes de un perfil, con las piezas de Configuración: una tarjeta con una fila
// por clave (nombre y carpeta en una línea, sus alias en el tooltip) y su interruptor. La lista nunca recibe material
// privado: solo lo que el catálogo enseña de cada clave.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { useEffect, useState } from 'react'
import type { ClaveAgente } from '../../../../shared/ssh-agente-ipc'
import type { Profile } from '../../../../main/profiles/types'
import { Modal, PieModal, AvisoModal } from '../../comun/Modal'
import { Cruce, Presente } from '../../comun/Presente'
import { Grupo, Interruptor } from '../../comun/piezasAjustes'
import { despacharTabs } from './store'
import { txClavesAgente } from './textosClavesAgente'
import './clavesAgente.css'

/** Una clave: su nombre y su carpeta en una sola línea, y el interruptor que la permite. */
function FilaClave({ clave, deshabilitada, alternar }: { clave: ClaveAgente; deshabilitada: boolean; alternar: () => void }): React.JSX.Element {
  const alias = clave.alias.join(', ')
  // El nombre o la carpeta pueden recortarse: el tooltip los lleva enteros, con los alias que usan la clave.
  const completo = `${clave.nombre} · ${clave.carpeta}`
  return (
    <div className="ajustes-fila claves-agente-fila" title={alias ? `${completo}\n${txClavesAgente().alias(alias)}` : completo}>
      <div className="ajustes-fila-texto claves-agente-texto">
        <span className="ajustes-fila-etiqueta claves-agente-nombre">{clave.nombre}</span>
        <span className="claves-agente-carpeta">{clave.carpeta}</span>
      </div>
      <div className="ajustes-fila-control">
        <Interruptor activo={clave.permitida} onChange={alternar} etiqueta={clave.nombre} deshabilitado={deshabilitada} />
      </div>
    </div>
  )
}

export function ClavesAgenteModal({ perfil, alCerrar }: { perfil: Profile; alCerrar: () => void }): React.JSX.Element {
  const t = txClavesAgente()
  const [claves, fijarClaves] = useState<ClaveAgente[] | null>(null)
  const [error, fijarError] = useState(false)
  const [guardando, fijarGuardando] = useState(false)
  useEffect(() => {
    let vigente = true
    window.tessera.clavesAgente
      .listar(perfil.id)
      .then((lista) => {
        if (vigente) fijarClaves(lista)
      })
      .catch(() => {
        if (vigente) fijarError(true)
      })
    return () => {
      vigente = false
    }
  }, [perfil.id])

  const alternar = (ruta: string): void =>
    fijarClaves((lista) => lista?.map((c) => (c.ruta === ruta ? { ...c, permitida: !c.permitida } : c)) ?? null)

  async function guardar(): Promise<void> {
    if (!claves || guardando) return
    fijarGuardando(true)
    fijarError(false)
    const permitidas = claves.filter((clave) => clave.permitida).map((clave) => clave.ruta)
    try {
      await window.tessera.clavesAgente.guardar(perfil.id, permitidas)
      despacharTabs({ type: 'fijarClavesSsh', perfil: perfil.id, claves: permitidas })
      alCerrar()
    } catch {
      fijarError(true)
      fijarGuardando(false)
    }
  }

  return (
    <Modal
      titulo={t.titulo(perfil.nombre)}
      tamano="m"
      onCerrar={alCerrar}
      cerrable={!guardando}
      pie={
        <PieModal>
          <button className="btn btn-ghost" onClick={alCerrar} disabled={guardando}>
            {t.cancelar}
          </button>
          <button className="btn primary" onClick={() => void guardar()} disabled={!claves || guardando}>
            {t.guardar}
          </button>
        </PieModal>
      }
    >
      <p className="modal-message">{t.descripcion}</p>
      <Cruce clave={claves === null ? 'cargando' : claves.length ? 'lista' : 'vacio'}>
        {claves === null ? (
          <p className="modal-message">{t.cargando}</p>
        ) : claves.length === 0 ? (
          <p className="modal-message">{t.vacio}</p>
        ) : (
          <Grupo titulo={t.grupo} ayuda={t.origen}>
            <div className="claves-agente-lista">
              {claves.map((clave) => (
                <FilaClave key={clave.ruta} clave={clave} deshabilitada={guardando} alternar={() => alternar(clave.ruta)} />
              ))}
            </div>
          </Grupo>
        )}
      </Cruce>
      <AvisoModal tono="info">{t.alcance}</AvisoModal>
      <Presente visible={error} className="mov-despliega">
        <AvisoModal tono="error">{t.error}</AvisoModal>
      </Presente>
    </Modal>
  )
}
