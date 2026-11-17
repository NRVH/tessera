// =============================================================================
// El permiso de los hooks nuevos o cambiados de un repo: el preload lo pide cuando una escritura de git de la
// interfaz se detiene por ellos, y se atienden en cola, uno por repo. «Ver» despliega el contenido aquí mismo,
// porque un hook puede vivir fuera del árbol del proyecto.
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import type { HooksPendientes, ResolucionHooks } from '../../../../shared/git-ipc'
import { Modal, ModalPie } from '../../comun/Modal'
import { Grupo } from '../../comun/piezasAjustes'
import { Cruce, Presente } from '../../comun/Presente'
import './hooksGit.css'
import { txGit } from './textos'

/** Un hook pendiente: nombre, dónde está, si es nuevo o cambió, y su contenido desplegable en solo lectura. */
function FilaHook({ hook, soloRuta }: { hook: HooksPendientes['hooks'][number]; soloRuta: boolean }): React.JSX.Element {
  const [abierto, fijarAbierto] = useState(false)
  const t = txGit()
  return (
    <section className="git-hook">
      <div className="ajustes-fila git-hook-fila" title={hook.ruta}>
        <div className="ajustes-fila-texto git-hook-texto">
          <span className="ajustes-fila-etiqueta git-hook-nombre">{hook.nombre}</span>
          <span className="git-hook-ruta">{hook.ruta}</span>
        </div>
        {!soloRuta && (
          <div className="ajustes-fila-control">
            <span className={`git-hook-estado ${hook.estado}`}>{hook.estado === 'nuevo' ? t.hooksNuevo : t.hooksCambiado}</span>
            <button className="btn btn-ghost" aria-expanded={abierto} onClick={() => fijarAbierto(!abierto)}>
              {t.hooksVer}
            </button>
          </div>
        )}
      </div>
      <Presente visible={abierto && !soloRuta} className="mov-despliega">
        <pre className="git-hook-contenido" tabIndex={0}>
          {hook.contenido}
        </pre>
        {hook.truncado && <p className="git-hook-nota">{t.hooksTruncado}</p>}
      </Presente>
    </section>
  )
}

export function PermisosHooksGit(): React.JSX.Element | null {
  const [cola, fijarCola] = useState<HooksPendientes[]>([])
  useEffect(() => window.tessera.git.alPedirPermisoHooks((pendiente) => fijarCola((previa) => [...previa, pendiente])), [])
  const pendiente = cola[0]
  const cancelar = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelar.current?.focus() }, [pendiente?.ficha])
  if (!pendiente) return null
  const t = txGit()
  const incompleta = pendiente.incompleta === true
  const resolver = (decision?: ResolucionHooks['decision']): void => {
    window.tessera.git.resolverPermisoHooks(pendiente.ficha, decision)
    fijarCola((previa) => previa.slice(1))
  }
  return <Modal titulo={<Cruce clave={pendiente.ficha}>{incompleta ? t.hooksTituloIncompleta(pendiente.repo) : t.hooksTitulo(pendiente.repo)}</Cruce>} severidad={incompleta ? 'peligro' : 'advertencia'} tamano="l" onCerrar={() => resolver()} cierraConVelo={false}
    pie={<ModalPie>
      <button ref={cancelar} className="btn btn-ghost" onClick={() => resolver()}>{t.hooksCancelar}</button>
      <button className="btn" onClick={() => resolver('omitir')}>{t.hooksContinuar}</button>
      {/* Una carpeta que no se pudo inspeccionar entera no se puede aceptar: el botón no se ofrece. */}
      {!incompleta && <button className="btn primary" onClick={() => resolver('aceptar')}>{t.hooksAceptar}</button>}
    </ModalPie>}>
    <Cruce clave={pendiente.ficha} className="git-hooks-cruce">
      <p className="modal-message">{incompleta ? pendiente.hooks[0]?.contenido : t.hooksDetalleGeneral}</p>
      <Grupo titulo={t.hooksGrupo}>
        {pendiente.hooks.map((hook) => <FilaHook key={`${pendiente.ficha}/${hook.nombre}`} hook={hook} soloRuta={incompleta} />)}
      </Grupo>
    </Cruce>
  </Modal>
}
