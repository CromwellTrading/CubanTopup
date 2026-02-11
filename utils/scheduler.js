const sessions = require('../handlers/sessions');

function initScheduledTasks() {
    // Clean inactive sessions every 10 minutes
    setInterval(() => {
        sessions.cleanupOldSessions();
        
        // Limpiar estados en handlers externos
        try {
            const BolitaHandler = require('../services/BolitaHandler');
            const TradingSignalsHandler = require('../services/TradingSignalsHandler');
            
            const bot = require('../bot');
            const db = require('../database');
            
            const bolitaHandler = new BolitaHandler(bot, db.supabase);
            const tradingHandler = new TradingSignalsHandler(bot, db.supabase);
            
            bolitaHandler.cleanupOldStates();
            tradingHandler.cleanupOldStates();
            
            console.log('🧹 Tareas de limpieza ejecutadas');
        } catch (error) {
            console.error('Error en tareas programadas:', error);
        }
        
    }, 10 * 60 * 1000); // 10 minutes
    
    // Otras tareas programadas
    setInterval(async () => {
        try {
            // Verificar sorteos vencidos de La Bolita
            const { data: sorteosVencidos } = await require('../database').supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado', 'activo')
                .lt('fecha', new Date().toISOString());
            
            if (sorteosVencidos && sorteosVencidos.length > 0) {
                for (const sorteo of sorteosVencidos) {
                    await require('../database').supabase
                        .from('bolita_sorteos')
                        .update({ estado: 'finalizado' })
                        .eq('id', sorteo.id);
                    
                    console.log(`📅 Sorteo ${sorteo.id} marcado como finalizado`);
                }
            }
        } catch (error) {
            console.error('Error verificando sorteos vencidos:', error);
        }
    }, 5 * 60 * 1000); // 5 minutos
    
    // Notificar al admin que las tareas están activas
    console.log('⏰ Tareas programadas iniciadas');
}

module.exports = {
    initScheduledTasks
};
