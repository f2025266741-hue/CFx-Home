from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import uuid
import database
import auth
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session tracking for active users
# user_id -> {role, alias, real_name, icon, slot, websocket}
active_connections: Dict[str, Dict] = {}

class LoginRequest(BaseModel):
    role: str
    password: Optional[str] = None
    real_name: Optional[str] = None
    code: Optional[str] = None
    slot: Optional[int] = None

class LinkCreate(BaseModel):
    title: str
    url: str
    description: Optional[str] = None

class AnnouncementCreate(BaseModel):
    content: str

# --- API Routes ---

@app.post("/api/login")
async def login(req: LoginRequest):
    conn = database.get_db_connection()
    user_id = str(uuid.uuid4())
    token_data = {"id": user_id, "role": req.role}
    
    if req.role == "Admin":
        if not req.password or not req.slot:
            raise HTTPException(status_code=400, detail="Password and Slot required")
        
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'admin_password'")
        row = cursor.fetchone()
        
        # In a real app we'd use hashing, but for this shared changeable password
        # we check the stored value. The prompt says "share a single password".
        if req.password != row["value"]:
            raise HTTPException(status_code=401, detail="Invalid password")
        
        token_data["slot"] = req.slot
        token_data["real_name"] = f"Admin {req.slot}"
        
    elif req.role == "User":
        if not req.real_name or not req.code:
            raise HTTPException(status_code=400, detail="Name and Code required")
        
        if req.code == "sugar":
            token_data["role"] = "Standard User"
            token_data["alias"] = auth.generate_alias()
            token_data["real_name"] = req.real_name
        elif req.code == "gumnaam":
            token_data["role"] = "Agent"
            token_data["real_name"] = req.real_name
            token_data["icon"] = "🕵️" # Special agent icon
        else:
            raise HTTPException(status_code=401, detail="Invalid confirmation code")
            
    token = auth.create_access_token(token_data)
    conn.close()
    return {"access_token": token, "token_type": "bearer", "user": token_data}

@app.get("/api/links")
async def get_links():
    conn = database.get_db_connection()
    links = conn.execute("SELECT * FROM links").fetchall()
    conn.close()
    return [dict(l) for l in links]

@app.post("/api/links")
async def create_link(link: LinkCreate):
    # Auth check would go here (Admin only)
    conn = database.get_db_connection()
    conn.execute("INSERT INTO links (title, url, description) VALUES (?, ?, ?)",
                 (link.title, link.url, link.description))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/announcements")
async def get_announcements():
    conn = database.get_db_connection()
    ann = conn.execute("SELECT * FROM announcements ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(a) for a in ann]

@app.post("/api/announcements")
async def create_announcement(ann: AnnouncementCreate):
    conn = database.get_db_connection()
    conn.execute("INSERT INTO announcements (content) VALUES (?)", (ann.content,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/admins/status")
async def get_admin_status():
    conn = database.get_db_connection()
    status = conn.execute("SELECT slot, is_available FROM admin_status").fetchall()
    conn.close()
    return [dict(s) for s in status]

@app.post("/api/admins/toggle")
async def toggle_admin_status(slot: int, available: bool):
    conn = database.get_db_connection()
    conn.execute("UPDATE admin_status SET is_available = ? WHERE slot = ?", (available, slot))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/admins/change-password")
async def change_admin_password(new_password: str):
    conn = database.get_db_connection()
    conn.execute("UPDATE settings SET value = ? WHERE key = 'admin_password'", (new_password,))
    conn.commit()
    conn.close()
    return {"status": "success"}

# --- WebSocket ---

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_data: Dict[str, dict] = {}

    async def connect(self, websocket: WebSocket, token: str):
        payload = auth.verify_token(token)
        if not payload:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None
        
        user_id = payload["id"]
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_data[user_id] = payload
        return user_id

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            del self.user_data[user_id]

    async def broadcast(self, message: dict, portal: str, sender_id: str):
        sender_data = self.user_data.get(sender_id)
        if not sender_data: return

        for uid, ws in self.active_connections.items():
            recipient_data = self.user_data.get(uid)
            if not recipient_data: continue

            # Permission logic
            can_see = False
            visible_sender_name = sender_data.get("real_name")

            if portal == "1": # Admin to Admin
                if sender_data["role"] == "Admin" and recipient_data["role"] == "Admin":
                    can_see = True
            
            elif portal == "2": # Admin to User (Direct)
                # Messages for portal 2 should have a target_id
                target_id = message.get("target_id")
                if (uid == target_id or uid == sender_id):
                    can_see = True
                    # Masking logic for Portal 2
                    if recipient_data["role"] != "Admin":
                        # User sees Admin Slot
                        if sender_data["role"] == "Admin":
                            visible_sender_name = f"Admin {sender_data['slot']}"
                    # Admin sees User's Real Name (default handled by visible_sender_name)

            elif portal == "3": # User to User (Public)
                if recipient_data["role"] in ["Admin", "Standard User"]:
                    can_see = True
                    # Privacy logic for Portal 3
                    if recipient_data["role"] != "Admin":
                        # Standard users see aliases
                        visible_sender_name = sender_data.get("alias") or sender_data.get("real_name")
                    # Admins see Real Name (handled by visible_sender_name)

            elif portal == "4": # Agent to Admin
                if recipient_data["role"] in ["Admin", "Agent"] and sender_data["role"] in ["Admin", "Agent"]:
                    # Ensure Agents don't see Portal 1, 2, 3 (handled by filtering their participation here)
                    if (sender_data["role"] == "Agent" or recipient_data["role"] == "Agent"):
                        can_see = True

            if can_see:
                await ws.send_json({
                    "portal": portal,
                    "sender": visible_sender_name,
                    "icon": sender_data.get("icon"),
                    "content": message["content"],
                    "timestamp": time.time()
                })

manager = ConnectionManager()

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    user_id = await manager.connect(websocket, token)
    if not user_id: return
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            # message should have: portal, content, target_id (optional)
            await manager.broadcast(message, message["portal"], user_id)
    except WebSocketDisconnect:
        manager.disconnect(user_id)

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
