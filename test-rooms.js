const WebSocket = require('ws');

const rooms = ['double_v2', 'double_room_1', 'double_room_2', 'double', 'double_room'];

const connect = () => {
    console.log('Connecting...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    ws.on('open', () => console.log('WS Open.'));

    ws.on('message', (data) => {
        const msg = data.toString();
        
        if (msg === '2') {
            ws.send('3');
            return;
        }

        if (msg.startsWith('40')) {
            console.log('Socket.IO Connected. Subscribing to rooms...');
            for (const room of rooms) {
                console.log(`Subscribing to ${room}...`);
                ws.send(`42["cmd",{"id":"subscribe","payload":{"room":"${room}"}}]`);
            }
            
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('2');
            }, 25000);
        }

        if (msg.includes('tick')) {
            console.log('\n\n=== GOT TICK ===\n', msg.substring(0, 300));
            process.exit(0);
        }
    });
};

connect();
