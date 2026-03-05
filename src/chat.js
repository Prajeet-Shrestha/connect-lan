// Chat & WebSocket handler
const os = require('os');

const chatHistory = []; // Last 100 messages
const MAX_HISTORY = 100;
const connectedDevices = new Map(); // ws -> { hostname, os, ip, userAgent }

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setupWebSocket(wss, validateAuth) {
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    
    // Auth check (pass socket IP for localhost auto-auth)
    const cookie = req.headers.cookie || '';
    if (!validateAuth(cookie, ip)) {
      ws.close(1008, 'Authentication required');
      return;
    }
    
    // Default device info until register-device
    connectedDevices.set(ws, {
      hostname: 'Unknown Device',
      os: 'Unknown',
      ip: ip.replace('::ffff:', ''),
      userAgent: req.headers['user-agent'] || '',
    });
    
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg, wss);
      } catch (e) {
        // Ignore malformed messages
      }
    });
    
    ws.on('close', () => {
      const device = connectedDevices.get(ws);
      connectedDevices.delete(ws);
      if (device) {
        broadcastToAll(wss, {
          type: 'device-left',
          device: { hostname: device.hostname, os: device.os, ip: device.ip },
        }, ws);
      }
    });
    
    ws.on('error', () => {
      connectedDevices.delete(ws);
    });
  });
}

function handleMessage(ws, msg, wss) {
  switch (msg.type) {
    case 'register-device': {
      const device = connectedDevices.get(ws);
      if (device) {
        device.hostname = escapeHtml(msg.hostname || os.hostname());
        device.os = escapeHtml(msg.os || process.platform);
        device.userAgent = msg.userAgent || '';
        
        // Send current connected devices to the new client
        const devices = getDeviceList();
        ws.send(JSON.stringify({ type: 'device-list', devices }));
        
        // Broadcast join to others
        broadcastToAll(wss, {
          type: 'device-joined',
          device: { hostname: device.hostname, os: device.os, ip: device.ip },
        }, ws);
      }
      break;
    }
    
    case 'chat-message': {
      const device = connectedDevices.get(ws);
      if (!device || !msg.text) return;
      
      const text = escapeHtml(msg.text.substring(0, 10000)); // Limit message length
      const chatMsg = {
        type: 'chat-message',
        from: { hostname: device.hostname, os: device.os },
        text,
        timestamp: new Date().toISOString(),
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      };
      
      // Store in history
      chatHistory.push(chatMsg);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
      
      // Broadcast to all including sender
      broadcastToAll(wss, chatMsg);
      break;
    }
  }
}

function broadcastToAll(wss, msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(data);
    }
  });
}

function getDeviceList() {
  const devices = [];
  for (const [, device] of connectedDevices) {
    devices.push({
      hostname: device.hostname,
      os: device.os,
      ip: device.ip,
    });
  }
  return devices;
}

function getChatHistory() {
  return chatHistory.slice(-MAX_HISTORY);
}

// Create a broadcast function that can be used by file routes
function createBroadcaster(wss) {
  return (msg) => {
    broadcastToAll(wss, msg);
  };
}

module.exports = {
  setupWebSocket,
  getChatHistory,
  getDeviceList,
  createBroadcaster,
};
