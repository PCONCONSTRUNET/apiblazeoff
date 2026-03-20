const WebSocket = require('ws');

const connect = () => {
    console.log('Connecting to Blaze WebSocket...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    let pingInterval = null;

    ws.on('open', () => {
        console.log('Connected! Sending probe...');
        ws.send('2probe');
    });

    ws.on('message', (data) => {
        const msg = data.toString();
        console.log(`[${new Date().toISOString()}] Server says:`, msg.substring(0, 100));
        
        if (msg === '2') {
            console.log('--> Server sent 2 (ping), sending 3 (pong)');
            ws.send('3');
        }

        if (msg === '3probe') {
            console.log('Probe matched. Upgrading...');
            ws.send('5'); // Upgrade
            setTimeout(() => {
                ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_v2"}}]');
            }, 500);

            // test our own ping interval like in index.js
            pingInterval = setInterval(() => {
                console.log(`[${new Date().toISOString()}] --> Client sending 2 (ping)`);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('2');
                }
            }, 25000);
        }
    });

    ws.on('error', (err) => {
        console.error('WS Error:', err.message);
        process.exit(1);
    });

    ws.on('close', (code, reason) => {
        console.log(`WS Closed: ${code} - ${reason.toString()}`);
        if(pingInterval) clearInterval(pingInterval);
        process.exit(0);
    });
};

connect();
