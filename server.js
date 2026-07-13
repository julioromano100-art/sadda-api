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
  console.error("Error crítico al cargar las credenciales de Google:", error);
}

// =================================================================
// HERRAMIENTAS MATEMÁTICAS (Migradas de Apps Script)
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
  return { lat: parseFloat(partes[0]), lon: parseFloat(partes[1]) };
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

// =================================================================
// RUTAS DE CONTROL Y SALUD (Render y Cron-Job)
// =================================================================
app.get('/', (req, res) => res.send('Servidor SADDA activo.'));
app.get('/ping', (req, res) => res.status(200).send('OK'));

// =================================================================
// ENDPOINTS DE LA API PARA LA APP MÓVIL
// =================================================================

// 1. Buscar DNI de forma dinámica
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
      res.json({ status: "error", msg: "DNI no encontrado en la base de datos." });
    }
  } catch (error) {
    res.status(500).json({ status: "error", msg: "Error del servidor." });
  }
});

// 2. Validar QR y ubicación GPS
app.post('/api/validarEscaneo', (req, res) => {
  try {
    const { qrData, lat, lon } = req.body;
    const coordenadasQR = descifrarCoordenadas(qrData, CLAVE_SECRETA);

    if (isNaN(coordenadasQR.lat) || isNaN(coordenadasQR.lon)) {
      return res.json({ status: "error", msg: "El QR no pertenece a SADDA o está corrupto." });
    }

    const distancia = calcularDistanciaMetros(coordenadasQR.lat, coordenadasQR.lon, lat, lon);

    if (distancia > RADIO_PERMITIDO_METROS) {
      return res.json({ status: "error", msg: `Estás fuera de rango. Distancia: ${Math.round(distancia)}m (Máx 100m).` });
    }

    res.json({ status: "success", data: { evento: "Punto de Control E.E.S. N° 46" } });
  } catch (err) {
    res.json({ status: "error", msg: "Error de descifrado: El QR no es válido." });
  }
});

// 3. Registrar Asistencia Dinámica (Búsqueda inversa para Salida)
app.post('/api/registrarAsistencia', async (req, res) => {
  try {
    const { tipo, dni, nombre, spreadsheetId, tabName } = req.body;
    if (!spreadsheetId) return res.status(400).json({ status: "error", msg: "Falta spreadsheetId" });

    const hoja = tabName || 'asistencia';
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    const ahora = new Date();
    const horaArgentina = ahora.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                          ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (tipo === "ENTRADA") {
      await googleSheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${hoja}!A:D`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[nombre, dni, horaArgentina, ""]] },
      });
      return res.json({ status: "success", msg: "Entrada registrada a las " + horaArgentina });
    } 

    if (tipo === "SALIDA") {
      const lectura = await googleSheets.spreadsheets.values.get({ spreadsheetId, range: `${hoja}!A:D` });
      const filas = lectura.data.values;
      let filaEncontrada = -1;
      
      // Búsqueda de abajo hacia arriba (idéntica a script.txt)
      for (let i = filas.length - 1; i > 0; i--) {
        if (String(filas[i][1]).trim() === String(dni).trim()) {
          filaEncontrada = i + 1; // +1 porque Google Sheets empieza en la fila 1
          break;
        }
      }

      if (filaEncontrada !== -1) {
        await googleSheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${hoja}!D${filaEncontrada}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[horaArgentina]] },
        });
        return res.json({ status: "success", msg: "Salida registrada a las " + horaArgentina });
      } else {
        return res.json({ status: "error", msg: "No se encontró una ENTRADA previa para registrar esta salida." });
      }
    }
  } catch (error) {
    res.status(500).json({ status: "error", msg: "Error al registrar en Google Sheets." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Motor Node.js activado en el puerto ${PORT}`));
