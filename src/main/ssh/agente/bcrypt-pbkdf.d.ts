// =============================================================================
// Firma de la derivación bcrypt que utiliza el formato privado OpenSSH.
// Declara los tipos de entrada y salida para comprobar el uso de la derivación al descifrar claves.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
declare module 'bcrypt-pbkdf' {
  const bcrypt: {
    pbkdf: (frase: Uint8Array, longitud: number, sal: Uint8Array, longitudSal: number, salida: Uint8Array, longitudSalida: number, rondas: number) => number
  }
  export default bcrypt
}
