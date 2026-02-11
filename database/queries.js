const { supabase } = require('./index');

// Advanced queries for statistics
async function getTotalStats() {
    const { data: users, error: usersError } = await supabase
        .from('users')
        .select('balance_cup, balance_saldo, tokens_cws');
    
    if (usersError) throw usersError;
    
    let totalCUP = 0;
    let totalSaldo = 0;
    let totalCWS = 0;
    
    users.forEach(user => {
        totalCUP += parseFloat(user.balance_cup) || 0;
        totalSaldo += parseFloat(user.balance_saldo) || 0;
        totalCWS += parseFloat(user.tokens_cws) || 0;
    });
    
    return {
        totalCUP: Math.round(totalCUP * 100) / 100,
        totalSaldo: Math.round(totalSaldo * 100) / 100,
        totalCWS: Math.round(totalCWS)
    };
}

async function getUserStats(userId) {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();
    
    if (error) throw error;
    
    const { data: transacciones } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
    
    const { data: ordenesPendientes } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    
    const { data: apuestasBolita } = await supabase
        .from('bolita_apuestas')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
    
    const { data: suscripcionesTrading } = await supabase
        .from('trading_suscripciones')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    return {
        usuario: {
            id: user.telegram_id,
            nombre: user.first_name,
            username: user.username,
            telefono: user.phone_number,
            balance_cup: user.balance_cup || 0,
            balance_saldo: user.balance_saldo || 0,
            tokens_cws: user.tokens_cws || 0,
            fecha_registro: user.created_at || user.last_active
        },
        transacciones: transacciones || [],
        ordenesPendientes: ordenesPendientes || [],
        apuestasBolita: apuestasBolita || [],
        suscripcionesTrading: suscripcionesTrading || []
    };
}

async function getPendingTransactionsByCurrency(userId, currency = null) {
    let query = supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .eq('type', 'DEPOSIT');
    
    if (currency) {
        query = query.eq('currency', currency);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data;
}

async function getRecentTransactions(limit = 20) {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

async function getPendingPayments() {
    const { data, error } = await supabase
        .from('pending_sms_payments')
        .select('*')
        .eq('claimed', false)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
}

async function getGameTransactionsByUser(userId, limit = 10) {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'GAME_RECHARGE')
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

async function getETECSATransactionsByUser(userId, limit = 10) {
    const { data, error } = await supabase
        .from('soky_transactions')
        .select('*')
        .eq('telegram_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

async function getBolitaBetsByUser(userId, limit = 10) {
    const { data, error } = await supabase
        .from('bolita_apuestas')
        .select('*, bolita_sorteos(numero_ganador, fecha, hora, estado)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

async function getTradingSubscriptionsByUser(userId) {
    const { data, error } = await supabase
        .from('trading_suscripciones')
        .select('*, trading_planes(nombre, duracion_dias, precio)')
        .eq('user_id', userId)
        .order('fecha_inicio', { ascending: false });
    
    if (error) throw error;
    return data;
}

module.exports = {
    getTotalStats,
    getUserStats,
    getPendingTransactionsByCurrency,
    getRecentTransactions,
    getPendingPayments,
    getGameTransactionsByUser,
    getETECSATransactionsByUser,
    getBolitaBetsByUser,
    getTradingSubscriptionsByUser
};
