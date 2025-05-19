require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

const app = express();
const port = process.env.PORT || 8080;
const sessionPath = process.env.WHATSAPP_SESSION || './whatsapp-session';

app.use(cors()); // Allow all origins (adjust as needed for security)
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
    console.log('QR RECEIVED, ready to scan.');
    qrcode.generate(qr, { small: true }); // For CLI debug
    QRCode.toDataURL(qr).then(url => {
      qrCodeDataUrl = url;
      console.log('QR Data URL generated.');
    });
    isReady = false;
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
    qrCodeDataUrl = null;
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

// ====== OPEN ENDPOINTS ======

// QR code image (PNG) endpoint
app.get('/qr', (req, res) => {
  if (!qrCodeDataUrl) return res.status(404).send('No QR available');
  const img = qrCodeDataUrl.split(',')[1];
  const buf = Buffer.from(img, 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length
  });
  res.end(buf);
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    connected: isReady,
    statusText: isReady ? "Connected ✅" : (qrCodeDataUrl ? "Scan QR code below to connect" : "Connecting..."),
    qr: !!qrCodeDataUrl
  });
});

// Send WhatsApp message endpoint (open to all POST requests)
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

// Root: Simple landing/status page (optional)
app.get('/', (req, res) => {
  res.send(`
    <h1>WhatsApp Web API Server</h1>
    <ul>
      <li><a href="/status">/status</a> - Get connection status</li>
      <li><a href="/qr">/qr</a> - Get current QR code (PNG)</li>
      <li>/send-whatsapp [POST] - Send WhatsApp message</li>
    </ul>
  `);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
