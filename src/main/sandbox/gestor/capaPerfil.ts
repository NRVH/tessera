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
import { writeFileAtomicSync } from '../../util/atomicWrite.ts'
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
import { runDocker, runDockerBuild } from '../adaptadores/docker.ts'
import { NEUTRAL_USER } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { ImagenSandbox } from './imagen.ts'

/** Resultado de aplicar la capa de un perfil. */
export interface ResultadoCapa {
  ok: boolean
  /** Programas que no quedaron en el PATH de la imagen (el comando de su agente no arrancará). */
  faltan: string[]
  error?: string
}

/** Una instalación leída del registro, o null si no tiene la forma. */
function instalacionValida(raw: unknown): InstalacionAgente | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const campos = [r.nombre, r.programa, r.instalacion]
  if (typeof r.id !== 'string' || !esAgenteManual(r.id) || !campos.every((c) => typeof c === 'string' && c.length > 0)) return null
  return { id: r.id, nombre: r.nombre as string, programa: r.programa as string, instalacion: r.instalacion as string }
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
    writeFileAtomicSync(this.rutaRegistro, JSON.stringify({ version: 1, perfiles, fallidos }, null, 2))
  }

  /** Apunta (o borra) el sello que no se pudo construir; solo escribe si cambia. */
  private marcarFallo(profileId: string, sello: string, fallo: boolean): void {
    const antes = this.fallidos.get(profileId)
    if (fallo) this.fallidos.set(profileId, sello)
    else this.fallidos.delete(profileId)
    if (antes !== this.fallidos.get(profileId)) this.guardar()
  }

  /** La imagen con la que nace el contenedor del perfil: su capa al día o, sin capa (o si falla), la base. */
  async imagenPara(profileId: string, onLog?: (linea: string) => void): Promise<string> {
    const inst = this.registro.get(profileId)
    if (!inst || inst.length === 0) return this.n.imagen
    const tag = nombreImagenCapa(profileId)
    const ok = await this.alDia(profileId, inst, onLog)
    if (ok) return tag
    onLog?.(txSandbox().capa.sinCapa)
    return this.n.imagen
  }

  /**
   * ¿La capa del perfil está al día? Si no, la construye (coalescido por perfil y sello). Un
   * sello que ya falló no se reintenta salvo con `reintentar` (aplicar a mano): repetir un build
   * roto en cada arranque del contenedor retrasaría también a los agentes de serie.
   */
  private async alDia(profileId: string, inst: InstalacionAgente[], onLog?: (linea: string) => void, reintentar = false): Promise<boolean> {
    const idBase = await this.idImagen(this.n.imagen)
    if (!idBase) return false
    const sello = selloCapa(idBase, inst)
    const tag = nombreImagenCapa(profileId)
    if ((await this.selloDe(tag)) === sello) return true
    if (!reintentar && this.fallidos.get(profileId) === sello) return false
    const vuelo = this.enVuelo.get(profileId)
    if (vuelo && vuelo.sello === sello) return vuelo.promesa
    const promesa = this.construir(tag, sello, inst, onLog).then((ok) => {
      this.marcarFallo(profileId, sello, !ok)
      return ok
    }).finally(() => {
      if (this.enVuelo.get(profileId)?.promesa === promesa) this.enVuelo.delete(profileId)
    })
    this.enVuelo.set(profileId, { sello, promesa })
    return promesa
  }

  private async idImagen(imagen: string): Promise<string | null> {
    const r = await runDocker(['image', 'inspect', imagen, '--format', '{{.Id}}'])
    return r.status === 0 ? r.stdout.trim() : null
  }

  private async selloDe(tag: string): Promise<string | null> {
    const r = await runDocker(['image', 'inspect', tag, '--format', `{{index .Config.Labels "${ETIQUETA_SELLO_CAPA}"}}`])
    return r.status === 0 ? r.stdout.trim() : null
  }

  /** `docker build` de la capa en una carpeta temporal con su Dockerfile y su guion. */
  private async construir(tag: string, sello: string, inst: InstalacionAgente[], onLog?: (linea: string) => void): Promise<boolean> {
    const dir = mkdtempSync(path.join(tmpdir(), 'tessera-capa-'))
    try {
      writeFileSync(path.join(dir, 'Dockerfile'), dockerfileCapa(this.n.imagen, sello, NEUTRAL_USER))
      writeFileSync(path.join(dir, 'instalar.sh'), guionInstalacion(inst))
      onLog?.(txSandbox().capa.instalando)
      const code = await runDockerBuild(['build', '-t', tag, dir], { onLog })
      return code === 0
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Aplica las instalaciones del perfil: las guarda, construye la capa (si hace falta), comprueba
   * los programas y para el contenedor, que se recrea con la imagen nueva al reabrir sus agentes.
   */
  async aplicar(profileId: string, inst: InstalacionAgente[], onLog: (linea: string) => void): Promise<ResultadoCapa> {
    if (inst.length === 0) this.registro.delete(profileId)
    else this.registro.set(profileId, inst)
    this.guardar()
    if (inst.length === 0) return { ok: true, faltan: [] }
    try {
      // La capa se construye ENCIMA de la base: primero la base, al día.
      await this.imagen.ensureImage()
      if (!(await this.alDia(profileId, inst, onLog, true))) return { ok: false, faltan: [], error: txSandbox().capa.fallo }
      const r = await runDocker(['run', '--rm', '--entrypoint', 'bash', nombreImagenCapa(profileId), '-lc', ordenComprobarProgramas(inst.map((i) => i.programa))])
      // Sin salir bien, la salida vacía no dice «no falta nada»: no se pudo comprobar.
      if (r.status !== 0) return { ok: false, faltan: [], error: txSandbox().capa.noSeComprobo((r.stderr || r.stdout).trim().slice(0, 300)) }
      return { ok: true, faltan: programasQueFaltan(r.stdout) }
    } catch (err) {
      return { ok: false, faltan: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Olvida la capa de un perfil borrado y borra su imagen (sin esperar ni fallar). */
  olvidar(profileId: string): void {
    const habia = this.fallidos.delete(profileId)
    if (!this.registro.delete(profileId) && !habia) return
    this.guardar()
    void runDocker(['image', 'rm', '-f', nombreImagenCapa(profileId)])
  }
}
