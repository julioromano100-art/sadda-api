const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configuración de autenticación con Google usando la Variable de Entorno
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
// 1. RUTAS DE CONTROL Y SALUD (Para Render y Cron-Job)
// =================================================================

// Ruta Raíz: Aprueba el Health Check de Render para activar el botón "Live" en verde
app.get('/', (req, res) => {
  res.send('El servidor de SADDA está activo y respondiendo correctamente.');
});

// Ruta Ping: Específica para cron-job.org. Devuelve una respuesta minúscula para evitar el error de "salida grande"
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});


// =================================================================
// 2. ENDPOINTS DINÁMICOS PARA TU APP MÓVIL
// =================================================================

// Endpoint para buscar un DNI en cualquier pestaña y rango
app.post('/api/buscarDni', async (req, res) => {
  try {
    // Recibimos los parámetros dinámicos desde el body de la petición
    const { dni, spreadsheetId, tabName, rangeColumns } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({ error: "Falta el spreadsheetId de la planilla." });
    }

    // Configuración dinámica de Pestaña y Columnas (si no se envían, usa valores por defecto)
    const hoja = tabName || 'IDusuario';
    const rangoColumnas = rangeColumns || 'A:H'; // Ejemplo dinámico: 'A:H', 'A:B', etc.
    const rangoCompleto = `${hoja}!${rangoColumnas}`;

    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    const respuesta = await googleSheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: rangoCompleto,
    });

    const filas = respuesta.data.values;
    if (!filas || filas.length === 0) {
      return res.json({ encontrado: false, mensaje: "La hoja está vacía." });
    }

    // Buscamos el DNI dentro de la matriz de filas obtenida
    const alumnoEncontrado = filas.find(fila => fila.includes(dni.toString()));

    if (alumnoEncontrado) {
      res.json({ encontrado: true, datos: alumnoEncontrado });
    } else {
      res.json({ encontrado: false, mensaje: "DNI no registrado en esta pestaña." });
    }

  } catch (error) {
    console.error("Error en buscarDni:", error);
    res.status(500).json({ error: "Error interno del servidor", detalle: error.message });
  }
});

// Endpoint para registrar asistencias en cualquier pestaña de forma dinámica
app.post('/api/registrarAsistencia', async (req, res) => {
  try {
    const { tipo, dni, nombre, spreadsheetId, tabName, rangeColumns } = req.body;

    if (!spreadsheetId) {
      return res.status(400).json({ error: "Falta el spreadsheetId de la planilla." });
    }

    // Configuración dinámica
    const hoja = tabName || 'asistencia';
    const rangoColumnas = rangeColumns || 'A:D'; 
    const rangoCompleto = `${hoja}!${rangoColumnas}`;

    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });

    // Fecha y hora configuradas en la zona horaria de Argentina
    const ahora = new Date();
    const fechaArgentina = ahora.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const horaArgentina = ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    if (tipo === "ENTRADA") {
      await googleSheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: rangoCompleto,
        valueInputOption: 'USER_ENTERED',
        resource: { 
          values: [[nombre, dni, fechaArgentina, horaArgentina, ""]] 
        },
      });
      return res.json({ exito: true, mensaje: "Entrada guardada de forma dinámica." });
    }

    if (tipo === "SALIDA") {
      // Tu lógica actual para leer las filas y actualizar la celda de salida
      const lectura = await googleSheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: rangoCompleto,
      });

      const filas = lectura.data.values;
      
      // Aquí agregás tu lógica de bucle para encontrar el DNI de hoy y meter el update.
      // (Mantenemos la estructura limpia usando 'rangoCompleto' para que no falle)
      
      return res.json({ exito: true, mensaje: "Procesando salida..." });
    }

  } catch (error) {
    console.error("Error en registrarAsistencia:", error);
    res.status(500).json({ error: "Error interno del servidor", detalle: error.message });
  }
});


// =================================================================
// 3. ASIGNACIÓN DE PUERTO (Vital para Render)
// =================================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Motor Node.js activado en el puerto ${PORT}`);
});
