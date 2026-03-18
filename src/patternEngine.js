const { createClient } = require('@supabase/supabase-js');
// Config do Supabase vindo do .env/react ou Variáveis da Nuvem/VPS
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xrphlhlqksxnkldsypap.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycGhsaGxxa3N4bmtsZHN5cGFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgwODIwMywiZXhwIjoyMDg5Mzg0MjAzfQ.IqRd_EGi0oO_UWz1w6ocMCL_x910AU3WmWSJ9J9HEfo";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let activePatterns = [];
const lastTriggeredRound = {}; // Para evitar que o mesmo pattern dispare várias vezes na mesma pedra
let pendingSignals = []; // Sinais atualmente em aberto monitorados pela API em memória para não martelar o banco de tempo em tempo

async function initPatternEngine() {
    console.log('[Pattern Engine] Inicializando...');

    // 1. Carrega padroes
    await fetchPatterns();

    // 2. Carrega sinais que ainda não terminaram (Pendentes)
    await loadPendingSignals();

    // 3. Assina as mudanças na tabela patterns para atualização hot-reload sem reiniciar API
    supabase.channel('patterns-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'patterns' }, () => {
            console.log('[Pattern Engine] Padrões atualizados no Admin! Recarregando...');
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
        console.log(`[Pattern Engine] ${activePatterns.length} padrões ativos sincronizados.`);
    }
}

async function loadPendingSignals() {
    // Carrega sinais do banco que ainda estão pending (caso a API tenha caído e voltado)
    const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('result', 'pending');

    if (!error && data) {
        pendingSignals = data;
        console.log(`[Pattern Engine] Retomado acompanhamento de ${pendingSignals.length} sinais pendentes.`);
    }
}

async function processNewRoll(latestResults) {
    if (!latestResults || latestResults.length === 0) return;
    const newestRoll = latestResults[0];

    // CUIDADO COM A ORDEM!
    // 1°. Primeiro avaliamos as apostas pendentes contra o número que CAIU AGORA.
    await checkPendingSignals(newestRoll);

    // 2°. Depois verificamos se a fita atual invoca algum novo sinal para as PRÓXIMAS rodadas.
    await evaluatePatterns(latestResults);
}

async function checkPendingSignals(newestRoll) {
    if (pendingSignals.length === 0) return;

    console.log(`[Pattern Engine] Checando ${pendingSignals.length} sinais pendentes contra o roll [${newestRoll.color}]...`);
    const remainingPendings = [];

    for (const signal of pendingSignals) {
        // Encontra o padrão associado a este sinal ou tenta extrair dados salvos
        let victoryTarget = signal.target || 'reds'; 
        
        let maxGales = 2; // default
        if (signal.protection) {
            if (signal.protection.toLowerCase().includes('sem')) maxGales = 0;
            else {
                const match = signal.protection.match(/(\d+)/);
                if (match) maxGales = parseInt(match[1]);
            }
        }

        // Verifica vitória
        let isWin = false;
        const color = newestRoll.color;

        switch (victoryTarget) {
            case 'reds': isWin = (color === 'red'); break;
            case 'blacks': isWin = (color === 'black'); break;
            case 'whites': isWin = (color === 'white'); break;
            case 'blacks-whites': isWin = (color === 'black' || color === 'white'); break;
            case 'reds-whites': isWin = (color === 'red' || color === 'white'); break;
            case 'any': isWin = true; break;
        }

        if (isWin) {
            // DEU GREEN! 🎉
            console.log(`[Pattern Engine] Sinal ${signal.signal_type} -> GREEN! na rodada ${signal.rounds}`);
            await supabase.from('signals').update({ result: 'green', updated_at: new Date().toISOString() }).eq('id', signal.id);
        } else {
            // Não bateu. LOSS da etapa atual. Tem gale?
            const currentRound = signal.rounds || 1;
            const limitRounds = maxGales + 1; // 0 gales = 1 rodada. 1 gale = 2 rodadas. 2 gales = 3 rodadas.

            if (currentRound < limitRounds) {
                // Tem Gale! Avança a etapa. Continua pendente.
                console.log(`[Pattern Engine] Sinal ${signal.signal_type} errou. Indo pro Gale ${currentRound}...`);
                await supabase.from('signals').update({ rounds: currentRound + 1, updated_at: new Date().toISOString() }).eq('id', signal.id);
                signal.rounds = currentRound + 1;
                remainingPendings.push(signal); // Mantém no monitoramento
            } else {
                // Esgotou as tentativas. RED ❌
                console.log(`[Pattern Engine] Sinal ${signal.signal_type} esgotou gales -> LOSS!`);
                await supabase.from('signals').update({ result: 'loss', updated_at: new Date().toISOString() }).eq('id', signal.id);
            }
        }
    }

    pendingSignals = remainingPendings;
}

async function evaluatePatterns(latestResults) {
    const newestRoll = latestResults[0];
    
    console.log('[Pattern Engine] Tape Atual: ', latestResults.slice(0, 5).map(r => r.color));

    for (const pattern of activePatterns) {
        // Usa o roundId do WS ou o id gerado pelo DOM para unicidade
        const uniqueId = newestRoll.roundId || newestRoll.id;
        
        // Se este pattern já foi processado nesta pedra exata, pula. (Isso previne dupla criação do mesmo sinal)
        if (lastTriggeredRound[pattern.id] === uniqueId) {
            continue;
        }

        const colors = pattern.colors || [];
        const numbers = pattern.numbers || [];

        // Padrão vazio é inválido
        if (colors.length === 0 && numbers.length === 0) continue;

        // Pega o maior tamanho para saber até onde voltar na fita
        const size = Math.max(colors.length, numbers.length);
        if (latestResults.length < size) {
            console.log(`[Pattern Engine] Array ${latestResults.length} muito curto (padrao precisa de ${size})`);
            continue;
        }

        let matchColors = true;
        let matchNumbers = true;

        if (colors.length > 0) {
            for (let i = 0; i < colors.length; i++) {
                const patCol = colors[colors.length - 1 - i]; // Indice reverso
                const resCol = latestResults[i].color;
                console.log(`[Debug] Checking pattern '${pattern.name}' i=${i} -> Pat[${patCol}] vs Tape[${resCol}]`);
                if (patCol !== resCol) {
                    matchColors = false;
                    console.log(`[Debug] Failed match on pattern '${pattern.name}' at i=${i}`);
                    break;
                }
            }
        }

        if (numbers.length > 0) {
            for (let i = 0; i < numbers.length; i++) {
                const patNum = numbers[numbers.length - 1 - i]; // Indice reverso
                const resNum = latestResults[i].roll;
                if (patNum !== resNum) {
                    matchNumbers = false;
                    break;
                }
            }
        }

        // MATCH COMPLETO DA TAPE!
        if (matchColors && matchNumbers) {
            // Verifica o MODE do padrão
            // 'when_exit' -> Quando essa sequência SAIR.
            // 'when_not_exit' -> Quando a sequência NÃO sair (complexo, no momento focado no standard when_exit)
            if (pattern.mode === 'when_exit') {
                console.log(`[Pattern Engine] 🔥 PADRÃO DETECTADO! [${pattern.name}] na pedra ${uniqueId}`);
                
                lastTriggeredRound[pattern.id] = uniqueId;

                // Emite um novo Sinal para o banco (os apps dos clientes vão pipocar Realtime)
                const protectionText = pattern.gales === 0 ? "Sem gale" : pattern.gales === 1 ? "1 Gale" : `${pattern.gales} Gales`;
                const vtLabel = {
                    'reds': 'Vermelhos',
                    'blacks': 'Pretos',
                    'whites': 'Brancos',
                    'blacks-whites': 'Pretos/Brancos',
                    'reds-whites': 'Vermelhos/Brancos',
                    'any': 'Qualquer'
                }[pattern.victory_target || 'reds'];

                const newSignal = {
                    signal_type: pattern.name,
                    entry: `Cobrir ${vtLabel}`,
                    protection: protectionText, // Ex: "Sem gale", "1 Gale", "2 Gales"
                    result: 'pending',
                    target: pattern.victory_target, // Salva o technical enum pra lógica
                    rounds: 1
                };

                const { data, error } = await supabase.from('signals').insert(newSignal).select('*').single();
                if (error) {
                    console.error('[Pattern Engine] Falha ao injetar sinal:', error);
                } else if (data) {
                    pendingSignals.push(data); // Inicia o monitoramento dessa aposta nos próximos roles
                }
            }
        }
    }
}

module.exports = {
    initPatternEngine,
    processNewRoll
};
