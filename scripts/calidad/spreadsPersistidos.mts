// =============================================================================
// Claves sobrantes en un spread hacia un tipo persistido: el compilador no revisa las claves de un
// spread, así que una con otro nombre se guarda sin aviso. Recibe el programa y las declaraciones del
// cierre que calcula `clavesPersistidas.mts`. Sin E/S.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import path from 'node:path'
import type ts from 'typescript'
import { ubicacion } from './clavesPersistidas.mts'
import type { Cierre, Hallazgo } from './clavesPersistidas.mts'

function propiedadesDelOrigen(tipo: ts.Type, verificador: ts.TypeChecker): ts.Symbol[] {
  const miembros = tipo.isUnion() ? tipo.types : [tipo]
  return [...new Map(miembros.flatMap((t) => verificador.getPropertiesOfType(t)).map((p) => [p.getName(), p])).values()]
}

// El valor que el literal deja en cada clave, en orden: explícita, abreviada o traída por un spread. Una
// clave que un spread trae opcional, o solo en parte de su unión, puede quedar o no: no fija nada.
function valoresFijados(compilador: typeof ts, verificador: ts.TypeChecker, literal: ts.ObjectLiteralExpression): Map<string, ts.Type | null> {
  const fijados = new Map<string, ts.Type | null>()
  for (const p of literal.properties) {
    if (compilador.isPropertyAssignment(p)) fijados.set(p.name.getText().replace(/^['"]|['"]$/g, ''), verificador.getTypeAtLocation(p.initializer))
    else if (compilador.isShorthandPropertyAssignment(p)) {
      const valor = verificador.getShorthandAssignmentValueSymbol(p)
      fijados.set(p.name.text, valor ? verificador.getTypeOfSymbol(valor) : null)
    } else if (compilador.isSpreadAssignment(p)) {
      const origen = verificador.getTypeAtLocation(p.expression)
      const comunes = new Map(verificador.getPropertiesOfType(origen).map((q) => [q.getName(), q]))
      for (const q of propiedadesDelOrigen(origen, verificador)) {
        const comun = comunes.get(q.getName())
        fijados.set(q.getName(), comun && !(comun.flags & compilador.SymbolFlags.Optional) ? verificador.getTypeOfSymbol(comun) : null)
      }
    }
  }
  return fijados
}

// Una variante del destino que no admite el valor unitario (literal, booleano o null) que el literal fija
// en una clave no es el destino real: revisarla tomaría por sobrantes las claves propias de la variante
// elegida. Un valor que no es unitario no descarta nada.
function admiteDiscriminantes(compilador: typeof ts, verificador: ts.TypeChecker, destino: ts.Type, fijados: Map<string, ts.Type | null>): boolean {
  const F = compilador.TypeFlags
  const unitario = (t: ts.Type): boolean => t.isLiteral() || !!(t.flags & (F.BooleanLiteral | F.EnumLiteral | F.Null | F.Undefined))
  for (const [nombre, valor] of fijados) {
    const variantes = valor ? (valor.isUnion() ? valor.types : [valor]) : []
    const propiedad = destino.getProperty(nombre)
    if (!propiedad || !variantes.length || !variantes.every(unitario)) continue
    const esperado = verificador.getTypeOfSymbol(propiedad)
    if (!variantes.some((t) => verificador.isTypeAssignableTo(t, esperado))) return false
  }
  return true
}

// El tipo que declara una propiedad: su interfaz o clase, o su tipo literal junto con la intersección que
// lo contiene (`Omit<Dto, 'x'> & { orden?: number }` es un solo tipo).
function contenedorDe(compilador: typeof ts, d: ts.Declaration): ts.Node {
  let n: ts.Node = d.parent
  if (compilador.isTypeLiteralNode(n)) while (compilador.isIntersectionTypeNode(n.parent) || compilador.isParenthesizedTypeNode(n.parent)) n = n.parent
  return n
}

// Una clave que el destino no declara solo se exime si es persistida y el tipo que la declara está en la
// herencia del destino (el destino lo hereda, o él hereda todo lo persistido del destino: el paso del disco
// a su DTO). Compartir artefacto no basta: una raíz que agrupa varios tipos los haría parientes a todos.
function parentesco(compilador: typeof ts, verificador: ts.TypeChecker, enCierre: Cierre): (propiedades: ts.Symbol[]) => (p: ts.Symbol) => boolean {
  const cierres = new Map<ts.Node, Set<ts.Node>>()
  const contenedores = (simbolos: readonly ts.Symbol[]): Set<ts.Node> =>
    new Set(simbolos.flatMap((p) => (p.declarations ?? []).filter((d) => enCierre.has(d)).map((d) => contenedorDe(compilador, d))))
  const cierreDe = (c: ts.Node): Set<ts.Node> => {
    let cierre = cierres.get(c)
    if (!cierre) {
      const nombre = (compilador.isInterfaceDeclaration(c) || compilador.isClassDeclaration(c)) ? c.name : undefined
      cierre = contenedores(verificador.getPropertiesOfType(verificador.getTypeAtLocation(nombre ?? c))).add(c)
      cierres.set(c, cierre)
    }
    return cierre
  }
  return (propiedades) => {
    const delDestino = contenedores(propiedades)
    return (p) => (p.declarations ?? []).filter((d) => enCierre.has(d)).some((d) => {
      const c = contenedorDe(compilador, d)
      return delDestino.has(c) || (delDestino.size > 0 && [...delDestino].every((x) => cierreDe(c).has(x)))
    })
  }
}

export function sobrantesEnSpreads(compilador: typeof ts, programa: ts.Program, enCierre: Cierre, dentroDe: (archivo: string) => boolean): Hallazgo[] {
  const verificador = programa.getTypeChecker()
  const hallazgos: Hallazgo[] = []
  const persistida = (p: ts.Symbol): boolean => (p.declarations ?? []).some((d) => enCierre.has(d))
  const pariente = parentesco(compilador, verificador, enCierre)
  function revisar(literal: ts.ObjectLiteralExpression): void {
    const contexto = verificador.getContextualType(literal)
    if (!contexto) return
    const miembros = contexto.isUnion() ? contexto.types : [contexto]
    const fijados = valoresFijados(compilador, verificador, literal)
    const elegidos = miembros.filter((destino) => admiteDiscriminantes(compilador, verificador, destino, fijados))
    // Si ninguna variante admite los discriminantes (código que no compila), se revisan todas.
    for (const destino of elegidos.length ? elegidos : miembros) {
      const propiedades = verificador.getPropertiesOfType(destino)
      if (!propiedades.some(persistida) || verificador.getIndexInfosOfType(destino).length) continue
      const archivos = new Set(propiedades.flatMap((p) => (p.declarations ?? []).flatMap((d) => [...enCierre.artefactos?.get(d) ?? []])))
      const delDestino = pariente(propiedades)
      const nombres = new Set(propiedades.map((p) => p.getName()))
      const aportadas = new Set(verificador.getPropertiesOfType(verificador.getTypeAtLocation(literal)).map((p) => p.getName()))
      const posibles = propiedades.filter((p) => p.flags & compilador.SymbolFlags.Optional && !aportadas.has(p.getName())).map((p) => p.getName())
      for (const expansion of literal.properties.filter(compilador.isSpreadAssignment)) {
        const origen = verificador.getTypeAtLocation(expansion.expression)
        for (const p of propiedadesDelOrigen(origen, verificador)) {
          if (nombres.has(p.getName()) || delDestino(p)) continue
          const declaracion = p.declarations?.[0]
          hallazgos.push({
            clase: 'SOBRANTE', ruta: ubicacion(expansion).replace(/:\d+$/, ''), nombre: p.getName(),
            destino: verificador.typeToString(destino), origen: expansion.expression.getText(), posibles,
            declaracion: declaracion ? ubicacion(declaracion).replace(/:\d+$/, '') : '(sin declaración)',
            artefacto: archivos ? [...archivos].join(', ') : '(raíz persistida)'
          })
        }
      }
    }
  }
  function visitar(n: ts.Node): void {
    if (compilador.isObjectLiteralExpression(n) && n.properties.some(compilador.isSpreadAssignment)) revisar(n)
    compilador.forEachChild(n, visitar)
  }
  for (const fuente of programa.getSourceFiles()) {
    if (!fuente.isDeclarationFile && !path.basename(fuente.fileName).startsWith('test-') && dentroDe(fuente.fileName)) visitar(fuente)
  }
  return hallazgos
}
