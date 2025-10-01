from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import random
import string
import json
import asyncio
import logging
from typing import Dict, List

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active rooms and connections
rooms: Dict[str, List[WebSocket]] = {}

@app.get("/")
def root():
    """Health check endpoint"""
    return {"message": "WebSocket File Sharing Server is running"}

@app.get("/new-code")
def new_code():
    """Generate a new room code"""
    code = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    logger.info(f"Generated new room code: {code}")
    return {"code": code}

@app.get("/room/{room_code}/status")
def room_status(room_code: str):
    """Get room status and peer count"""
    peer_count = len(rooms.get(room_code, []))
    return {
        "room_code": room_code,
        "peer_count": peer_count,
        "active": room_code in rooms and peer_count > 0
    }

async def broadcast_peer_count(room_code: str):
    """Send peer count to all clients in a room"""
    if room_code in rooms:
        count = len(rooms[room_code])
        message = {"type": "peers", "count": count}
        logger.info(f"Broadcasting peer count {count} to room {room_code}")
        
        # Create a copy of the list to avoid modification during iteration
        peers = rooms[room_code].copy()
        disconnected_peers = []
        
        for peer in peers:
            try:
                await peer.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to peer: {e}")
                disconnected_peers.append(peer)
        
        # Remove disconnected peers
        for peer in disconnected_peers:
            if peer in rooms[room_code]:
                rooms[room_code].remove(peer)

async def cleanup_room(room_code: str, websocket: WebSocket):
    """Clean up room after disconnect"""
    if room_code in rooms:
        if websocket in rooms[room_code]:
            rooms[room_code].remove(websocket)
            logger.info(f"Removed peer from room {room_code}")
        
        if rooms[room_code]:
            # Notify remaining peers about updated count
            await broadcast_peer_count(room_code)
        else:
            # Clean up empty room
            del rooms[room_code]
            logger.info(f"Cleaned up empty room {room_code}")

@app.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    await websocket.accept()
    logger.info(f"WebSocket connected to room: {room_code}")

    # Initialize room if it doesn't exist
    if room_code not in rooms:
        rooms[room_code] = []

    rooms[room_code].append(websocket)
    
    # Notify all peers about the updated count
    await broadcast_peer_count(room_code)

    try:
        while True:
            try:
                # Set a timeout to prevent hanging
                message = await asyncio.wait_for(websocket.receive(), timeout=300.0)
                
                if message["type"] == "websocket.disconnect":
                    break
                    
                if "text" in message and message["text"]:
                    # Parse and forward JSON messages (SDP, ICE, meta, file info)
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type", "unknown")
                        logger.info(f"Received {msg_type} message in room {room_code}")
                        
                        # Forward to other peers in the room
                        peers = rooms[room_code].copy()
                        for peer in peers:
                            if peer != websocket:
                                try:
                                    await peer.send_text(message["text"])
                                except Exception as e:
                                    logger.warning(f"Failed to forward text message: {e}")
                                    
                    except json.JSONDecodeError:
                        logger.warning("Received invalid JSON text message")
                        # Still forward non-JSON text messages
                        peers = rooms[room_code].copy()
                        for peer in peers:
                            if peer != websocket:
                                try:
                                    await peer.send_text(message["text"])
                                except Exception as e:
                                    logger.warning(f"Failed to forward text message: {e}")
                
                elif "bytes" in message and message["bytes"]:
                    # Forward binary data (file chunks)
                    logger.info(f"Received binary data ({len(message['bytes'])} bytes) in room {room_code}")
                    peers = rooms[room_code].copy()
                    for peer in peers:
                        if peer != websocket:
                            try:
                                await peer.send_bytes(message["bytes"])
                            except Exception as e:
                                logger.warning(f"Failed to forward binary message: {e}")
                                
            except asyncio.TimeoutError:
                # Send ping to check if connection is still alive
                try:
                    await websocket.send_json({"type": "ping"})
                except:
                    break
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected from room: {room_code}")
    except Exception as e:
        logger.error(f"WebSocket error in room {room_code}: {e}")
    finally:
        # Clean up the connection
        await cleanup_room(room_code, websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")