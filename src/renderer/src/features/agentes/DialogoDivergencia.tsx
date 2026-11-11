// =============================================================================
// Elección de la copia que se reanuda, con confirmación en el botón y conservación de la otra.
// Se monta una vez en App y bloquea el cierre mientras se prepara el destino.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './divergencia.css'
import '../../comun/botonGuardar.css'
import { useEffect, useRef, useState } from 'react'
import { localeActual } from '../../../../shared/i18n'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { EleccionDivergencia } from '../../../../shared/traspaso-ipc'
import { Modal, PieModal } from '../../comun/Modal'
import { Cruce } from '../../comun/Presente'
import { continuarEn } from './continuarEn'
import { IconoContenedor, IconoEquipo } from './iconosAgentPane'
import { masReciente, nombresDeLados, ordenBotones } from './modeloDivergencia'
import { cerrarDivergencia, useStoreDivergencia, type Divergencia } from './storeDivergencia'
import { txTraspaso } from './textosTraspaso'

function TarjetaDivergencia({ abierta, lado, reciente, lugar }: {
  abierta: Divergencia; lado: EleccionDivergencia; reciente: EleccionDivergencia; lugar: string
}): React.JSX.Element {
  const t = txTraspaso()
  const extremo = abierta.lados[lado]
  const copia = abierta.copias[lado]
  const nombre = extremo.modo === 'nativo' ? t.tarjetaEquipo : t.tarjetaDocker(extremo.nombre)
  const fecha = new Intl.DateTimeFormat(localeActual(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return <section className="divergencia-copia" data-lado={lado}>
    <div className="divergencia-fila">
      {extremo.modo === 'nativo' ? <IconoEquipo /> : <IconoContenedor />}
      <strong title={nombre}>{nombre}</strong>
      <span className="divergencia-datos">{t.datosCopia(copia.modificada === null ? t.sinFecha : fecha.format(copia.modificada), copia.mensajes === null ? null : t.mensajes(copia.mensajes))}</span>
    </div>
    <div className="divergencia-detalle">
      <span>{lado === 'origen' ? t.desdeDonde : t.yaEsta(lugar)}</span>
      {reciente === lado && <span className="divergencia-reciente">{t.masReciente}</span>}
    </div>
  </section>
}

export function DialogoDivergencia({ abierta }: { abierta: Divergencia }): React.JSX.Element {
  const t = txTraspaso()
  const sistema = nombresSistema(window.tessera.plataforma)
  const nombres = nombresDeLados(abierta.lados.origen, abierta.lados.destino, {
    tuEquipo: sistema.tuEquipo, docker: t.docker, cuenta: t.cuentaLugar, citada: txTraspaso().cuentaCitada
  })
  const reciente = masReciente(abierta.copias)
  const orden = ordenBotones(reciente)
  const [pulsado, setPulsado] = useState<EleccionDivergencia | null>(null)
  const [exito, setExito] = useState(false)
  const bloqueo = useRef(false)
  const temporizador = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(temporizador.current), [])
  const ocupado = pulsado !== null
  const elegir = async (eleccion: EleccionDivergencia): Promise<void> => {
    if (bloqueo.current) return
    bloqueo.current = true
    setPulsado(eleccion)
    const ok = await continuarEn(abierta.origen, abierta.sessionId, abierta.destino, { lados: abierta.lados, divergencia: eleccion })
    if (ok) {
      setExito(true)
      temporizador.current = setTimeout(cerrarDivergencia, 700)
    } else {
      bloqueo.current = false
      setPulsado(null)
    }
  }
  return (
    <Modal tamano="m" severidad="advertencia" rol="alertdialog" className="divergencia"
      cuerpoClassName="divergencia-cuerpo" titulo={t.divergenciaTitulo(nombres.lugar)}
      ocupado={ocupado} cerrable={!ocupado} cierraConVelo={false} onCerrar={cerrarDivergencia}
      pie={<PieModal auxiliares={<button type="button" className="btn" disabled={ocupado} onClick={cerrarDivergencia}>{t.cancelar}</button>}>
        {orden.map((lado, i) => {
          const ok = exito && pulsado === lado
          const preparando = pulsado === lado
          return <button key={lado} type="button" data-conserva={lado}
            className={`btn${i === orden.length - 1 ? ' primary' : ''} boton-guardar${ok ? ' ok' : ''}`}
            disabled={ocupado} aria-label={ok ? t.hecho : undefined} onClick={() => void elegir(lado)}>
            <span className="boton-guardar-capa reposo" aria-hidden={ok}>
              <Cruce clave={preparando ? 'preparando' : 'elegir'}>{preparando ? t.preparando : t.continuarConLaDe(nombres[lado])}</Cruce>
            </span>
            <span className="boton-guardar-capa exito" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path className="boton-guardar-palomita" d="M3 8.5l3.2 3L13 4.5" pathLength={1} />
              </svg>
            </span>
          </button>
        })}
        <span className="solo-lectores" role="status">{exito ? t.hecho : ''}</span>
      </PieModal>}>
      <p>{t.divergenciaTexto(nombres.lugar)}</p>
      <div className="divergencia-copias">
        {(['origen', 'destino'] as const).map((lado) =>
          <TarjetaDivergencia key={lado} abierta={abierta} lado={lado} reciente={reciente} lugar={nombres.lugar} />
        )}
      </div>
      <p className="divergencia-nota">{t.notaApartar(nombres.origen, nombres.lugar)}</p>
    </Modal>
  )
}

export function CapaDivergencia(): React.JSX.Element | null {
  const abierta = useStoreDivergencia((s) => s.abierta)
  return abierta ? <DialogoDivergencia key={`${abierta.sessionId}:${abierta.destino.accountId ?? abierta.destino.modo}`} abierta={abierta} /> : null
}
