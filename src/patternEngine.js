const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xrphlhlqksxnkldsypap.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycGhsaGxxa3N4bmtsZHN5cGFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgwODIwMywiZXhwIjoyMDg5Mzg0MjAzfQ.IqRd_EGi0oO_UWz1w6ocMCL_x910AU3WmWSJ9J9HEfo";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let activePatterns = [];

// Usamos apenas o roundId da ultima pedra que foi processada para evitar duplicatas
// Não mantemos pendingSignals em memória — sempre consultamos o banco para ter estado correto
let lastProcessedRoundId = null;

async function initPatternEngine() {
    console.log('[Pattern Engine] Inicializando...');
    await fetchPatterns();

    // Hot-reload de padrões: quando o Admin mudar algo, a API recarrega automaticamente
    supabase.channel('patterns-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'patterns' }, () => {
            console.log('[Pattern Engine] Padrões atualizados! Recarregando...');
            fetchPatterns();
        })
        .subscribe();
}

async function fetchPatterns() {
    const { data, error } = await supabase
        .from('patterns')
        .select('*')
        .eq('status', 'active');

    if (error) {
        console.error('[Pattern Engine] Erro ao buscar padrões:', error);
    } else if (data) {
        activePatterns = data;
        console.log(`[Pattern Engine] ${activePatterns.length} padrões ativos.`);
    }
}

async function processNewRoll(latestResults, broadcastSignalSSE) {
    if (!latestResults || latestResults.length === 0) return;
    const newestRoll = latestResults[0];

    // Obtém o ID único desta pedra (para não processar duas vezes)
    const currentRoundId = newestRoll.roundId || newestRoll.id;

    if (lastProcessedRoundId === currentRoundId) {
        return; // Já processamos essa pedra
    }
    lastProcessedRoundId = currentRoundId;

    // 1°. SEMPRE consulta o banco para ter o estado correto (não depende de memória)
    const { data: pendingSignals, error: fetchErr } = await supabase
        .from('signals')
        .select('*')
        .eq('result', 'pending');

    if (fetchErr) {
        console.error('[Pattern Engine] Erro ao buscar sinais pendentes:', fetchErr);
        return;
    }

    const hasPending = pendingSignals && pendingSignals.length > 0;

    // 2°. Se tem sinal ativo, avalia Win/Loss contra a pedra que acabou de cair
    if (hasPending) {
        await checkPendingSignals(pendingSignals, newestRoll, broadcastSignalSSE);
    } else {
        // 3°. Só avalia novos padrões se NÃO tiver sinal ativo
        await evaluatePatterns(latestResults, broadcastSignalSSE);
    }
}

async function checkPendingSignals(pendingSignals, newestRoll, broadcastSignalSSE) {
    const color = newestRoll.color;
    console.log(`[Pattern Engine] Avaliando ${pendingSignals.length} sinal(is) contra [${color}]...`);

    for (const signal of pendingSignals) {
        const victoryTarget = signal.target || 'reds';

        let maxGales = 0;
        if (signal.protection) {
            if (signal.protection.toLowerCase().includes('sem')) {
                maxGales = 0;
            } else {
                const match = signal.protection.match(/(\d+)/);
                if (match) maxGales = parseInt(match[1]);
            }
        }

        let isWin = false;
        switch (victoryTarget) {
            case 'reds':          isWin = (color === 'red'); break;
            case 'blacks':        isWin = (color === 'black'); break;
            case 'whites':        isWin = (color === 'white'); break;
            case 'blacks-whites': isWin = (color === 'black' || color === 'white'); break;
            case 'reds-whites':   isWin = (color === 'red' || color === 'white'); break;
            case 'any':           isWin = true; break;
        }

        if (isWin) {
            console.log(`[Pattern Engine] ✅ GREEN! Sinal "${signal.signal_type}" - Gale ${signal.rounds}`);
            await supabase.from('signals').update({ result: 'green' }).eq('id', signal.id);
            if (typeof broadcastSignalSSE === 'function') broadcastSignalSSE({ ...signal, result: 'green' });
        } else {
            const currentAttempt = signal.rounds || 0;

            if (currentAttempt < maxGales) {
                const nextAttempt = currentAttempt + 1;
                console.log(`[Pattern Engine] ⚠️ Sinal "${signal.signal_type}" errou. Indo pro Gale ${nextAttempt}...`);
                await supabase.from('signals').update({ rounds: nextAttempt }).eq('id', signal.id);
                if (typeof broadcastSignalSSE === 'function') broadcastSignalSSE({ ...signal, rounds: nextAttempt });
            } else {
                console.log(`[Pattern Engine] ❌ LOSS! Sinal "${signal.signal_type}" sem mais gales.`);
                await supabase.from('signals').update({ result: 'loss' }).eq('id', signal.id);
                if (typeof broadcastSignalSSE === 'function') broadcastSignalSSE({ ...signal, result: 'loss' });
            }
        }
    }
}

async function evaluatePatterns(latestResults, broadcastSignalSSE) {
    const newestRoll = latestResults[0];
    const uniqueId = newestRoll.roundId || newestRoll.id;

    for (const pattern of activePatterns) {
        const colors = pattern.colors || [];
        const numbers = pattern.numbers || [];

        if (colors.length === 0 && numbers.length === 0) continue;

        const size = Math.max(colors.length, numbers.length);
        if (latestResults.length < size) continue;

        let matchColors = true;
        let matchNumbers = true;

        if (colors.length > 0) {
            for (let i = 0; i < colors.length; i++) {
                const patCol = colors[colors.length - 1 - i];
                const resCol = latestResults[i].color;
                if (patCol !== resCol) { matchColors = false; break; }
            }
        }

        if (numbers.length > 0) {
            for (let i = 0; i < numbers.length; i++) {
                const patNum = numbers[numbers.length - 1 - i];
                const resNum = latestResults[i].roll;
                if (patNum !== resNum) { matchNumbers = false; break; }
            }
        }

        if (matchColors && matchNumbers && pattern.mode === 'when_exit') {
            console.log(`[Pattern Engine] 🔥 PADRÃO DETECTADO! [${pattern.name}]`);

            const protectionText = pattern.gales === 0 ? 'Sem gale' : pattern.gales === 1 ? '1 Gale' : `${pattern.gales} Gales`;
            const vtLabel = {
                'reds': 'Vermelhos', 'blacks': 'Pretos', 'whites': 'Brancos',
                'blacks-whites': 'Pretos/Brancos', 'reds-whites': 'Vermelhos/Brancos', 'any': 'Qualquer'
            }[pattern.victory_target || 'reds'];

            const newSignal = {
                signal_type: pattern.name,
                entry: `Cobrir ${vtLabel}`,
                protection: protectionText,
                result: 'pending',
                target: pattern.victory_target,
                rounds: 0
            };

            const { data, error } = await supabase.from('signals').insert(newSignal).select('*').single();
            if (error) {
                console.error('[Pattern Engine] Falha ao criar sinal:', error);
            } else if (data) {
                console.log(`[Pattern Engine] Sinal criado: ${data.id}`);
                if (typeof broadcastSignalSSE === 'function') broadcastSignalSSE(data);
            }
            break;
        }
    }
}

module.exports = { initPatternEngine, processNewRoll };
