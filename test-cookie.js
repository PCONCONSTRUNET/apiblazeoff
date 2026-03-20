const WebSocket = require('ws');
const fs = require('fs');

const cookies = JSON.parse(fs.readFileSync('./exported_cookies.json'));
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

const write = (s) => { process.stdout.write(s + '\n'); fs.appendFileSync('./cookie-test.log', s + '\n'); };

fs.writeFileSync('./cookie-test.log', '');

const connect = () => {
    write('Connecting with cookies...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': cookieHeader
        }
    });

    ws.on('open', () => write(`[${new Date().toISOString()}] OPEN`));

    ws.on('message', (data) => {
        const msg = data.toString();
        if (msg === '2') { ws.send('3'); return; }
        if (msg === '3') return;
        write(`[${new Date().toISOString()}] MSG [${msg.length}b]: ${msg.substring(0, 800)}`);

        if (msg.startsWith('40')) {
            write('Connected! Subscribing to double_room_1...');
            ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_room_1"}}]');
            setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('2'); }, 25000);
        }
    });

    ws.on('close', (code, reason) => { write(`CLOSE: ${code} ${reason}`); process.exit(0); });
    ws.on('error', err => { write(`ERROR: ${err.message}`); process.exit(1); });
};

setTimeout(() => { write('3min up.'); process.exit(0); }, 180000);
connect();
