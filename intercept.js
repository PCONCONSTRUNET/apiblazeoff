const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    client.on('Network.webSocketWillSendHandshakeRequest', ({ request }) => {
        console.log(`\n\n=== HANDSHAKE HEADERS ===\n${JSON.stringify(request.headers, null, 2)}\n=========================\n`);
    });

    client.on('Network.webSocketFrameSent', ({ response }) => {
        const payload = response.payloadData;
        console.log(`[SENT] ${payload.substring(0, 500)}`);
        
        if (payload.includes('subscribe')) {
            console.log('\n\n==== FOUND SUBSCRIBE PAYLOAD ====\n' + payload + '\n=================================\n');
        }
    });

    client.on('Network.webSocketCreated', ({ url }) => {
        console.log(`[WS_CREATED] ${url}`);
    });

    console.log('Navigating to Blaze...');
    await page.goto('https://blaze.bet.br/pt/games/double?modal=pay_table&game_mode=double_room_1', { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('Waiting 10s for websocket init...');
    await new Promise(r => setTimeout(r, 10000));

    await browser.close();
    console.log('Done.');
})();
