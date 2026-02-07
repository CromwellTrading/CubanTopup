// sokyrecargas.js - Manejador de recargas ETECSA via SokyRecargas
require('dotenv').config();
const axios = require('axios');

class SokyRecargasHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.SOKY_API_TOKEN = process.env.SOKY_API_TOKEN || '6970|31Cg3qhd5A72tRptPkAxROM0BF7GgtEK37cHLqu62e5f8b6b';
        this.SOKY_CUP_RATE = parseFloat(process.env.SOKY_CUP_RATE) || 632;
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

    // Obtener ofertas y convertirlas a CUP
    async getOffers() {
        try {
            console.log('🔍 Obteniendo ofertas de SokyRecargas...');
            const response = await this.api.get('/api/v1/recharges/offers');
            
            if (!response.data || !response.data.data) {
                console.log('❌ No se encontraron ofertas en la respuesta');
                return [];
            }
            
            // Filtrar solo ofertas de tipo recharge (ETECSA)
            const offers = response.data.data.filter(offer => 
                offer.type === 'recharge' && 
                offer.available === true &&
                offer.currency?.code === 'USDT'
            );
            
            // Convertir precios de USDT a CUP
            const offersWithCUP = offers.map(offer => {
                const pricesInCUP = offer.prices.map(price => {
                    const cupPrice = price.public * this.SOKY_CUP_RATE;
                    return {
                        ...price,
                        cup_price: Math.ceil(cupPrice), // Redondear hacia arriba
                        original_usdt: price.public
                    };
                });
                
                return {
                    ...offer,
                    prices: pricesInCUP
                };
            });
            
            console.log(`✅ ${offersWithCUP.length} ofertas encontradas (convertidas a CUP)`);
            return offersWithCUP;
            
        } catch (error) {
            console.error('❌ Error obteniendo ofertas de Soky:', error.response?.data || error.message);
            return [];
        }
    }

    // Mostrar ofertas al usuario
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

            // Agrupar ofertas por nombre/descripción similar
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

            // Mostrar ofertas agrupadas
            Object.keys(groupedOffers).forEach((key, index) => {
                const group = groupedOffers[key];
                const firstOffer = group[0];
                
                message += `${index + 1}. *${firstOffer.name}*\n`;
                message += `   📝 ${firstOffer.description || 'Recarga ETECSA'}\n`;
                message += `   💰 Precios:\n`;
                
                // Mostrar todos los precios de este grupo
                group.forEach(offer => {
                    offer.prices.forEach(price => {
                        message += `      • ${price.label}: $${price.cup_price} CUP\n`;
                    });
                });
                
                message += `\n`;
            });

            // Crear botones para cada oferta
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

    // Manejar selección de oferta
    async handleOfferSelection(chatId, messageId, offerId, priceId) {
        try {
            const offers = await this.getOffers();
            const offer = offers.find(o => o.id == offerId);
            const price = offer?.prices.find(p => p.id === priceId);
            
            if (!offer || !price) {
                await this.bot.answerCallbackQuery(messageId, { text: '❌ Oferta no disponible' });
                return;
            }

            // Obtener usuario y verificar saldo
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

            // Guardar en sesión
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
            
            message += `Por favor, escribe el número de teléfono de destino:\n` +
                `*Formato:* 53xxxxxxxxx (ej: 5351234567)`;

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

    // Procesar recarga
    async processRecharge(chatId, phone, email = null) {
        try {
            const session = this.activeSessions[chatId];
            if (!session) {
                await this.bot.sendMessage(chatId, '❌ Sesión expirada. Inicia nuevamente.');
                return;
            }

            // Validar teléfono
            const cleanPhone = phone.replace(/[^\d]/g, '');
            if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
                await this.bot.sendMessage(chatId,
                    `❌ *Formato incorrecto*\n\n` +
                    `El número debe comenzar con *53* y tener 10 dígitos.\n\n` +
                    `Ejemplo: *5351234567*\n\n` +
                    `Inténtalo de nuevo:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Validar email si es necesario
            if (session.requiresEmail && !email) {
                session.phone = cleanPhone;
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

            // Obtener usuario y verificar saldo nuevamente
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

            // Confirmación final
            let confirmMessage = `📋 *Confirmar Recarga*\n\n` +
                `🎯 *Oferta:* ${session.offerName}\n` +
                `💰 *Paquete:* ${session.priceLabel}\n` +
                `💵 *Precio:* $${session.cupPrice} CUP\n` +
                `📞 *Teléfono destino:* +${cleanPhone}\n`;
            
            if (email) {
                confirmMessage += `📧 *Email Nauta:* ${email}\n`;
            }
            
            confirmMessage += `\n👛 *Tu saldo después:* $${user.balance_cup - session.cupPrice} CUP\n\n` +
                `¿Confirmas la recarga?`;

            session.phone = cleanPhone;
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

    // Confirmar y ejecutar recarga
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

            // 1. Verificar saldo del usuario
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

            // 2. Realizar recarga en SokyRecargas
            const rechargeData = {
                price_id: session.priceId,
                recipient: session.phone,
                recipient_name: user.first_name || 'Usuario',
                subscribe: false
            };

            if (session.email) {
                rechargeData.email = session.email;
            }

            let sokyResult;
            try {
                const response = await this.api.post(
                    `/api/v1/recharges/offers/${session.offerId}/recharge`,
                    rechargeData
                );
                sokyResult = response.data;
            } catch (error) {
                console.error('❌ Error en API Soky:', error.response?.data || error.message);
                throw new Error('Error al procesar la recarga con ETECSA');
            }

            // 3. Actualizar saldo del usuario
            const newBalance = user.balance_cup - session.cupPrice;
            await this.supabase
                .from('users')
                .update({ balance_cup: newBalance })
                .eq('telegram_id', chatId);

            // 4. Registrar transacción
            await this.supabase.from('transactions').insert({
                user_id: chatId,
                type: 'ETECSA_RECHARGE',
                currency: 'cup',
                amount: -session.cupPrice, // Negativo porque es un gasto
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
                    recipient: session.phone,
                    email: session.email,
                    offer_name: session.offerName,
                    price_label: session.priceLabel,
                    original_usdt: session.originalUsdt,
                    cup_rate: this.SOKY_CUP_RATE
                },
                completed_at: new Date().toISOString()
            });

            // 5. Notificar al usuario
            const successMessage = `✅ *¡Recarga ETECSA Exitosa!*\n\n` +
                `🎯 *Oferta:* ${session.offerName}\n` +
                `💰 *Paquete:* ${session.priceLabel}\n` +
                `💵 *Pagado:* $${session.cupPrice} CUP\n` +
                `📞 *Teléfono destino:* +${session.phone}\n`;
            
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

            // 6. Limpiar sesión
            delete this.activeSessions[chatId];

            // 7. Notificar al admin si está configurado
            const ADMIN_CHAT_ID = process.env.ADMIN_GROUP;
            if (ADMIN_CHAT_ID) {
                const adminMessage = `📱 *NUEVA RECARGA ETECSA*\n\n` +
                    `👤 Usuario: ${user.first_name} (@${user.username || 'sin usuario'})\n` +
                    `💰 Monto: $${session.cupPrice} CUP ($${session.originalUsdt} USDT)\n` +
                    `📞 Destino: +${session.phone}\n` +
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

    // Manejar mensajes de texto para recargas
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

    // Manejar callbacks de recargas
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
