const { initPatternEngine, processNewRoll } = require('./src/patternEngine');

async function runTest() {
    await initPatternEngine();
    
    // Simulate drops!
    console.log("--- DROP 1: TRIGGER 2 BLACKS ---");
    await processNewRoll([
        { color: 'black', roll: 10, roundId: 't1' },
        { color: 'black', roll: 8, roundId: 't2' }
    ]);

    // Give some time for async inserts
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("--- DROP 2: THE BET (WIN) ---");
    await processNewRoll([
        { color: 'white', roll: 0, roundId: 't3' },
        { color: 'black', roll: 10, roundId: 't1' },
        { color: 'black', roll: 8, roundId: 't2' }
    ]);

    await new Promise(r => setTimeout(r, 3000));
    console.log("DONE");
}
runTest();
