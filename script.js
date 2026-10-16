document.getElementById("loginForm").addEventListener("submit", async function(e){
  e.preventDefault();
  const rut = document.getElementById("rut").value;
  const passwd = document.getElementById("passwd").value;

  const resultadoEl = document.getElementById("resultado");
  resultadoEl.innerText = "⏳ Conectando...";

  try {
    const resp = await fetch("/proxy-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rut, passwd })
    });

    const data = await resp.json();
    resultadoEl.innerText = data.mensaje || JSON.stringify(data);

    if (!resp.ok) {
      console.error("Error /proxy-login:", resp.status, data);
    }
  } catch (err) {
    console.error("Error fetch /proxy-login:", err);
    resultadoEl.innerText = "⚠️ Error al conectar con el servidor.";
  }
});
