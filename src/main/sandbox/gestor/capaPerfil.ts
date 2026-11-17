// =============================================================================
// Capa de imagen propia de cada perfil: lo que instalan sus agentes manuales, encima de la
// base. El registro (las instalaciones aplicadas, en `capas-perfil.json`) es del main: con él
// `imagenPara` pone la capa al día al crear el contenedor (también cuando cambió la base) y
// `aplicar` la construye, comprueba los programas y recrea el contenedor del perfil.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { escribirArchivoAtomicoSync } from '../../util/escrituraAtomica.ts'
import { txSandbox } from '../textos.ts'
import {
  ETIQUETA_SELLO_CAPA,
  dockerfileCapa,
  guionInstalacion,
  nombreImagenCapa,
  ordenComprobarProgramas,
  programasQueFaltan,
  selloCapa,
  type InstalacionAgente
} from '../../../shared/capaPerfil.ts'
import { esAgenteManual } from '../../../shared/agentesManuales.ts'
import { ejecutarDocker, ejecutarConstruccionDocker } from '../adaptadores/docker.ts'
import { USUARIO_NEUTRO, instanciaDePruebas } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { ImagenSandbox } from './imagen.ts'

/** La capa del perfil en esta instancia: las pruebas no pisan la de un perfil del usuario con el mismo id. */
export function etiquetaCapa(perfilId: string): string {
  return nombreImagenCapa(perfilId, instanciaDePruebas())
}

/** Resultado de aplicar la capa de un perfil. */
export interface ResultadoCapa {
  ok: boolean
  /** Programas que no quedaron en el PATH de la imagen (el comando de su agente no arrancará). */
  faltan: string[]
  error?: string
}

/** Una instalación leída del registro, o null si no tiene la forma. */
function instalacionValida(crudo: unknown): InstalacionAgente | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const r = crudo as Record<string, unknown>
  const campos = [r.nombre, r.programa, r.instalacion]
  if (typeof r.id !== 'string' || !esAgenteManual(r.id) || !campos.every((c) => typeof c === 'string' && c.length > 0)) return null
  return { id: r.id, nombre: r.nombre as string, programa: r.programa as string, instalacion: r.instalacion as string }
}

/** Lo que se escribe en `capas-perfil.json`. */
export interface ArchivoCapasPerfil {
  version: number
  perfiles: Record<string, InstalacionAgente[]>
  fallidos: Record<string, string>
}

interface Registro {
  perfiles: Map<string, InstalacionAgente[]>
  /** Sello de la última capa que no se pudo construir, por perfil: no se reintenta al arrancar. */
  fallidos: Map<string, string>
}

/** Lee el registro de capas; un archivo ilegible o ajeno es un registro vacío. */
function leerRegistro(ruta: string): Registro {
  const reg: Registro = { perfiles: new Map(), fallidos: new Map() }
  if (!existsSync(ruta)) return reg
  try {
    const datos = JSON.parse(readFileSync(ruta, 'utf8')) as { perfiles?: Record<string, unknown>; fallidos?: Record<string, unknown> }
    for (const [perfil, lista] of Object.entries(datos.perfiles ?? {})) {
      const inst = Array.isArray(lista) ? lista.map(instalacionValida).filter((i): i is InstalacionAgente => i !== null) : []
      if (inst.length > 0) reg.perfiles.set(perfil, inst)
    }
    for (const [perfil, sello] of Object.entries(datos.fallidos ?? {})) if (typeof sello === 'string') reg.fallidos.set(perfil, sello)
  } catch (err) {
    console.log(`[sandbox] capas: registro ilegible (${String(err)}); se empieza vacío`)
  }
  return reg
}

/** Capas de imagen por perfil. */
export class CapaPerfilSandbox {
  private readonly n: NucleoSandbox
  private readonly imagen: ImagenSandbox
  private rutaRegistro: string | null = null
  private registro = new Map<string, InstalacionAgente[]>()
  private fallidos = new Map<string, string>()
  /** Builds de capa en vuelo, por perfil y sello: dos aperturas no lanzan dos builds iguales. */
  private readonly enVuelo = new Map<string, { sello: string; promesa: Promise<boolean> }>()

  constructor(n: NucleoSandbox, imagen: ImagenSandbox) {
    this.n = n
    this.imagen = imagen
  }

  /** Dónde vive el registro; se carga en el acto. Sin llamar a esto, ningún perfil tiene capa. */
  usarRegistro(ruta: string): void {
    this.rutaRegistro = ruta
    const reg = leerRegistro(ruta)
    this.registro = reg.perfiles
    this.fallidos = reg.fallidos
  }

  private guardar(): void {
    if (!this.rutaRegistro) return
    const perfiles = Object.fromEntries(this.registro)
    const fallidos = Object.fromEntries(this.fallidos)
    const doc: ArchivoCapasPerfil = { version: 1, perfiles, fallidos }
    escribirArchivoAtomicoSync(this.rutaRegistro, JSON.stringify(doc, null, 2))
  }

  /** Apunta (o borra) el sello que no se pudo construir; solo escribe si cambia. */
  private marcarFallo(perfilId: string, sello: string, fallo: boolean): void {
    const antes = this.fallidos.get(perfilId)
    if (fallo) this.fallidos.set(perfilId, sello)
    else this.fallidos.delete(perfilId)
    if (antes !== this.fallidos.get(perfilId)) this.guardar()
  }

  /** ¿Tiene algún perfil instalaciones propias? */
  hayCapas(): boolean {
    return [...this.registro.values()].some((inst) => inst.length > 0)
  }

  /** La imagen con la que nace el contenedor del perfil: su capa al día o, sin capa (o si falla), la base. */
  async imagenPara(perfilId: string, onRegistrar?: (linea: string) => void): Promise<string> {
    const inst = this.registro.get(perfilId)
    if (!inst || inst.length === 0) return this.n.imagen
    const etiqueta = etiquetaCapa(perfilId)
    const ok = await this.alDia(perfilId, inst, onRegistrar)
    if (ok) return etiqueta
    onRegistrar?.(txSandbox().capa.sinCapa)
    return this.n.imagen
  }

  /**
   * ¿La capa del perfil está al día? Si no, la construye (coalescido por perfil y sello). Un
   * sello que ya falló no se reintenta salvo con `reintentar` (aplicar a mano): repetir un build
   * roto en cada arranque del contenedor retrasaría también a los agentes de serie.
   */
  private async alDia(perfilId: string, inst: InstalacionAgente[], onRegistrar?: (linea: string) => void, reintentar = false): Promise<boolean> {
    const idBase = await this.idImagen(this.n.imagen)
    if (!idBase) return false
    const sello = selloCapa(idBase, inst)
    const etiqueta = etiquetaCapa(perfilId)
    if ((await this.selloDe(etiqueta)) === sello) return true
    if (!reintentar && this.fallidos.get(perfilId) === sello) return false
    const vuelo = this.enVuelo.get(perfilId)
    if (vuelo && vuelo.sello === sello) return vuelo.promesa
    const promesa = this.construir(etiqueta, sello, inst, onRegistrar).then((ok) => {
      this.marcarFallo(perfilId, sello, !ok)
      return ok
    }).finally(() => {
      if (this.enVuelo.get(perfilId)?.promesa === promesa) this.enVuelo.delete(perfilId)
    })
    this.enVuelo.set(perfilId, { sello, promesa })
    return promesa
  }

  private async idImagen(imagen: string): Promise<string | null> {
    const r = await ejecutarDocker(['image', 'inspect', imagen, '--format', '{{.Id}}'])
    return r.status === 0 ? r.stdout.trim() : null
  }

  private async selloDe(etiqueta: string): Promise<string | null> {
    const r = await ejecutarDocker(['image', 'inspect', etiqueta, '--format', `{{index .Config.Labels "${ETIQUETA_SELLO_CAPA}"}}`])
    return r.status === 0 ? r.stdout.trim() : null
  }

  /** `docker build` de la capa en una carpeta temporal con su Dockerfile y su guion. */
  private async construir(etiqueta: string, sello: string, inst: InstalacionAgente[], onRegistrar?: (linea: string) => void): Promise<boolean> {
    const dir = mkdtempSync(path.join(tmpdir(), 'tessera-capa-'))
    try {
      writeFileSync(path.join(dir, 'Dockerfile'), dockerfileCapa(this.n.imagen, sello, USUARIO_NEUTRO))
      writeFileSync(path.join(dir, 'instalar.sh'), guionInstalacion(inst))
      onRegistrar?.(txSandbox().capa.instalando)
      const codigo = await ejecutarConstruccionDocker(['build', '-t', etiqueta, dir], { onRegistrar })
      return codigo === 0
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Aplica las instalaciones del perfil: las guarda, construye la capa (si hace falta), comprueba
   * los programas y para el contenedor, que se recrea con la imagen nueva al reabrir sus agentes.
   */
  async aplicar(perfilId: string, inst: InstalacionAgente[], onRegistrar: (linea: string) => void): Promise<ResultadoCapa> {
    if (inst.length === 0) this.registro.delete(perfilId)
    else this.registro.set(perfilId, inst)
    this.guardar()
    if (inst.length === 0) return { ok: true, faltan: [] }
    try {
      // La capa se construye ENCIMA de la base: primero la base, al día.
      await this.imagen.asegurarImagen()
      if (!(await this.alDia(perfilId, inst, onRegistrar, true))) return { ok: false, faltan: [], error: txSandbox().capa.fallo }
      const r = await ejecutarDocker(['run', '--rm', '--entrypoint', 'bash', etiquetaCapa(perfilId), '-lc', ordenComprobarProgramas(inst.map((i) => i.programa))])
      // Sin salir bien, la salida vacía no dice «no falta nada»: no se pudo comprobar.
      if (r.status !== 0) return { ok: false, faltan: [], error: txSandbox().capa.noSeComprobo((r.stderr || r.stdout).trim().slice(0, 300)) }
      return { ok: true, faltan: programasQueFaltan(r.stdout) }
    } catch (err) {
      return { ok: false, faltan: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Olvida la capa de un perfil borrado y borra su imagen (sin esperar ni fallar). */
  olvidar(perfilId: string): void {
    const habia = this.fallidos.delete(perfilId)
    if (!this.registro.delete(perfilId) && !habia) return
    this.guardar()
    void ejecutarDocker(['image', 'rm', '-f', etiquetaCapa(perfilId)])
  }
}
