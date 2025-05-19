# WhatsApp Web API Backend

A production-ready backend for sending WhatsApp messages via WhatsApp Web.js, with persistent session and simple web UI.

## Deploy on Railway

1. [Create a new project on Railway](https://railway.app/)
2. Connect your GitHub repo or upload these files.
3. Set your environment variables (see `.env.example`).
4. Deploy and open the web URL.
5. On first run, scan the QR code on the `/` page with your WhatsApp app.
6. Use the `/send-whatsapp` API or the web UI to send messages.

## API

**POST** `/send-whatsapp`  
Body:
```json
{
  "number": "919876543210",
  "message": "Hello from WhatsApp Web API!"
}
