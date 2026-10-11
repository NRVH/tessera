// =============================================================================
// Lo que se enseña al importar de OpenSSH, sin efectos: con un solo `Host`, cómo se rellena el formulario de
// alta (y qué nota lo acompaña); con varios, las filas de la revisión con su credencial (método, contraseña
// o archivo de clave), sus problemas (nombre vacío, repetido o ya usado, sin usuario, sin archivo, puerto que
// no es número), el grupo de cada una y el alta de cada fila elegida. Lo usan
// `DialogoConexionSsh`, `DialogoImportarOpenSsh` e `importacionSsh.ts`; lo prueba `test-importacion-openssh.mts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import type { SshCandidataOpenSsh, SshClaveElegida, SshConexionInput, SshLecturaOpenSsh, SshMetodo } from '../../../../shared/ssh-ipc.ts'
import type { BorradorSsh } from './borradorSsh.ts'

/** Lo que el formulario de alta recibe de una lectura con un solo `Host`: sus campos y la nota que lo explica. */
export interface ImportacionEnFormulario {
  prefijo: Partial<BorradorSsh>
  nota: string
}

/** Los campos del formulario que trae un `Host`: el método es el archivo de clave si se pudo importar. */
export function prefijoDeCandidata(c: SshCandidataOpenSsh): Partial<BorradorSsh> {
  return {
    alias: c.alias,
    host: c.host,
    puerto: c.puerto === null ? '' : String(c.puerto),
    usuario: c.usuario,
    metodo: c.clave ? 'clave' : 'sistema',
    clave: c.clave ? { nombre: c.clave.nombre, tipo: c.clave.tipo, cifrada: c.clave.cifrada, token: c.clave.token } : null
  }
}

/** Lo que falta revisar de un `Host`, en frases cortas. */
function pendientesDe(c: SshCandidataOpenSsh): string[] {
  return [
    c.existe ? 'ya hay una conexión con ese nombre: cámbialo' : '',
    c.usuario === '' ? 'el archivo no trae el usuario' : '',
    c.puerto === null ? 'el puerto no es un número' : '',
    c.claveNoUsable ? 'su archivo de clave no se pudo usar: entra con las claves del sistema' : ''
  ].filter((p) => p !== '')
}

/** El formulario relleno con el único `Host` de una lectura. */
export function importacionEnFormulario(l: SshLecturaOpenSsh): ImportacionEnFormulario {
  const c = l.candidatas[0]
  const pendientes = pendientesDe(c)
  const base = `Datos de «${c.alias}» leídos de «${l.archivo}». Revisa, elige el grupo y guarda.`
  return { prefijo: prefijoDeCandidata(c), nota: pendientes.length > 0 ? `${base} Ojo: ${pendientes.join('; ')}.` : base }
}

/** Lo que el archivo trae y no se importa (comodines, `Match`, `Include`), o `null` si nada. */
export function textoNoSeImporta(l: SshLecturaOpenSsh): string | null {
  const partes = [
    l.conPatrones === 1 ? '1 bloque con comodines o Match' : l.conPatrones > 1 ? `${l.conPatrones} bloques con comodines o Match` : '',
    l.include > 0 ? `${l.include} Include (no se siguen)` : ''
  ].filter((p) => p !== '')
  return partes.length > 0 ? `No se importa: ${partes.join(' y ')}.` : null
}

/** Por qué no hay nada que revisar en una lectura sin `Host` concretos. */
export function motivoSinCandidatas(l: SshLecturaOpenSsh): string {
  return `«${l.archivo}» no tiene ningún Host concreto que importar.${textoNoSeImporta(l) ? ` ${textoNoSeImporta(l)}` : ''}`
}

/** Una fila de la revisión: el `Host` leído, si se importa y lo que se puede cambiar, credencial incluida. */
export interface FilaImportacion {
  candidata: SshCandidataOpenSsh
  elegida: boolean
  alias: string
  usuario: string
  metodo: SshMetodo
  /** La contraseña o, con archivo de clave, su frase: '' = no se guarda (la pedirá la terminal). */
  secreto: string
  /** El archivo de clave: el del `IdentityFile` o uno elegido aquí, con su ficha. */
  clave: SshClaveElegida | null
  /** El grupo al que va: `null` = «Sin grupo». */
  grupoId: string | null
  /** El error del alta, si falló al importar. */
  error: string | null
}

/**
 * Las filas de una lectura: elegidas las que se pueden importar tal cual. El método, el archivo de clave si el
 * `Host` lo trae y, si no, las claves del sistema: es como entra ese `Host` con OpenSSH, y la contraseña
 * desactiva la clave pública, así que darla por defecto rompería los que entran con el agente.
 */
export function filasIniciales(l: SshLecturaOpenSsh): FilaImportacion[] {
  return l.candidatas.map((c) => ({
    candidata: c,
    elegida: !c.existe && c.usuario !== '' && c.puerto !== null,
    alias: c.alias,
    usuario: c.usuario,
    metodo: c.clave ? 'clave' : 'sistema',
    secreto: '',
    clave: c.clave,
    grupoId: null,
    error: null
  }))
}

/**
 * Las filas MARCADAS al mismo grupo: el atajo para no elegirlo fila a fila. Las desmarcadas no se importan, y
 * tocarlas haría creer que sí.
 */
export function conGrupoEnMarcadas(filas: readonly FilaImportacion[], grupoId: string | null): FilaImportacion[] {
  return filas.map((f) => (f.elegida ? { ...f, grupoId, error: null } : f))
}

/**
 * Marca o desmarca la fila `i`. Al marcarla entra en el grupo que comparten las marcadas (si van a varios, en
 * «Sin grupo»); al desmarcarla vuelve a «Sin grupo», como todo lo que no se importa.
 */
export function conMarca(filas: readonly FilaImportacion[], i: number, elegida: boolean): FilaImportacion[] {
  const comun = grupoComun(filas)
  const grupoId = elegida ? (comun ?? null) : null
  return filas.map((f, j) => (j === i ? { ...f, elegida, grupoId, error: null } : f))
}

/** El grupo que comparten las filas marcadas (`null` sin ninguna marcada); `undefined` si van a grupos distintos. */
export function grupoComun(filas: readonly FilaImportacion[]): string | null | undefined {
  const grupos = new Set(filas.filter((f) => f.elegida).map((f) => f.grupoId))
  if (grupos.size === 0) return null
  return grupos.size === 1 ? [...grupos][0] : undefined
}

/** El grupo de una fila si aún existe; si se borró mientras se revisaba, «Sin grupo». */
export function grupoVigente(f: FilaImportacion, existentes: ReadonlySet<string>): string | null {
  return f.grupoId !== null && existentes.has(f.grupoId) ? f.grupoId : null
}

const clave = (alias: string): string => alias.trim().toLowerCase()

/**
 * Lo que impide importar una fila elegida, o `null`. `existentes`: los nombres del perfil; `filas`, todas,
 * para no elegir dos con el mismo nombre.
 */
export function problemaDeFila(f: FilaImportacion, filas: readonly FilaImportacion[], existentes: readonly string[]): string | null {
  if (f.candidata.puerto === null) return 'El puerto del archivo no es un número.'
  if (f.alias.trim() === '') return 'Ponle un nombre.'
  if (f.usuario.trim() === '') return 'Falta el usuario.'
  if (f.metodo === 'clave' && f.clave === null) return 'Elige el archivo de clave.'
  if (existentes.some((e) => clave(e) === clave(f.alias))) return 'Ya hay una conexión con ese nombre.'
  const repetidas = filas.filter((x) => x.elegida && clave(x.alias) === clave(f.alias))
  return repetidas.length > 1 ? 'Hay otra con el mismo nombre.' : null
}

/** Cuántas se van a importar y si se puede: alguna elegida y ninguna elegida con problemas. */
export function resumenImportacion(filas: readonly FilaImportacion[], existentes: readonly string[]): { elegidas: number; listo: boolean } {
  const elegidas = filas.filter((f) => f.elegida)
  return { elegidas: elegidas.length, listo: elegidas.length > 0 && elegidas.every((f) => problemaDeFila(f, filas, existentes) === null) }
}

/** El alta de una fila con su método y su grupo: el secreto solo si se escribió (y nunca con las claves del sistema). */
export function entradaDeFila(f: FilaImportacion, perfilId: string): SshConexionInput {
  const c = f.candidata
  const base = { profileId: perfilId, alias: f.alias.trim(), grupoId: f.grupoId, host: c.host, puerto: c.puerto ?? 22, usuario: f.usuario.trim(), disponibleAgentes: true }
  const secreto = f.secreto !== '' ? { secreto: f.secreto } : {}
  if (f.metodo === 'sistema') return { ...base, metodo: 'sistema' }
  if (f.metodo === 'clave' && f.clave) return { ...base, metodo: 'clave', clave: { tipo: 'elegida', token: f.clave.token }, ...secreto }
  return { ...base, metodo: 'contrasena', ...secreto }
}

/** ¿Se escribe aquí un secreto? La contraseña, o la frase de una clave que la tiene. */
export function pideSecreto(f: FilaImportacion): boolean {
  return f.metodo === 'contrasena' || (f.metodo === 'clave' && f.clave?.cifrada === true)
}

/**
 * El aviso al terminar: cuántas entraron y en qué grupo, con el nombre del grupo de cada importada (`null` =
 * «Sin grupo»). Si van a varios, el reparto, del grupo con más al de menos.
 */
export function tituloImportadas(grupos: readonly (string | null)[]): string {
  const n = grupos.length
  const cuantas = n === 1 ? 'Se importó 1 conexión SSH' : `Se importaron ${n} conexiones SSH`
  const nombre = (g: string | null): string => `«${g ?? 'Sin grupo'}»`
  const cuenta = new Map<string | null, number>()
  for (const g of grupos) cuenta.set(g, (cuenta.get(g) ?? 0) + 1)
  if (cuenta.size <= 1) return `${cuantas} en ${nombre(grupos[0] ?? null)}`
  const partes = [...cuenta].sort((a, b) => b[1] - a[1]).map(([g, k]) => `${k} en ${nombre(g)}`)
  return `${cuantas}: ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}
