const express = require('express');
const router = express.Router();
const middleware = require('./middleware');
const bot = require('../bot');
const db = require('../database');
const config = require('../config');
const utils = require('../utils');

// LioGames webhook
router.post('/lio-webhook', middleware.verifyWebhookToken, async (req, res) => {
    try {
        console.log('📥 LioGames webhook received:', req.body);
        
        const { order_id, status, message, partner_ref } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required' });
        }
        
        // Search transaction
        let transaction = null;
        
        const { data: txByLioId } = await db.supabase
            .from('game_transactions')
            .select('*')
            .eq('lio_transaction_id', order_id)
            .single();
        
        if (txByLioId) {
            transaction = txByLioId;
        } else if (partner_ref) {
            const { data: txByRef } = await db.supabase
                .from('game_transactions')
                .select('*')
                .eq('partner_ref', partner_ref)
                .single();
            
            if (txByRef) {
                transaction = txByRef;
            }
        }
        
        if (!transaction) {
            console.log(`❌ Transaction not found for order_id: ${order_id}, partner_ref: ${partner_ref}`);
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        // Map status
        let newStatus = 'processing';
        if (status === 'SUCCESS') newStatus = 'completed';
        else if (status === 'FAILED') newStatus = 'failed';
        else if (status === 'PENDING') newStatus = 'pending';
        else if (status === 'CANCELED') newStatus = 'canceled';
        
        // Update transaction
        const updates = {
            status: newStatus,
            updated_at: new Date().toISOString(),
            response_data: req.body
        };
        
        if (newStatus === 'completed') {
            updates.completed_at = new Date().toISOString();
        }
        
        await db.supabase
            .from('game_transactions')
            .update(updates)
            .eq('id', transaction.id);
        
        // Update general transactions
        await db.supabase
            .from('transactions')
            .update({ 
                status: newStatus,
                completed_at: newStatus === 'completed' ? new Date().toISOString() : null
            })
            .eq('game_transaction_id', transaction.id);
        
        // Notify user
        if (transaction.telegram_user_id) {
            let statusMessage = '';
            switch (newStatus) {
                case 'completed':
                    statusMessage = `✅ *¡Recarga de ${transaction.game_name} completada!*\n\n` +
                        `🎮 Juego: ${transaction.game_name}\n` +
                        `💰 Monto: ${utils.formatCurrency(transaction.amount, transaction.currency)}\n` +
                        `🆔 Orden LioGames: ${order_id}\n` +
                        `📅 Fecha: ${new Date().toLocaleString()}`;
                    break;
                case 'failed':
                    statusMessage = `❌ *Recarga de ${transaction.game_name} fallida*\n\n` +
                        `Error: ${message || 'Error desconocido'}\n\n` +
                        `Contacta al administrador para más información.`;
                    break;
                case 'processing':
                    statusMessage = `⏳ *Recarga de ${transaction.game_name} en proceso*\n\n` +
                        `Estamos procesando tu recarga. Te notificaremos cuando esté completa.`;
                    break;
            }
            
            if (statusMessage) {
                await bot.sendMessage(transaction.telegram_user_id, statusMessage, { 
                    parse_mode: 'Markdown' 
                });
            }
        }
        
        // Notify admin
        if (config.ADMIN_CHAT_ID) {
            const adminMsg = `🎮 *Webhook LioGames - Estado Actualizado*\n\n` +
                `👤 Usuario: ${transaction.telegram_user_id}\n` +
                `🎮 Juego: ${transaction.game_name}\n` +
                `📦 Estado: ${newStatus}\n` +
                `🆔 Orden LioGames: ${order_id}\n` +
                `💰 Monto: ${utils.formatCurrency(transaction.amount, transaction.currency)}`;
            
            await bot.sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            message: 'Estado actualizado correctamente',
            transaction_id: transaction.id,
            new_status: newStatus
        });
        
    } catch (error) {
        console.error('❌ Error procesando webhook LioGames:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// SokyRecargas webhook
router.post('/soky-webhook', middleware.verifyWebhookToken, async (req, res) => {
    try {
        console.log('📥 SokyRecargas webhook received:', req.body);
        
        const { transaction_id, status, message, offer_id, price_id } = req.body;
        
        if (!transaction_id) {
            return res.status(400).json({ error: 'transaction_id es requerido' });
        }
        
        // Search transaction
        const { data: transaction, error } = await db.supabase
            .from('soky_transactions')
            .select('*')
            .eq('soky_transaction_id', transaction_id)
            .single();
        
        if (error || !transaction) {
            console.log(`❌ Transacción Soky no encontrada: ${transaction_id}`);
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }
        
        // Map status
        let newStatus = 'pending';
        if (status === 'completed' || status === 'success') newStatus = 'completed';
        else if (status === 'failed') newStatus = 'failed';
        else if (status === 'canceled') newStatus = 'canceled';
        else newStatus = status;
        
        // Update status
        const updates = {
            status: newStatus,
            updated_at: new Date().toISOString(),
            metadata: { ...transaction.metadata, webhook_data: req.body }
        };
        
        await db.supabase
            .from('soky_transactions')
            .update(updates)
            .eq('id', transaction.id);
        
        // Notify user
        if (transaction.telegram_user_id) {
            let statusMessage = '';
            switch (newStatus) {
                case 'completed':
                    statusMessage = `✅ *¡Recarga ETECSA completada!*\n\n` +
                        `📱 Oferta: ${transaction.offer_name}\n` +
                        `💰 Paquete: ${transaction.price_label}\n` +
                        `💵 Monto: $${transaction.cup_price} CUP\n` +
                        `📞 Destino: ${transaction.recipient_phone}\n` +
                        `🆔 ID Soky: ${transaction_id}\n` +
                        `📅 Fecha: ${new Date().toLocaleString()}`;
                    break;
                case 'failed':
                    statusMessage = `❌ *Recarga ETECSA fallida*\n\n` +
                        `Oferta: ${transaction.offer_name}\n` +
                        `Error: ${message || 'Error desconocido'}\n\n` +
                        `Contacta al administrador para más información.`;
                    break;
                case 'pending':
                    statusMessage = `⏳ *Recarga ETECSA en proceso*\n\n` +
                        `Tu recarga está siendo procesada por ETECSA. Te notificaremos cuando esté completa.`;
                    break;
            }
            
            if (statusMessage) {
                await bot.sendMessage(transaction.telegram_user_id, statusMessage, { 
                    parse_mode: 'Markdown' 
                });
            }
        }
        
        // Notify admin
        if (config.ADMIN_CHAT_ID) {
            const adminMsg = `📱 *Webhook SokyRecargas - Estado Actualizado*\n\n` +
                `👤 Usuario: ${transaction.telegram_user_id}\n` +
                `📱 Oferta: ${transaction.offer_name}\n` +
                `📦 Estado: ${newStatus}\n` +
                `🆔 ID Soky: ${transaction_id}\n` +
                `💰 Monto: $${transaction.cup_price} CUP`;
            
            await bot.sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        }
        
        res.json({ 
            success: true, 
            message: 'Estado actualizado correctamente',
            transaction_id: transaction.id,
            new_status: newStatus
        });
        
    } catch (error) {
        console.error('❌ Error procesando webhook SokyRecargas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Generic status webhook
router.post('/status-webhook', middleware.verifyWebhookToken, async (req, res) => {
    try {
        console.log('📥 Status webhook received:', req.body);
        
        const { service, type, data } = req.body;
        
        if (!service || !type || !data) {
            return res.status(400).json({ error: 'service, type y data son requeridos' });
        }
        
        switch (service) {
            case 'liogames':
                return router.handle(req, res, (err) => {
                    if (err) throw err;
                });
                
            case 'sokyrecargas':
                return router.handle(req, res, (err) => {
                    if (err) throw err;
                });
                
            default:
                console.log(`⚠️ Servicio no reconocido: ${service}`);
                
                if (config.ADMIN_CHAT_ID) {
                    const adminMsg = `🌐 *Webhook Genérico Recibido*\n\n` +
                        `🔧 Servicio: ${service}\n` +
                        `📋 Tipo: ${type}\n` +
                        `📊 Datos: ${JSON.stringify(data, null, 2)}\n\n` +
                        `Hora: ${new Date().toLocaleString()}`;
                    
                    await bot.sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
                }
                
                res.json({ 
                    success: true, 
                    message: 'Notificación recibida',
                    service: service,
                    type: type
                });
        }
        
    } catch (error) {
        console.error('❌ Error procesando webhook de estado:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Payment notification endpoint
router.post('/payment-notification', middleware.verifyWebhookToken, async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📥 PAYMENT-NOTIFICATION RECIBIDA EN EL BOT');
        console.log('🕐 Hora:', new Date().toISOString());
        
        const { 
            type, 
            amount, 
            currency, 
            tx_id, 
            tipo_pago, 
            phone
        } = req.body;
        
        if (!type || !amount || !currency || !tx_id) {
            console.log('❌ Campos requeridos faltantes en payload');
            return res.status(400).json({ 
                success: false, 
                message: 'Campos requeridos faltantes: type, amount, currency, tx_id' 
            });
        }
        
        switch (type) {
            case 'SMS_PAYMENT_DETECTED':
                console.log(`🔍 Procesando SMS_PAYMENT_DETECTED`);
                console.log(`📞 Teléfono recibido: ${phone}`);
                console.log(`💰 Monto: ${amount} ${currency}`);
                
                let user = null;
                let normalizedPhone = null;
                
                if (phone) {
                    normalizedPhone = phone.replace(/[^\d]/g, '');
                    console.log(`🔍 Buscando usuario con teléfono normalizado: ${normalizedPhone}`);
                    
                    user = await db.getUserByPhone(normalizedPhone);
                    
                    if (user) {
                        console.log(`✅ Usuario encontrado: ${user.telegram_id}`);
                        
                        const result = await utils.procesarPagoAutomatico(
                            user.telegram_id, 
                            amount, 
                            currency, 
                            tx_id, 
                            tipo_pago
                        );
                        
                        console.log(`✅ Resultado del procesamiento:`, result);
                        return res.json(result);
                    } else {
                        console.log(`❌ Usuario NO encontrado para teléfono: ${normalizedPhone}`);
                        
                        // Save as pending payment
                        await db.supabase.from('pending_sms_payments').insert({
                            phone: normalizedPhone,
                            amount: amount,
                            currency: currency,
                            tx_id: tx_id,
                            tipo_pago: tipo_pago,
                            claimed: false,
                            created_at: new Date().toISOString()
                        });
                        
                        console.log(`✅ Pago pendiente guardado para teléfono: ${normalizedPhone}`);
                        
                        // Notify admin
                        if (config.ADMIN_CHAT_ID) {
                            const mensajeAdmin = `📱 *PAGO NO IDENTIFICADO*\n\n` +
                                `📞 Teléfono: ${normalizedPhone}\n` +
                                `💰 Monto: ${utils.formatCurrency(amount, currency)}\n` +
                                `🔧 Tipo: ${tipo_pago}\n` +
                                `🆔 ID: \`${tx_id}\`\n\n` +
                                `ℹ️ Este pago está pendiente de reclamar.`;
                            
                            await bot.sendMessage(config.ADMIN_CHAT_ID, mensajeAdmin, { parse_mode: 'Markdown' });
                        }
                        
                        return res.json({ 
                            success: false, 
                            message: 'Usuario no encontrado, pago guardado como pendiente',
                            phone: normalizedPhone
                        });
                    }
                }
                break;
                
            default:
                console.log(`❌ Tipo de notificación desconocido: ${type}`);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Tipo de notificación desconocido',
                    received_type: type 
                });
        }
        
    } catch (error) {
        console.error('❌ Error en payment-notification:', error);
        
        if (config.ADMIN_CHAT_ID) {
            const errorMsg = `❌ *ERROR EN PAYMENT-NOTIFICATION*\n\n` +
                `Error: ${error.message}\n` +
                `Hora: ${new Date().toLocaleString()}`;
            
            try {
                await bot.sendMessage(config.ADMIN_CHAT_ID, errorMsg, { parse_mode: 'Markdown' });
            } catch (botError) {
                console.error('Error enviando mensaje de error:', botError);
            }
        }
        
        return res.status(500).json({ 
            success: false, 
            message: error.message
        });
    }
});

module.exports = {
    router
};
