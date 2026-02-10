require('dotenv').config();
const axios = require('axios');

class SokyRecargasHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        
        this.SOKY_API_TOKEN = process.env.SOKY_API_TOKEN;
        this.SOKY_RATE_CUP = parseFloat(process.env.SOKY_RATE_CUP);
        
        if (!this.SOKY_API_TOKEN) {
            console.error('❌ ERROR: SOKY_API_TOKEN no está configurado en .env');
            throw new Error('Falta SOKY_API_TOKEN en .env');
        }
        
        if (!this.SOKY_RATE_CUP || isNaN(this.SOKY_RATE_CUP)) {
            console.warn('⚠️ SOKY_RATE_CUP no configurado, usando valor por defecto 632');
            this.SOKY_RATE_CUP = 632;
        }
        
        this.baseURL = 'https://api.sokyrecargas.com';
        
        this.api = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${this.SOKY_API_TOKEN}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        this.activeSessions = {};
    }

    async getOffers() {
        try {
            console.log('🔍 Obteniendo ofertas de SokyRecargas...');
            const response = await this.api.get('/api/v1/recharges/offers');
            
            if (!response.data || !response.data.data) {
                console.log('❌ No se encontraron ofertas en la respuesta');
                return [];
            }
            
            const offers = response.data.data.filter(offer => 
                offer.type === 'recharge' && 
                offer.available === true &&
                offer.currency?.code === 'USDT'
            );
            
            const offersWithCUP = offers.map(offer => {
                // Verificar que offer.prices exista
                if (!offer.prices || !Array.isArray(offer.prices)) {
                    console.warn(`⚠️ Oferta sin precios:`, offer);
                    return null;
                }
                
                const pricesInCUP = offer.prices.map(price => {
                    const cupPrice = price.public * this.SOKY_RATE_CUP;
                    return {
                        id: price.id,
                        label: price.label || `$${price.public} USDT`,
                        cup_price: Math.ceil(cupPrice),
                        original_usdt: price.public,
                        description: price.description || ''
                    };
                });
                
                return {
                    id: offer.id,
                    name: offer.name,
                    description: offer.description,
                    prices: pricesInCUP,
                    metadata: {
                        has_email: offer.metadata?.has_email || false
                    }
                };
            }).filter(offer => offer !== null);
            
            console.log(`✅ ${offersWithCUP.length} ofertas encontradas (convertidas a CUP)`);
            return offersWithCUP;
            
        } catch (error) {
            console.error('❌ Error obteniendo ofertas de Soky:', error.response?.data || error.message);
            return [];
        }
    }

    async showOffers(chatId, messageId) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            
            const offers = await this.getOffers();
            
            if (offers.length === 0) {
                const message = `📭 *No hay ofertas disponibles*\n\n` +
                    `No encontramos ofertas de recargas ETECSA en este momento.\n` +
                    `Intenta más tarde.`;
                
                if (messageId) {
                    await this.bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 Actualizar', callback_data: 'soky_offers' }],
                                [{ text: '🔙 Volver', callback_data: 'start_back' }]
                            ]
                        }
                    });
                } else {
                    await this.bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 Actualizar', callback_data: 'soky_offers' }],
                                [{ text: '🔙 Volver', callback_data: 'start_back' }]
                            ]
                        }
                    });
                }
                return;
            }

            const groupedOffers = {};
            offers.forEach(offer => {
                const key = offer.description || offer.name;
                if (!groupedOffers[key]) {
                    groupedOffers[key] = [];
                }
                groupedOffers[key].push(offer);
            });

            let message = `📱 *RECARGAS ETECSA*\n\n`;
            message += `*Ofertas disponibles:*\n\n`;

            Object.keys(groupedOffers).forEach((key, index) => {
                const group = groupedOffers[key];
                const firstOffer = group[0];
                
                message += `${index + 1}. *${firstOffer.name}*\n`;
                message += `   📝 ${firstOffer.description || 'Recarga ETECSA'}\n`;
                message += `   💰 Precios:\n`;
                
                group.forEach(offer => {
                    offer.prices.forEach(price => {
                        message += `      • ${price.label}: $${price.cup_price} CUP\n`;
                    });
                });
                
                message += `\n`;
            });

            const buttons = offers.map(offer => 
                offer.prices.map(price => [
                    {
                        text: `${offer.name.substring(0, 15)}... - ${price.label}`,
                        callback_data: `soky_select:${offer.id}:${price.id}`
                    }
                ])
            ).flat();

            const keyboard = {
                inline_keyboard: [
                    ...buttons,
                    [{ text: '🔄 Actualizar ofertas', callback_data: 'soky_offers' }],
                    [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
                ]
            };

            if (messageId) {
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } else {
                await this.bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }

        } catch (error) {
            console.error('❌ Error mostrando ofertas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al cargar las ofertas. Intenta nuevamente.');
        }
    }

    async handleOfferSelection(chatId, messageId, offerId, priceId) {
        try {
            const offers = await this.getOffers();
            const offer = offers.find(o => o.id == offerId);
            const price = offer?.prices.find(p => p.id === priceId);
            
            if (!offer || !price) {
                await this.bot.answerCallbackQuery(messageId, { text: '❌ Oferta no disponible' });
                return;
            }

            const { data: user } = await this.supabase
                .from('users')
                .select('*')
                .eq('telegram_id', chatId)
                .single();

            if (!user) {
                await this.bot.sendMessage(chatId, '❌ No se pudo obtener tu información.');
                return;
            }

            const cupPrice = price.cup_price;
            const userBalance = user.balance_cup || 0;

            if (userBalance < cupPrice) {
                const faltante = cupPrice - userBalance;
                const message = `❌ *Saldo insuficiente*\n\n` +
                    `💰 *Precio de la recarga:* $${cupPrice} CUP\n` +
                    `👛 *Tu saldo CUP:* $${userBalance} CUP\n` +
                    `❌ *Faltan:* $${faltante} CUP\n\n` +
                    `Recarga tu billetera primero.`;
                
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }],
                            [{ text: '🔙 Volver a ofertas', callback_data: 'soky_offers' }]
                        ]
                    }
                });
                return;
            }

            this.activeSessions[chatId] = {
                offerId,
                priceId,
                offerName: offer.name,
                priceLabel: price.label,
                cupPrice,
                originalUsdt: price.original_usdt,
                requiresEmail: offer.metadata?.has_email || false,
                step: 'waiting_phone'
            };

            let message = `📱 *Confirmar Recarga ETECSA*\n\n` +
                `🎯 *Oferta:* ${offer.name}\n` +
                `💰 *Paquete:* ${price.label}\n` +
                `💵 *Precio en CUP:* $${cupPrice} CUP\n` +
                `💳 *Precio original:* $${price.original_usdt} USDT\n` +
                `👛 *Tu saldo CUP:* $${userBalance} CUP\n\n`;
            
            if (offer.metadata?.has_email) {
                message += `📧 *Esta recarga requiere email de Nauta*\n\n`;
            }
            
            // CAMBIADO: Solo pedimos 8 dígitos
            message += `Por favor, escribe el número de teléfono de destino:\n` +
                `*Formato:* 8 dígitos (ej: 51234567)\n` +
                `No incluyas el prefijo 53`;

            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Cancelar', callback_data: 'soky_offers' }]
                    ]
                }
            });

        } catch (error) {
            console.error('❌ Error en selección de oferta:', error);
            await this.bot.sendMessage(chatId, '❌ Error al procesar la selección.');
        }
    }

    async processRecharge(chatId, phone, email = null) {
        try {
            const session = this.activeSessions[chatId];
            if (!session) {
                await this.bot.sendMessage(chatId, '❌ Sesión expirada. Inicia nuevamente.');
                return;
            }

            const cleanPhone = phone.replace(/[^\d]/g, '');
            
            // CAMBIADO: Solo aceptamos 8 dígitos exactos
            if (cleanPhone.length !== 8) {
                await this.bot.sendMessage(chatId,
                    `❌ *Formato incorrecto*\n\n` +
                    `Debe tener exactamente 8 dígitos (sin el 53).\n\n` +
                    `Ejemplos válidos:\n` +
                    `• *51234567* (8 dígitos) ✅\n` +
                    `• *59190241* (8 dígitos) ✅\n\n` +
                    `No incluyas el prefijo 53. Inténtalo de nuevo:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            // Guardamos solo los 8 dígitos
            session.phone = cleanPhone;
            console.log(`✅ Número guardado (8 dígitos): ${cleanPhone}`);

            if (session.requiresEmail && !email) {
                session.step = 'waiting_email';
                
                await this.bot.sendMessage(chatId,
                    `📧 *Email de Nauta requerido*\n\n` +
                    `Esta recarga necesita email de Nauta.\n\n` +
                    `Por favor, escribe el email de Nauta:\n` +
                    `*Formato:* usuario@nauta.com.cu`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            if (session.requiresEmail && email) {
                const emailRegex = /^[a-zA-Z0-9._%+-]+@nauta\.(com\.cu|cu)$/i;
                if (!emailRegex.test(email)) {
                    await this.bot.sendMessage(chatId,
                        `❌ *Email inválido*\n\n` +
                        `Debe ser un email de Nauta válido.\n\n` +
                        `Ejemplo: usuario@nauta.com.cu\n\n` +
                        `Inténtalo de nuevo:`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
            }

            const { data: user } = await this.supabase
                .from('users')
                .select('*')
                .eq('telegram_id', chatId)
                .single();

            if (!user) {
                await this.bot.sendMessage(chatId, '❌ No se pudo obtener tu información.');
                delete this.activeSessions[chatId];
                return;
            }

            if (user.balance_cup < session.cupPrice) {
                await this.bot.sendMessage(chatId,
                    `❌ *Saldo insuficiente*\n\n` +
                    `Tu saldo ha cambiado. Recarga tu billetera primero.`,
                    { parse_mode: 'Markdown' }
                );
                delete this.activeSessions[chatId];
                return;
            }

            let confirmMessage = `📋 *Confirmar Recarga*\n\n` +
                `🎯 *Oferta:* ${session.offerName}\n` +
                `💰 *Paquete:* ${session.priceLabel}\n` +
                `💵 *Precio:* $${session.cupPrice} CUP\n` +
                `📞 *Teléfono destino:* 53${session.phone}\n`; // Mostramos con 53 para confirmación
            
            if (email) {
                confirmMessage += `📧 *Email Nauta:* ${email}\n`;
            }
            
            confirmMessage += `\n👛 *Tu saldo después:* $${user.balance_cup - session.cupPrice} CUP\n\n` +
                `¿Confirmas la recarga?`;

            session.email = email;
            session.step = 'confirming';

            await this.bot.sendMessage(chatId, confirmMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirmar y Pagar', callback_data: `soky_confirm:${session.offerId}:${session.priceId}` }],
                        [{ text: '❌ Cancelar', callback_data: 'soky_offers' }]
                    ]
                }
            });

        } catch (error) {
            console.error('❌ Error procesando recarga:', error);
            await this.bot.sendMessage(chatId, '❌ Error al procesar la recarga.');
            delete this.activeSessions[chatId];
        }
    }

    async confirmAndExecuteRecharge(chatId, messageId, offerId, priceId) {
        try {
            const session = this.activeSessions[chatId];
            if (!session || session.offerId != offerId || session.priceId != priceId) {
                await this.bot.sendMessage(chatId, '❌ Sesión expirada. Inicia nuevamente.');
                return;
            }

            await this.bot.editMessageText('🔄 Procesando tu recarga ETECSA...', {
                chat_id: chatId,
                message_id: messageId
            });

            const { data: user } = await this.supabase
                .from('users')
                .select('*')
                .eq('telegram_id', chatId)
                .single();

            if (!user || user.balance_cup < session.cupPrice) {
                await this.bot.editMessageText(
                    '❌ Saldo insuficiente. La recarga ha sido cancelada.',
                    { chat_id: chatId, message_id: messageId }
                );
                delete this.activeSessions[chatId];
                return;
            }

            // IMPORTANTE: Enviamos solo los 8 dígitos a SokyRecargas
            const rechargeData = {
                price_id: session.priceId,
                recipient: session.phone, // Solo 8 dígitos
                recipient_name: user.first_name || 'Usuario',
                subscribe: false
            };

            if (session.email) {
                rechargeData.email = session.email;
            }

            let sokyResult;
            try {
                console.log(`📤 Enviando a SokyRecargas:`, {
                    offer_id: session.offerId,
                    recipient: session.phone, // 8 dígitos
                    price_id: session.priceId
                });
                
                const response = await this.api.post(
                    `/api/v1/recharges/offers/${session.offerId}/recharge`,
                    rechargeData
                );
                sokyResult = response.data;
                console.log('✅ Respuesta de SokyRecargas:', sokyResult);
            } catch (error) {
                console.error('❌ Error en API Soky:', error.response?.data || error.message);
                throw new Error('Error al procesar la recarga con ETECSA');
            }

            const newBalance = user.balance_cup - session.cupPrice;
            await this.supabase
                .from('users')
                .update({ balance_cup: newBalance })
                .eq('telegram_id', chatId);

            await this.supabase.from('transactions').insert({
                user_id: chatId,
                type: 'ETECSA_RECHARGE',
                currency: 'cup',
                amount: -session.cupPrice,
                amount_requested: session.cupPrice,
                status: 'completed',
                user_name: user.first_name,
                user_username: user.username,
                user_phone: user.phone_number,
                tx_id: sokyResult.data?.id || `soky_${Date.now()}`,
                metadata: {
                    soky_offer_id: session.offerId,
                    soky_price_id: session.priceId,
                    soky_transaction_id: sokyResult.data?.id,
                    recipient: session.phone, // Guardamos 8 dígitos en la BD
                    recipient_full: `53${session.phone}`, // Guardamos también el formato completo
                    email: session.email,
                    offer_name: session.offerName,
                    price_label: session.priceLabel,
                    original_usdt: session.originalUsdt,
                    cup_rate: this.SOKY_RATE_CUP
                },
                completed_at: new Date().toISOString()
            });

            let successMessage = `✅ *¡Recarga ETECSA Exitosa!*\n\n` +
                `🎯 *Oferta:* ${session.offerName}\n` +
                `💰 *Paquete:* ${session.priceLabel}\n` +
                `💵 *Pagado:* $${session.cupPrice} CUP\n` +
                `📞 *Teléfono destino:* 53${session.phone}\n`; // Mostramos con 53 al usuario
            
            if (session.email) {
                successMessage += `📧 *Email Nauta:* ${session.email}\n`;
            }
            
            successMessage += `\n🆔 *ID de transacción:* ${sokyResult.data?.id || 'N/A'}\n` +
                `👛 *Nuevo saldo CUP:* $${newBalance} CUP\n\n` +
                `La recarga ha sido enviada a ETECSA. Debe llegar en pocos minutos.`;

            await this.bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📱 Otra Recarga', callback_data: 'soky_offers' }],
                        [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
                    ]
                }
            });

            delete this.activeSessions[chatId];

            const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;
            if (ADMIN_CHAT_ID) {
                const adminMessage = `📱 *NUEVA RECARGA ETECSA*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `💰 Monto: $${session.cupPrice} CUP ($${session.originalUsdt} USDT)\n` +
                    `📞 Destino: 53${session.phone} (${session.phone} enviado a Soky)\n` +
                    `🎯 Oferta: ${session.offerName}\n` +
                    `🆔 ID Soky: ${sokyResult.data?.id || 'N/A'}`;
                
                await this.bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            console.error('❌ Error confirmando recarga:', error);
            
            await this.bot.editMessageText(
                `❌ *Error en la recarga*\n\n` +
                `${error.message || 'Ocurrió un error al procesar la recarga.'}\n\n` +
                `Tu saldo NO ha sido afectado. Intenta nuevamente.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Intentar de nuevo', callback_data: 'soky_offers' }],
                            [{ text: '🔙 Volver al Inicio', callback_data: 'start_back' }]
                        ]
                    }
                }
            );
            
            delete this.activeSessions[chatId];
        }
    }

    async handleMessage(chatId, text) {
        const session = this.activeSessions[chatId];
        
        if (!session) return false;
        
        switch (session.step) {
            case 'waiting_phone':
                await this.processRecharge(chatId, text);
                return true;
                
            case 'waiting_email':
                await this.processRecharge(chatId, session.phone, text);
                return true;
                
            default:
                return false;
        }
    }

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;
        
        if (data.startsWith('soky_')) {
            await this.bot.answerCallbackQuery(query.id);
            
            const [action, param1, param2] = data.split(':');
            
            switch (action) {
                case 'soky_offers':
                    await this.showOffers(chatId, query.message.message_id);
                    return true;
                    
                case 'soky_select':
                    await this.handleOfferSelection(chatId, query.message.message_id, param1, param2);
                    return true;
                    
                case 'soky_confirm':
                    await this.confirmAndExecuteRecharge(chatId, query.message.message_id, param1, param2);
                    return true;
            }
        }
        
        return false;
    }
}

module.exports = SokyRecargasHandler;
