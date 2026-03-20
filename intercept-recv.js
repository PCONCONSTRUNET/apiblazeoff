const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

const logStream = fs.createWriteStream('intercept-incoming.log');

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    let tickCount = 0;

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', ({ response }) => {
        const payload = response.payloadData;
        logStream.write(`[RECV] ${payload}\n`);
        
        if (payload.includes('tick')) {
            tickCount++;
            console.log(`\n\n==== FOUND TICK (${tickCount}) ====\n` + payload.substring(0, 300) + '\n=====================\n');
        }
    });

    console.log('Navigating to Blaze...');
    await page.goto('https://blaze.bet.br/pt/games/double?modal=pay_table&game_mode=double_room_1', { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('Waiting 3 minutes for ticks...');
    await new Promise(r => setTimeout(r, 180000));

    console.log(`Done. Captured ${tickCount} ticks.`);
    await browser.close();
    process.exit(0);
})();
