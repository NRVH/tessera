// =============================================================================
// La capa de imagen PROPIA de un perfil con Docker: lo que hornean los agentes manuales con
// órdenes de instalación, encima de la imagen base común. Puro: el nombre de la imagen, el
// sello (base + órdenes), el Dockerfile, el guion que corre como root y la orden que comprueba
// que cada programa quedó en el PATH. Lo usan el gestor del sandbox y sus pruebas.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { citarSh } from './citarShell.ts'
import { programaDelComando, type DefinicionAgente, type IdAgenteManual } from './agentesManuales.ts'

/** Lo que un agente manual aporta a la capa: su id, el programa que tiene que quedar y sus órdenes. */
export interface InstalacionAgente {
  id: IdAgenteManual
  nombre: string
  programa: string
  instalacion: string
}

/** Prefijo de las imágenes de capa: lo que no empiece así no es de Tessera y no se toca. */
export const PREFIJO_IMAGEN_CAPA = 'tessera-sandbox-perfil-'
/** Etiqueta con el sello de la capa (base + órdenes): igual sello, nada que construir. */
export const ETIQUETA_SELLO_CAPA = 'tessera.capa.sello'

/** FNV-1a de 32 bits en hexadecimal: estable entre plataformas y sin `crypto` (corre en el renderer). */
function hash(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Las instalaciones de un perfil: solo los agentes con órdenes, en el orden en que se definieron. */
export function instalacionesDe(defs: readonly DefinicionAgente[]): InstalacionAgente[] {
  return defs
    .filter((d) => (d.instalacion ?? '').trim().length > 0)
    .map((d) => ({ id: d.id, nombre: d.nombre, programa: programaDelComando(d.comando), instalacion: d.instalacion!.trim() }))
}

/** Nombre de la imagen de capa de un perfil: el id del perfil va resumido (una etiqueta de Docker no admite cualquier carácter). */
export function nombreImagenCapa(profileId: string): string {
  return `${PREFIJO_IMAGEN_CAPA}${hash(profileId)}`
}

/** El sello de una capa: cambia si cambia la base (Actualizar agentes) o cualquier orden. */
export function selloCapa(idImagenBase: string, inst: readonly InstalacionAgente[]): string {
  return hash([idImagenBase, ...inst.map((i) => `${i.id}\u0000${i.instalacion}`)].join('\u0001'))
}

/** El guion que corre como root dentro del build: cada agente con su cabecera, y el primer fallo corta. */
export function guionInstalacion(inst: readonly InstalacionAgente[]): string {
  const partes = ['#!/bin/bash', 'set -euo pipefail']
  for (const i of inst) {
    partes.push(`echo ${citarSh(`── Instalando ${i.nombre} ──`)}`, i.instalacion)
  }
  return partes.join('\n') + '\n'
}

/** El Dockerfile de la capa: la base, el guion como root y de vuelta al usuario del sandbox. */
export function dockerfileCapa(imagenBase: string, sello: string, usuario: string): string {
  return [
    `FROM ${imagenBase}`,
    'USER root',
    'COPY instalar.sh /tmp/tessera-instalar.sh',
    'RUN bash /tmp/tessera-instalar.sh && rm -f /tmp/tessera-instalar.sh',
    `LABEL ${ETIQUETA_SELLO_CAPA}="${sello}"`,
    `USER ${usuario}`,
    ''
  ].join('\n')
}

/** Marca con la que la comprobación dice qué programa no está. */
export const MARCA_FALTA = 'TESSERA_FALTA:'

/**
 * Orden (para `bash -lc` en la imagen) que imprime `TESSERA_FALTA:<programa>` por cada uno que no
 * encuentre, con el PATH que tendrá el agente (sus `.local/bin` delante).
 */
export function ordenComprobarProgramas(programas: readonly string[]): string {
  const lineas = ['export PATH="$HOME/.local/bin:/home/agente/.local/bin:$PATH"']
  for (const p of programas) lineas.push(`command -v ${citarSh(p)} >/dev/null 2>&1 || echo ${citarSh(MARCA_FALTA + p)}`)
  return lineas.join('\n')
}

/** Los programas que faltan según la salida de `ordenComprobarProgramas`. */
export function programasQueFaltan(salida: string): string[] {
  return salida
    .split(/\r?\n/)
    .filter((l) => l.startsWith(MARCA_FALTA))
    .map((l) => l.slice(MARCA_FALTA.length).trim())
}
