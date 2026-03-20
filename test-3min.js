const WebSocket = require('ws');

const connect = () => {
    console.log('Connecting...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    ws.on('open', () => console.log(`[${new Date().toISOString()}] WS Open.`));

    ws.on('message', (data) => {
        const msg = data.toString();
        
        if (msg === '2') {
            ws.send('3');
            return;
        }
        
        console.log(`[${new Date().toISOString()}] RECV (${msg.length} bytes): ${msg.substring(0, 600)}`);

        if (msg.startsWith('40')) {
            console.log('Connected! Subscribing to double_room_1...');
            ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_room_1"}}]');
            
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('2');
            }, 25000);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Closed: ${code} ${reason.toString()}`);
        process.exit(0);
    });

    ws.on('error', err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
};

// Run for 3 minutes to wait for a full Blaze round
setTimeout(() => {
    console.log('3 minutes elapsed, stopping.');
    process.exit(0);
}, 180000);

connect();
