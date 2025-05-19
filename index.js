require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

const app = express();
const port = process.env.PORT || 3000;
const sessionPath = process.env.WHATSAPP_SESSION || './whatsapp-session';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeDataUrl = null;
let isReady = false;
let client;

async function startWhatsAppClient() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one", dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
  });

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    QRCode.toDataURL(qr).then(url => {
      qrCodeDataUrl = url;
    });
  });

  client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    isReady = true;
    qrCodeDataUrl = null;
  });

  client.on('authenticated', () => {
    console.log('WhatsApp Client authenticated');
  });

  client.on('auth_failure', msg => {
    console.error('Authentication failure', msg);
    isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
    isReady = false;
    qrCodeDataUrl = null;
    client.destroy();
    startWhatsAppClient();
  });

  await client.initialize();
}

startWhatsAppClient().catch(console.error);

// API Endpoint: Send WhatsApp message
app.post('/send-whatsapp', async (req, res) => {
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ status: 'error', error: 'Missing number or message' });
  }

  const sanitizedNumber = number.replace(/\D/g, '');
  if (sanitizedNumber.length < 10) {
    return res.status(400).json({ status: 'error', error: 'Invalid phone number' });
  }

  if (!isReady) {
    return res.status(503).json({ status: 'error', error: 'WhatsApp client not ready' });
  }

  const chatId = sanitizedNumber.includes('@c.us') ? sanitizedNumber : `${sanitizedNumber}@c.us`;

  try {
    await client.sendMessage(chatId, message);
    return res.json({ status: 'success', message: 'Message sent' });
  } catch (err) {
    console.error('Send message error:', err);
    return res.status(500).json({ status: 'error', error: 'Failed to send message' });
  }
});

// Simple connection status and QR code
app.get('/', (req, res) => {
  let qrImage = qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" />` : '';
  let statusText = isReady ? "Connected ✅" : (qrCodeDataUrl ? "Scan QR code below to connect" : "Connecting...");

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <title>WhatsApp Web API</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
      h1 { color: #0B72E7; }
      label { display: block; margin-top: 10px; font-weight: bold; }
      input, textarea { width: 100%; padding: 8px; margin-top: 5px; box-sizing: border-box; }
      button { margin-top: 15px; background-color: #0B72E7; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; }
      button:hover { background-color: #094bb5; }
      #status { margin-bottom: 20px; font-weight: bold; }
      img { margin-top: 10px; max-width: 250px; }
      #result { margin-top: 15px; font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>WhatsApp Web API</h1>
    <div id="status">Status: ${statusText}</div>
    ${qrImage}
    <form id="sendForm">
      <label for="number">Phone Number (with country code, no +):</label>
      <input type="text" id="number" name="number" required placeholder="e.g. 919876543210" />
      <label for="message">Message:</label>
      <textarea id="message" name="message" rows="4" required></textarea>
      <button type="submit">Send WhatsApp Message</button>
    </form>
    <div id="result"></div>

    <script>
      const form = document.getElementById('sendForm');
      const resultDiv = document.getElementById('result');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        resultDiv.textContent = '';

        const number = form.number.value.trim();
        const message = form.message.value.trim();

        if (!number || !message) {
          resultDiv.textContent = 'Please fill in both fields.';
          return;
        }

        try {
          const res = await fetch('/send-whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number, message })
          });
          const data = await res.json();
          if (data.status === 'success') {
            resultDiv.style.color = 'green';
            resultDiv.textContent = 'Message sent successfully!';
          } else {
            resultDiv.style.color = 'red';
            resultDiv.textContent = 'Error: ' + (data.error || 'Unknown error');
          }
        } catch (err) {
          resultDiv.style.color = 'red';
          resultDiv.textContent = 'Fetch error: ' + err.message;
        }
      });
    </script>
  </body>
  </html>
  `);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
