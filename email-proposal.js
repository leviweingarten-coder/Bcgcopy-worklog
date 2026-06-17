// netlify/functions/email-proposal.js
// Uses Gmail SMTP with App Password - no OAuth, never expires
// Required env vars: GMAIL_USER, GMAIL_APP_PASSWORD

const tls = require("tls");
const net = require("net");

function base64(str) {
  return Buffer.from(str).toString("base64");
}

function smtpCommand(socket, cmd) {
  return new Promise((resolve) => {
    let response = "";
    const handler = (data) => {
      response += data.toString();
      if (response.match(/^\d{3} /m)) {
        socket.removeListener("data", handler);
        resolve(response);
      }
    };
    socket.on("data", handler);
    if (cmd) socket.write(cmd + "\r\n");
  });
}

async function sendEmail(to, subject, html, from, appPassword) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(587, "smtp.gmail.com");

    sock.on("error", reject);

    sock.on("connect", async () => {
      try {
        // Read greeting
        await smtpCommand(sock, null);
        // EHLO
        await smtpCommand(sock, "EHLO ldhstudio.netlify.app");
        // STARTTLS
        await smtpCommand(sock, "STARTTLS");

        // Upgrade to TLS
        const tlsSock = tls.connect({ socket: sock, host: "smtp.gmail.com" });

        tlsSock.on("error", reject);
        tlsSock.on("secureConnect", async () => {
          try {
            await smtpCommand(tlsSock, "EHLO ldhstudio.netlify.app");
            // AUTH LOGIN
            await smtpCommand(tlsSock, "AUTH LOGIN");
            await smtpCommand(tlsSock, base64(from));
            await smtpCommand(tlsSock, base64(appPassword));
            // Mail from / rcpt to
            await smtpCommand(tlsSock, "MAIL FROM:<" + from + ">");
            await smtpCommand(tlsSock, "RCPT TO:<" + to + ">");
            await smtpCommand(tlsSock, "DATA");

            // Build email
            const boundary = "boundary_ldh_" + Date.now();
            const encodedSubject = "=?UTF-8?B?" + Buffer.from(subject).toString("base64") + "?=";
            const encodedHtml = Buffer.from(html).toString("base64").match(/.{1,76}/g).join("\r\n");

            const message = [
              "From: " + from,
              "To: " + to,
              "Subject: " + encodedSubject,
              "MIME-Version: 1.0",
              'Content-Type: multipart/alternative; boundary="' + boundary + '"',
              "",
              "--" + boundary,
              "Content-Type: text/plain; charset=UTF-8",
              "",
              "Please view this email in an HTML-compatible email client.",
              "",
              "--" + boundary,
              "Content-Type: text/html; charset=UTF-8",
              "Content-Transfer-Encoding: base64",
              "",
              encodedHtml,
              "",
              "--" + boundary + "--",
              "."
            ].join("\r\n");

            const resp = await smtpCommand(tlsSock, message);
            await smtpCommand(tlsSock, "QUIT");
            tlsSock.destroy();
            sock.destroy();

            if (resp.startsWith("250")) {
              resolve({ success: true });
            } else {
              reject(new Error("SMTP error: " + resp));
            }
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const gmailUser = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !appPassword) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing env vars: GMAIL_USER and/or GMAIL_APP_PASSWORD" })
    };
  }

  let to, subject, html;
  try {
    const body = JSON.parse(event.body);
    to = body.to;
    subject = body.subject;
    html = body.html;
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!to || !subject || !html) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing to, subject, or html" }) };
  }

  try {
    await sendEmail(to, subject, html, gmailUser, appPassword);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: "Email sent successfully" })
    };
  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "SMTP error: " + err.message })
    };
  }
};
