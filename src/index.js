const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

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

const startDOMScraping = async () => {
    console.log('Launching Puppeteer browser in stealth mode to scrape DOM...');
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = (await browser.pages())[0];
        console.log(`Navigating to ${BLAZE_URL}...`);

        // Interceptar WebSocket para capturar o resultado no exato milissegundo em que a Blaze gera 
        // antes mesmo da animação visual começar! (Zero delay absoluto)
        try {
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            
            client.on('Network.webSocketFrameReceived', ({ response }) => {
                const payloadStr = response.payloadData || '';
                
                if (payloadStr.includes('double.tick')) {
                    // Os frames do Socket.IO começam com números, como '42["dados", { ... }]'
                    const bracketIndex = payloadStr.indexOf('[');
                    if (bracketIndex !== -1) {
                        try {
                            const arr = JSON.parse(payloadStr.substring(bracketIndex));
                            // arr é um array do socket.io. Normalmente arr[1] tem o payload
                            for (const item of arr) {
                                if (item && item.id === 'double.tick' && item.payload) {
                                    const p = item.payload;
                                    if (p.status !== 'waiting') console.log(`[WS DEBUG] Status: ${p.status}, Roll: ${p.roll}`);
                                    // Se o status for rolling ou complete e tivermos rolagem real
                                    if ((p.status === 'rolling' || p.status === 'complete') && p.roll !== null && p.roll !== undefined) {
                                    
                                    const roll = parseInt(p.roll);
                                    let color = 'white';
                                    let colorId = 0;
                                    
                                    if ([1,2,3,4,5,6,7].includes(roll)) { color = 'red'; colorId = 1; }
                                    else if (roll >= 8 && roll <= 14) { color = 'black'; colorId = 2; }

                                    const lastSaved = latestResults[0] || {};
                                    // Insere IMEDIATAMENTE se for um novo numero (roll ID diferente garante rodada nova)
                                    const roundId = p.id || `ws_${Date.now()}`;
                                    if (latestResults.length === 0 || lastSaved.roundId !== roundId) {
                                        // O Blaze agrupa as rodadas pelo minuto em que COMEÇARAM (created_at), não quando terminaram (updated_at)
                                        // Se usarmos updated_at, a animação (~12s) frequentemente cruza a fronteira do minuto e cai na coluna errada
                                        const realTimestamp = p.created_at || new Date().toISOString();
                                        latestResults.unshift({
                                            id: `ws_${Date.now()}`,
                                            roundId: roundId,
                                            colorId: colorId,
                                            color: color,
                                            roll: roll,
                                            createdAt: realTimestamp
                                        });

                                        if (latestResults.length > 200) latestResults.pop();
                                        lastInsertWallTime = Date.now(); // Atualiza o wall time para o DOM Scraper não duplicar
                                        lastUpdate = new Date().toISOString();
                                        console.log(`[${lastUpdate}] WS Instant Scraped: ${roll} (${color}) !! ZERO DELAY !!`);

                                        // -> CHAMA O MOTOR DE PADRÕES PARA DAR GREEN/LOSS E LER NOVAS ENTRADAS (WS)
                                        processNewRoll(latestResults).catch(e => console.error(e));

                                        if (typeof broadcastToSSE === 'function') {
                                            broadcastToSSE(latestResults);
                                        }
                                    }
                                }
                                }
                            }
                        } catch (err) {}
                    }
                }
            });
            console.log('WebSocket CDP Interceptor attached successfully!');
        } catch (e) {
            console.error('Failed to attach CDP Session:', e);
        }

        // Use domcontentloaded to not get stuck on endless websocket requests
        await page.goto(BLAZE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('Page loaded. Starting DOM scraping loop (Fallback)...');
        fetchError = null;

        // Poll the DOM every 2 seconds
        setInterval(async () => {
            if (browser.isConnected()) {
                try {
                    const pageTitle = await page.title();
                    console.log(`[DEBUG] Page Title: ${pageTitle} | URL: ${page.url()}`);
                    
                    const rolls = await page.evaluate(() => {
                        // O histórico real da Blaze mudou para CSS Modules com a palavra "entry"
                        const boxes = Array.from(document.querySelectorAll('div[class*="entry"], div[class*="Entry-module__entry"]'));

                        return boxes.map((el) => {
                            const text = el.innerText.trim();
                            let color = 'unknown';
                            let colorId = -1;
                            let rollNum = parseInt(text);
                            
                            // Se tem número de 1 a 14, garantimos a cor
                            if (!isNaN(rollNum)) {
                                if (rollNum >= 1 && rollNum <= 7) { color = 'red'; colorId = 1; }
                                else if (rollNum >= 8 && rollNum <= 14) { color = 'black'; colorId = 2; }
                                else if (rollNum === 0) { color = 'white'; colorId = 0; }
                            } else {
                                // Se não tem número, e tem uma imagem/svg, é o branco da Blaze
                                if (el.querySelector('svg, img, [class*="icon"]')) {
                                    color = 'white'; colorId = 0;
                                    rollNum = 0;
                                }
                            }

                            return {
                                color,
                                colorId,
                                text: isNaN(rollNum) ? '' : rollNum.toString()
                            };
                        }).filter(r => r.color !== 'unknown');
                    });

                    if (rolls.length > 0) {
                        // O histórico do site só entrega as cores/números sem hora. Emulamos o distanciamento exato de 25s de um giro clássico da double
                        // para que a Grid seja gerada organicamente e distribua os slots passados sem achatar na mesma coluna.
                        const timeNow = Date.now();
                        const newArray = rolls.map((r, i) => ({
                            id: `roll_idx_${i}_${timeNow}`, // fallback id
                            colorId: r.colorId,
                            color: r.color,
                            roll: parseInt(r.text) || 0,
                            createdAt: new Date(timeNow - (i * 25000)).toISOString()
                        }));

                        // O histórico da Blaze normalmente adiciona o novo item na esquerda (index 0).
                        const newest = newArray[0];

                        // Backfill: Se a API acabou de ligar, puxa as últimas 15 pedras do site imediatamente para alinhar a interface
                        if (latestResults.length === 0 && newArray.length > 0) {
                            latestResults = [...newArray];
                            lastUpdate = new Date().toISOString();
                            console.log(`[${lastUpdate}] DOM Scraped Initial Backfill: ${latestResults.length} items`);
                            if (typeof broadcastToSSE === 'function') {
                                broadcastToSSE(latestResults);
                            }
                            return; // Encerra por agora pois já fez o backfill
                        }

                        // Comparando se o array recente deslocou uma casa:
                        const lastSaved = latestResults[0] || {};
                        
                        // O DOM Scraper é o fallback - só insere se o WebSocket não inseriu nada nos últimos 30s em tempo real de parede
                        const msSinceLastInsert = Date.now() - (lastInsertWallTime || 0);
                        const isNewRoll = lastSaved.roll !== newest.roll || lastSaved.color !== newest.color;
                        
                        if (newest && newest.color !== 'unknown' && isNewRoll && msSinceLastInsert > 30000) {
                            latestResults.unshift({
                                id: `dom_${Date.now()}`,
                                colorId: newest.colorId,
                                color: newest.color,
                                roll: newest.roll,
                                createdAt: new Date().toISOString()
                            });
                            lastInsertWallTime = Date.now();

                            if (latestResults.length > 200) latestResults.pop();
                            lastUpdate = new Date().toISOString();
                            console.log(`[${lastUpdate}] DOM Fallback Roll: ${newest.roll} (${newest.color})`);

                            // -> CHAMA O MOTOR DE PADRÕES PARA DAR GREEN/LOSS E LER NOVAS ENTRADAS (DOM FALLBACK)
                            processNewRoll(latestResults).catch(e => console.error(e));

                            if (typeof broadcastToSSE === 'function') {
                                broadcastToSSE(latestResults);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore transient evaluate errors
                }
            }
        }, 2500);

        // Auto-refresh the page every hour to drop old caches/sessions
        setTimeout(async () => {
            console.log('Restarting browser to keep session fresh...');
            await browser.close();
            startDOMScraping();
        }, 60 * 60 * 1000);

    } catch (err) {
        console.error('Puppeteer scraper error:', err.message);
        fetchError = err.message;
        setTimeout(startDOMScraping, 10000);
    }
};

startDOMScraping();

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

app.listen(PORT, () => {
    console.log(`Blaze Double DOM Scraper API is running on http://localhost:${PORT}`);
    console.log(`Live endpoint: http://localhost:${PORT}/api/double/live`);
    console.log(`SSE  endpoint: http://localhost:${PORT}/api/double/stream`);
});
