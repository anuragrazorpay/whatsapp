require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store all WhatsApp client sessions here
const SESSIONS = {}; // { [sessionName]: { client, ready, qr } }

// Create a directory for all sessions
const SESSIONS_PATH = path.resolve(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_PATH)) fs.mkdirSync(SESSIONS_PATH);

function startSession(sessionName) {
  if (SESSIONS[sessionName]) return SESSIONS[sessionName];

  const sessionDataPath = path.join(SESSIONS_PATH, sessionName);
  if (!fs.existsSync(sessionDataPath)) fs.mkdirSync(sessionDataPath);

  const session = { ready: false, qr: null };

  session.client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionName, dataPath: sessionDataPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  session.client.on('qr', (qr) => {
    session.qr = qr;
    session.ready = false;
    console.log(`[${sessionName}] QR generated`);
  });

  session.client.on('ready', () => {
    session.ready = true;
    session.qr = null;
    console.log(`[${sessionName}] WhatsApp is ready!`);
  });

  session.client.on('authenticated', () => {
    console.log(`[${sessionName}] WhatsApp authenticated`);
  });

  session.client.on('auth_failure', (msg) => {
    session.ready = false;
    session.qr = null;
    console.error(`[${sessionName}] Auth failure: ${msg}`);
  });

  session.client.on('disconnected', (reason) => {
    session.ready = false;
    session.qr = null;
    console.log(`[${sessionName}] Disconnected: ${reason}`);
    session.client.destroy();
    // Optionally restart the session for auto-recovery
    setTimeout(() => startSession(sessionName), 5000);
  });

  session.client.initialize();
  SESSIONS[sessionName] = session;
  return session;
}

// GET /qr?session=anurag
app.get('/qr', async (req, res) => {
  const sessionName = req.query.session;
  if (!sessionName) return res.status(400).send('Session name required');
  const session = startSession(sessionName);
  if (!session.qr) return res.status(404).send('No QR available');
  // Serve as PNG image
  try {
    const url = await QRCode.toDataURL(session.qr);
    const img = url.split(',')[1];
    const buf = Buffer.from(img, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (e) {
    res.status(500).send('Failed to generate QR');
  }
});

// GET /status?session=anurag
app.get('/status', (req, res) => {
  const sessionName = req.query.session;
  if (!sessionName) return res.status(400).json({ error: 'Session name required' });
  const session = startSession(sessionName);
  res.json({
    connected: session.ready,
    statusText: session.ready ? 'Connected ✅' : (session.qr ? 'Scan QR to connect' : 'Connecting...'),
    qr: !!session.qr
  });
});

// POST /send-whatsapp  { number, message, session }
app.post('/send-whatsapp', async (req, res) => {
  const { number, message, session: sessionName } = req.body;
  if (!sessionName) return res.status(400).json({ status: 'error', error: 'Session name required' });
  if (!number || !message) return res.status(400).json({ status: 'error', error: 'Missing number or message' });

  const session = startSession(sessionName);

  if (!session.ready) {
    return res.status(503).json({ status: 'error', error: `WhatsApp client not ready for session ${sessionName}` });
  }

  const sanitizedNumber = number.replace(/\D/g, '');
  const chatId = sanitizedNumber.endsWith('@c.us') ? sanitizedNumber : `${sanitizedNumber}@c.us`;

  try {
    await session.client.sendMessage(chatId, message);
    return res.json({ status: 'success', message: 'Message sent' });
  } catch (err) {
    console.error(`[${sessionName}] Send message error:`, err);
    return res.status(500).json({ status: 'error', error: 'Failed to send message' });
  }
});

// Landing page (optional)
app.get('/', (req, res) => {
  res.send(`
    <h1>Multi-Session WhatsApp Web API</h1>
    <ul>
      <li><b>/qr?session=NAME</b> - Get QR code for a session</li>
      <li><b>/status?session=NAME</b> - Get WhatsApp status for a session</li>
      <li><b>POST /send-whatsapp {number, message, session}</b> - Send WhatsApp message</li>
    </ul>
  `);
});

app.listen(port, () => {
  console.log(`Multi-Session WhatsApp backend running on port ${port}`);
});
