// =============================================================================
// Pruebas de disponibilidad de cuentas, consumo y detección de sesión.
// Ejecuta el modelo puro y comprueba sus estados en ambos idiomas.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { tieneCuentasDocker, estadoCuenta, sesionIniciada } from './modeloCuentasConfiguracion.ts'
import { fijarIdioma } from '../../../../shared/i18n.ts'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc.ts'

let total = 0
let correctas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(nombre: string, condicion: boolean): void {
  total++
  if (condicion) correctas++
  console.log(`[${condicion ? 'PASS' : 'FAIL'}] ${nombre}`)
}
hr('Cuentas de Docker en Configuración')
fijarIdioma('es')
check('Los agentes de serie tienen cuentas aunque estén ocultos', tieneCuentasDocker('serie'))
check('Un manual Docker tiene cuentas', tieneCuentasDocker('docker'))
check('Un manual nativo no tiene cuentas', !tieneCuentasDocker('nativo'))
check('Sin credencial no se enseña consumo', estadoCuenta({ conSesion: false }, { windows: [{ key: 'a', label: '5h', percent: 99 }] }) === 'sin sesión')
check('Sin uso se conserva la sesión', estadoCuenta({ conSesion: true }, null) === 'sesión iniciada')
check('Se elige la ventana más consumida', estadoCuenta({ conSesion: true }, { windows: [
  { key: 'a', label: '5h', percent: 22 }, { key: 'b', label: '7d', percent: 92 }
] }) === 'sesión iniciada · 7d 92%')
check('95 % aún no está agotada', estadoCuenta({ conSesion: true }, { windows: [{ key: 'a', label: '5h', percent: 95 }] }).startsWith('sesión iniciada'))
check('Más del 95 % sin reinicio conocido', estadoCuenta({ conSesion: true }, { windows: [{ key: 'a', label: '5h', percent: 96 }] }) === 'agotada')
check('Más del 95 % enseña el reinicio', estadoCuenta({ conSesion: true }, { windows: [{ key: 'a', label: '5h', percent: 99, resetsAt: 2_000_000_000_000 }] }).startsWith('agotada · se reinicia '))
const cuenta: AgentAccount = { id: 'a', agente: 'codex', profileId: 'perfil', nombre: 'Trabajo', isDefault: false, conSesion: false }
check('No confirma sin credencial', !sesionIniciada([cuenta], 'a'))
check('No confirma si falta la cuenta', !sesionIniciada([], 'a'))
check('No confirma la sesión de otra cuenta', !sesionIniciada([{ ...cuenta, conSesion: true }], 'b'))
check('Confirma solo la cuenta solicitada', sesionIniciada([{ ...cuenta, conSesion: true }], 'a'))
check('Campo desconocido no equivale a sesión', !sesionIniciada([{ ...cuenta, conSesion: undefined }], 'a'))
check('No se afirma que una sesión desconocida esté cerrada', estadoCuenta({}, null) === 'sesión sin comprobar')
fijarIdioma('en')
check('El estado también nace en inglés', estadoCuenta({ conSesion: false }, null) === 'signed out')
console.log(`\nVEREDICTO: ${correctas}/${total} PASS`)
process.exit(correctas === total ? 0 : 1)
