// ============================================
// handlers/callbacks.js - FÁBRICA DE CALLBACK HANDLER
// ============================================

module.exports = (bot, db, deps) => {
    const {
        gameHandler,
        sokyHandler,
        bolitaHandler,
        tradingHandler,
        adminHandlers,
        walletHandlers,
        rechargeHandlers,
        helpHandlers,
        sessions
    } = deps;

    const keyboards = require('../config/keyboards');
    const utils = require('../utils');

    async function handleCallback(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const messageId = query.message.message_id;
        const data = query.data;

        try {
            await bot.answerCallbackQuery(query.id);

            // --------------------------------------------------------
            // 1️⃣ Admin callbacks (prioridad)
            // --------------------------------------------------------
            if (adminHandlers.esAdmin(userId)) {
                const adminHandled = await adminHandlers.handleAdminCallbacks(chatId, messageId, userId, data);
                if (adminHandled) return;
            }

            // --------------------------------------------------------
            // 2️⃣ Handlers externos (misma instancia única)
            // --------------------------------------------------------
            const handledByTrading = await tradingHandler.handleCallback(query);
            if (handledByTrading) return;

            const handledBySoky = await sokyHandler.handleCallback(query);
            if (handledBySoky) return;

            const handledByGame = await gameHandler.handleCallback(query);
            if (handledByGame) return;

            const handledByBolita = await bolitaHandler.handleCallback(query);
            if (handledByBolita) return;

            // --------------------------------------------------------
            // 3️⃣ Acciones normales del bot
            // --------------------------------------------------------
            const [action, param1, param2, param3] = data.split(':');

            switch (action) {
                case 'start_back':
                    await handleStartBack(chatId, messageId);
                    break;
                case 'open_webapp':
                    await handleOpenWebApp(chatId, messageId);
                    break;
                case 'wallet':
                    await walletHandlers.handleWallet(chatId, messageId);
                    break;
                case 'refresh_wallet':
                    await walletHandlers.handleRefreshWallet(chatId, messageId);
                    break;
                case 'recharge_menu':
                    await rechargeHandlers.handleRechargeMenu(chatId, messageId);
                    break;
                case 'games_menu':
                    await gameHandler.showGamesList(chatId, messageId);
                    break;
                case 'apuestas_menu':
                    await handleApuestasMenu(chatId, messageId);
                    break;
                case 'trading_menu':
                    await tradingHandler.showTradingMenu(chatId, messageId);
                    break;
                case 'dep_init':
                    await rechargeHandlers.handleDepositInit(chatId, messageId, param1);
                    break;
                case 'confirm_deposit':
                    await rechargeHandlers.handleConfirmDeposit(chatId, messageId, param1, param2);
                    break;
                case 'cancel_pending_order':
                    await rechargeHandlers.handleCancelPendingOrder(chatId, messageId);
                    break;
                case 'confirm_cancel':
                    await rechargeHandlers.handleConfirmCancel(chatId, messageId, param1, param2);
                    break;
                case 'terms':
                    await handleTerms(chatId, messageId);
                    break;
                case 'accept_terms':
                    await handleAcceptTerms(chatId, messageId);
                    break;
                case 'link_phone':
                    await handleLinkPhone(chatId, messageId);
                    break;
                case 'enter_phone':
                    await handleEnterPhone(chatId, messageId);
                    break;
                case 'claim_payment':
                    await handleClaimPayment(chatId, messageId);
                    break;
                case 'search_payment_id':
                    await handleSearchPaymentId(chatId, messageId);
                    break;
                case 'view_pending_payments':
                    await handleViewPendingPayments(chatId, messageId);
                    break;
                case 'history':
                    await handleHistory(chatId, messageId);
                    break;
                case 'view_pending':
                    await walletHandlers.handleViewPending(chatId, messageId);
                    break;
                case 'bolita_menu':
                    await bolitaHandler.mostrarMenuPrincipal(chatId, messageId);
                    break;
                case 'help_menu':
                    await helpHandlers.handleHelpMenu(chatId, messageId);
                    break;
                case 'help_faq':
                    await helpHandlers.handleHelpFAQ(chatId, messageId);
                    break;
                case 'help_contact':
                    await helpHandlers.handleHelpContact(chatId, messageId);
                    break;
                case 'help_report':
                    await helpHandlers.handleHelpReport(chatId, messageId);
                    break;
                default:
                    console.log(`Acción no reconocida: ${action}`);
            }
        } catch (error) {
            console.error('Error en callback:', error);
            await bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
        }
    }

    // ------------------------------------------------------------
    // FUNCIONES AUXILIARES (sin cambios, solo asegurar que existen)
    // ------------------------------------------------------------
    async function handleStartBack(chatId, messageId) {
        const user = await db.getUser(chatId);
        const message = `✅ *¡Bienvenido de nuevo, ${user.first_name}!*\n\n` +
            `🆔 *Tu ID de Telegram es:* \`${chatId}\`\n\n` +
            `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
            `Ahora también puedes usar nuestra *WebApp* para una mejor experiencia.\n\n` +
            `¿Cómo puedo ayudarte hoy?`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createMainKeyboard()
        });
    }

    async function handleOpenWebApp(chatId, messageId) {
        const baseUrl = process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const webAppUrl = `${baseUrl}/webapp.html?userId=${chatId}`;
        
        console.log(`🔗 WebApp URL generada para ${chatId}: ${webAppUrl}`);
        
        const message = `🌐 *Abrir WebApp Cromwell Store*\n\n` +
            `Haz clic en el botón de abajo para abrir la WebApp:\n\n` +
            `⚠️ *Tu ID de Telegram:* \`${chatId}\`\n` +
            `Guarda este ID por si necesitas contactar soporte.`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '🌐 Abrir WebApp',
                        web_app: { url: webAppUrl }
                    }
                ]]
            }
        });
    }

    async function handleApuestasMenu(chatId, messageId) {
        const message = `⚽ *Apuestas Deportivas*\n\n` +
            `Próximamente disponible...\n\n` +
            `Muy pronto podrás hacer apuestas deportivas con tus CWS.`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
    }

    async function handleTerms(chatId, messageId) {
        const config = require('../config');
        const terms = `📜 *Términos y Condiciones de Cromwell Store*\n\n` +
            `1. *ACEPTACIÓN*: Al usar este servicio, aceptas estos términos.\n\n` +
            `2. *PROPÓSITO*: La billetera es exclusiva para pagos en Cromwell Store. El dinero no es retirable, excepto los bonos que son utilizables para recargas.\n\n` +
            `3. *DEPÓSITOS*:\n   • Mínimos: CUP=${config.MINIMO_CUP}, Saldo=${config.MINIMO_SALDO}\n   • Bonos solo en el primer depósito por método\n   • Los tokens no son retirables, solo utilizables en la tienda\n\n` +
            `4. *TOKENS*:\n   • CWS: Gana ${config.CWS_PER_100_SALDO} por cada 100 de saldo\n   • Mínimo para usar: CWS=${config.MIN_CWS_USE}\n\n` +
            `5. *RECARGAS DE JUEGOS*:\n   • 1 CWS = $10 CUP de descuento en recargas\n   • Puedes pagar con CUP, Saldo Móvil o CWS\n   • Las recargas se procesan a través de LioGames\n\n` +
            `6. *RECARGAS ETECSA*:\n   • Se procesan a través de SokyRecargas\n   • Los precios están en CUP (1 USDT = ${config.SOKY_RATE_CUP} CUP)\n   • Se descuentan automáticamente de tu saldo CUP\n\n` +
            `7. *SEÑALES DE TRADING*:\n   • Servicio de señales de trading profesional\n   • Suscripciones por tiempo determinado\n   • Las señales son sugerencias, no garantías de ganancia\n   • El trading conlleva riesgos financieros\n   • Rentabilidad prometida: +60% semanal\n   • Si baja del 50%, reembolso del 50% (1500 CUP)\n   • Programa de referidos: 20% por cada amigo que se haga VIP\n\n` +
            `8. *SEGURIDAD*:\n   • Toma capturas de pantalla de todas las transacciones\n   • ETECSA puede fallar con las notificaciones SMS\n   • Tu responsabilidad guardar los recibos\n\n` +
            `9. *REEMBOLSOS*:\n   • Si envías dinero y no se acredita pero tienes captura válida\n   • Contacta al administrador dentro de 24 horas\n   • Se investigará y resolverá en 48 horas máximo\n\n` +
            `10. *PROHIBIDO*:\n   • Uso fraudulento o múltiples cuentas\n   • Lavado de dinero o actividades ilegales\n   • Spam o abuso del sistema\n\n` +
            `11. *MODIFICACIONES*: Podemos cambiar estos términos notificando con 72 horas de anticipación.\n\n` +
            `_Última actualización: ${new Date().toLocaleDateString()}_\n\n` +
            `⚠️ *Para ver estos términos y condiciones nuevamente, visita nuestra web.*`;
        
        if (messageId) {
            await bot.editMessageText(terms, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboards.createTermsKeyboard()
            });
        } else {
            await bot.sendMessage(chatId, terms, {
                parse_mode: 'Markdown',
                reply_markup: keyboards.createTermsKeyboard()
            });
        }
    }

    async function handleAcceptTerms(chatId, messageId) {
        await db.updateUser(chatId, { accepted_terms: true });
        
        const user = await db.getUser(chatId);
        const message = `✅ *¡Términos aceptados!*\n\n` +
            `🆔 *Tu ID de Telegram es:* \`${chatId}\`\n\n` +
            `⚠️ *GUARDA ESTE ID* - Lo necesitarás para acceder a la web.\n\n` +
            `Solo puedes acceder a la web con tu ID de Telegram.\n\n` +
            `Ahora puedes usar todos los servicios de Cromwell Store.`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createMainKeyboard()
        });
    }

    async function handleLinkPhone(chatId, messageId) {
        const user = await db.getUser(chatId);
        
        let message = `📱 *Cambiar Teléfono Vinculado*\n\n`;
        
        if (user.phone_number) {
            message += `📞 *Teléfono actual:* +53 ${user.phone_number.substring(2)}\n\n`;
        }
        
        message += `Por favor, escribe tu nuevo número de teléfono:\n\n` +
            `🔢 *Formato requerido:*\n` +
            `• 10 dígitos\n` +
            `• Comienza con 53\n` +
            `• Ejemplo: *5351234567*\n\n` +
            `⚠️ *IMPORTANTE:* Este debe ser el número *desde el que harás los pagos* en Transfermóvil.`;
        
        sessions.setSession(chatId, { 
            step: 'waiting_phone_change',
            oldPhone: user.phone_number 
        });
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
    }

    async function handleEnterPhone(chatId, messageId) {
        sessions.setSession(chatId, { step: 'waiting_phone_start' });
        
        const message = `📱 *Por favor, escribe tu número de teléfono:*\n\n` +
            `🔢 *Formato requerido:*\n` +
            `• 10 dígitos\n` +
            `• Comienza con 53\n` +
            `• Ejemplo: *5351234567*\n\n` +
            `⚠️ *IMPORTANTE:* Este debe ser el número *desde el que harás los pagos* en Transfermóvil.`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('start_back')
        });
    }

    async function handleClaimPayment(chatId, messageId) {
        const message = `🎁 *Reclamar Pago*\n\n` +
            `Para pagos que no fueron detectados automáticamente:\n\n` +
            `1. Pagos *Tarjeta → Billetera* (sin número visible)\n` +
            `2. Pagos que necesitan ID de transacción\n` +
            `3. Pagos con problemas de notificación\n\n` +
            `Selecciona una opción:`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createClaimPaymentKeyboard()
        });
    }

    async function handleSearchPaymentId(chatId, messageId) {
        const message = `🔍 *Buscar por ID de Transacción*\n\n` +
            `Encuentra el ID en tu SMS de Transfermóvil:\n\n` +
            `Ejemplo: "Id Transaccion: TMW162915233"\n\n` +
            `Escribe el ID que quieres reclamar:`;
        
        sessions.setSession(chatId, { step: 'search_payment_id' });
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('claim_payment')
        });
    }

    async function handleViewPendingPayments(chatId, messageId) {
        const user = await db.getUser(chatId);
        const phone = user.phone_number;
        
        const { data: pendingPayments } = await db.supabase
            .from('pending_sms_payments')
            .select('*')
            .eq('claimed', false)
            .or(`user_id.eq.${chatId},phone.eq.${phone}`)
            .order('created_at', { ascending: false });
        
        let message = `📋 *Tus Pagos Pendientes*\n\n`;
        
        if (!pendingPayments || pendingPayments.length === 0) {
            message += `No tienes pagos pendientes por reclamar.`;
        } else {
            pendingPayments.forEach((payment, index) => {
                message += `${index + 1}. ${utils.formatCurrency(payment.amount, payment.currency)}\n`;
                message += `   🆔 ID: \`${payment.tx_id}\`\n`;
                message += `   📅 ${new Date(payment.created_at).toLocaleDateString()}\n`;
                message += `   🔧 ${payment.tipo_pago}\n\n`;
            });
            
            message += `Para reclamar, usa "🔍 Buscar por ID"`;
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('claim_payment')
        });
    }

    async function handleHistory(chatId, messageId) {
        const { data: transactions } = await db.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', chatId)
            .order('created_at', { ascending: false })
            .limit(15);
        
        let message = `📜 *Historial de Transacciones*\n\n`;
        
        if (!transactions || transactions.length === 0) {
            message += `No tienes transacciones registradas.`;
        } else {
            transactions.forEach((tx, index) => {
                let icon = '🔸';
                if (tx.status === 'completed') icon = '✅';
                else if (tx.status === 'pending') icon = '⏳';
                else if (tx.status === 'rejected') icon = '❌';
                
                const fecha = new Date(tx.created_at).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                message += `${icon} *${tx.type === 'DEPOSIT' ? 'Depósito' : tx.type === 'GAME_RECHARGE' ? 'Recarga Juego' : tx.type === 'ETECSA_RECHARGE' ? 'Recarga ETECSA' : tx.type === 'TRADING_SUSCRIPTION' ? 'Suscripción Trading' : tx.type}*\n`;
                message += `💰 ${utils.formatCurrency(Math.abs(tx.amount || tx.amount_requested), tx.currency)}\n`;
                message += `📅 ${fecha}\n`;
                message += `📊 ${tx.status === 'completed' ? 'Completado' : tx.status === 'pending' ? 'Pendiente' : tx.status}\n`;
                if (tx.tx_id) message += `🆔 \`${tx.tx_id}\`\n`;
                if (tx.tokens_generated > 0) message += `🎫 +${tx.tokens_generated} CWS\n`;
                message += `\n`;
            });
        }
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboards.createBackKeyboard('wallet')
        });
    }

    return handleCallback;
};
