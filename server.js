const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// =================================================================
// CONFIGURACIÓN Y SEGURIDAD
// =================================================================
const CLAVE_SECRETA = "SADDA_EES46_SECRET_2026"; 
const RADIO_PERMITIDO_METROS = 100;

let auth;
try {
  const credentials = JSON.parse(process.env.CRED_JSON_CONTENT);
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (error) {
  console.error("Error crítico al cargar las credenciales:", error);
}

// =================================================================
// HERRAMIENTAS MATEMÁTICAS
// =================================================================
const descifrarCoordenadas = (textoHex, clave) => {
  let textoOriginal = "";
  for (let i = 0; i < textoHex.length; i += 2) {
    let hexByte = textoHex.substr(i, 2);
    let charCode = parseInt(hexByte, 16);
    let charClave = clave.charCodeAt((i / 2) % clave.length);
    textoOriginal += String.fromCharCode(charCode ^ charClave);
  }
  
  let partes = textoOriginal.split(",");
  return { 
    lat: parseFloat(partes[0]), 
    lon: parseFloat(partes[1]),
    evento: partes[2] ? partes[2].trim() : "Evento General" 
  };
};

const calcularDistanciaMetros = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const f1 = lat1 * Math.PI / 180;
  const f2 = lat2 * Math.PI / 180;
  const deltaF = (lat2 - lat1) * Math.PI / 180;
  const deltaL = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaF / 2) * Math.sin(deltaF / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(deltaL / 2) * Math.sin(deltaL / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

app.get('/', (req, res) => res.send('Servidor activo.'));
app.get('/ping', (req, res) => res.status(200).send('OK'));

// =================================================================
// ENDPOINTS
// =================================================================

app.post('/api/buscarDni', async (req, res) => {
  try {
    const { dni, spreadsheetId, tabName, rangeColumns } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "Falta spreadsheetId" });

    const hoja = tabName || 'IDusuario';
    const rangoCompleto = `${hoja}!${rangeColumns || 'A:B'}`;

    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });
    const respuesta = await googleSheets.spreadsheets.values.get({ spreadsheetId, range: rangoCompleto });

    const filas = respuesta.data.values;
    if (!filas) return res.json({ status: "error", msg: "La hoja está vacía." });

    const alumnoEncontrado = filas.find(fila => String(fila[0]).trim() === String(dni).trim());

    if (alumnoEncontrado) {
      res.json({ status: "success", data: { nombre: alumnoEncontrado[1] } });
    } else {
      res.json({ status: "error", msg: "DNI no encontrado." });
    }
  } catch (error) {
    res.status(500).json({ status: "error", msg: "Error del servidor." });
  }
});

// LOGIN DE ADMIN REPARADO Y OPTIMIZADO
app.post('/api/loginAdmin', async (req, res) => {
  try {
    const { usuario, clave, spreadsheetId, tabName } = req.body;
    
    if (!spreadsheetId) return res.status(400).json({ status: "error", msg: "Falta spreadsheetId" });
    if (!usuario || !clave) return res.status(400).json({ status: "error", msg: "Faltan credenciales" });

    const hoja = tabName || 'IDusuario';
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });
    
    const respuesta = await googleSheets.spreadsheets.values.get({ 
      spreadsheetId, 
      range: `${hoja}!A:C` 
    });

    const filas = respuesta.data.values;
    if (!filas) return res.json({ status: "error", msg: "La hoja de usuarios está vacía." });

    // Búsqueda a prueba de fallos (ignora mayúsculas/minúsculas en el usuario y evita errores de columnas vacías)
    const inputUsuario = String(usuario).trim().toLowerCase();
    const inputClave = String(clave).trim();

    const adminEncontrado = filas.find(fila => {
      const sheetClave = fila[0] ? String(fila[0]).trim() : "";
      const sheetUsuario = fila[1] ? String(fila[1]).trim().toLowerCase() : "";
      return sheetClave === inputClave && sheetUsuario === inputUsuario;
    });

    if (adminEncontrado) {
      // Si la columna C existe toma ese nombre, sino usa el usuario de la columna B
      const nombreAdmin = adminEncontrado[2] ? adminEncontrado[2].trim() : adminEncontrado[1].trim();
      res.json({ status: "success", data: { nombre: nombreAdmin } });
    } else {
      res.json({ status: "error", msg: "Usuario o clave incorrectos." });
    }
  } catch (error) {
    console.error("Error en loginAdmin:", error);
    res.status(500).json({ status: "error", msg: "Error de servidor al validar login." });
  }
});

app.post('/api/validarEscaneo', (req, res) => {
  try {
    const { qrData, lat, lon } = req.body;
    const coordenadasQR = descifrarCoordenadas(qrData, CLAVE_SECRETA);

    if (isNaN(coordenadasQR.lat) || isNaN(coordenadasQR.lon)) {
      return res.json({ status: "error", msg: "El QR no es de SADDA o está corrupto." });
    }

    const distancia = calcularDistanciaMetros(coordenadasQR.lat, coordenadasQR.lon, lat, lon);

    if (distancia > RADIO_PERMITIDO_METROS) {
      return res.json({ status: "error", msg: `Fuera de rango. Distancia: ${Math.round(distancia)}m (Máx 100m).` });
    }

    res.json({ status: "success", data: { evento: coordenadasQR.evento } });
  } catch (err) {
    res.json({ status: "error", msg: "Error de descifrado." });
  }
});

app.post('/api/registrarAsistencia', async (req, res) => {
  try {
    const { tipo, dni, nombre, evento, duracion, spreadsheetId, tabName } = req.body;
    if (!spreadsheetId) return res.status(400).json({ status: "error", msg: "Falta spreadsheetId" });

    const hoja = tabName || 'asistencia';
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    const ahora = new Date();
    const fechaArgentina = ahora.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaArgentina = ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
    
    // Combinamos Fecha y Hora en una sola variable para inyectarla en la columna D y E
    const fechaHoraActual = `${fechaArgentina} ${horaArgentina}`;

    if (tipo === "ENTRADA") {
      await googleSheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${hoja}!A:F`, // Columnas A hasta F
        valueInputOption: 'USER_ENTERED',
        // A:Evento, B:Nombre, C:DNI, D:Entrada(Fecha y Hora), E:Salida(vacía), F:Duracion(vacía)
        resource: { values: [[evento || "Evento General", nombre, dni, fechaHoraActual, "", ""]] },
      });
      return res.json({ status: "success", msg: "Entrada registrada a las " + horaArgentina });
    } 

    if (tipo === "SALIDA") {
      const lectura = await googleSheets.spreadsheets.values.get({ spreadsheetId, range: `${hoja}!A:F` });
      const filas = lectura.data.values;
      let filaEncontrada = -1;
      
      // Recorremos de abajo hacia arriba para buscar la última entrada de ese DNI
      for (let i = filas.length - 1; i > 0; i--) {
        // Col C es índice 2 (DNI). Verificamos que coincida el DNI.
        // Col E es índice 4 (Salida). Verificamos que esté vacía para no pisar salidas ya registradas.
        if (filas[i][2] && String(filas[i][2]).trim() === String(dni).trim() && !filas[i][4]) {
          filaEncontrada = i + 1; // +1 porque los arrays empiezan en 0 y las hojas en 1
          break;
        }
      }

      if (filaEncontrada !== -1) {
        await googleSheets.spreadsheets.values.update({
          spreadsheetId,
          // Actualizamos específicamente la columna E (Salida) y F (Duración)
          range: `${hoja}!E${filaEncontrada}:F${filaEncontrada}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[fechaHoraActual, duracion]] },
        });
        return res.json({ status: "success", msg: "Salida registrada a las " + horaArgentina });
      } else {
        return res.json({ status: "error", msg: "No se encontró ENTRADA previa pendiente de cierre." });
      }
    }
  } catch (error) {
    console.error("Error en registrarAsistencia:", error);
    res.status(500).json({ status: "error", msg: "Error al registrar en la planilla." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Motor Node.js activado en el puerto ${PORT}`));
