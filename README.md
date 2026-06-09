---
title: Whatsapp Backend
sdk: docker
app_port: 7860
---

<div align="center">

# 💬 WhatsApp Clone — Backend API

A production-ready, real-time messaging server built with Node.js — featuring WebSocket signaling for peer-to-peer calls, media uploads, push notifications, and a security-hardened REST API.

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://prisma.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

**[🌐 Live Demo](https://whatsapp-server1.vercel.app)** · **[📱 Client Repo](https://github.com/mohamed-ayad40/Whatsapp-client)**

</div>

---

## ✨ Features

- **Real-Time Messaging** — Bidirectional communication via Socket.io with online/offline presence and message delivery events
- **WebRTC Signaling** — Acts as the signaling server for peer-to-peer voice and video calls (offer/answer/ICE candidate relay)
- **Authentication** — Firebase-based auth with secure token verification middleware
- **Media Uploads** — Image and audio message handling with Cloudinary integration
- **Database** — Type-safe MongoDB access via Prisma ORM
- **Security-First** — Helmet.js headers, rate limiting, input sanitization via `sanitize-html`, and CORS protection
- **Push Notifications** — Server-side Firebase Admin SDK for mobile/web push delivery
- **Containerized** — Full Docker support for consistent local and production environments

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM modules) |
| Framework | Express.js |
| Database | MongoDB |
| ORM | Prisma |
| Real-Time | Socket.io 4.6 |
| Media Storage | Cloudinary |
| Auth & Push | Firebase Admin SDK |
| Security | Helmet, express-rate-limit, sanitize-html |
| File Uploads | Multer |
| Containerization | Docker |
| Deployment | Vercel |

---

## 📁 Project Structure

```
├── config/          # Environment & service configuration
├── controllers/     # Route handler logic
├── middlewares/     # Auth, validation, and security middleware
├── prisma/          # MongoDB schema
├── routes/          # API route definitions
├── uploads/         # Temporary media storage
├── utils/           # Shared helper functions
├── index.js         # App entry point
├── Dockerfile       # Container definition
└── vercel.json      # Vercel deployment config
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- MongoDB database (Atlas or local)
- Cloudinary account
- Firebase project

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/mohamed-ayad40/Whatsapp-server1.git
cd Whatsapp-server1

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Fill in your DATABASE_URL, CLOUDINARY_*, FIREBASE_* keys

# 4. Generate Prisma client
npx prisma generate

# 5. Start the development server
npm start
```

### Docker

```bash
docker build -t whatsapp-server .
docker run -p 7860:7860 --env-file .env whatsapp-server
```

---

## 🔌 API Overview

| Module | Description |
|---|---|
| Auth | Register, login, token verification |
| Users | Profile management, search, online status |
| Messages | Send, receive, and delete messages |
| Media | Upload images and audio clips |
| Signaling | WebRTC offer/answer/ICE relay via Socket.io |

---

## 🔒 Security

- **Helmet.js** — Sets secure HTTP response headers
- **Rate Limiting** — Prevents brute-force and DDoS attempts
- **Input Sanitization** — Strips malicious HTML from all user input
- **Firebase Auth Middleware** — Verifies every protected request with a valid JWT

---

## 📄 License

MIT © [Mohamed Ayad](https://github.com/mohamed-ayad40)
