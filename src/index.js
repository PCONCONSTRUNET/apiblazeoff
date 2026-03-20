const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://xrphlhlqksxnkldsypap.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycGhsaGxxa3N4bmtsZHN5cGFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgwODIwMywiZXhwIjoyMDg5Mzg0MjAzfQ.IqRd_EGi0oO_UWz1w6ocMCL_x910AU3WmWSJ9J9HEfo";

const app = express();
const HTTP_PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let latestResults = [];
let fetchError = null;
let lastUpdate = null;
let lastInsertWallTime = 0; // Wall clock time da última inserção (WS ou DOM) para evitar duplicação

// Carrega o motor de Padrões
const { initPatternEngine, processNewRoll } = require('./patternEngine');
initPatternEngine();

const BLAZE_URL = 'https://blaze.bet.br/pt/games/double?modal=pay_table&game_mode=double_room_1';

const connectBlazeWebSocket = () => {
    console.log('Connecting to Blaze WebSocket natively...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    let pingInterval = null;

    ws.on('open', () => {
        console.log('WS Connected! Sending probe...');
        ws.send('2probe');
    });

    ws.on('message', (data) => {
        const msg = data.toString();
        
        if (msg === '2') {
            ws.send('3');
        }

        // Socket.IO Upgrade Handshake
        if (msg === '3probe') {
            console.log('Probe matched. Upgrading status...');
            ws.send('5'); // Upgrade
            setTimeout(() => {
                ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_v2"}}]');
                console.log('Subscribed to double_v2 room!');
            }, 500);

            // Heartbeat ping every 25s to keep connection alive
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('2');
                }
            }, 25000);
        }

        // Handle Double Tick
        if (msg.includes('double.tick')) {
            const bracketIndex = msg.indexOf('[');
            if (bracketIndex !== -1) {
                try {
                    const arr = JSON.parse(msg.substring(bracketIndex));
                    for (const item of arr) {
                        if (item && item.id === 'double.tick' && item.payload) {
                            const p = item.payload;
                            if (p.status !== 'waiting') console.log(`[WS DEBUG] Status: ${p.status}, Roll: ${p.roll}`);
                            
                            if ((p.status === 'rolling' || p.status === 'complete') && p.roll !== null && p.roll !== undefined) {
                                const roll = parseInt(p.roll);
                                let color = 'white';
                                let colorId = 0;
                                
                                if ([1,2,3,4,5,6,7].includes(roll)) { color = 'red'; colorId = 1; }
                                else if (roll >= 8 && roll <= 14) { color = 'black'; colorId = 2; }

                                const lastSaved = latestResults[0] || {};
                                const roundId = p.id || `ws_${Date.now()}`;
                                
                                if (latestResults.length === 0 || lastSaved.roundId !== roundId) {
                                    const realTimestamp = p.created_at || new Date().toISOString();
                                    latestResults.unshift({
                                        id: `ws_${Date.now()}`,
                                        roundId: roundId,
                                        colorId: colorId,
                                        color: color,
                                        roll: roll,
                                        createdAt: realTimestamp
                                    });

                                    // Keep memory clean
                                    if (latestResults.length > 200) latestResults.pop();
                                    lastInsertWallTime = Date.now();
                                    lastUpdate = new Date().toISOString();
                                    console.log(`[${lastUpdate}] WS Instant Scraped: ${roll} (${color}) !! ZERO DELAY !!`);

                                    // Process signals immediately
                                    (async () => {
                                        await processNewRoll(latestResults, broadcastSignalSSE);
                                        if (typeof broadcastToSSE === 'function') {
                                            broadcastToSSE(latestResults);
                                        }
                                    })();
                                }
                            }
                        }
                    }
                } catch (err) {}
            }
        }
    });

    ws.on('error', (err) => {
        console.error('Blaze WS Error:', err.message);
    });

    ws.on('close', () => {
        console.log('Blaze WS Connection Closed. Reconnecting in 3s...');
        if (pingInterval) clearInterval(pingInterval);
        setTimeout(connectBlazeWebSocket, 3000);
    });
};

connectBlazeWebSocket();

/**
 * GET /api/double/live
 * Returns the cached results from the DOM scraper
 */
app.get('/api/double/live', (req, res) => {
    if (latestResults.length === 0 && fetchError) {
        return res.status(503).json({
            success: false,
            message: 'Scraper configuring or disconnected. Please try again soon.',
            error: fetchError
        });
    }

    res.json({
        success: true,
        lastUpdate: lastUpdate || new Date().toISOString(),
        data: latestResults
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * GET /api/double/stream
 * Server-Sent Events (SSE) — push de novos resultados em tempo real
 * Clientes conectados recebem um evento 'result' a cada novo giro detectado
 */
const sseClients = new Set();

app.get('/api/double/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Enviar estado atual imediatamente ao conectar
    if (latestResults.length > 0) {
        res.write(`data: ${JSON.stringify({ success: true, lastUpdate, data: latestResults })}\n\n`);
    }

    // Heartbeat a cada 25s para manter a conexão viva
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    sseClients.add(res);
    console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
    });
});

// Notifica clientes SSE quando um novo resultado é detectado
const broadcastToSSE = (data) => {
    const payload = JSON.stringify({ success: true, lastUpdate, data: latestResults });
    for (const client of sseClients) {
        client.write(`data: ${payload}\n\n`);
    }
};

// Notifica clientes SSE quando um sinal muda (novo, gale, green, loss) — ZERO DELAY
const broadcastSignalSSE = (signal) => {
    const payload = JSON.stringify({ type: 'signal_update', signal });
    for (const client of sseClients) {
        client.write(`event: signal\ndata: ${payload}\n\n`);
    }
};

// Chamada periódica da Edge Function a cada ~5s desativada pois o motor local agora faz isso
/*
setInterval(async () => {
    if (latestResults.length === 0) return;
    try {
        await axios.post(
            `${SUPABASE_URL}/functions/v1/analyze-blaze`,
            { results: latestResults },
            {
                headers: {
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        // console.log('[Edge Function] Resultados analisados com sucesso.');
    } catch (err) {
        console.error('[Edge Function] Erro ao enviar resultados:', err.response?.data || err.message);
    }
}, 5000);
*/

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`API Server running on port ${HTTP_PORT}`);
    // No explicit call needed, connectBlazeWebSocket() is called upon definition
});

