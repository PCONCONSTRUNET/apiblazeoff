// export-cookies.js
// Run once locally: node export-cookies.js
// It reads the cookies from puppeteer_session and outputs them as JSON for Railway

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: './puppeteer_session',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.pages().then(p => p[0] || browser.newPage());
    
    // Get all cookies (Blaze domain)
    const cookies = await page.cookies('https://blaze.bet.br');
    
    if (cookies.length === 0) {
        // Navigate to get cookies from context
        const context = browser.defaultBrowserContext();
        const allCookies = await (await browser.newPage()).cookies();
        console.log('\n=== BLAZE_COOKIES (set this as Railway env variable) ===');
        console.log(JSON.stringify(allCookies));
    } else {
        console.log('\n=== BLAZE_COOKIES (set this as Railway env variable) ===');
        console.log(JSON.stringify(cookies));
    }
    
    await browser.close();
    console.log('\n\nCopy the JSON above and add it as BLAZE_COOKIES in Railway Variables.');
})();
