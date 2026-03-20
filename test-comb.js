const WebSocket = require('ws');
const fs = require('fs');

const cookies = JSON.parse(fs.readFileSync('./exported_cookies.json'));
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

const connect = () => {
    console.log('Connecting with cookies AND 420 namespace...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': cookieHeader
        }
    });

    ws.on('open', () => console.log('OPEN'));

    ws.on('message', (data) => {
        const msg = data.toString();
        
        if (msg === '2') { ws.send('3'); return; }
        if (msg === '3') return;

        console.log('RECV:', msg.substring(0, 300));

        if (msg.startsWith('40')) {
            console.log('Subscribing with 420 AND Cookies...');
            ws.send('420["cmd",{"id":"subscribe","payload":{"room":"double_room_1"}}]');
            ws.send('420["cmd",{"id":"subscribe","payload":{"room":"double_v2"}}]');
            setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('2'); }, 25000);
        }

        if (msg.includes('double.tick') || msg.includes('tick')) {
            console.log('\n\n!!! SUCCESS !!! GOT A TICK!\n\n', msg.substring(0, 500));
            process.exit(0);
        }
        
        if (msg.includes('error')) {
            console.log('!!! ERROR !!!\n', msg);
        }
    });

    ws.on('error', err => { console.error('Error:', err.message); process.exit(1); });
    ws.on('close', () => { console.log('Closed.'); process.exit(0); });
};

connect();
