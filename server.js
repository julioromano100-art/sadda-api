const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
// Habilitamos CORS para que la app móvil pueda conectarse sin bloqueos de seguridad
app.use(cors());
// Permite que el servidor entienda los datos en formato JSON que manda React Native
app.use(express.json());

// ==========================================
// 1. CONFIGURACIÓN DE AUTENTICACIÓN
// ==========================================
let auth;

// Si existe la variable en Render, la usamos. Si no, usamos el archivo local.
if (process.env.CRED_JSON_CONTENT) {
  auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.CRED_JSON_CONTENT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
} else {
  // En tu PC, como no existe la variable, entrará por este 'else' y leerá el archivo
  auth = new google.auth.GoogleAuth({
    keyFile: './credenciales.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

// ==========================================
// 2. ENDPOINT: BUSCAR DNI
// ==========================================
app.post('/api/buscarDni', async (req, res) => {
  try {
    // Ahora el servidor recibe el DNI y el ID de la planilla específica de la escuela
    const { dni, spreadsheetId } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({ status: "error", msg: "Falta el ID de la planilla de la escuela." });
    }

    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    // Buscamos en la hoja 'IDusuario' de la planilla que nos pasaron
    const respuesta = await googleSheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'IDusuario!A:B',
    });

    const filas = respuesta.data.values || [];
    const filaEncontrada = filas.find(fila => String(fila[0]).trim() === String(dni).trim());

    if (filaEncontrada) {
      res.json({ status: "success", data: { nombre: filaEncontrada[1] } });
    } else {
      res.json({ status: "error", msg: "DNI no encontrado en la base de datos." });
    }
  } catch (error) {
    console.error("Error en buscarDni:", error);
    res.status(500).json({ status: "error", msg: "Error al consultar la base de datos en Google Sheets." });
  }
});

// ==========================================
// 3. ENDPOINT: REGISTRAR ASISTENCIA
// ==========================================
app.post('/api/registrarAsistencia', async (req, res) => {
  try {
    const { tipo, dni, nombre, spreadsheetId } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({ status: "error", msg: "Falta el ID de la planilla." });
    }

    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    // Ajuste horario exacto para Argentina (GMT-3) independientemente de dónde esté el servidor
    const fechaHora = new Date(new Date().getTime() - (3 * 60 * 60 * 1000));
    const dia = String(fechaHora.getUTCDate()).padStart(2, '0');
    const mes = String(fechaHora.getUTCMonth() + 1).padStart(2, '0');
    const anio = fechaHora.getUTCFullYear();
    const horas = String(fechaHora.getUTCHours()).padStart(2, '0');
    const minutos = String(fechaHora.getUTCMinutes()).padStart(2, '0');
    const segundos = String(fechaHora.getUTCSeconds()).padStart(2, '0');
    const horaFormateada = `${dia}/${mes}/${anio} ${horas}:${minutos}:${segundos}`;

    // LÓGICA DE ENTRADA
    if (tipo === "ENTRADA") {
      await googleSheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: 'asistencia!A:D',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[nombre, dni, horaFormateada, ""]] }, // Deja la columna D (Salida) vacía
      });
      // Devolvemos el formato exacto que espera tu código de React Native
      return res.json({ 
        status: "success", 
        data: { msg: "Entrada registrada a las " + horaFormateada } 
      });
    } 
    
    // LÓGICA DE SALIDA
    if (tipo === "SALIDA") {
      const lectura = await googleSheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'asistencia!A:D',
      });
      
      const filas = lectura.data.values || [];
      let filaIndex = -1;
      
      // Recorremos de abajo hacia arriba para encontrar la ÚLTIMA entrada de este usuario
      for (let i = filas.length - 1; i > 0; i--) {
        if (String(filas[i][1]).trim() === String(dni).trim()) {
          filaIndex = i + 1; // Sumamos 1 porque los arrays de JS empiezan en 0, pero Sheets en 1
          break;
        }
      }

      if (filaIndex !== -1) {
        // Encontramos la entrada, ahora escribimos la hora de salida solo en la columna D
        await googleSheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          range: `asistencia!D${filaIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[horaFormateada]] },
        });
        
        return res.json({ 
          status: "success", 
          data: { msg: "Salida registrada a las " + horaFormateada } 
        });
      } else {
        return res.json({ status: "error", msg: "No se encontró una ENTRADA previa hoy para este DNI." });
      }
    }

  } catch (error) {
    console.error("Error en registrarAsistencia:", error);
    res.status(500).json({ status: "error", msg: "Error al registrar la operación." });
  }
});

// ==========================================
// 4. INICIALIZACIÓN DEL SERVIDOR
// ==========================================
// process.env.PORT es vital para Hostinger, le permite al hosting asignar un puerto libre.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Motor Node.js activado en el puerto ${PORT}`);
});
