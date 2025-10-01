# PeerDrop – AirDrop Style File Sharing over LAN

PeerDrop is a simple **peer-to-peer file sharing app** built with **FastAPI** as the signaling server and **React** as the frontend.  
It uses **WebRTC** under the hood to enable direct file transfer between two peers on the same network — no third-party servers like WhatsApp or Google Drive needed.

---

## ⚡ Features
- Share files instantly over **local Wi-Fi**.
- Works on laptops and desktops — **no cables, no WhatsApp, no pen drives**.
- Secure peer-to-peer connection via **WebRTC DataChannel**.
- Backend only handles signaling (room codes, SDP, ICE exchange).

---

## 🛠 Backend Setup (FastAPI)

### 1. Create Virtual Environment
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
```

```
source venv/bin/activate       # Linux/Mac
```

2. Install Requirements
Add this to requirements.txt:

```
pip install -r requirements.txt
```
3. Run FastAPI Server

```
uvicorn main:app --reload --port 8000
```
Server will run on:
👉 http://127.0.0.1:8000

🎨 Frontend Setup (React)
1. Install Dependencies
```
cd frontend
npm install
```
2. Start React Dev Server
```
npm run dev
```
React app will run on:
👉 http://127.0.0.1:5173 (Vite default)
## 🔗 How It Works

1. Open the **frontend** in two browsers/devices connected to the **same Wi-Fi**.
2. 👤 **User A** clicks **Create Room** → gets a room code from backend (`/new-code`).
3. 👥 **User B** enters that room code to **join the room**.
4. ⚡ The **FastAPI server** relays **SDP + ICE** messages between peers (signaling only).
5. 🔄 Once the **WebRTC connection** is established, files can be sent **directly peer-to-peer**.

---

## ✅ Example Flow

- 👤 **User A** → Creates room → gets code **`ABCD`**.  
- 👥 **User B** → Joins with code **`ABCD`**.  
- 🖥 **Backend** → Only relays signaling messages (does not handle files).  
- 🔗 **Peers connect directly (P2P)**.  
- 📂 **User A drops a file** → **User B downloads instantly**.  

---

## 📌 Notes

- 🌐 Works best on the **same LAN / Wi-Fi**.  
- 🔒 Backend **does not store files** — it only helps peers find each other.  
- 📦 Large files are sent in **chunks** to avoid crashes.  

---

## 🚀 Future Improvements

- 📱 Add **QR code** for easier sharing of room codes.  
- 📊 Show a **progress bar** while transferring files.  
- 🖱 Enable **drag & drop** support for multiple files.  
- 🔐 Add **authentication** for private groups.  

---

## 🖥️ Tech Stack

- ⚙️ **Backend:** FastAPI + WebSockets  
- 🎨 **Frontend:** React + WebRTC API  
- 📡 **Signaling Protocol:** SDP + ICE  

---
