const WebSocket = require('ws');

const connect = () => {
    console.log('Connecting with simulated sequence...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    ws.on('open', () => console.log('OPEN'));

    let pktId = 0;

    ws.on('message', (data) => {
        const msg = data.toString();
        
        if (msg === '2') { ws.send('3'); return; }
        if (msg === '3') return;

        console.log('RECV:', msg.substring(0, 300));

        if (msg.startsWith('40')) {
            console.log('Connected! Sending exact sequence...');
            ws.send('420["cmd",{"id":"unsubscribe","payload":{"room":"double_v2"}}]');
            ws.send('420["cmd",{"id":"subscribe","payload":{"room":"double_room_1"}}]');
            ws.send(Date.now().toString());

            setInterval(() => { 
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('2'); // engine.io ping
                    ws.send('42' + pktId + '["cmd",{"id":"ping","payload":{"uuid":"a4b3c2d1-e5f6-4a1b-8c2d-e4f5a6b7c8d9"}}]');
                    pktId++;
                }
            }, 25000);
        }

        if (msg.includes('tick')) {
            console.log('\n\n!!! SUCCESS !!! GOT A TICK!\n\n', msg.substring(0, 500));
            // Don't exit immediately, let's see if we get more!
        }
        
        if (msg.includes('error')) {
            console.log('!!! ERROR !!!\n', msg);
        }
    });

    ws.on('error', err => { console.error('Error:', err.message); process.exit(1); });
    ws.on('close', () => { console.log('Closed.'); process.exit(0); });
};

connect();
