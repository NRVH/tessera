// =============================================================================
// Lo que se enseña al importar de OpenSSH, sin efectos: con un solo `Host`, cómo se rellena el formulario de
// alta (y qué nota lo acompaña); con varios, las filas de la revisión con su credencial (método, contraseña
// o archivo de clave), sus problemas (nombre vacío, repetido o ya usado, sin usuario, sin archivo, puerto que
// no es número) y el alta de cada fila elegida. Lo usan
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
    error: null
  }))
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

/** El alta de una fila con su método: el secreto solo si se escribió (y nunca con las claves del sistema). */
export function entradaDeFila(f: FilaImportacion, perfilId: string, grupoId: string | null): SshConexionInput {
  const c = f.candidata
  const base = { profileId: perfilId, alias: f.alias.trim(), grupoId, host: c.host, puerto: c.puerto ?? 22, usuario: f.usuario.trim(), disponibleAgentes: true }
  const secreto = f.secreto !== '' ? { secreto: f.secreto } : {}
  if (f.metodo === 'sistema') return { ...base, metodo: 'sistema' }
  if (f.metodo === 'clave' && f.clave) return { ...base, metodo: 'clave', clave: { tipo: 'elegida', token: f.clave.token }, ...secreto }
  return { ...base, metodo: 'contrasena', ...secreto }
}

/** ¿Se escribe aquí un secreto? La contraseña, o la frase de una clave que la tiene. */
export function pideSecreto(f: FilaImportacion): boolean {
  return f.metodo === 'contrasena' || (f.metodo === 'clave' && f.clave?.cifrada === true)
}

/** El aviso al terminar: cuántas entraron y en qué grupo. */
export function tituloImportadas(n: number, grupo: string | null): string {
  const donde = grupo === null ? 'en «Sin grupo»' : `en «${grupo}»`
  return n === 1 ? `Se importó 1 conexión SSH ${donde}` : `Se importaron ${n} conexiones SSH ${donde}`
}
