// =============================================================================
// Simulación para desarrollo (`TESSERA_FAKE_UPDATE`). No toca red ni instalador: recorre la
// máquina de estados para poder ver la UI sin empaquetar. `1` = ciclo hasta «preparada»;
// `available` = hasta «disponible, descarga manual» (botón con una URL de mentira);
// `aplicada` / `fallo` = siembra el aviso terminal, que de verdad solo se alcanza tras
// instalar algo. Trabaja sobre `ciclo` (`nucleo.ts`).
// =============================================================================

import { MAX_INTENTOS_UPDATE } from './marcadorUpdatePuro'
import { ciclo, preferenciaAlCerrar, setState, sistema } from './nucleo'

export function simulateUpdate(modo: string): void {
  if (modo === 'available') {
    setState({ status: 'checking' })
    setTimeout(() => {
      ciclo.feedBase = 'http://feed.de.mentira/tessera/latest'
      ciclo.urlDescargaMac = `${ciclo.feedBase}/Tessera-99.0.0-arm64.dmg`
      setState({ status: 'available', newVersion: '99.0.0', percent: 0, ultimoChequeoMs: Date.now() })
    }, 2000)
    return
  }
  if (modo === 'aplicada') {
    setState({ status: 'idle', avisoAplicada: { desde: sistema().version(), hasta: '99.0.0' } })
    return
  }
  if (modo === 'fallo') {
    setState({
      status: 'idle',
      avisoFallo: {
        versionEsperada: '99.0.0',
        intentos: MAX_INTENTOS_UPDATE,
        agotado: true,
        mensaje: null,
        detalle: null
      }
    })
    return
  }
  setState({ status: 'checking' })
  let percent = 0
  setTimeout(() => {
    setState({ status: 'downloading', newVersion: '99.0.0', percent: 0 })
    const timer = setInterval(() => {
      percent += 12
      if (percent >= 100) {
        clearInterval(timer)
        setState({
          status: 'ready',
          newVersion: '99.0.0',
          percent: 100,
          ultimoChequeoMs: Date.now(),
          seAplicaAlCerrar: preferenciaAlCerrar()
        })
      } else {
        setState({ status: 'downloading', percent })
      }
    }, 400)
  }, 2000)
}
