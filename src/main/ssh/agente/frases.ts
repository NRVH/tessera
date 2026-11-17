// =============================================================================
// Frases del SSH del sistema cifradas con el mismo almacén seguro que las conexiones SSH.
// Gestiona su persistencia para reutilizar frases confirmadas sin guardarlas como texto legible.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CifradoSecretos } from '../../db/adaptadores/cifradoSistema.ts'
import { escribirArchivoAtomicoSync } from '../../util/escrituraAtomica.ts'

export class FrasesAgente {
  private readonly ruta: string
  private readonly cifrado: CifradoSecretos
  private guardadas: Record<string, string> = {}
  constructor(ruta: string, cifrado: CifradoSecretos) {
    this.ruta = ruta
    this.cifrado = cifrado
    try {
      const datos: unknown = JSON.parse(readFileSync(ruta, 'utf8'))
      if (datos && typeof datos === 'object' && !Array.isArray(datos)) this.guardadas = Object.fromEntries(Object.entries(datos).filter(([nombre, valor]) => /^[a-f0-9]{64}$/.test(nombre) && typeof valor === 'string'))
    } catch { /* Sin archivo legible se vuelve a preguntar, nunca se conserva texto plano. */ }
  }
  private identificador(ruta: string): string { return createHash('sha256').update(ruta).digest('hex') }
  leer(ruta: string): string | null {
    const guardada = this.guardadas[this.identificador(ruta)]
    try { return guardada && this.cifrado.disponible() ? this.cifrado.descifrar(Buffer.from(guardada, 'base64')) : null } catch { return null }
  }
  guardar(ruta: string, frase: string): void {
    if (!this.cifrado.disponible()) return
    try {
      const siguiente = { ...this.guardadas, [this.identificador(ruta)]: this.cifrado.cifrar(frase).toString('base64') }
      escribirArchivoAtomicoSync(this.ruta, JSON.stringify(siguiente))
      this.guardadas = siguiente
    } catch { /* El fallo del llavero no impide la firma ya autorizada de esta sesión. */ }
  }
}
