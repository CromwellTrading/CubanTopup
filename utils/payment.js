const bot = require('../bot');
const db = require('../database');
const config = require('../config');
const currencies = require('./currencies');

async function procesarPagoAutomatico(userId, amount, currency, txId, tipoPago) {
    try {
        console.log(`💰 Processing automatic payment: ${userId}, ${amount}, ${currency}, ${txId}, ${tipoPago}`);
        
        // 1. Check if transaction already exists
        const esDuplicado = await db.verificarTransaccionDuplicada(txId);
        if (esDuplicado) {
            console.log(`❌ Duplicate transaction detected: ${txId}`);
            return { 
                success: false, 
                message: 'Esta transacción ya fue procesada anteriormente',
                esDuplicado: true 
            };
        }
        
        // 2. Check if user has pending request
        const solicitudPendiente = await db.verificarSolicitudPendiente(userId, currency);
        
        if (!solicitudPendiente) {
            console.log(`❌ User ${userId} has no pending request for ${currency}`);
            
            // Save as unrequested payment (external transfer)
            await db.supabase.from('unrequested_payments').insert({
                user_id: userId,
                amount: amount,
                currency: currency,
                tx_id: txId,
                tipo_pago: tipoPago,
                status: 'no_request',
                created_at: new Date().toISOString()
            });
            
            // Only notify admin
            if (config.ADMIN_CHAT_ID) {
                const user = await db.getUser(userId);
                const adminMsg = `⚠️ *Transferencia exterior recibida*\n\n` +
                    `👤 Usuario: ${user ? user.first_name : 'Desconocido'}\n` +
                    `🆔 ID: ${userId}\n` +
                    `💰 Monto: ${currencies.formatCurrency(amount, currency)}\n` +
                    `🔧 Tipo: ${tipoPago}\n` +
                    `🆔 TX ID: \`${txId}\`\n\n` +
                    `Este pago se guardó como transferencia exterior (sin solicitud).`;
                await bot.sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
            }
            
            return { 
                success: false, 
                message: 'Pago guardado como transferencia exterior',
                esTransferenciaExterior: true 
            };
        }
        
        // 3. Verify amount matches (with 10% margin)
        const montoSolicitado = solicitudPendiente.amount_requested;
        const margen = montoSolicitado * 0.1;
        
        if (Math.abs(amount - montoSolicitado) > margen) {
            console.log(`❌ Amount doesn't match: Requested ${montoSolicitado}, Received ${amount}`);
            
            // Notify user
            await bot.sendMessage(userId,
                `⚠️ *Monto no coincide*\n\n` +
                `📋 Solicitado: ${currencies.formatCurrency(montoSolicitado, currency)}\n` +
                `💰 Recibido: ${currencies.formatCurrency(amount, currency)}\n\n` +
                `Contacta al administrador para aclaración.`,
                { parse_mode: 'Markdown' }
            );
            
            return { 
                success: false, 
                message: 'Monto no coincide con la solicitud',
                montoSolicitado: montoSolicitado,
                montoRecibido: amount 
            };
        }
        
        // 4. Process payment
        const user = await db.getUser(userId);
        if (!user) {
            console.log(`❌ User ${userId} not found`);
            return { success: false, message: 'Usuario no encontrado' };
        }
        
        let montoConBono = amount;
        let tokensGanados = 0;
        
        // Apply bonus only for first deposit
        if (currency === 'cup' && user.first_dep_cup) {
            montoConBono = amount * 1.10;
            await db.updateUser(userId, { first_dep_cup: false });
        } else if (currency === 'saldo' && user.first_dep_saldo) {
            montoConBono = amount * 1.10;
            await db.updateUser(userId, { first_dep_saldo: false });
        }
        
        // Calculate tokens for saldo
        if (currency === 'saldo') {
            tokensGanados = Math.floor(amount / 100) * config.CWS_PER_100_SALDO;
        }
        
        // Update user balance
        const updates = {
            [`balance_${currency}`]: (user[`balance_${currency}`] || 0) + montoConBono
        };
        
        if (currency === 'saldo') {
            updates.tokens_cws = (user.tokens_cws || 0) + tokensGanados;
        }
        
        await db.updateUser(userId, updates);
        
        // Update transaction as completed
        await db.supabase
            .from('transactions')
            .update({ 
                status: 'completed',
                amount: montoConBono,
                tokens_generated: tokensGanados,
                tx_id: txId,
                tipo_pago: tipoPago,
                completed_at: new Date().toISOString()
            })
            .eq('id', solicitudPendiente.id);
        
        const bonoMensaje = montoConBono > amount ? 
            `\n🎉 *¡Bono aplicado!* +${currencies.formatCurrency(montoConBono - amount, currency)}` : '';
        
        const tokensMensaje = tokensGanados > 0 ? 
            `\n🎫 *Tokens ganados:* +${tokensGanados} CWS` : '';
        
        // Notify user
        const mensajeUsuario = `✨ *¡Depósito Completado!*\n\n` +
            `📋 Orden #${solicitudPendiente.id}\n` +
            `💰 Monto recibido: ${currencies.formatCurrency(amount, currency)}\n` +
            `${bonoMensaje}${tokensMensaje}\n` +
            `💵 Total acreditado: *${currencies.formatCurrency(montoConBono, currency)}*\n\n` +
            `📊 Nuevo saldo ${currency.toUpperCase()}: *${currencies.formatCurrency(updates[`balance_${currency}`], currency)}*\n` +
            `🆔 ID de Transacción: \`${txId}\``;
        
        await bot.sendMessage(userId, mensajeUsuario, { parse_mode: 'Markdown' });
        
        // Notify admin
        if (config.ADMIN_CHAT_ID) {
            const mensajeAdmin = `✅ *DEPÓSITO COMPLETADO*\n\n` +
                `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                `📋 Orden #: ${solicitudPendiente.id}\n` +
                `💰 Monto: ${currencies.formatCurrency(amount, currency)}\n` +
                `🎁 Total con bono: ${currencies.formatCurrency(montoConBono, currency)}\n` +
                `🎫 Tokens: ${tokensGanados} CWS\n` +
                `🔧 Tipo: ${tipoPago}\n` +
                `🆔 TX ID: \`${txId}\``;
            
            await bot.sendMessage(config.ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
        }
        
        return { 
            success: true, 
            montoConBono, 
            tokensGanados,
            ordenId: solicitudPendiente.id,
            tx_id: txId,
            montoRecibido: amount,
            bono: montoConBono - amount
        };
        
    } catch (error) {
        console.error('❌ Error procesando pago automático:', error);
        return { success: false, message: error.message };
    }
}

async function notificarSolicitudNueva(solicitud) {
    try {
        if (!config.ADMIN_CHAT_ID) return;
        
        const user = await db.getUser(solicitud.user_id);
        if (!user) return;
        
        const mensajeAdmin = `📝 *NUEVA SOLICITUD DE DEPÓSITO*\n\n` +
            `🆔 *Orden #:* ${solicitud.id}\n` +
            `👤 *Usuario:* ${user.first_name} (@${user.username || 'sin usuario'})\n` +
            `🆔 *ID:* ${user.telegram_id}\n` +
            `📞 *Teléfono:* ${user.phone_number || 'No vinculado'}\n` +
            `💰 *Monto solicitado:* ${currencies.formatCurrency(solicitud.amount_requested, solicitud.currency)}\n` +
            `💳 *Método:* ${solicitud.currency.toUpperCase()}\n` +
            `📅 *Fecha:* ${new Date(solicitud.created_at).toLocaleString()}\n\n` +
            `⚠️ *Esperando pago del usuario*`;
        
        await bot.sendMessage(config.ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error notifying new request:', error);
    }
}

module.exports = {
    procesarPagoAutomatico,
    notificarSolicitudNueva
};
