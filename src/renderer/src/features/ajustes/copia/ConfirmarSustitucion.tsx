// =============================================================================
// El aviso antes de importar cuando algo existente va a sustituirse: qué es y dónde, y si queda versión anterior. El foco
// empieza en «Volver a la lista», que cierra sin perder la selección.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md, docs/decisiones/renderer/modales.md
// =============================================================================
import { useEffect, useRef } from 'react'
import { Modal, PieModal } from '../../../comun/Modal'
import type { ItemSustitucion } from '../../../../../shared/sustitucionesCopia'
import { txCopia } from './textosCopia.ts'

/** Lo que dice cada línea: qué se sustituye y dónde está, con `mono` si es una ruta. */
function describir(i: ItemSustitucion, nombrePerfil: (id: string) => string): { que: string; donde: string; mono?: boolean } {
  const t = txCopia().importar.confirmar
  const ag = txCopia().agentes
  switch (i.clase) {
    case 'reglasPerfil':
      return { que: t.reglasPerfil, donde: t.enPerfil(nombrePerfil(i.perfilAqui)) }
    case 'configPerfil':
      return { que: t.configPerfil, donde: t.enPerfil(nombrePerfil(i.perfilAqui)) }
    case 'reglasGlobales':
      return { que: t.reglasGlobales, donde: t.paraTodos }
    case 'configGlobal':
      return { que: t.configGlobal, donde: t.paraTodos }
    case 'archivoCuenta': {
      const cuenta = i.predeterminada ? txCopia().predeterminada : (i.cuenta ?? '')
      return { que: i.tipo === 'instrucciones' ? t.reglasCuenta(ag[i.agente], cuenta) : t.configCuenta(ag[i.agente], cuenta), donde: t.enPerfilArchivo(nombrePerfil(i.perfilAqui), i.archivo) }
    }
    case 'reglaNativa':
      return { que: t.reglasNativa(ag[i.agente]), donde: i.archivo, mono: true }
  }
}

export function ConfirmarSustitucion(p: {
  items: readonly ItemSustitucion[]
  nombrePerfil: (id: string) => string
  onVolver: () => void
  onSustituir: () => void
}): React.JSX.Element {
  const t = txCopia().importar.confirmar
  const volverRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    volverRef.current?.focus()
  }, [])
  const recuperables = p.items.filter((i) => i.recuperable).length
  const mensaje = recuperables === p.items.length ? t.mensaje : recuperables === 0 ? t.mensajeNinguno : t.mensajeParcial
  return (
    <Modal
      titulo={t.titulo(p.items.length)}
      severidad="advertencia"
      tamano="s"
      rol="alertdialog"
      className="copia-confirmar"
      cierraConVelo={false}
      onCerrar={p.onVolver}
      pie={
        <PieModal>
          <button ref={volverRef} type="button" className="btn btn-ghost" onClick={p.onVolver}>{t.volver}</button>
          <button type="button" className="btn primary" onClick={p.onSustituir}>{t.sustituir}</button>
        </PieModal>
      }
    >
      <p className="modal-message">{mensaje}</p>
      <ul className="copia-cambios">
        {p.items.map((i, n) => {
          const d = describir(i, p.nombrePerfil)
          return (
            <li key={n}>
              <span className="copia-cambio-que">{d.que}</span>
              <span className={d.mono ? 'copia-cambio-donde copia-mono' : 'copia-cambio-donde'}>{d.donde}</span>
              {!i.recuperable && <span className="copia-cambio-aviso">{t.noRecuperable}</span>}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
