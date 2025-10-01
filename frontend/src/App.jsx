import React, { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:8000/ws/";
const API_URL = "http://localhost:8000";

export default function App() {
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [peerCount, setPeerCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sendProgress, setSendProgress] = useState(0);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);
  const [receivingFileName, setReceivingFileName] = useState("");

  const wsRef = useRef(null);
  const receiveBuffer = useRef([]);
  const expectedFileSize = useRef(0);
  const receivedFileSize = useRef(0);
  const expectedFileName = useRef("");

  async function newCode() {
    try {
      const res = await fetch(API_URL + "/new-code");
      const data = await res.json();
      setCode(data.code);
    } catch (error) {
      console.error("Failed to get new code:", error);
      setStatus("Failed to get room code");
    }
  }

  useEffect(() => {
    newCode();
  }, []);

  function addMessage(type, content, from = "system") {
    const timestamp = new Date().toLocaleTimeString();
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        type,
        content,
        from,
        timestamp,
      },
    ]);
  }

  async function join() {
    if (!code) return;

    try {
      const ws = new WebSocket(WS_URL + code);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Connected to room");
        setJoined(true);
        addMessage("system", `Connected to room ${code}`);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data);
            handleJsonMessage(message);
          } catch (error) {
            // Plain text message
            addMessage("text", event.data, "peer");
          }
        } else if (
          event.data instanceof Blob ||
          event.data instanceof ArrayBuffer
        ) {
          handleBinaryData(event.data);
        }
      };

      ws.onclose = () => {
        setStatus("Disconnected");
        setJoined(false);
        addMessage("system", "Disconnected from room");
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("Connection error");
        addMessage("system", "Connection error");
      };
    } catch (error) {
      console.error("Failed to connect:", error);
      setStatus("Failed to connect");
    }
  }

  function handleJsonMessage(message) {
    console.log("Received JSON message:", message);

    if (message.type === "peers") {
      setPeerCount(message.count);
      setStatus(`Connected - ${message.count} peer(s) in room`);
      addMessage("system", `Peer count updated: ${message.count}`);
    } else if (message.type === "file_info") {
      // File transfer starting
      expectedFileName.current = message.filename || "unknown_file";
      expectedFileSize.current = message.size || 0;
      receivedFileSize.current = 0;
      receiveBuffer.current = [];
      setIsReceiving(true);
      setReceivingFileName(expectedFileName.current);
      setReceiveProgress(0);
      addMessage(
        "system",
        `Receiving file: ${message.filename} (${(
          message.size /
          1024 /
          1024
        ).toFixed(2)} MB)`
      );
    } else if (message.type === "file_chunk") {
      // Chunk metadata - just for info
      console.log(
        `Receiving chunk ${message.chunk_index}/${message.total_chunks || "?"}`
      );
    } else if (message.type === "file_complete") {
      // File transfer complete
      if (receiveBuffer.current.length > 0) {
        downloadReceivedFile();
      }
    } else {
      // Generic message from peer
      addMessage("json", JSON.stringify(message, null, 2), "peer");
    }
  }

  async function handleBinaryData(data) {
    console.log("Received binary data:", data);

    let arrayBuffer;
    if (data instanceof Blob) {
      arrayBuffer = await data.arrayBuffer();
    } else {
      arrayBuffer = data;
    }

    receiveBuffer.current.push(arrayBuffer);
    receivedFileSize.current += arrayBuffer.byteLength;

    if (expectedFileSize.current > 0) {
      const progress = Math.round(
        (receivedFileSize.current / expectedFileSize.current) * 100
      );
      setReceiveProgress(progress);
    }

    addMessage(
      "system",
      `Received binary chunk: ${arrayBuffer.byteLength} bytes`
    );

    // Auto-download if we've received all expected data
    if (
      expectedFileSize.current > 0 &&
      receivedFileSize.current >= expectedFileSize.current
    ) {
      downloadReceivedFile();
    }
  }

  function downloadReceivedFile() {
    if (receiveBuffer.current.length === 0) return;

    const blob = new Blob(receiveBuffer.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = expectedFileName.current || "received_file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addMessage(
      "system",
      `File downloaded: ${expectedFileName.current} (${(
        blob.size /
        1024 /
        1024
      ).toFixed(2)} MB)`
    );

    // Reset receiving state
    receiveBuffer.current = [];
    receivedFileSize.current = 0;
    expectedFileSize.current = 0;
    expectedFileName.current = "";
    setIsReceiving(false);
    setReceivingFileName("");
    setReceiveProgress(0);
  }

  function sendMessage() {
    if (!newMessage.trim() || !wsRef.current) return;

    try {
      const message = {
        type: "chat",
        message: newMessage,
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(message));
      addMessage("json", JSON.stringify(message, null, 2), "you");
      setNewMessage("");
    } catch (error) {
      console.error("Failed to send message:", error);
      addMessage("system", "Failed to send message");
    }
  }

  async function sendFile(file) {
    if (!file || !wsRef.current) return;

    try {
      // Send file info first
      const fileInfo = {
        type: "file_info",
        filename: file.name,
        size: file.size,
        timestamp: Date.now(),
      };

      wsRef.current.send(JSON.stringify(fileInfo));
      addMessage(
        "system",
        `Sending file: ${file.name} (${(file.size / 1024 / 1024).toFixed(
          2
        )} MB)`
      );

      // Send file in chunks
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      const reader = file.stream().getReader();
      let sentBytes = 0;
      let chunkIndex = 0;

      setSendProgress(0);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        for (let offset = 0; offset < value.byteLength; offset += CHUNK_SIZE) {
          const chunk = value.slice(offset, offset + CHUNK_SIZE);

          // Send chunk metadata
          const chunkInfo = {
            type: "file_chunk",
            chunk_index: chunkIndex++,
            size: chunk.byteLength,
          };
          wsRef.current.send(JSON.stringify(chunkInfo));

          // Send chunk data
          wsRef.current.send(chunk);

          sentBytes += chunk.byteLength;
          const progress = Math.round((sentBytes / file.size) * 100);
          setSendProgress(progress);

          // Small delay to prevent overwhelming
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Send completion signal
      const completion = {
        type: "file_complete",
        total_chunks: chunkIndex,
        total_size: sentBytes,
      };
      wsRef.current.send(JSON.stringify(completion));

      addMessage("system", `File sent successfully: ${file.name}`);
      setSendProgress(0);
    } catch (error) {
      console.error("Failed to send file:", error);
      addMessage("system", `Failed to send file: ${error.message}`);
      setSendProgress(0);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <h1 className="text-2xl font-bold text-blue-600 mb-4">
            Simple File Share
          </h1>

          {!joined ? (
            <div className="flex gap-2 mb-4">
              <button
                onClick={newCode}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
              >
                New Code
              </button>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                className="border px-3 py-2 rounded font-mono uppercase"
                maxLength={4}
              />
              <button
                onClick={join}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
              >
                Join
              </button>
            </div>
          ) : (
            <div className="mb-4">
              <div className="flex items-center gap-4 mb-2">
                <span className="font-semibold">Room: {code}</span>
                <span className="text-gray-600">Peers: {peerCount}</span>
              </div>
              <div className="text-sm text-gray-500">{status}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* File Transfer Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold mb-4">File Transfer</h2>

            {/* Send File */}
            <div className="mb-6">
              <h3 className="font-medium mb-2">Send File</h3>
              <input
                type="file"
                onChange={(e) =>
                  e.target.files[0] && sendFile(e.target.files[0])
                }
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                disabled={!joined}
              />
              {sendProgress > 0 && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${sendProgress}%` }}
                    />
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Sending: {sendProgress}%
                  </div>
                </div>
              )}
            </div>

            {/* Receive File */}
            <div>
              <h3 className="font-medium mb-2">Receive File</h3>
              {isReceiving ? (
                <div>
                  <div className="text-sm text-gray-600 mb-2">
                    Receiving: {receivingFileName}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all"
                      style={{ width: `${receiveProgress}%` }}
                    />
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Progress: {receiveProgress}%
                  </div>
                </div>
              ) : (
                <div className="text-gray-500 text-sm">
                  Waiting for files...
                </div>
              )}

              {receiveBuffer.current.length > 0 && (
                <button
                  onClick={downloadReceivedFile}
                  className="mt-2 bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                >
                  Download Received File
                </button>
              )}
            </div>
          </div>

          {/* Messages Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold mb-4">Messages</h2>

            {/* Send Message */}
            <div className="mb-4">
              <div className="flex gap-2">
                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 border px-3 py-2 rounded"
                  disabled={!joined}
                />
                <button
                  onClick={sendMessage}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  disabled={!joined || !newMessage.trim()}
                >
                  Send
                </button>
              </div>
            </div>

            {/* Messages Display */}
            <div className="border rounded h-64 overflow-y-auto p-3 bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-gray-500 text-center">
                  No messages yet...
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className="mb-2 text-sm">
                    <div className="flex justify-between items-start">
                      <span
                        className={`font-medium ${
                          msg.from === "system"
                            ? "text-gray-600"
                            : msg.from === "you"
                            ? "text-blue-600"
                            : "text-green-600"
                        }`}
                      >
                        {msg.from === "system"
                          ? "System"
                          : msg.from === "you"
                          ? "You"
                          : `Peer`}
                        :
                      </span>
                      <span className="text-xs text-gray-400">
                        {msg.timestamp}
                      </span>
                    </div>
                    <div
                      className={`mt-1 ${
                        msg.type === "json"
                          ? "font-mono text-xs bg-gray-100 p-2 rounded"
                          : ""
                      }`}
                    >
                      {msg.type === "json" ? (
                        <pre className="whitespace-pre-wrap">{msg.content}</pre>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Debug Info */}
        <div className="bg-white rounded-lg shadow-md p-4 mt-4">
          <details>
            <summary className="cursor-pointer font-medium">Debug Info</summary>
            <div className="mt-2 text-sm text-gray-600">
              <div>
                WebSocket State:{" "}
                {wsRef.current?.readyState === 1 ? "Connected" : "Disconnected"}
              </div>
              <div>Room Code: {code}</div>
              <div>Joined: {joined ? "Yes" : "No"}</div>
              <div>Peer Count: {peerCount}</div>
              <div>Receiving File: {isReceiving ? "Yes" : "No"}</div>
              <div>Buffer Size: {receiveBuffer.current.length} chunks</div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
