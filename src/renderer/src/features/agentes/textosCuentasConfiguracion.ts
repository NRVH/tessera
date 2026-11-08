// =============================================================================
// Textos en español e inglés de las cuentas Docker de Configuración.
// Incluye el estado de consumo y las indicaciones del diálogo de acceso.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { crearTextos } from '../../../../shared/i18n.ts'

export const txCuentasConfiguracion = crearTextos({
  titulo: 'Cuentas de Docker',
  desplegar: (nombre: string) => `Expandir las cuentas de Docker de «${nombre}»`,
  plegar: (nombre: string) => `Contraer las cuentas de Docker de «${nombre}»`,
  numeroCuentas: (n: number) => (n === 1 ? '1 cuenta' : `${n} cuentas`),
  conSesion: 'sesión iniciada',
  sinSesion: 'sin sesión',
  sinComprobar: 'sesión sin comprobar',
  agotada: 'agotada',
  reinicio: (hora: string) => `se reinicia ${hora}`,
  estado: (sesion: string, uso: string) => uso ? `${sesion} · ${uso}` : sesion,
  uso: (ventana: string, porcentaje: string) => `${ventana} ${porcentaje}`,
  iniciar: 'Iniciar sesión',
  esperando: 'Esperando el inicio de sesión…',
  confirmado: 'Sesión iniciada',
  sinProyecto: 'Abra un proyecto de este perfil para iniciar sesión.',
  codex: 'Autorice el acceso en el navegador que abre Codex.',
  terminal: 'Siga las instrucciones de la terminal para iniciar sesión.',
  manual: 'Siga las instrucciones de la terminal para iniciar sesión. Cuando termine, cierre este diálogo.',
  errorSalida: 'La terminal del inicio de sesión terminó antes de completarlo. Haga clic en «Reintentar» para empezar de nuevo.',
  errorAcceso: 'No se pudo abrir el inicio de sesión',
  reintentar: 'Reintentar'
}, {
  titulo: 'Docker accounts',
  desplegar: (nombre: string) => `Expand Docker accounts for “${nombre}”`,
  plegar: (nombre: string) => `Collapse Docker accounts for “${nombre}”`,
  numeroCuentas: (n: number) => (n === 1 ? '1 account' : `${n} accounts`),
  conSesion: 'signed in',
  sinSesion: 'signed out',
  sinComprobar: 'sign-in status unavailable',
  agotada: 'limit reached',
  reinicio: (hora: string) => `resets at ${hora}`,
  estado: (sesion: string, uso: string) => uso ? `${sesion} · ${uso}` : sesion,
  uso: (ventana: string, porcentaje: string) => `${ventana} ${porcentaje}`,
  iniciar: 'Sign in',
  esperando: 'Waiting for sign-in…',
  confirmado: 'Signed in',
  sinProyecto: 'Open a project in this profile to sign in.',
  codex: 'Authorize access in the browser opened by Codex.',
  terminal: 'Follow the terminal instructions to sign in.',
  manual: 'Follow the terminal instructions to sign in. Close this dialog when you finish.',
  errorSalida: 'The sign-in terminal exited before finishing. Click Retry to start again.',
  errorAcceso: 'Could not open sign-in',
  reintentar: 'Retry'
})
