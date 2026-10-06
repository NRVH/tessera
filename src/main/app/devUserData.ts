// =============================================================================
// Aísla el `userData` de DESARROLLO en `Tessera-dev`, para que `npm run dev` y la
// app instalada no compartan carpeta, y la primera vez lo siembra desde la compartida.
// Depende de `electron` (`app.setPath`); lo llama `proceso.ts` al cargar.
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================

import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Carpeta de datos de la instancia de desarrollo, hermana de la compartida. */
const DEV_DIR_NAME = 'Tessera-dev'

/**
 * Qué se copia al sembrar. Lista BLANCA a propósito: la carpeta de la app también
 * contiene las cachés de Chromium (`Cache`, `GPUCache`, `blob_storage`…), que son
 * grandes, desechables y a veces están bloqueadas por el proceso instalado. Copiar
 * "todo menos lo que se me ocurra excluir" habría arrastrado eso.
 */
const SEMILLA_ARCHIVOS = [
  // `Local State` NO es opcional aunque lo parezca (es un archivo de Chromium, no
  // nuestro): dentro vive `os_crypt.encrypted_key`, la clave con la que safeStorage
  // cifra las contraseñas de las conexiones. Sin copiarla, la instancia de desarrollo
  // genera una clave NUEVA y todas las contraseñas del registro copiado quedan
  // indescifrables: el registro se lee, las conexiones se listan, y solo al intentar
  // conectar sale un "no hay contraseña" que no se parece en nada a la causa.
  // Medido: sin esto, el primer arranque de dev registraba `secretos=0/2`.
  'Local State',
  'profiles.json',
  'agent-accounts.json',
  'db-connections.json',
  'db-drivers.json',
  'ssh-connections.json',
  'workspace-state.json',
  'conversation-titles.json'
]

/**
 * Carpetas que se copian enteras. `drivers` pesa (~40 MB con un Instant Client) y
 * se copia igualmente: sin él, la instancia de desarrollo NO puede probar las bases
 * Oracle 11g —que exigen modo thick— y justo eso es lo que hay que poder probar.
 * `.tessera` lleva las credenciales de los agentes: sin ella habría que re-loguear
 * cada cuenta en dev, que es fricción suficiente para que nadie use la separación.
 * `ssh` lleva las huellas aceptadas y las claves importadas de las conexiones SSH, y
 * `terminal` la carpeta del agente de la terminal de cada perfil, con su contexto y sus notas.
 */
const SEMILLA_CARPETAS = ['.tessera', 'conexiones', 'drivers', 'ssh', 'terminal']

/**
 * En DESARROLLO, reapunta `userData` a una carpeta propia. No-op en la app
 * empaquetada.
 *
 * Debe llamarse ANTES de cualquier `app.getPath('userData')` y antes de que la app
 * esté lista: a partir de `ready`, Chromium ya ha abierto archivos bajo la ruta
 * vieja y moverla deja de tener efecto sobre ellos.
 *
 * Devuelve la ruta efectiva, para poder registrarla.
 */
export function aislarUserDataEnDesarrollo(log: (msg: string) => void = console.log): string {
  if (app.isPackaged) return app.getPath('userData')

  const compartida = app.getPath('userData')
  const propia = join(app.getPath('appData'), DEV_DIR_NAME)
  const primeraVez = !existsSync(propia)

  app.setPath('userData', propia)
  mkdirSync(propia, { recursive: true })

  if (primeraVez) sembrar(compartida, propia, log)
  log(`[tessera] DESARROLLO: userData aislado en ${propia}`)
  return propia
}

/**
 * Copia los datos de la carpeta compartida a la de desarrollo. Best-effort por
 * entrada: que falle una (un archivo bloqueado por la instancia instalada) no debe
 * impedir arrancar ni abortar el resto de la siembra.
 */
function sembrar(origen: string, destino: string, log: (msg: string) => void): void {
  if (!existsSync(origen)) return
  log(`[tessera] DESARROLLO: sembrando userData desde ${origen} (solo esta vez)…`)
  let copiados = 0

  for (const nombre of SEMILLA_ARCHIVOS) {
    const src = join(origen, nombre)
    if (!existsSync(src)) continue
    try {
      cpSync(src, join(destino, nombre))
      copiados++
    } catch (err) {
      log(`[tessera] DESARROLLO: no se pudo sembrar ${nombre}: ${String(err)}`)
    }
  }

  for (const nombre of SEMILLA_CARPETAS) {
    const src = join(origen, nombre)
    if (!existsSync(src)) continue
    try {
      if (!statSync(src).isDirectory()) continue
      cpSync(src, join(destino, nombre), { recursive: true })
      copiados++
    } catch (err) {
      log(`[tessera] DESARROLLO: no se pudo sembrar la carpeta ${nombre}: ${String(err)}`)
    }
  }

  log(`[tessera] DESARROLLO: siembra terminada (${copiados} entradas).`)
}
