// =============================================================================
// Las conexiones SSH de una copia de la configuración, dadas de alta en este equipo: primero los
// grupos (el que ya se llama igual se reutiliza), luego las conexiones con su id (un bastión antes
// que quien salta por él), cada una por la validación de siempre, con su clave reconocida por su
// contenido y sus huellas. Lo que ya está no se toca. Sin electron: el registro y las claves llegan.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { SshClaveElegida, SshConexionInput } from '../../../shared/ssh-ipc.ts'
import type { ConexionesSsh } from '../ConexionesSsh.ts'
import { ID_SEGURO } from '../registroSsh.ts'

export interface DepsCopiaSsh {
  conexiones: ConexionesSsh
  /** La clave de la copia como copia provisional protegida, con su ficha. */
  deCopia: (texto: string, clave: { nombre: string; tipo: string; cifrada: boolean }, profileId: string) => Promise<SshClaveElegida>
  /** El alta con la clave de la ficha ya en su sitio (o sin clave), con el id de la copia. */
  crear: (input: SshConexionInput, id: string) => void
}

export interface ResultadoCopiaSsh {
  anadidas: number
  saltadas: Array<{ alias: string; motivo: string }>
  /** Entraron sin su secreto: este equipo no tiene almacén donde guardarlo. */
  sinSecreto: string[]
}

type Crudo = Record<string, unknown>

const objeto = (v: unknown): Crudo => (typeof v === 'object' && v !== null ? (v as Crudo) : {})
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Los grupos de los perfiles importados; devuelve el id con el que queda cada uno (el de aquí si ya había). */
function importarGrupos(grupos: unknown, perfiles: ReadonlySet<string>, d: DepsCopiaSsh): Map<string, string> {
  const ids = new Map<string, string>()
  for (const g of Array.isArray(grupos) ? grupos : []) {
    const o = objeto(g)
    if (!perfiles.has(texto(o.profileId))) continue
    try {
      ids.set(texto(o.id), d.conexiones.importarGrupoDeCopia(o))
    } catch {
      // Un grupo que no valida deja a sus conexiones en «Sin grupo».
    }
  }
  return ids
}

function entradaDe(r: Crudo, secreto: unknown, grupos: Map<string, string>, clave?: SshClaveElegida): SshConexionInput {
  return {
    profileId: texto(r.profileId),
    alias: texto(r.alias),
    grupoId: grupos.get(texto(r.grupoId)) ?? null,
    host: texto(r.host),
    puerto: typeof r.puerto === 'number' ? r.puerto : 22,
    usuario: texto(r.usuario),
    metodo: r.metodo as SshConexionInput['metodo'],
    disponibleAgentes: r.disponibleAgentes === true,
    ...(typeof secreto === 'string' && secreto !== '' ? { secreto } : {}),
    ...(clave ? { clave: { tipo: 'elegida' as const, token: clave.token } } : {}),
    saltoId: typeof r.saltoId === 'string' ? r.saltoId : null,
    tuneles: Array.isArray(r.tuneles) ? (r.tuneles as SshConexionInput['tuneles']) : []
  }
}

/** Una conexión; null si entró, o el motivo. Sin almacén de secretos entra sin el suyo (y se apunta). */
async function importarUna(c: Crudo, grupos: Map<string, string>, d: DepsCopiaSsh, sinSecreto: string[]): Promise<string | null> {
  const r = objeto(c.registro)
  const id = texto(r.id)
  if (!ID_SEGURO.test(id)) return 'no tiene un id válido'
  if (d.conexiones.idOcupado(id)) return 'ya está en este equipo'
  let clave: SshClaveElegida | undefined
  if (r.metodo === 'clave') {
    if (typeof c.clave !== 'string' || c.clave === '') return 'la copia no trae su archivo de clave'
    const meta = objeto(r.clave)
    clave = await d.deCopia(c.clave, { nombre: texto(meta.nombre) || 'clave', tipo: texto(meta.tipo), cifrada: meta.cifrada === true }, texto(r.profileId))
  }
  const conSecreto = typeof c.secreto === 'string' && c.secreto !== ''
  const guardable = d.conexiones.puedeGuardarSecretos()
  d.crear(entradaDe(r, guardable ? c.secreto : undefined, grupos, clave), id)
  if (conSecreto && !guardable) sinSecreto.push(texto(r.alias))
  try {
    if (typeof c.huellas === 'string' && c.huellas !== '') d.conexiones.escribirHuellas(id, c.huellas)
  } catch {
    // La conexión ya está: sin sus huellas, aceptará la del servidor al conectar.
  }
  return null
}

/**
 * Da de alta las conexiones de los perfiles importados. Una conexión que salta por un bastión de la
 * copia espera a que ese bastión entre; si no llega a entrar, se intenta igual y la validación dirá por qué.
 */
export async function importarSshDeCopia(copia: unknown, perfiles: ReadonlySet<string>, d: DepsCopiaSsh): Promise<ResultadoCopiaSsh> {
  const o = objeto(copia)
  const grupos = importarGrupos(o.grupos, perfiles, d)
  let pendientes = (Array.isArray(o.conexiones) ? o.conexiones : []).map(objeto).filter((c) => perfiles.has(texto(objeto(c.registro).profileId)))
  const resultado: ResultadoCopiaSsh = { anadidas: 0, saltadas: [], sinSecreto: [] }
  const enCopia = new Set(pendientes.map((c) => texto(objeto(c.registro).id)))
  let forzar = false
  while (pendientes.length > 0) {
    const siguen: Crudo[] = []
    for (const c of pendientes) {
      const salto = texto(objeto(c.registro).saltoId)
      const esperaBastion = salto !== '' && enCopia.has(salto) && d.conexiones.conexion(salto) === undefined && pendientes.some((p) => texto(objeto(p.registro).id) === salto)
      if (esperaBastion && !forzar) {
        siguen.push(c)
        continue
      }
      let motivo: string | null
      try {
        motivo = await importarUna(c, grupos, d, resultado.sinSecreto)
      } catch (e) {
        motivo = e instanceof Error ? e.message : String(e)
      }
      if (motivo === null) resultado.anadidas++
      else resultado.saltadas.push({ alias: texto(objeto(c.registro).alias) || '(sin nombre)', motivo })
    }
    // Sin avances solo queda un ciclo de bastiones: se intentan igual, una vez.
    forzar = siguen.length === pendientes.length
    pendientes = siguen
  }
  return resultado
}
