const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Initialize Supabase
const supabase = createClient(config.DB_URL, config.DB_KEY);

// User operations
const getUser = async (telegramId) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    
    if (error) {
        console.log('Error getting user:', error);
        return null;
    }
    return data;
};

const updateUser = async (telegramId, updates) => {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('telegram_id', telegramId);
    
    return !error;
};

// Transaction operations
const tieneOrdenPendiente = async (telegramId, currency = null) => {
    try {
        let query = supabase
            .from('transactions')
            .select('*')
            .eq('user_id', telegramId)
            .eq('status', 'pending')
            .eq('type', 'DEPOSIT');
        
        if (currency) {
            query = query.eq('currency', currency);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.log('Error checking pending order:', error);
            return null;
        }
        
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error in tieneOrdenPendiente:', error);
        return null;
    }
};

const cancelarOrdenPendiente = async (telegramId, currency = null) => {
    try {
        const orden = await tieneOrdenPendiente(telegramId, currency);
        
        if (!orden) {
            return { success: false, message: 'No tienes órdenes pendientes para cancelar' };
        }
        
        const { error } = await supabase
            .from('transactions')
            .update({ status: 'canceled', canceled_at: new Date().toISOString() })
            .eq('id', orden.id);
        
        if (error) {
            throw error;
        }
        
        return { success: true, message: `Orden #${orden.id} cancelada exitosamente` };
    } catch (error) {
        console.error('Error canceling order:', error);
        return { success: false, message: 'Error al cancelar la orden' };
    }
};

// Phone operations
const getUserByPhone = async (phone) => {
    try {
        if (!phone) {
            console.log('❌ No phone provided for search');
            return null;
        }
        
        const normalizedPhone = phone.replace(/[^\d]/g, '');
        console.log(`🔍 Searching user with normalized phone: ${normalizedPhone}`);
        
        let searchPatterns = [];
        
        if (normalizedPhone.startsWith('53') && normalizedPhone.length === 10) {
            searchPatterns.push(normalizedPhone);
            searchPatterns.push(normalizedPhone.substring(2));
        } else if (normalizedPhone.length === 8) {
            searchPatterns.push(`53${normalizedPhone}`);
            searchPatterns.push(normalizedPhone);
        } else {
            searchPatterns.push(normalizedPhone);
        }
        
        searchPatterns = [...new Set(searchPatterns)];
        
        console.log(`🔍 Search patterns to try:`, searchPatterns);
        
        for (const pattern of searchPatterns) {
            console.log(`🔍 Trying pattern: ${pattern}`);
            
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', pattern)
                .single();
            
            if (error) {
                if (error.code !== 'PGRST116') {
                    console.log(`⚠️ Error searching with pattern ${pattern}:`, error.message);
                }
            }
            
            if (data) {
                console.log(`✅ User found with pattern ${pattern}:`, {
                    id: data.telegram_id,
                    name: data.first_name,
                    phone_in_db: data.phone_number
                });
                return data;
            }
        }
        
        console.log(`❌ User not found for any phone pattern`);
        return null;
        
    } catch (error) {
        console.error('❌ Error in getUserByPhone:', error);
        return null;
    }
};

// Verification operations
const verificarTransaccionDuplicada = async (tx_id) => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('tx_id', tx_id)
            .eq('status', 'completed')
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.log('Error checking duplicate:', error);
        }
        
        return data !== null;
    } catch (error) {
        console.error('Error in verificarTransaccionDuplicada:', error);
        return false;
    }
};

const verificarSolicitudPendiente = async (userId, currency) => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('currency', currency)
            .eq('type', 'DEPOSIT')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (error) {
            console.log('Error checking pending request:', error);
            return null;
        }
        
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Error in verificarSolicitudPendiente:', error);
        return null;
    }
};

module.exports = {
    supabase,
    getUser,
    updateUser,
    tieneOrdenPendiente,
    cancelarOrdenPendiente,
    getUserByPhone,
    verificarTransaccionDuplicada,
    verificarSolicitudPendiente
};
