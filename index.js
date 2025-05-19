require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// === CONFIG ===
const USERS = {
  // username: password
  anurag: 'pass123',
  pooja: 'pass456',
  amit: 'pass789'
  // ...add more as needed
};
const SESSION_SECRET = process.env.SESSION_SECRET || 'ANU123RAG';

// === EXPRESS APP SETUP ===
const app = express();
const port = process.env.PORT || 8080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// === MULTI-SESSION WHATSAPP SETUP ===
const SESSIONS = {};
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
    setTimeout(() => startSession(sessionName), 5000);
  });

  session.client.initialize();
  SESSIONS[sessionName] = session;
  return session;
}

// === AUTH MIDDLEWARE ===
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  req.session.user = req.session.user.toLowerCase();
  next();
}

// === ROUTES ===

// Login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    return res.redirect('/portal');
  }
  res.render('login', { error: 'Invalid credentials.' });
});

// Logout from web portal session
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Main portal
app.get('/portal', requireLogin, async (req, res) => {
  const sessionName = req.session.user;
  const session = startSession(sessionName);
  let qrDataUrl = null;
  if (session.qr) {
    qrDataUrl = await QRCode.toDataURL(session.qr);
  }
  res.render('portal', {
    username: sessionName,
    connected: session.ready,
    qrDataUrl,
    error: null
  });
});

// Log out WhatsApp session
app.post('/portal/logout', requireLogin, async (req, res) => {
  const sessionName = req.session.user;
  const session = SESSIONS[sessionName];
  if (session && session.client) {
    try {
      await session.client.logout();
      session.ready = false;
      session.qr = null;
    } catch (e) {
      return res.render('portal', {
        username: sessionName,
        connected: false,
        qrDataUrl: null,
        error: "Couldn't log out from WhatsApp. Try again."
      });
    }
  }
  // Re-initialize session to generate new QR
  setTimeout(() => startSession(sessionName), 1000);
  res.redirect('/portal');
});

// (Optional) API endpoint for sending WhatsApp messages
app.post('/send-whatsapp', requireLogin, async (req, res) => {
  const { number, message } = req.body;
  const sessionName = req.session.user;
  const session = startSession(sessionName);

  if (!session.ready) {
    return res.status(503).json({ status: 'error', error: `WhatsApp client not ready for session ${sessionName}` });
  }
  if (!number || !message) {
    return res.status(400).json({ status: 'error', error: 'Missing number or message' });
  }
  const sanitizedNumber = number.replace(/\D/g, '');
  const chatId = sanitizedNumber.endsWith('@c.us') ? sanitizedNumber : `${sanitizedNumber}@c.us`;

  try {
    await session.client.sendMessage(chatId, message);
    return res.json({ status: 'success', message: 'Message sent' });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: 'Failed to send message' });
  }
});

// Home page
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/portal');
  }
  res.redirect('/login');
});

// Static assets for EJS styles, etc.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
  console.log(`WhatsApp Portal running on port ${port}`);
});
