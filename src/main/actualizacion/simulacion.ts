// =============================================================================
// Simulación para desarrollo (`TESSERA_FAKE_UPDATE`). No toca red ni instalador: recorre la
// máquina de estados para poder ver la UI sin empaquetar. `1` = ciclo hasta «preparada»;
// `available` = hasta «disponible, descarga manual» (botón con una URL de mentira);
// `aplicada` / `fallo` = siembra el aviso terminal, que de verdad solo se alcanza tras
// instalar algo. Trabaja sobre `ciclo` (`nucleo.ts`).
// =============================================================================

import { MAX_INTENTOS_ACTUALIZACION } from './marcadorActualizacionPuro'
import { ciclo, preferenciaAlCerrar, fijarEstado, sistema } from './nucleo'

export function simularActualizacion(modo: string): void {
  if (modo === 'available') {
    fijarEstado({ fase: 'checking' })
    setTimeout(() => {
      ciclo.feedBase = 'http://feed.de.mentira/tessera/latest'
      ciclo.urlDescargaMac = `${ciclo.feedBase}/Tessera-99.0.0-arm64.dmg`
      fijarEstado({ fase: 'available', newVersion: '99.0.0', percent: 0, ultimoChequeoMs: Date.now() })
    }, 2000)
    return
  }
  if (modo === 'aplicada') {
    fijarEstado({ fase: 'idle', avisoAplicada: { desde: sistema().version(), hasta: '99.0.0' } })
    return
  }
  if (modo === 'fallo') {
    fijarEstado({
      fase: 'idle',
      avisoFallo: {
        versionEsperada: '99.0.0',
        intentos: MAX_INTENTOS_ACTUALIZACION,
        agotado: true,
        mensaje: null,
        detalle: null
      }
    })
    return
  }
  fijarEstado({ fase: 'checking' })
  let porcentaje = 0
  setTimeout(() => {
    fijarEstado({ fase: 'downloading', newVersion: '99.0.0', percent: 0 })
    const temporizador = setInterval(() => {
      porcentaje += 12
      if (porcentaje >= 100) {
        clearInterval(temporizador)
        fijarEstado({
          fase: 'ready',
          newVersion: '99.0.0',
          percent: 100,
          ultimoChequeoMs: Date.now(),
          seAplicaAlCerrar: preferenciaAlCerrar()
        })
      } else {
        fijarEstado({ fase: 'downloading', percent: porcentaje })
      }
    }, 400)
  }, 2000)
}
