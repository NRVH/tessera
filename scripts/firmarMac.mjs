// =============================================================================
// Gancho `afterSign` de electron-builder: vuelve a firmar el .app de macOS con el certificado de
// Tessera (`HUELLA_CERTIFICADO`) cuando `TESSERA_FIRMA_MAC_LLAVERO` apunta al llavero que lo
// guarda. El requisito designado sale igual en todas las versiones, y macOS conserva entre
// actualizaciones los permisos que el usuario le dio a la app. Sin llavero deja la firma ad-hoc,
// salvo con `TESSERA_FIRMA_MAC_OBLIGATORIA=1` (el workflow de publicación), que entonces falla.
// Decisiones: docs/decisiones/despliegue/firma-mac-certificado-propio.md
// =============================================================================
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Huella SHA-1 del certificado de firma de Tessera. Es lo que macOS compara entre versiones:
 * firmar con otro certificado hace que cada Mac instalado trate la versión nueva como otra app.
 */
export const HUELLA_CERTIFICADO = '4E4C715CC9E361144F6C348068D6C82474309460'

/** El `appId` de electron-builder.yml, que es el identificador del ejecutable principal. */
const IDENTIFICADOR = 'com.noe.tessera'

/**
 * La firma que toca según el entorno: `{ tipo: 'certificado', llavero }` o `{ tipo: 'adhoc' }`.
 * Lanza si el llavero indicado no existe (un error de configuración no se convierte en ad-hoc
 * en silencio) o si la firma es obligatoria y no hay llavero.
 */
export function decidirFirma(entorno, existe = existsSync) {
  const llavero = (entorno.TESSERA_FIRMA_MAC_LLAVERO ?? '').trim()
  if (llavero) {
    if (!existe(llavero)) throw new Error(`no existe el llavero de firma ${llavero} (TESSERA_FIRMA_MAC_LLAVERO)`)
    return { tipo: 'certificado', llavero }
  }
  if (entorno.TESSERA_FIRMA_MAC_OBLIGATORIA === '1') {
    throw new Error(
      'falta TESSERA_FIRMA_MAC_LLAVERO: una versión publicada de macOS se firma siempre con el certificado de Tessera'
    )
  }
  return { tipo: 'adhoc' }
}

/**
 * El requisito designado que deja el certificado, ENTERO: un identificador y la huella, sin más
 * cláusulas (un `or` añadido lo debilitaría). El certificado es autofirmado, así que es a la vez
 * hoja y raíz de su cadena, y codesign escribe una u otra según sus extensiones: las dos valen.
 */
const REQUISITO = /^designated => identifier "([^"]+)" and certificate (?:leaf|root) = H"([0-9a-fA-F]{40})"$/

/** El identificador firmado con el certificado según la salida de `codesign -d -r-`, o `null`. */
export function identificadorDelRequisito(salida, huella = HUELLA_CERTIFICADO) {
  const linea = salida
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('designated => '))
  const m = linea === undefined ? null : REQUISITO.exec(linea)
  return m !== null && m[2].toLowerCase() === huella.toLowerCase() ? m[1] : null
}

/** Si el requisito designado (`codesign -d -r-`) es exactamente el del certificado para `identificador`. */
export function requisitoDelCertificado(salida, huella = HUELLA_CERTIFICADO, identificador = IDENTIFICADOR) {
  return identificadorDelRequisito(salida, huella) === identificador
}

/** Corre una orden y devuelve su salida entera; lanza con su error si sale distinto de 0. */
function ejecutar(orden, args) {
  const r = spawnSync(orden, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${orden} ${args.join(' ')} falló: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim()}`)
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

export default async function firmarMac(contexto) {
  if (contexto.electronPlatformName !== 'darwin') return
  const firma = decidirFirma(process.env)
  if (firma.tipo === 'adhoc') {
    console.log('  • firma de macOS: ad-hoc (sin TESSERA_FIRMA_MAC_LLAVERO)')
    return
  }
  const app = join(contexto.appOutDir, `${contexto.packager.appInfo.productFilename}.app`)
  // Se conservan los entitlements y el runtime de la firma de electron-builder: `--force` los
  // sustituiría por ninguno, y con el runtime endurecido la app no arrancaría sin ellos.
  ejecutar('codesign', [
    '--force',
    '--deep',
    '--preserve-metadata=entitlements,runtime',
    '--sign',
    HUELLA_CERTIFICADO,
    '--keychain',
    firma.llavero,
    app
  ])
  ejecutar('codesign', ['--verify', '--deep', '--strict', app])
  const requisito = ejecutar('codesign', ['-d', '-r-', app])
  if (!requisitoDelCertificado(requisito)) {
    throw new Error(`el .app firmado no lleva el requisito del certificado de Tessera: ${requisito.trim()}`)
  }
  // Los procesos auxiliares son apps propias, con su identificador y su requisito.
  const marcos = join(app, 'Contents', 'Frameworks')
  for (const auxiliar of readdirSync(marcos).filter((n) => n.endsWith('.app'))) {
    const suyo = ejecutar('codesign', ['-d', '-r-', join(marcos, auxiliar)])
    if (!identificadorDelRequisito(suyo)?.startsWith(`${IDENTIFICADOR}.`)) {
      throw new Error(`${auxiliar} no lleva el requisito del certificado de Tessera: ${suyo.trim()}`)
    }
  }
  console.log(`  • firma de macOS: certificado de Tessera (${HUELLA_CERTIFICADO})`)
}
