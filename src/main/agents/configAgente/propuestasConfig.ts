// =============================================================================
// Las propuestas de configuración que dejan los agentes con `tctx config proponer`: guardadas en `userData`
// hasta que el usuario las acepta o las descarta. Una por nivel, perfil que la propone, agente y archivo: una
// nueva sustituye a la anterior, pero nunca a la de otro perfil, ni en la capa global. Sin electron.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomicSync } from '../../util/atomicWrite.ts'
import type { PropuestaConfig } from '../../../shared/configAgente-ipc.ts'

const clave = (p: PropuestaConfig): string => [p.nivel, p.profileId, p.agente, p.tipo].join('|')

function esPropuesta(v: unknown): v is PropuestaConfig {
  const p = v as Partial<PropuestaConfig> | null
  return (
    typeof p?.id === 'string' &&
    (p.nivel === 'global' || p.nivel === 'perfil') &&
    typeof p.profileId === 'string' &&
    (p.agente === 'claude-code' || p.agente === 'codex') &&
    p.tipo === 'configuracion' &&
    typeof p.texto === 'string' &&
    typeof p.motivo === 'string' &&
    typeof p.en === 'number'
  )
}

export class PropuestasConfig {
  private readonly ruta: string
  private readonly log: (m: string) => void
  private lista: PropuestaConfig[]

  constructor(opts: { ruta: string; log?: (m: string) => void }) {
    this.ruta = opts.ruta
    this.log = opts.log ?? (() => {})
    this.lista = this.cargar()
  }

  private cargar(): PropuestaConfig[] {
    if (!existsSync(this.ruta)) return []
    try {
      const datos: unknown = JSON.parse(readFileSync(this.ruta, 'utf-8'))
      return Array.isArray(datos) ? datos.filter(esPropuesta) : []
    } catch (err) {
      this.log(`propuestas de configuración ilegibles en ${this.ruta}: ${String(err)}`)
      return []
    }
  }

  private persistir(): void {
    writeFileAtomicSync(this.ruta, `${JSON.stringify(this.lista, null, 2)}\n`)
  }

  listar(): PropuestaConfig[] {
    return [...this.lista].sort((a, b) => a.en - b.en)
  }

  obtener(id: string): PropuestaConfig | null {
    return this.lista.find((p) => p.id === id) ?? null
  }

  guardar(p: PropuestaConfig): void {
    this.lista = [...this.lista.filter((x) => clave(x) !== clave(p)), p]
    this.persistir()
  }

  quitar(id: string): boolean {
    const antes = this.lista.length
    this.lista = this.lista.filter((p) => p.id !== id)
    if (this.lista.length === antes) return false
    this.persistir()
    return true
  }

  /** Quita las propuestas de los perfiles que ya no existen. */
  depurar(idsVivos: readonly string[]): void {
    const vivos = new Set(idsVivos)
    const antes = this.lista.length
    this.lista = this.lista.filter((p) => vivos.has(p.profileId))
    if (this.lista.length !== antes) this.persistir()
  }
}
