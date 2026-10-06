// =============================================================================
// tessera-askpass: el programa de contraseñas (SSH_ASKPASS) de Tessera en Windows. ssh lo lanza con la
// pregunta del servidor; él se la pasa a Tessera por el puente local (TESSERA_DB_PIPE) con la ficha de esa
// sesión (TESSERA_SSH_TOKEN) y escribe la respuesta en stdout. Si Tessera no contesta, sale con 1, que ssh
// toma como cancelar. C# 5 sobre .NET Framework 4 y nada más; lo compila scripts/compilarAskpass.mjs con
// /target:winexe (sin ventana de consola).
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

static class AskpassTessera
{
    // Fija y sin el texto del servidor: lo que este escriba no llega a la terminal por aquí.
    const string MensajeNo = "Tessera no contesta esa pregunta del servidor; reconecta escribiendo en la terminal";
    const string PrefijoPipe = @"\\.\pipe\";
    const int TopeConexionMs = 5000;
    // Por si Tessera se queda colgada a mitad de respuesta: ssh espera a este proceso.
    const int TopeTotalMs = 10000;
    const int MaxRespuesta = 64 * 1024;
    // La respuesta la escribe JSON.stringify en el puente, con este orden de claves.
    const string InicioOk = "{\"ok\":true,\"respuesta\":\"";
    const string FinOk = "\"}";

    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    static int Main(string[] args)
    {
        using (new Timer(_ => { Cancelar(); Environment.Exit(1); }, null, TopeTotalMs, Timeout.Infinite))
        {
            string respuesta;
            try
            {
                respuesta = Preguntar(args.Length > 0 ? args[0] : "");
            }
            catch (Exception)
            {
                respuesta = null;
            }
            if (respuesta == null) return Cancelar();
            Escribir(Console.OpenStandardOutput(), respuesta + "\n");
            return 0;
        }
    }

    static int Cancelar()
    {
        try
        {
            Escribir(Console.OpenStandardError(), MensajeNo + "\n");
        }
        catch (Exception)
        {
            // Sin stderr no hay a quién decírselo: cancelar es lo que importa.
        }
        return 1;
    }

    static void Escribir(Stream destino, string texto)
    {
        byte[] b = Utf8.GetBytes(texto);
        destino.Write(b, 0, b.Length);
        destino.Flush();
    }

    static string Preguntar(string prompt)
    {
        string pipe = Environment.GetEnvironmentVariable("TESSERA_DB_PIPE");
        string token = Environment.GetEnvironmentVariable("TESSERA_SSH_TOKEN");
        if (String.IsNullOrEmpty(pipe) || String.IsNullOrEmpty(token)) return null;
        if (!pipe.StartsWith(PrefijoPipe, StringComparison.OrdinalIgnoreCase)) return null;
        using (NamedPipeClientStream cliente = new NamedPipeClientStream(".", pipe.Substring(PrefijoPipe.Length), PipeDirection.InOut))
        {
            cliente.Connect(TopeConexionMs);
            string peticion = "{\"v\":1,\"token\":" + Json(token) + ",\"op\":\"ssh.askpass\",\"prompt\":" + Json(prompt) + "}\n";
            byte[] b = Utf8.GetBytes(peticion);
            cliente.Write(b, 0, b.Length);
            cliente.Flush();
            string linea = LeerLinea(cliente);
            return linea == null ? null : RespuestaDe(linea);
        }
    }

    /** Una línea de la respuesta (sin el salto), o null si no llega entera o se pasa del tope. */
    static string LeerLinea(Stream origen)
    {
        MemoryStream leido = new MemoryStream();
        byte[] trozo = new byte[4096];
        while (leido.Length <= MaxRespuesta)
        {
            int n = origen.Read(trozo, 0, trozo.Length);
            if (n <= 0) break;
            int fin = Array.IndexOf(trozo, (byte)'\n', 0, n);
            if (fin >= 0)
            {
                leido.Write(trozo, 0, fin);
                return Utf8.GetString(leido.ToArray());
            }
            leido.Write(trozo, 0, n);
        }
        return null;
    }

    /** El secreto de una respuesta afirmativa, o null con cualquier otra cosa. */
    static string RespuestaDe(string linea)
    {
        if (!linea.StartsWith(InicioOk, StringComparison.Ordinal) || !linea.EndsWith(FinOk, StringComparison.Ordinal)) return null;
        if (linea.Length < InicioOk.Length + FinOk.Length) return null;
        return SinEscapes(linea.Substring(InicioOk.Length, linea.Length - InicioOk.Length - FinOk.Length));
    }

    /** Deshace los escapes de una cadena JSON; null si no es una cadena JSON válida. */
    static string SinEscapes(string cuerpo)
    {
        StringBuilder s = new StringBuilder(cuerpo.Length);
        for (int i = 0; i < cuerpo.Length; i++)
        {
            char c = cuerpo[i];
            if (c == '"' || c < ' ') return null;
            if (c != '\\')
            {
                s.Append(c);
                continue;
            }
            if (++i >= cuerpo.Length) return null;
            switch (cuerpo[i])
            {
                case '"': s.Append('"'); break;
                case '\\': s.Append('\\'); break;
                case '/': s.Append('/'); break;
                case 'b': s.Append('\b'); break;
                case 'f': s.Append('\f'); break;
                case 'n': s.Append('\n'); break;
                case 'r': s.Append('\r'); break;
                case 't': s.Append('\t'); break;
                case 'u':
                    if (i + 4 >= cuerpo.Length) return null;
                    int codigo;
                    if (!Int32.TryParse(cuerpo.Substring(i + 1, 4), System.Globalization.NumberStyles.HexNumber, null, out codigo)) return null;
                    s.Append((char)codigo);
                    i += 4;
                    break;
                default: return null;
            }
        }
        return s.ToString();
    }

    /** Un texto como cadena JSON: comillas, barra invertida y caracteres de control escapados. */
    static string Json(string texto)
    {
        StringBuilder s = new StringBuilder(texto.Length + 2);
        s.Append('"');
        foreach (char c in texto)
        {
            if (c == '"') s.Append("\\\"");
            else if (c == '\\') s.Append("\\\\");
            else if (c < ' ' || c == '\u2028' || c == '\u2029') s.Append("\\u").Append(((int)c).ToString("x4"));
            else s.Append(c);
        }
        s.Append('"');
        return s.ToString();
    }
}
