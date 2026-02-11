const sessions = require('../handlers/sessions');

function initScheduledTasks(bolitaHandler = null, tradingHandler = null) {
    // Clean inactive sessions every 10 minutes
    setInterval(() => {
        try {
            sessions.cleanupOldSessions();
            
            // Limpiar estados en handlers externos si están disponibles
            if (bolitaHandler && typeof bolitaHandler.cleanupOldStates === 'function') {
                bolitaHandler.cleanupOldStates();
            }
            
            if (tradingHandler && typeof tradingHandler.cleanupOldStates === 'function') {
                tradingHandler.cleanupOldStates();
            }
            
            console.log('🧹 Tareas de limpieza ejecutadas');
        } catch (error) {
            console.error('Error en tareas programadas:', error);
        }
        
    }, 10 * 60 * 1000); // 10 minutes
    
    // Otras tareas programadas
    setInterval(async () => {
        try {
            // Verificar sorteos vencidos de La Bolita
            const db = require('../database');
            const { data: sorteosVencidos } = await db.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado', 'activo')
                .lt('fecha', new Date().toISOString());
            
            if (sorteosVencidos && sorteosVencidos.length > 0) {
                for (const sorteo of sorteosVencidos) {
                    await db.supabase
                        .from('bolita_sorteos')
                        .update({ estado: 'finalizado' })
                        .eq('id', sorteo.id);
                    
                    console.log(`📅 Sorteo ${sorteo.id} marcado como finalizado`);
                }
            }
            
            // También podemos verificar renovaciones de trading si el handler está disponible
            if (tradingHandler && typeof tradingHandler.checkRenewals === 'function') {
                await tradingHandler.checkRenewals();
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
