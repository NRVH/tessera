// =============================================================================
// Lo que va DENTRO de la copia cifrada: los perfiles y, según los apartados elegidos, sus
// conexiones SSH (con secretos, claves y huellas) y de bases de datos (con sus contraseñas), los
// agentes definidos a mano y los ajustes. Arma el contenido al exportar, lo lee al importar
// (perfiles validados como los de `profiles.json`), da su vista previa sin secretos y lo reduce a lo
// elegido. Sin electron: las conexiones llegan por parámetro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { ExportarRequest, ResumenExportacion } from '../../shared/copia-configuracion-ipc.ts'
import type { AgentesCopia, AjustesCopia } from '../../shared/copiaConfiguracion.ts'
import type { ConexionPrevia, PreviaConexiones, SeleccionConexiones } from '../../shared/seleccionCopia.ts'
import type { Profile } from '../profiles/types.ts'
import { validateProfileShape } from '../profiles/validate.ts'
import type { ConexionBdCopia } from '../db/copiaConexiones.ts'
import { txConfiguracion } from './textos.ts'
import type { ConexionSshCopia } from '../ssh/ConexionesSsh.ts'
import type { GrupoSshPersistido } from '../ssh/conservarAlEditarSsh.ts'

export interface ContenidoCopia {
  perfiles: Profile[]
  ssh?: { grupos: GrupoSshPersistido[]; conexiones: Array<Omit<ConexionSshCopia, 'ilegible'>> }
  bd?: ConexionBdCopia[]
  agentes?: AgentesCopia
  ajustes?: AjustesCopia
}

/** De dónde salen las conexiones de un perfil, con sus secretos en claro (solo dentro del main). */
export interface FuentesConexiones {
  ssh: (profileId: string) => { grupos: GrupoSshPersistido[]; conexiones: ConexionSshCopia[] }
  bd: (profileId: string) => Array<ConexionBdCopia & { ilegible: boolean }>
}

/** Los perfiles con forma válida; los demás se descartan (y se cuentan). */
export function perfilesValidos(raw: unknown): { perfiles: Profile[]; invalidos: number } {
  const lista = Array.isArray(raw) ? raw : []
  const perfiles = lista.filter((p): p is Profile => validateProfileShape(p).length === 0)
  return { perfiles, invalidos: lista.length - perfiles.length }
}

/** El contenido a cifrar y su resumen. Lanza si no hay ningún perfil válido que exportar. */
export function armarContenido(req: ExportarRequest, fuentes: FuentesConexiones): { contenido: ContenidoCopia; resumen: ResumenExportacion } {
  const { perfiles } = perfilesValidos(req.perfiles)
  if (perfiles.length === 0) throw new Error(txConfiguracion().elegirPerfil)
  const contenido: ContenidoCopia = { perfiles }
  const resumen: ResumenExportacion = { perfiles: perfiles.length, ssh: 0, bd: 0, agentes: 0, sinSecreto: [], sinClave: [] }
  if (req.apartados.ssh) {
    const ssh: NonNullable<ContenidoCopia['ssh']> = { grupos: [], conexiones: [] }
    for (const p of perfiles) {
      const de = fuentes.ssh(p.id)
      ssh.grupos.push(...de.grupos)
      for (const { ilegible, ...c } of de.conexiones) {
        if (ilegible) resumen.sinSecreto.push(c.registro.alias)
        if (c.registro.metodo === 'clave' && !c.clave) resumen.sinClave.push(c.registro.alias)
        ssh.conexiones.push(c)
      }
    }
    contenido.ssh = ssh
    resumen.ssh = ssh.conexiones.length
  }
  if (req.apartados.bd) {
    contenido.bd = perfiles.flatMap((p) =>
      fuentes.bd(p.id).map(({ ilegible, ...c }) => {
        if (ilegible) resumen.sinSecreto.push(c.registro.alias)
        return c
      })
    )
    resumen.bd = contenido.bd.length
  }
  if (req.apartados.agentes && req.agentes) {
    contenido.agentes = req.agentes
    resumen.agentes = req.agentes.nativos.length + Object.values(req.agentes.dockerPorPerfil).reduce((n, l) => n + l.length, 0)
  }
  if (req.apartados.ajustes && req.ajustes) contenido.ajustes = req.ajustes
  return { contenido, resumen }
}

/** El contenido descifrado, leído con cuidado: lo que no tiene la forma se queda fuera, no rompe. */
export function leerContenido(texto: string): { contenido: ContenidoCopia; invalidos: number } | null {
  let raw: unknown
  try {
    raw = JSON.parse(texto)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const { perfiles, invalidos } = perfilesValidos(r.perfiles)
  const contenido: ContenidoCopia = { perfiles }
  if (typeof r.ssh === 'object' && r.ssh !== null) contenido.ssh = r.ssh as ContenidoCopia['ssh']
  if (Array.isArray(r.bd)) contenido.bd = r.bd as ContenidoCopia['bd']
  if (typeof r.agentes === 'object' && r.agentes !== null) contenido.agentes = r.agentes as AgentesCopia
  if (typeof r.ajustes === 'object' && r.ajustes !== null) contenido.ajustes = r.ajustes as AjustesCopia
  return { contenido, invalidos }
}

type Crudo = Record<string, unknown>
const objeto = (v: unknown): Crudo => (typeof v === 'object' && v !== null ? (v as Crudo) : {})
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const lista = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
const registroDe = (x: unknown): Crudo => objeto(objeto(x).registro)

/**
 * Las conexiones que trae, de los perfiles válidos, para la vista previa: nombre, grupo y de qué
 * otra conexión dependen, sin secretos. `yaEsta` dice si el id ya está en este equipo.
 */
export function previaConexiones(c: ContenidoCopia, yaEsta: { ssh: (id: string) => boolean; bd: (id: string) => boolean }): PreviaConexiones {
  const perfiles = new Set(c.perfiles.map((p) => p.id))
  const grupos = new Map(lista(c.ssh?.grupos as unknown[] | undefined).map((g) => [texto(objeto(g).id), texto(objeto(g).nombre)]))
  const previa = (tipo: 'ssh' | 'bd', x: unknown): ConexionPrevia[] => {
    const r = registroDe(x)
    const id = texto(r.id)
    const perfil = texto(r.profileId)
    if (id === '' || !perfiles.has(perfil)) return []
    const depende = tipo === 'ssh' ? texto(r.saltoId) : texto(objeto(r.tunelSsh).conexionId)
    const detalle = tipo === 'ssh' ? grupos.get(texto(r.grupoId)) || null : null
    return [{ id, perfil, nombre: texto(r.alias) || id, detalle, depende: depende || null, yaEsta: yaEsta[tipo](id) }]
  }
  return {
    ssh: lista(c.ssh?.conexiones as unknown[] | undefined).flatMap((x) => previa('ssh', x)),
    bd: lista(c.bd as unknown[] | undefined).flatMap((x) => previa('bd', x))
  }
}

/**
 * El contenido reducido a lo elegido: los perfiles, las conexiones por id y los grupos SSH que usan
 * las conexiones elegidas (el grupo viaja con su conexión). Un grupo vacío en el archivo entra con su perfil.
 */
export function seleccionarContenido(c: ContenidoCopia, sel: SeleccionConexiones): ContenidoCopia {
  const perfiles = new Set(sel.perfiles)
  const ssh = new Set(sel.ssh)
  const bd = new Set(sel.bd)
  const fuera: ContenidoCopia = { ...c, perfiles: c.perfiles.filter((p) => perfiles.has(p.id)) }
  if (c.ssh) {
    const todas = lista(c.ssh.conexiones)
    const conexiones = todas.filter((x) => ssh.has(texto(registroDe(x).id)))
    const usados = new Set(conexiones.map((x) => texto(registroDe(x).grupoId)))
    const conConexiones = new Set(todas.map((x) => texto(registroDe(x).grupoId)))
    const grupos = lista(c.ssh.grupos).filter((g) => {
      const o = objeto(g)
      return usados.has(texto(o.id)) || (!conConexiones.has(texto(o.id)) && perfiles.has(texto(o.profileId)))
    })
    fuera.ssh = { grupos, conexiones }
  }
  if (c.bd) fuera.bd = lista(c.bd).filter((x) => bd.has(texto(registroDe(x).id)))
  return fuera
}
