// =============================================================================
// Configuración pública del contenedor: conserva alias y rutas públicas autorizadas.
// Filtra las directivas y genera nombres de públicas para conectar sin trasladar secretos del host.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { createHash } from 'node:crypto'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { argumentosOpenSsh, rutaIdentidad } from '../configOpenSsh.ts'

export interface EntornoConfig { home: string; usuario: string; plataforma: Plataforma }
export function analizarLinea(linea: string): { opcion: string; argumentos: string[] } | null {
  const partes = linea.match(/^\s*([a-z][a-z0-9]*)(?:\s*=\s*|\s+)(.*)$/i)
  return partes ? { opcion: partes[1].toLowerCase(), argumentos: argumentosOpenSsh(partes[2]) } : null
}

export function identidadesConfig(texto: string, entorno: EntornoConfig): { ruta: string; alias: string[] }[] {
  let alias: string[] = []
  const identidades: { ruta: string; alias: string[] }[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const parte = analizarLinea(linea)
    if (parte?.opcion === 'host') alias = parte.argumentos
    if (parte?.opcion === 'match') alias = []
    if (parte?.opcion !== 'identityfile' || !parte.argumentos[0]) continue
    const ruta = rutaIdentidad(parte.argumentos[0], entorno)
    if (ruta && !ruta.includes('%')) identidades.push({ ruta, alias: [...alias] })
  }
  return identidades
}

export function nombrePublica(ruta: string): string {
  return createHash('sha256').update(ruta).digest('hex') + '.pub'
}

const OPCIONES = new Set(['host', 'hostname', 'user', 'port', 'proxyjump', 'addressfamily', 'compression', 'connecttimeout', 'serveraliveinterval', 'serveralivecountmax', 'hostkeyalgorithms', 'pubkeyacceptedalgorithms', 'kexalgorithms', 'ciphers', 'macs', 'hostkeyalias', 'canonicalizehostname', 'canonicaldomains'])

export function configPublico(texto: string, entorno: EntornoConfig, permitidas: readonly string[]): string {
  const salida = ['IgnoreUnknown UseKeychain', 'IdentityAgent SSH_AUTH_SOCK', 'ForwardAgent no']
  const conocidas = new Set(permitidas)
  let omitirBloque = false
  let bloqueGeneral = true
  for (const linea of texto.split(/\r?\n/)) {
    const parte = analizarLinea(linea)
    if (!parte) continue
    if (parte.opcion === 'host') {
      omitirBloque = false
      bloqueGeneral = parte.argumentos.includes('*')
    }
    if (parte.opcion === 'match') {
      bloqueGeneral = parte.argumentos.length === 1 && parte.argumentos[0].toLowerCase() === 'all'
      omitirBloque = parte.argumentos.some((argumento) => /^!?exec$/i.test(argumento))
      salida.push(omitirBloque ? 'Host !*' : linea)
      continue
    }
    if (omitirBloque) continue
    if (parte.opcion === 'identityfile') {
      const argumento = parte.argumentos[0] ?? 'none'
      if (argumento.toLowerCase() === 'none') continue
      // Va en el bloque que eligió la identidad, también si esa clave no está permitida: esos destinos no prueban otra.
      // Un bloque general no elige destino: ataría todos los servidores a una clave que puede estar desactivada.
      if (!bloqueGeneral) salida.push('    IdentitiesOnly yes')
      const ruta = rutaIdentidad(argumento, entorno)
      if (ruta && conocidas.has(ruta)) salida.push(`    IdentityFile /home/agente/.ssh/${nombrePublica(ruta)}`)
    } else if (OPCIONES.has(parte.opcion)) salida.push(linea)
  }
  // Un destino sin identidad propia no llega con `IdentitiesOnly`: ssh le ofrece lo que liste el agente, que son las
  // claves permitidas del perfil. Quién coincide con cada bloque lo resuelve ssh, comodines y `Match` incluidos.
  salida.push('Host *', '    IdentityFile none', '    UserKnownHostsFile /home/agente/.ssh/known_hosts', '    StrictHostKeyChecking accept-new')
  return salida.join('\n') + '\n'
}

const NOMBRES_ESTANDAR = ['id_rsa', 'id_ecdsa', 'id_ecdsa_sk', 'id_ed25519', 'id_ed25519_sk', 'id_dsa']

/** Primero las claves de nombre estándar, en el orden de ssh: un servidor con varias cuentas se queda con la primera que acepta. */
export function primeroLasEstandar<T extends { nombre: string }>(claves: readonly T[]): T[] {
  const orden = (clave: T): number => {
    const indice = NOMBRES_ESTANDAR.indexOf(clave.nombre)
    return indice === -1 ? NOMBRES_ESTANDAR.length : indice
  }
  return [...claves].sort((a, b) => orden(a) - orden(b))
}
