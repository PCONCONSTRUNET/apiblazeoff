const WebSocket = require('ws');
const fs = require('fs');

const log = fs.createWriteStream('./server-dump.log', {flags: 'w'});

const connect = () => {
    console.log('Connecting...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    ws.on('open', () => {
        console.log('WS Open.');
    });

    ws.on('message', (data) => {
        const msg = data.toString();
        const line = `[${new Date().toISOString()}] ${msg}`;
        console.log('RECV:', msg.substring(0, 100));
        log.write(line + '\n');
        
        if (msg === '2') {
            ws.send('3');
            return;
        }

        if (msg.startsWith('40')) {
            console.log('Connected! Subscribing...');
            // Try the real room from Blaze frontend (double_room_1 is shown in the URL)
            ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_room_1"}}]');
            
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('2');
            }, 25000);
        }
    });

    ws.on('close', (code, reason) => {
        console.log('Closed:', code, reason.toString());
        process.exit(0);
    });

    ws.on('error', err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
};

// stop after 60 seconds
setTimeout(() => {
    console.log('60s elapsed, dumped all messages to server-dump.log');
    process.exit(0);
}, 60000);

connect();
