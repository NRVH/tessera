// =============================================================================
// Pruebas de disponibilidad de cuentas, estado y detección de sesión.
// Ejecuta el modelo puro y comprueba sus estados en ambos idiomas.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { tieneCuentasDocker, estadoCuenta, sesionIniciada } from './modeloCuentasConfiguracion.ts'
import { fijarIdioma } from '../../../../shared/i18n.ts'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc.ts'

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
check('Sin credencial se dice que no hay sesión', estadoCuenta({ conSesion: false }) === 'sin sesión')
check('Con credencial solo se dice que hay sesión', estadoCuenta({ conSesion: true }) === 'sesión iniciada')
const cuenta: CuentaAgente = { id: 'a', agente: 'codex', profileId: 'perfil', nombre: 'Trabajo', isDefault: false, conSesion: false }
check('No confirma sin credencial', !sesionIniciada([cuenta], 'a'))
check('No confirma si falta la cuenta', !sesionIniciada([], 'a'))
check('No confirma la sesión de otra cuenta', !sesionIniciada([{ ...cuenta, conSesion: true }], 'b'))
check('Confirma solo la cuenta solicitada', sesionIniciada([{ ...cuenta, conSesion: true }], 'a'))
check('Campo desconocido no equivale a sesión', !sesionIniciada([{ ...cuenta, conSesion: undefined }], 'a'))
check('No se afirma que una sesión desconocida esté cerrada', estadoCuenta({}) === 'sesión sin comprobar')
fijarIdioma('en')
check('El estado también nace en inglés', estadoCuenta({ conSesion: false }) === 'signed out')
console.log(`\nVEREDICTO: ${correctas}/${total} PASS`)
process.exit(correctas === total ? 0 : 1)
