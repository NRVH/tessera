// =============================================================================
// Contrato IPC del explorador para motores de CLAVES (Redis): canales KV, forma de las claves y
// valores, y los motivos de rechazo. Aparte del SQL; reutiliza de él la conexión y `DbRespuesta`.
// Hoja del grafo: solo `import type`; neutral y ES2020 (lo importan main, preload y renderer).
// Decisiones: docs/decisiones/bd/contratos-claves.md
// =============================================================================

import type { DbRespuesta } from './db-explorador-ipc.ts'

export const KV_CHANNELS = {
  /**
   * invoke: DbKvPedirBases -> DbRespuesta<DbKvBases>. Cuántas bases hay (`CONFIG GET
   * databases`, o `claves.basesPorDefecto` del descriptor si da NOPERM) y las que tienen
   * claves (`INFO keyspace`).
   */
  BASES: 'kv:bases',
  /** invoke: DbKvEscanear -> DbRespuesta<DbKvPaginaClaves>. Una vuelta de SCAN con patrón. */
  ESCANEAR: 'kv:escanear',
  /** invoke: DbKvPedirValor -> DbRespuesta<DbKvValor>. El valor de una clave según su tipo, por trozos. */
  VALOR: 'kv:valor',
  /** invoke: DbKvEjecutar -> DbRespuesta<DbKvResultado>. Un comando de la consola (D5). */
  CONSOLA_EJECUTAR: 'kv:consola:ejecutar'
} as const

/** Unos bytes de Redis (una clave, un campo, un valor): el texto si es UTF-8 válido y siempre el base64. */
export interface DbKvBytes {
  /** El texto, si los bytes son UTF-8 válido; ausente si no (el visor enseña el hex). */
  texto?: string
  /** Los bytes exactos: es lo que vuelve al main para pedir esa clave. */
  base64: string
}

/** Los tipos que el visor distingue (`TYPE`; `ReJSON-RL` es 'json'). */
export type DbKvTipo = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'json' | 'otro'

export interface DbKvBases {
  /** Cuántas bases numeradas hay (0…total-1). */
  total: number
  /** ¿Salió `total` del servidor (CONFIG GET) o del descriptor (sin permiso)? */
  totalDelServidor: boolean
  /** Las bases con claves (`INFO keyspace`): número, claves y cuántas caducan. */
  conClaves: { indice: number; claves: number; caducan: number }[]
  /**
   * `INFO keyspace` no se pudo leer (NOPERM con un ACL de lectura): `conClaves` va
   * vacío y NO significa «sin claves». El árbol no pinta conteos y escanea igual.
   */
  conteosDesconocidos?: true
}

export interface DbKvClave {
  nombre: DbKvBytes
  tipo: DbKvTipo
  /** El nombre del tipo tal cual si es 'otro' (un módulo: `TSDB-TYPE`…). */
  tipoServidor?: string
  /** Milisegundos hasta caducar (`PTTL`); null = no caduca. */
  ttlMs: number | null
}

export interface DbKvPaginaClaves {
  /** El cursor para la vuelta siguiente; '0' = se recorrió todo. */
  cursor: string
  claves: DbKvClave[]
  ms: number
}

export interface DbKvPedirBases {
  conexionId: string
}

export interface DbKvEscanear {
  conexionId: string
  base: number
  /** Patrón de MATCH (`usuario:*`); '' = `*`. */
  patron: string
  /** '0' la primera vez; después, el de la página anterior. */
  cursor: string
  /** El COUNT de SCAN (una pista para el servidor, no un tope exacto). */
  cuenta: number
  /** Solo claves de este tipo (`SCAN … TYPE`, Redis 6+). */
  tipo?: DbKvTipo
  peticionId?: string
}

export interface DbKvPedirValor {
  conexionId: string
  base: number
  clave: DbKvBytes
  /** Para los tipos con elementos (hash, list, set, zset, stream): desde dónde (índice o cursor). */
  desde?: string
  /** Cuántos elementos como mucho. */
  cuantos?: number
  peticionId?: string
}

/** El valor de una clave, según su tipo. Los tipos con elementos llegan POR TROZOS. */
export type DbKvContenido =
  /** `bytes` es el tamaño ENTERO (STRLEN); `truncado`, si `valor` es solo el principio (GETRANGE). */
  | { tipo: 'string'; valor: DbKvBytes; bytes: number; truncado: boolean }
  | { tipo: 'hash'; pares: { campo: DbKvBytes; valor: DbKvBytes }[]; total: number; siguiente: string | null }
  | { tipo: 'list'; elementos: DbKvBytes[]; total: number; siguiente: string | null }
  | { tipo: 'set'; miembros: DbKvBytes[]; total: number; siguiente: string | null }
  | { tipo: 'zset'; miembros: { miembro: DbKvBytes; puntuacion: string }[]; total: number; siguiente: string | null }
  | { tipo: 'stream'; entradas: { id: string; campos: { campo: DbKvBytes; valor: DbKvBytes }[] }[]; total: number; siguiente: string | null }
  /** `JSON.GET clave $` (sin los corchetes del `$`); `truncado` si se cortó al tope del visor. */
  | { tipo: 'json'; texto: string; truncado: boolean }
  | { tipo: 'otro'; tipoServidor: string }
  /** La clave ya no existe (se borró o caducó después del SCAN). */
  | { tipo: 'noExiste' }

export interface DbKvValor {
  contenido: DbKvContenido
  ttlMs: number | null
  /** `MEMORY USAGE` en bytes, si el servidor lo da. */
  memoria?: number
  /** `OBJECT ENCODING` (listpack, hashtable…), si el servidor lo da. */
  codificacion?: string
  ms: number
}

export interface DbKvEjecutar {
  perfilId: string
  consolaId: string
  conexionId: string
  /** La base de la consola (el `SELECT n` escrito a mano la cambia; vuelve en el resultado). */
  base: number
  /** UN comando, con las comillas de redis-cli (`SET "a b" 1`). */
  texto: string
  desplazamiento: number
  /** Confirmación de un comando PELIGROSO (D5). */
  confirmadoPeligroso?: boolean
  /** Confirmación de una escritura en PRODUCCIÓN. */
  confirmado?: boolean
  peticionId?: string
}

/** Una respuesta de Redis (RESP2), tal cual, para pintarla como redis-cli. */
export type DbKvRespuesta =
  | { tipo: 'simple'; texto: string }
  | { tipo: 'error'; texto: string }
  | { tipo: 'entero'; valor: string }
  | { tipo: 'bytes'; valor: DbKvBytes }
  | { tipo: 'nulo' }
  | { tipo: 'lista'; elementos: DbKvRespuesta[] }

export interface DbKvResultado {
  respuesta: DbKvRespuesta
  /** La base de la consola tras el comando (cambia con `SELECT n`). */
  base: number
  ms: number
}

/** Para que el main y el preload tipen los handlers sin repetir la forma. */
export type DbKvRespuestaIpc<T> = DbRespuesta<T>
