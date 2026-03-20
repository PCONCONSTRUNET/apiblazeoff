const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const s = createClient('https://xrphlhlqksxnkldsypap.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycGhsaGxxa3N4bmtsZHN5cGFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgwODIwMywiZXhwIjoyMDg5Mzg0MjAzfQ.IqRd_EGi0oO_UWz1w6ocMCL_x910AU3WmWSJ9J9HEfo');

async function run() {
    const {data: p} = await s.from('patterns').select('id, name, colors, numbers, status, mode, history');
    const {data: sig} = await s.from('signals').select('*').limit(10).order('created_at', {ascending: false});
    
    fs.writeFileSync('db_dump.json', JSON.stringify({ PATTERNS: p, SIGNALS: sig }, null, 2), 'utf8');
}
run();
