const WebSocket = require('ws');

const connect = () => {
    console.log('Connecting...');
    const ws = new WebSocket('wss://api-v2.blaze.bet.br/replication/?EIO=3&transport=websocket', {
        headers: {
            'Origin': 'https://blaze.bet.br',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    let pingInterval = null;

    ws.on('open', () => {
        console.log('WS Open.');
        // Don't send 2probe anymore
    });

    ws.on('message', (data) => {
        const msg = data.toString();
        console.log('RECV:', msg.substring(0, 100));

        // When Socket.IO connection is established
        if (msg.startsWith('40')) {
            console.log('Socket.IO Connected. Subscribing...');
            ws.send('42["cmd",{"id":"subscribe","payload":{"room":"double_v2"}}]');
            
            // start sending ping
            pingInterval = setInterval(() => {
                console.log('Sending ping (2)');
                if (ws.readyState === WebSocket.OPEN) ws.send('2');
            }, 25000);
        }

        if (msg === '2') {
            console.log('Received ping (2), sending pong (3)');
            ws.send('3');
        }
    });

    ws.on('error', (err) => {
        console.error('Error:', err.message);
        process.exit(1);
    });

    ws.on('close', () => {
        console.log('Closed.');
        process.exit(0);
    });
};

connect();
