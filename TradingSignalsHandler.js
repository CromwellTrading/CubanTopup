// TradingSignalsHandler.js - Manejador de Señales de Trading
require('dotenv').config();

class TradingSignalsHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.userStates = {}; // Almacena estados temporales de usuarios
        this.adminStates = {}; // Estados para admin al enviar señales
        this.activeSessions = {}; // Sesiones activas de trading
        this.BOT_ADMIN_ID = process.env.BOT_ADMIN_ID; // ID admin del .env
        
        // Configuración
        this.VIP_PRICE = 3000; // 3000 CUP mensual
        this.PROMISED_ROI = 60; // +60% semanal prometido
        this.SIGNALS_PER_SESSION = 10;
        this.SESSION_TIMES = ['10:00', '22:00']; // 10am y 10pm
        
        // Inicializar tablas si no existen
        this.initDatabase();
    }

    // ============================================
    // INICIALIZACIÓN DE BASE DE DATOS
    // ============================================

    async initDatabase() {
        try {
            // Crear tabla de planes de trading
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_planes',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(100) NOT NULL,
                    descripcion TEXT,
                    precio DECIMAL(10,2) NOT NULL,
                    duracion_dias INTEGER NOT NULL,
                    activo BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de suscripciones VIP
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_suscripciones',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    plan_id INTEGER REFERENCES trading_planes(id),
                    fecha_inicio TIMESTAMP NOT NULL,
                    fecha_fin TIMESTAMP NOT NULL,
                    precio_pagado DECIMAL(10,2) NOT NULL,
                    estado VARCHAR(20) DEFAULT 'activa',
                    metodo_pago VARCHAR(50),
                    tx_id VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de sesiones de trading
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_sesiones',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    admin_id BIGINT NOT NULL,
                    fecha DATE NOT NULL,
                    hora TIME NOT NULL,
                    tipo VARCHAR(20) NOT NULL, -- 'matutina' o 'vespertina'
                    señales_totales INTEGER DEFAULT 10,
                    señales_enviadas INTEGER DEFAULT 0,
                    estado VARCHAR(20) DEFAULT 'abierta',
                    rentabilidad_semanal DECIMAL(5,2),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de señales
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_senales',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    sesion_id INTEGER REFERENCES trading_sesiones(id),
                    activo VARCHAR(20) NOT NULL,
                    temporalidad VARCHAR(10) NOT NULL,
                    direccion VARCHAR(10) NOT NULL, -- 'alta' o 'baja'
                    precio_entrada DECIMAL(10,5),
                    take_profit DECIMAL(10,5),
                    stop_loss DECIMAL(10,5),
                    resultado VARCHAR(10), -- 'ganada', 'perdida', 'pendiente'
                    profit_loss DECIMAL(10,2),
                    hora_envio TIMESTAMP DEFAULT NOW(),
                    hora_cierre TIMESTAMP,
                    admin_message_id VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de señales por usuario
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_senales_usuario',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    señal_id INTEGER REFERENCES trading_senales(id),
                    recibida BOOLEAN DEFAULT false,
                    resultado_usuario VARCHAR(10),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de solicitudes VIP
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_solicitudes_vip',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    quotex_id VARCHAR(100) NOT NULL,
                    estado VARCHAR(20) DEFAULT 'pendiente', -- 'pendiente', 'aprobada', 'rechazada'
                    motivo_rechazo TEXT,
                    admin_id BIGINT,
                    fecha_aprobacion TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear tabla de rentabilidad semanal
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_rentabilidad',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    semana DATE NOT NULL, -- fecha del lunes de la semana
                    rentabilidad DECIMAL(5,2) NOT NULL,
                    señales_totales INTEGER NOT NULL,
                    señales_ganadas INTEGER NOT NULL,
                    señales_perdidas INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Crear el plan VIP por defecto si no existe
            const { data: existingPlan } = await this.supabase
                .from('trading_planes')
                .select('id')
                .eq('nombre', 'VIP Mensual')
                .single();

            if (!existingPlan) {
                await this.supabase
                    .from('trading_planes')
                    .insert([{
                        nombre: 'VIP Mensual',
                        descripcion: 'Acceso completo a señales de trading profesionales',
                        precio: this.VIP_PRICE,
                        duracion_dias: 30,
                        activo: true
                    }]);
            }

            console.log('✅ Tablas de trading inicializadas correctamente');

        } catch (error) {
            console.error('❌ Error inicializando tablas de trading:', error);
        }
    }

    // ============================================
    // FUNCIONES PRINCIPALES
    // ============================================

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const messageId = query.message.message_id;
        const data = query.data;

        try {
            await this.bot.answerCallbackQuery(query.id);

            const [action, param1, param2, param3] = data.split(':');

            switch (action) {
                case 'trading_menu':
                    await this.showTradingMenu(chatId, messageId);
                    return true;
                    
                case 'trading_subscriptions':
                    await this.showSubscriptions(chatId, messageId);
                    return true;
                    
                case 'trading_buy_signals':
                    await this.showBuySignals(chatId, messageId);
                    return true;
                    
                case 'trading_my_signals':
                    await this.showMySignals(chatId, messageId);
                    return true;
                    
                case 'trading_how_it_works':
                    await this.showHowItWorks(chatId, messageId);
                    return true;
                    
                case 'trading_performance':
                    await this.showPerformance(chatId, messageId);
                    return true;
                    
                case 'trading_signals_active':
                    await this.showActiveSignals(chatId, messageId);
                    return true;
                    
                case 'trading_history':
                    await this.showHistory(chatId, messageId);
                    return true;
                    
                case 'trading_request_vip':
                    await this.requestVIP(chatId, messageId);
                    return true;
                    
                case 'trading_confirm_vip':
                    await this.confirmVIP(chatId, messageId, param1);
                    return true;
                    
                case 'trading_pay_vip':
                    await this.payVIP(chatId, messageId, param1);
                    return true;
                    
                case 'trading_admin_menu':
                    if (this.esAdmin(userId)) {
                        await this.showAdminMenu(chatId, messageId);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_open_session':
                    if (this.esAdmin(userId)) {
                        await this.openSession(chatId, messageId);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_close_session':
                    if (this.esAdmin(userId)) {
                        await this.closeSession(chatId, messageId);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_send_signal':
                    if (this.esAdmin(userId)) {
                        await this.prepareSignal(chatId, messageId);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_view_requests':
                    if (this.esAdmin(userId)) {
                        await this.viewVIPRequests(chatId, messageId);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_approve_request':
                    if (this.esAdmin(userId)) {
                        await this.approveVIPRequest(chatId, messageId, param1);
                        return true;
                    }
                    break;
                    
                case 'trading_admin_reject_request':
                    if (this.esAdmin(userId)) {
                        await this.rejectVIPRequest(chatId, messageId, param1);
                        return true;
                    }
                    break;
                    
                case 'trading_signal_profit':
                    if (this.esAdmin(userId)) {
                        await this.markSignalResult(chatId, messageId, param1, 'ganada');
                        return true;
                    }
                    break;
                    
                case 'trading_signal_loss':
                    if (this.esAdmin(userId)) {
                        await this.markSignalResult(chatId, messageId, param1, 'perdida');
                        return true;
                    }
                    break;
                    
                case 'trading_signal_up':
                    if (this.esAdmin(userId) && this.adminStates[userId]) {
                        await this.sendSignalToUsers(chatId, messageId, 'alta');
                        return true;
                    }
                    break;
                    
                case 'trading_signal_down':
                    if (this.esAdmin(userId) && this.adminStates[userId]) {
                        await this.sendSignalToUsers(chatId, messageId, 'baja');
                        return true;
                    }
                    break;
                    
                case 'trading_calendar':
                    await this.showCalendar(chatId, messageId, param1);
                    return true;
                    
                case 'trading_view_date':
                    await this.viewSignalsByDate(chatId, messageId, param1);
                    return true;
            }

            return false;

        } catch (error) {
            console.error('Error en trading callback:', error);
            await this.bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
            return true;
        }
    }

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        // Si es admin y está en proceso de enviar señal
        if (this.esAdmin(userId) && this.adminStates[userId]) {
            const state = this.adminStates[userId];
            
            if (state.step === 'waiting_pair') {
                return await this.handlePairInput(chatId, text, state);
            }
            
            if (state.step === 'waiting_timeframe') {
                return await this.handleTimeframeInput(chatId, text, state);
            }
        }

        // Si usuario normal está solicitando VIP
        if (this.userStates[userId] && this.userStates[userId].step === 'waiting_quotex_id') {
            return await this.handleQuotexIdInput(chatId, text, userId);
        }

        return false;
    }

    // ============================================
    // FUNCIONES PARA USUARIOS
    // ============================================

    async showTradingMenu(chatId, messageId) {
        const user = await this.getUser(chatId);
        const isVIP = await this.isUserVIP(chatId);
        
        let message = `📈 *SEÑALES DE TRADING PROFESIONAL*\n\n`;
        
        if (isVIP) {
            const subscription = await this.getActiveSubscription(chatId);
            const daysLeft = this.getDaysLeft(subscription.fecha_fin);
            
            message += `🎖️ *ESTADO: VIP ACTIVO*\n`;
            message += `⏳ *Días restantes:* ${daysLeft}\n`;
            message += `📅 *Renueva:* ${new Date(subscription.fecha_fin).toLocaleDateString()}\n\n`;
            
            message += `🕙 *Horario de señales:*\n`;
            message += `• 10:00 AM - Sesión matutina (10 señales)\n`;
            message += `• 10:00 PM - Sesión vespertina (10 señales)\n\n`;
            
            message += `📊 *Rentabilidad prometida:* +${this.PROMISED_ROI}% semanal\n`;
            message += `💎 *Garantía:* Si baja del ${this.PROMISED_ROI}%, devolución del 50%\n\n`;
            
            message += `Selecciona una opción:`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📊 Señales Activas', callback_data: 'trading_signals_active' },
                        { text: '📈 Mis Señales', callback_data: 'trading_my_signals' }
                    ],
                    [
                        { text: '📋 Historial', callback_data: 'trading_history' },
                        { text: '📊 Rendimiento', callback_data: 'trading_performance' }
                    ],
                    [
                        { text: '💰 Renovar VIP', callback_data: 'trading_buy_signals' },
                        { text: '🔙 Menú Principal', callback_data: 'start_back' }
                    ]
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
            
        } else {
            message += `🔒 *ACCESO RESTRINGIDO*\n\n`;
            message += `Para recibir señales de trading necesitas ser miembro VIP.\n\n`;
            message += `🎖️ *BENEFICIOS VIP:*\n`;
            message += `• 20 señales diarias (10am y 10pm)\n`;
            message += `• Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n`;
            message += `• Garantía de devolución del 50% si no cumplimos\n`;
            message += `• Soporte personalizado\n\n`;
            message += `💵 *PRECIO:* ${this.VIP_PRICE} CUP mensual\n\n`;
            message += `¿Deseas convertirte en VIP?`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🎖️ Convertirse en VIP', callback_data: 'trading_request_vip' },
                        { text: '📋 Ver Historial', callback_data: 'trading_history' }
                    ],
                    [
                        { text: '❓ Cómo Funciona', callback_data: 'trading_how_it_works' },
                        { text: '📊 Rendimiento', callback_data: 'trading_performance' }
                    ],
                    [
                        { text: '🔙 Menú Principal', callback_data: 'start_back' }
                    ]
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
        }
    }

    async showHowItWorks(chatId, messageId) {
        const quotexLink = process.env.QUOTEX_REF_LINK || 'https://broker-qx.pro/sign-up/?lid=123456';
        
        const message = `❓ *CÓMO FUNCIONAN LAS SEÑALES DE TRADING*\n\n` +
            `1️⃣ *REQUISITOS PARA SER VIP:*\n` +
            `• Crear cuenta NUEVA en Quotex: ${quotexLink}\n` +
            `• Verificar identidad (KYC) - Se permiten cubanos\n` +
            `• Depositar mínimo 10 USDT\n` +
            `• Enviar tu ID de Quotex\n` +
            `• Esperar aprobación del admin\n\n` +
            `2️⃣ *HORARIO DE SEÑALES:*\n` +
            `• 10:00 AM - Sesión matutina (10 señales)\n` +
            `• 10:00 PM - Sesión vespertina (10 señales)\n` +
            `• No hay señales fines de semana\n\n` +
            `3️⃣ *PROCESO DE SEÑAL:*\n` +
            `• Admin envía par y temporalidad\n` +
            `• Se muestra formato amigable con emojis\n` +
            `• Admin envía dirección (↑ o ↓)\n` +
            `• Recibes notificación inmediata\n` +
            `• Admin marca resultado (profit/pérdida)\n\n` +
            `4️⃣ *GARANTÍA:*\n` +
            `• Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n` +
            `• Si baja del ${this.PROMISED_ROI}%, devolución del 50%\n` +
            `• Semana: Lunes a Viernes\n\n` +
            `5️⃣ *SUSCRIPCIÓN:*\n` +
            `• Precio: ${this.VIP_PRICE} CUP mensual\n` +
            `• Pago desde tu billetera Cromwell\n` +
            `• Renovación automática (avisos a 10, 5 y 1 día)\n\n` +
            `¿Listo para comenzar?`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎖️ Solicitar VIP', callback_data: 'trading_request_vip' },
                    { text: '📋 Ver Historial', callback_data: 'trading_history' }
                ],
                [
                    { text: '🔙 Volver', callback_data: 'trading_menu' }
                ]
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
    }

    async requestVIP(chatId, messageId) {
        const message = `🎖️ *SOLICITUD DE MEMBRESÍA VIP*\n\n` +
            `Para convertirte en VIP sigue estos pasos:\n\n` +
            `1️⃣ *Crear cuenta en Quotex*\n` +
            `• Usa este enlace: ${process.env.QUOTEX_REF_LINK || 'https://broker-qx.pro/sign-up/?lid=123456'}\n` +
            `• Crea una cuenta NUEVA (obligatorio)\n\n` +
            `2️⃣ *Verificar cuenta*\n` +
            `• Completa el KYC (verificación de identidad)\n` +
            `• Se permiten cubanos\n\n` +
            `3️⃣ *Hacer depósito*\n` +
            `• Depósito mínimo: 10 USDT\n` +
            `• Puedes usar cualquier método\n\n` +
            `4️⃣ *Enviar tu ID de Quotex*\n` +
            `• Encuentra tu ID en el perfil de Quotex\n` +
            `• Es un número único\n\n` +
            `Por favor, escribe tu ID de Quotex:`;
        
        this.userStates[chatId] = {
            step: 'waiting_quotex_id',
            requestTime: Date.now()
        };
        
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Cancelar', callback_data: 'trading_menu' }]] }
            });
        } else {
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Cancelar', callback_data: 'trading_menu' }]] }
            });
        }
    }

    async handleQuotexIdInput(chatId, text, userId) {
        const quotexId = text.trim();
        
        if (quotexId.length < 3) {
            await this.bot.sendMessage(chatId, '❌ ID inválido. Debe tener al menos 3 caracteres.');
            return true;
        }
        
        // Guardar solicitud
        await this.supabase
            .from('trading_solicitudes_vip')
            .insert([{
                user_id: chatId,
                quotex_id: quotexId,
                estado: 'pendiente'
            }]);
        
        // Notificar al admin
        const user = await this.getUser(chatId);
        const adminMessage = `🎖️ *NUEVA SOLICITUD VIP*\n\n` +
            `👤 *Usuario:* ${user.first_name}\n` +
            `🆔 *Telegram ID:* ${chatId}\n` +
            `📱 *Username:* @${user.username || 'N/A'}\n` +
            `🆔 *Quotex ID:* ${quotexId}\n\n` +
            `📅 *Fecha:* ${new Date().toLocaleString()}\n\n` +
            `¿Aprobar solicitud?`;
        
        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Aprobar', callback_data: `trading_admin_approve_request:${chatId}` },
                    { text: '❌ Rechazar', callback_data: `trading_admin_reject_request:${chatId}` }
                ],
                [
                    { text: '📋 Ver Solicitudes', callback_data: 'trading_admin_view_requests' }
                ]
            ]
        };
        
        await this.bot.sendMessage(this.BOT_ADMIN_ID, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: adminKeyboard
        });
        
        // Confirmar al usuario
        await this.bot.sendMessage(chatId,
            `✅ *Solicitud enviada exitosamente*\n\n` +
            `Hemos recibido tu solicitud VIP.\n\n` +
            `🆔 *Tu ID de Quotex:* ${quotexId}\n` +
            `⏳ *Estado:* En revisión\n\n` +
            `El administrador revisará tu solicitud y te notificará pronto.`,
            { parse_mode: 'Markdown' }
        );
        
        delete this.userStates[userId];
        return true;
    }

    async confirmVIP(chatId, messageId, requestId) {
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*')
            .eq('id', requestId)
            .single();
        
        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        const message = `🎖️ *CONFIRMAR COMPRA DE VIP*\n\n` +
            `📋 *Plan:* VIP Mensual\n` +
            `💰 *Precio:* ${this.VIP_PRICE} CUP\n` +
            `⏳ *Duración:* 30 días\n\n` +
            `📊 *Beneficios:*\n` +
            `• 20 señales diarias\n` +
            `• Rentabilidad +${this.PROMISED_ROI}% semanal\n` +
            `• Garantía de devolución\n` +
            `• Soporte personalizado\n\n` +
            `El pago se realizará desde tu billetera CUP.\n\n` +
            `¿Confirmas la compra?`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Confirmar Pago', callback_data: `trading_pay_vip:${requestId}` },
                    { text: '❌ Cancelar', callback_data: 'trading_menu' }
                ]
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
    }

    async payVIP(chatId, messageId, requestId) {
        // Obtener usuario
        const user = await this.getUser(chatId);
        
        if (!user) {
            await this.bot.editMessageText('❌ Usuario no encontrado.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Verificar saldo
        if (user.balance_cup < this.VIP_PRICE) {
            await this.bot.editMessageText(
                `❌ *Saldo insuficiente*\n\n` +
                `Necesitas ${this.VIP_PRICE} CUP\n` +
                `Tu saldo actual: ${user.balance_cup} CUP\n\n` +
                `Por favor, recarga tu billetera primero.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '💰 Recargar', callback_data: 'recharge_menu' }]] }
                }
            );
            return;
        }
        
        // Obtener plan VIP
        const { data: plan } = await this.supabase
            .from('trading_planes')
            .select('*')
            .eq('nombre', 'VIP Mensual')
            .single();
        
        if (!plan) {
            await this.bot.editMessageText('❌ Plan VIP no disponible.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Crear suscripción
        const fechaInicio = new Date();
        const fechaFin = new Date();
        fechaFin.setDate(fechaFin.getDate() + plan.duracion_dias);
        
        const { data: subscription } = await this.supabase
            .from('trading_suscripciones')
            .insert([{
                user_id: chatId,
                plan_id: plan.id,
                fecha_inicio: fechaInicio.toISOString(),
                fecha_fin: fechaFin.toISOString(),
                precio_pagado: this.VIP_PRICE,
                estado: 'activa',
                metodo_pago: 'billetera_cup'
            }])
            .select()
            .single();
        
        // Actualizar saldo del usuario
        await this.supabase
            .from('users')
            .update({ balance_cup: user.balance_cup - this.VIP_PRICE })
            .eq('telegram_id', chatId);
        
        // Actualizar solicitud
        await this.supabase
            .from('trading_solicitudes_vip')
            .update({ estado: 'aprobada', fecha_aprobacion: new Date().toISOString() })
            .eq('id', requestId);
        
        // Registrar transacción
        await this.supabase
            .from('transactions')
            .insert([{
                user_id: chatId,
                type: 'TRADING_SUSCRIPTION',
                currency: 'cup',
                amount: -this.VIP_PRICE,
                status: 'completed',
                description: `Suscripción VIP Trading - ${plan.nombre}`,
                created_at: new Date().toISOString()
            }]);
        
        // Notificar al usuario
        const message = `🎉 *¡FELICIDADES, ERES VIP!*\n\n` +
            `✅ *Suscripción activada exitosamente*\n\n` +
            `📋 *Detalles:*\n` +
            `• Plan: ${plan.nombre}\n` +
            `• Precio: ${this.VIP_PRICE} CUP\n` +
            `• Inicio: ${fechaInicio.toLocaleDateString()}\n` +
            `• Fin: ${fechaFin.toLocaleDateString()}\n` +
            `• Días: ${plan.duracion_dias}\n\n` +
            `🕙 *Horario de señales:*\n` +
            `• 10:00 AM - Sesión matutina\n` +
            `• 10:00 PM - Sesión vespertina\n\n` +
            `📊 *Recuerda:*\n` +
            `• Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n` +
            `• Si baja del ${this.PROMISED_ROI}%, devolución del 50%\n` +
            `• No hay señales fines de semana\n\n` +
            `🔔 *Avisos de renovación:*\n` +
            `• 10 días antes\n` +
            `• 5 días antes\n` +
            `• 1 día antes\n\n` +
            `¡Prepárate para recibir señales!`;
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📈 Ver Señales', callback_data: 'trading_menu' }]] }
        });
        
        // Programar recordatorios
        this.scheduleReminders(chatId, subscription.id, fechaFin);
    }

    async showActiveSignals(chatId, messageId) {
        const isVIP = await this.isUserVIP(chatId);
        
        if (!isVIP) {
            await this.bot.editMessageText(
                '❌ *Acceso restringido*\n\nSolo usuarios VIP pueden ver señales activas.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🎖️ Ser VIP', callback_data: 'trading_request_vip' }]] }
                }
            );
            return;
        }
        
        // Obtener sesión activa
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        
        if (!activeSession) {
            await this.bot.editMessageText(
                '📭 *No hay sesiones activas*\n\n' +
                'Actualmente no hay ninguna sesión de trading abierta.\n\n' +
                '🕙 *Próxima sesión:*\n' +
                '• 10:00 AM - Matutina\n' +
                '• 10:00 PM - Vespertina',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'trading_menu' }]] }
                }
            );
            return;
        }
        
        // Obtener señales de esta sesión
        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('*')
            .eq('sesion_id', activeSession.id)
            .order('hora_envio', { ascending: false });
        
        let message = `📈 *SESIÓN ACTIVA DE TRADING*\n\n` +
            `📅 *Fecha:* ${new Date(activeSession.fecha).toLocaleDateString()}\n` +
            `🕙 *Hora:* ${activeSession.hora}\n` +
            `📊 *Tipo:* ${activeSession.tipo}\n` +
            `📡 *Señales enviadas:* ${signals ? signals.length : 0}/${activeSession.señales_totales}\n\n`;
        
        if (signals && signals.length > 0) {
            message += `📋 *ÚLTIMAS SEÑALES:*\n\n`;
            
            signals.slice(0, 5).forEach((signal, index) => {
                const hora = new Date(signal.hora_envio).toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                
                message += `${index + 1}. *${signal.activo}* (${signal.temporalidad})\n`;
                message += `   📈 ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n`;
                message += `   🕙 ${hora}\n`;
                message += `   🆔 #${signal.id}\n`;
                
                if (signal.resultado) {
                    message += `   🎯 ${signal.resultado === 'ganada' ? '✅ GANADA' : '❌ PERDIDA'}\n`;
                } else {
                    message += `   ⏳ Pendiente\n`;
                }
                
                message += `\n`;
            });
        } else {
            message += `⏳ *Esperando primera señal...*\n\n`;
        }
        
        message += `🔔 *Recibirás notificación con cada nueva señal*`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔄 Actualizar', callback_data: 'trading_signals_active' },
                    { text: '📋 Historial', callback_data: 'trading_history' }
                ],
                [
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    async showMySignals(chatId, messageId) {
        const isVIP = await this.isUserVIP(chatId);
        
        if (!isVIP) {
            await this.bot.editMessageText(
                '❌ *Acceso restringido*\n\nSolo usuarios VIP pueden ver sus señales.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🎖️ Ser VIP', callback_data: 'trading_request_vip' }]] }
                }
            );
            return;
        }
        
        // Obtener señales del usuario
        const { data: userSignals } = await this.supabase
            .from('trading_senales_usuario')
            .select(`
                *,
                trading_senales (
                    activo,
                    temporalidad,
                    direccion,
                    resultado,
                    profit_loss,
                    hora_envio
                )
            `)
            .eq('user_id', chatId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        let message = `📋 *MIS ÚLTIMAS SEÑALES*\n\n`;
        
        if (!userSignals || userSignals.length === 0) {
            message += `📭 *No has recibido señales aún*\n\n`;
            message += `Las señales aparecerán aquí cuando el admin las envíe.\n`;
            message += `Mantente atento a las sesiones de trading.`;
        } else {
            let ganadas = 0;
            let perdidas = 0;
            let pendientes = 0;
            
            userSignals.forEach((userSignal, index) => {
                const signal = userSignal.trading_senales;
                if (!signal) return;
                
                const hora = new Date(signal.hora_envio).toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                const fecha = new Date(signal.hora_envio).toLocaleDateString();
                
                message += `${index + 1}. *${signal.activo}* (${signal.temporalidad})\n`;
                message += `   📈 ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n`;
                message += `   📅 ${fecha} ${hora}\n`;
                
                if (signal.resultado) {
                    if (signal.resultado === 'ganada') {
                        ganadas++;
                        message += `   ✅ GANADA`;
                        if (signal.profit_loss) {
                            message += ` (+${signal.profit_loss}%)`;
                        }
                    } else {
                        perdidas++;
                        message += `   ❌ PERDIDA`;
                        if (signal.profit_loss) {
                            message += ` (${signal.profit_loss}%)`;
                        }
                    }
                } else {
                    pendientes++;
                    message += `   ⏳ PENDIENTE`;
                }
                
                message += `\n\n`;
            });
            
            const total = ganadas + perdidas + pendientes;
            const porcentaje = total > 0 ? ((ganadas / total) * 100).toFixed(2) : 0;
            
            message += `📊 *ESTADÍSTICAS:*\n`;
            message += `✅ Ganadas: ${ganadas}\n`;
            message += `❌ Perdidas: ${perdidas}\n`;
            message += `⏳ Pendientes: ${pendientes}\n`;
            message += `📈 Porcentaje éxito: ${porcentaje}%\n`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📅 Ver Calendario', callback_data: 'trading_calendar:1' },
                    { text: '📊 Rendimiento', callback_data: 'trading_performance' }
                ],
                [
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    async showHistory(chatId, messageId) {
        // Obtener las últimas 10 señales completadas
        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('*')
            .not('resultado', 'is', null)
            .order('hora_envio', { ascending: false })
            .limit(10);
        
        let message = `📋 *HISTORIAL DE SEÑALES*\n\n`;
        
        if (!signals || signals.length === 0) {
            message += `📭 *No hay historial disponible*\n\n`;
            message += `Las señales completadas aparecerán aquí.\n`;
            message += `Actualmente no hay señales en el historial.`;
        } else {
            let ganadas = 0;
            let perdidas = 0;
            
            signals.forEach((signal, index) => {
                const hora = new Date(signal.hora_envio).toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                const fecha = new Date(signal.hora_envio).toLocaleDateString();
                
                message += `${index + 1}. *${signal.activo}* (${signal.temporalidad})\n`;
                message += `   📈 ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n`;
                message += `   📅 ${fecha} ${hora}\n`;
                
                if (signal.resultado === 'ganada') {
                    ganadas++;
                    message += `   ✅ GANADA`;
                    if (signal.profit_loss) {
                        message += ` (+${signal.profit_loss}%)`;
                    }
                } else {
                    perdidas++;
                    message += `   ❌ PERDIDA`;
                    if (signal.profit_loss) {
                        message += ` (${signal.profit_loss}%)`;
                    }
                }
                
                message += `\n\n`;
            });
            
            const total = ganadas + perdidas;
            const porcentaje = total > 0 ? ((ganadas / total) * 100).toFixed(2) : 0;
            
            message += `📊 *ESTADÍSTICAS TOTALES:*\n`;
            message += `✅ Ganadas: ${ganadas}\n`;
            message += `❌ Perdidas: ${perdidas}\n`;
            message += `📈 Porcentaje éxito: ${porcentaje}%\n`;
            message += `💰 Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n\n`;
            message += `💎 *Todos pueden ver el historial para evaluar nuestro rendimiento*`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📅 Ver Calendario', callback_data: 'trading_calendar:1' },
                    { text: '📊 Rendimiento', callback_data: 'trading_performance' }
                ],
                [
                    { text: '🎖️ Ser VIP', callback_data: 'trading_request_vip' },
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    async showPerformance(chatId, messageId) {
        // Obtener rentabilidad de las últimas 4 semanas
        const { data: weeklyPerformance } = await this.supabase
            .from('trading_rentabilidad')
            .select('*')
            .order('semana', { ascending: false })
            .limit(4);
        
        // Calcular estadísticas generales
        const { data: allSignals } = await this.supabase
            .from('trading_senales')
            .select('resultado, profit_loss')
            .not('resultado', 'is', null);
        
        let message = `📊 *RENDIMIENTO DE SEÑALES*\n\n`;
        
        if (weeklyPerformance && weeklyPerformance.length > 0) {
            message += `📈 *RENTABILIDAD SEMANAL:*\n\n`;
            
            weeklyPerformance.forEach((week, index) => {
                const semanaStart = new Date(week.semana);
                const semanaEnd = new Date(semanaStart);
                semanaEnd.setDate(semanaEnd.getDate() + 4); // Lunes a Viernes
                
                const emoji = week.rentabilidad >= this.PROMISED_ROI ? '✅' : '❌';
                const cumplio = week.rentabilidad >= this.PROMISED_ROI ? 'SÍ' : 'NO';
                
                message += `*Semana ${index + 1}:* ${semanaStart.toLocaleDateString()} - ${semanaEnd.toLocaleDateString()}\n`;
                message += `${emoji} Rentabilidad: ${week.rentabilidad}%\n`;
                message += `📊 Prometido: ${this.PROMISED_ROI}%\n`;
                message += `🎯 Cumplió: ${cumplio}\n`;
                message += `✅ Ganadas: ${week.señales_ganadas}\n`;
                message += `❌ Perdidas: ${week.señales_perdidas}\n`;
                message += `📋 Totales: ${week.señales_totales}\n\n`;
            });
        }
        
        if (allSignals && allSignals.length > 0) {
            const ganadas = allSignals.filter(s => s.resultado === 'ganada').length;
            const perdidas = allSignals.filter(s => s.resultado === 'perdida').length;
            const total = ganadas + perdidas;
            const porcentaje = total > 0 ? ((ganadas / total) * 100).toFixed(2) : 0;
            
            const totalProfit = allSignals
                .filter(s => s.profit_loss)
                .reduce((sum, s) => sum + (s.profit_loss || 0), 0);
            const avgProfit = allSignals.filter(s => s.profit_loss).length > 0 
                ? (totalProfit / allSignals.filter(s => s.profit_loss).length).toFixed(2) 
                : 0;
            
            message += `📈 *ESTADÍSTICAS GENERALES:*\n`;
            message += `✅ Señales ganadas: ${ganadas}\n`;
            message += `❌ Señales perdidas: ${perdidas}\n`;
            message += `📋 Total señales: ${total}\n`;
            message += `📊 Porcentaje éxito: ${porcentaje}%\n`;
            message += `💰 Profit promedio: ${avgProfit}%\n\n`;
        }
        
        message += `💎 *GARANTÍA:*\n`;
        message += `• Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n`;
        message += `• Si baja del ${this.PROMISED_ROI}%, devolución del 50%\n`;
        message += `• Semana: Lunes a Viernes\n`;
        message += `• No hay señales fines de semana\n\n`;
        message += `📅 *Para ver señales específicas por fecha, usa el calendario*`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📅 Calendario', callback_data: 'trading_calendar:1' },
                    { text: '📋 Historial', callback_data: 'trading_history' }
                ],
                [
                    { text: '🎖️ Ser VIP', callback_data: 'trading_request_vip' },
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    async showCalendar(chatId, messageId, monthOffset = 0) {
        const now = new Date();
        const currentMonth = now.getMonth() + parseInt(monthOffset);
        const currentYear = now.getFullYear();
        
        // Ajustar si cambia de año
        const actualMonth = currentMonth % 12;
        const actualYear = currentYear + Math.floor(currentMonth / 12);
        
        const firstDay = new Date(actualYear, actualMonth, 1);
        const lastDay = new Date(actualYear, actualMonth + 1, 0);
        const daysInMonth = lastDay.getDate();
        
        // Obtener días con señales
        const startDate = new Date(actualYear, actualMonth, 1).toISOString().split('T')[0];
        const endDate = new Date(actualYear, actualMonth + 1, 0).toISOString().split('T')[0];
        
        const { data: signalsByDay } = await this.supabase
            .from('trading_senales')
            .select('hora_envio')
            .gte('hora_envio', startDate)
            .lte('hora_envio', endDate);
        
        const daysWithSignals = new Set();
        if (signalsByDay) {
            signalsByDay.forEach(signal => {
                const day = new Date(signal.hora_envio).getDate();
                daysWithSignals.add(day);
            });
        }
        
        // Construir calendario
        const monthNames = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        
        let message = `📅 *CALENDARIO DE SEÑALES - ${monthNames[actualMonth]} ${actualYear}*\n\n`;
        
        // Encabezados de días
        message += `Dom Lun Mar Mié Jue Vie Sáb\n`;
        
        // Espacios para el primer día
        const firstDayOfWeek = firstDay.getDay();
        for (let i = 0; i < firstDayOfWeek; i++) {
            message += `    `;
        }
        
        // Días del mes
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${actualYear}-${String(actualMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const hasSignals = daysWithSignals.has(day);
            const isToday = now.getDate() === day && now.getMonth() === actualMonth && now.getFullYear() === actualYear;
            
            let dayDisplay = String(day).padStart(2, ' ');
            if (hasSignals) dayDisplay = `📈`;
            if (isToday) dayDisplay = `🔵`;
            
            message += `${dayDisplay} `;
            
            // Nueva línea cada sábado
            const currentDayOfWeek = new Date(actualYear, actualMonth, day).getDay();
            if (currentDayOfWeek === 6) {
                message += `\n`;
            }
        }
        
        message += `\n\n📈 = Día con señales\n`;
        message += `🔵 = Hoy\n\n`;
        message += `Haz clic en un día para ver las señales de esa fecha:`;
        
        // Crear teclado con días interactivos
        const keyboardRows = [];
        const daysPerRow = 7;
        
        for (let day = 1; day <= daysInMonth; day += daysPerRow) {
            const row = [];
            for (let d = day; d < Math.min(day + daysPerRow, daysInMonth + 1); d++) {
                const dateStr = `${actualYear}-${String(actualMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const hasSignals = daysWithSignals.has(d);
                
                let emoji = hasSignals ? '📈' : '📅';
                row.push({
                    text: `${emoji}${d}`,
                    callback_data: `trading_view_date:${dateStr}`
                });
            }
            keyboardRows.push(row);
        }
        
        // Navegación entre meses
        const navRow = [];
        if (parseInt(monthOffset) > -6) { // Limitar a 6 meses atrás
            navRow.push({
                text: '⬅️ Mes Anterior',
                callback_data: `trading_calendar:${parseInt(monthOffset) - 1}`
            });
        }
        
        navRow.push({
            text: '📅 Hoy',
            callback_data: 'trading_calendar:0'
        });
        
        if (parseInt(monthOffset) < 3) { // Limitar a 3 meses adelante
            navRow.push({
                text: 'Mes Siguiente ➡️',
                callback_data: `trading_calendar:${parseInt(monthOffset) + 1}`
            });
        }
        
        keyboardRows.push(navRow);
        
        // Botones de acción
        keyboardRows.push([
            { text: '🔙 Historial', callback_data: 'trading_history' },
            { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
        ]);
        
        const keyboard = { inline_keyboard: keyboardRows };
        
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
    }

    async viewSignalsByDate(chatId, messageId, dateStr) {
        const date = new Date(dateStr);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        
        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('*')
            .gte('hora_envio', date.toISOString())
            .lt('hora_envio', nextDay.toISOString())
            .order('hora_envio', { ascending: false });
        
        let message = `📅 *SEÑALES DEL ${date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*\n\n`;
        
        if (!signals || signals.length === 0) {
            message += `📭 *No hay señales este día*\n\n`;
            message += `No se registraron señales de trading para esta fecha.`;
        } else {
            let ganadas = 0;
            let perdidas = 0;
            let pendientes = 0;
            
            signals.forEach((signal, index) => {
                const hora = new Date(signal.hora_envio).toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                
                message += `${index + 1}. *${signal.activo}* (${signal.temporalidad})\n`;
                message += `   📈 ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n`;
                message += `   🕙 ${hora}\n`;
                
                if (signal.resultado) {
                    if (signal.resultado === 'ganada') {
                        ganadas++;
                        message += `   ✅ GANADA`;
                        if (signal.profit_loss) {
                            message += ` (+${signal.profit_loss}%)`;
                        }
                    } else {
                        perdidas++;
                        message += `   ❌ PERDIDA`;
                        if (signal.profit_loss) {
                            message += ` (${signal.profit_loss}%)`;
                        }
                    }
                } else {
                    pendientes++;
                    message += `   ⏳ PENDIENTE`;
                }
                
                message += `\n\n`;
            });
            
            const total = ganadas + perdidas + pendientes;
            const porcentaje = total > 0 ? ((ganadas / (ganadas + perdidas)) * 100).toFixed(2) : 0;
            
            message += `📊 *ESTADÍSTICAS DEL DÍA:*\n`;
            message += `✅ Ganadas: ${ganadas}\n`;
            message += `❌ Perdidas: ${perdidas}\n`;
            message += `⏳ Pendientes: ${pendientes}\n`;
            if (ganadas + perdidas > 0) {
                message += `📈 Porcentaje éxito: ${porcentaje}%\n`;
            }
        }
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📅 Calendario', callback_data: 'trading_calendar:0' },
                    { text: '📋 Historial', callback_data: 'trading_history' }
                ],
                [
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    // ============================================
    // FUNCIONES PARA ADMIN
    // ============================================

    esAdmin(userId) {
        return userId.toString() === this.BOT_ADMIN_ID.toString();
    }

    async showAdminMenu(chatId, messageId) {
        // Verificar si hay sesión activa
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .single();
        
        let sessionStatus = '❌ *NO HAY SESIÓN ACTIVA*';
        let sessionButtonText = '📡 Abrir Sesión';
        let sessionCallback = 'trading_admin_open_session';
        
        if (activeSession) {
            sessionStatus = `✅ *SESIÓN ACTIVA*\n📅 ${new Date(activeSession.fecha).toLocaleDateString()} ${activeSession.hora}\n📊 Señales: ${activeSession.señales_enviadas}/${activeSession.señales_totales}`;
            sessionButtonText = '🔒 Cerrar Sesión';
            sessionCallback = 'trading_admin_close_session';
        }
        
        const message = `👑 *PANEL ADMIN - SEÑALES TRADING*\n\n` +
            `${sessionStatus}\n\n` +
            `Selecciona una opción:`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: sessionButtonText, callback_data: sessionCallback },
                    { text: '📤 Enviar Señal', callback_data: 'trading_admin_send_signal' }
                ],
                [
                    { text: '📋 Ver Solicitudes VIP', callback_data: 'trading_admin_view_requests' },
                    { text: '📊 Estadísticas', callback_data: 'admin_trading_stats' }
                ],
                [
                    { text: '👥 Usuarios VIP', callback_data: 'admin_trading_users' },
                    { text: '📈 Señales Activas', callback_data: 'admin_trading_active_signals' }
                ],
                [
                    { text: '🔙 Panel Admin', callback_data: 'admin_panel' }
                ]
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
    }

    async openSession(chatId, messageId) {
        const now = new Date();
        const currentHour = now.getHours();
        
        // Determinar tipo de sesión basado en la hora
        let tipo = 'vespertina';
        if (currentHour < 12) {
            tipo = 'matutina';
        }
        
        // Verificar si ya hay sesión hoy de este tipo
        const today = now.toISOString().split('T')[0];
        const { data: existingSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('fecha', today)
            .eq('tipo', tipo)
            .single();
        
        if (existingSession) {
            await this.bot.editMessageText(
                `❌ *Ya existe una sesión ${tipo} hoy*\n\n` +
                `Puedes cerrar la sesión actual antes de abrir una nueva.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'trading_admin_menu' }]] }
                }
            );
            return;
        }
        
        // Crear nueva sesión
        const { data: session } = await this.supabase
            .from('trading_sesiones')
            .insert([{
                admin_id: chatId,
                fecha: today,
                hora: now.toTimeString().split(' ')[0],
                tipo: tipo,
                señales_totales: this.SIGNALS_PER_SESSION,
                señales_enviadas: 0,
                estado: 'abierta'
            }])
            .select()
            .single();
        
        // Notificar a usuarios VIP
        const vipUsers = await this.getVIPUsers();
        for (const user of vipUsers) {
            try {
                await this.bot.sendMessage(user.user_id,
                    `📢 *¡NUEVA SESIÓN DE TRADING ABIERTA!*\n\n` +
                    `📅 *Fecha:* ${new Date().toLocaleDateString()}\n` +
                    `🕙 *Hora:* ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
                    `📊 *Tipo:* Sesión ${tipo}\n` +
                    `📡 *Señales:* ${this.SIGNALS_PER_SESSION} señales programadas\n\n` +
                    `🔔 *Prepárate para recibir señales*\n` +
                    `Las señales llegarán en breve.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.log(`No se pudo notificar al usuario ${user.user_id}`);
            }
        }
        
        const message = `✅ *SESIÓN ABIERTA EXITOSAMENTE*\n\n` +
            `📅 *Fecha:* ${today}\n` +
            `🕙 *Hora:* ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
            `📊 *Tipo:* ${tipo}\n` +
            `📡 *Señales:* ${this.SIGNALS_PER_SESSION} señales programadas\n` +
            `👥 *Usuarios notificados:* ${vipUsers.length}\n\n` +
            `Ahora puedes enviar señales usando el botón "📤 Enviar Señal"`;
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📤 Enviar Primera Señal', callback_data: 'trading_admin_send_signal' }]] }
        });
    }

    async closeSession(chatId, messageId) {
        // Obtener sesión activa
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .single();
        
        if (!activeSession) {
            await this.bot.editMessageText('❌ No hay sesión activa para cerrar.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Cerrar sesión
        await this.supabase
            .from('trading_sesiones')
            .update({ estado: 'cerrada' })
            .eq('id', activeSession.id);
        
        // Notificar a usuarios VIP
        const vipUsers = await this.getVIPUsers();
        for (const user of vipUsers) {
            try {
                await this.bot.sendMessage(user.user_id,
                    `📢 *SESIÓN DE TRADING CERRADA*\n\n` +
                    `La sesión ${activeSession.tipo} ha finalizado.\n\n` +
                    `📊 *Resumen:*\n` +
                    `• Señales enviadas: ${activeSession.señales_enviadas}/${activeSession.señales_totales}\n` +
                    `• Fecha: ${new Date(activeSession.fecha).toLocaleDateString()}\n\n` +
                    `📅 *Próxima sesión:*\n` +
                    `• ${activeSession.tipo === 'matutina' ? '22:00' : '10:00'} (${activeSession.tipo === 'matutina' ? 'Vespertina' : 'Matutina'})\n\n` +
                    `¡Gracias por participar!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.log(`No se pudo notificar al usuario ${user.user_id}`);
            }
        }
        
        const message = `✅ *SESIÓN CERRADA EXITOSAMENTE*\n\n` +
            `📅 *Fecha:* ${activeSession.fecha}\n` +
            `🕙 *Hora de cierre:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
            `📊 *Tipo:* ${activeSession.tipo}\n` +
            `📡 *Señales enviadas:* ${activeSession.señales_enviadas}/${activeSession.señales_totales}\n` +
            `👥 *Usuarios notificados:* ${vipUsers.length}\n\n` +
            `La sesión ha sido cerrada y los usuarios han sido notificados.`;
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Panel Trading', callback_data: 'trading_admin_menu' }]] }
        });
    }

    async prepareSignal(chatId, messageId) {
        // Verificar que haya sesión activa
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .single();
        
        if (!activeSession) {
            await this.bot.editMessageText(
                '❌ *No hay sesión activa*\n\nDebes abrir una sesión primero.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📡 Abrir Sesión', callback_data: 'trading_admin_open_session' }]] }
                }
            );
            return;
        }
        
        // Verificar límite de señales
        if (activeSession.señales_enviadas >= activeSession.señales_totales) {
            await this.bot.editMessageText(
                `❌ *Límite de señales alcanzado*\n\n` +
                `Ya se enviaron ${activeSession.señales_enviadas}/${activeSession.señales_totales} señales.\n` +
                `Puedes cerrar la sesión o aumentar el límite.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }]] }
                }
            );
            return;
        }
        
        // Iniciar proceso de envío de señal
        this.adminStates[chatId] = {
            step: 'waiting_pair',
            sessionId: activeSession.id,
            signalNumber: activeSession.señales_enviadas + 1
        };
        
        const message = `📤 *PREPARANDO SEÑAL #${activeSession.señales_enviadas + 1}*\n\n` +
            `Por favor, escribe el par de divisas:\n\n` +
            `📌 *Ejemplos:*\n` +
            `• EUR/USD\n` +
            `• GBP/JPY\n` +
            `• XAU/USD\n` +
            `• BTC/USD\n\n` +
            `Escribe el par ahora:`;
        
        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'trading_admin_menu' }]] }
        });
    }

    async handlePairInput(chatId, text, state) {
        const pair = text.trim().toUpperCase();
        
        // Validar formato básico del par
        if (!pair.includes('/') || pair.length < 6) {
            await this.bot.sendMessage(chatId,
                `❌ *Formato inválido*\n\n` +
                `El par debe tener formato: XXX/XXX\n\n` +
                `Ejemplos válidos:\n` +
                `• EUR/USD\n` +
                `• GBP/JPY\n` +
                `• XAU/USD\n\n` +
                `Inténtalo de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        // Actualizar estado
        this.adminStates[chatId].step = 'waiting_timeframe';
        this.adminStates[chatId].pair = pair;
        
        await this.bot.sendMessage(chatId,
            `✅ *Par aceptado:* ${pair}\n\n` +
            `Ahora escribe la temporalidad:\n\n` +
            `📌 *Ejemplos:*\n` +
            `• 1min\n` +
            `• 5min\n` +
            `• 15min\n` +
            `• 1h\n` +
            `• 4h\n\n` +
            `Escribe la temporalidad ahora:`,
            { parse_mode: 'Markdown' }
        );
        
        return true;
    }

    async handleTimeframeInput(chatId, text, state) {
        const timeframe = text.trim().toLowerCase();
        
        // Validar temporalidades comunes
        const validTimeframes = ['1min', '5min', '15min', '30min', '1h', '4h', '1d', '1w'];
        if (!validTimeframes.includes(timeframe)) {
            await this.bot.sendMessage(chatId,
                `❌ *Temporalidad no válida*\n\n` +
                `Usa una de estas opciones:\n` +
                `• 1min\n` +
                `• 5min\n` +
                `• 15min\n` +
                `• 30min\n` +
                `• 1h\n` +
                `• 4h\n` +
                `• 1d\n` +
                `• 1w\n\n` +
                `Inténtalo de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        // Actualizar estado
        this.adminStates[chatId].step = 'waiting_direction';
        this.adminStates[chatId].timeframe = timeframe;
        
        // Mostrar botones de dirección
        const message = `✅ *Configuración lista:*\n\n` +
            `📊 *Activo:* ${state.pair}\n` +
            `⏰ *Temporalidad:* ${timeframe}\n` +
            `🔢 *Señal #:* ${state.signalNumber}\n\n` +
            `Selecciona la dirección de la señal:`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⬆️ COMPRA (ALTA)', callback_data: 'trading_signal_up' },
                    { text: '⬇️ VENTA (BAJA)', callback_data: 'trading_signal_down' }
                ],
                [
                    { text: '❌ Cancelar', callback_data: 'trading_admin_menu' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        
        return true;
    }

    async sendSignalToUsers(chatId, messageId, direction) {
        const state = this.adminStates[chatId];
        if (!state) return;
        
        const { pair, timeframe, sessionId, signalNumber } = state;
        
        // Obtener sesión
        const { data: session } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('id', sessionId)
            .single();
        
        if (!session) {
            await this.bot.editMessageText('❌ Sesión no encontrada.', {
                chat_id: chatId,
                message_id: messageId
            });
            delete this.adminStates[chatId];
            return;
        }
        
        // Crear señal en base de datos
        const { data: signal } = await this.supabase
            .from('trading_senales')
            .insert([{
                sesion_id: sessionId,
                activo: pair,
                temporalidad: timeframe,
                direccion: direction,
                resultado: 'pendiente'
            }])
            .select()
            .single();
        
        // Incrementar contador de señales en sesión
        await this.supabase
            .from('trading_sesiones')
            .update({ señales_enviadas: session.señales_enviadas + 1 })
            .eq('id', sessionId);
        
        // Obtener usuarios VIP activos
        const vipUsers = await this.getVIPUsers();
        
        // Preparar mensaje para usuarios
        const userMessage = `🚨 *¡NUEVA SEÑAL DE TRADING!*\n\n` +
            `📊 *Activo:* ${pair}\n` +
            `⏰ *Temporalidad:* ${timeframe}\n` +
            `📈 *Dirección:* ${direction === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `🔢 *Señal #:* ${signalNumber}\n` +
            `📅 *Hora:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            `⚡ *¡ACTÚA RÁPIDO!*\n` +
            `Esta es una señal para opciones binarias.`;
        
        // Enviar a cada usuario VIP
        let sentCount = 0;
        for (const user of vipUsers) {
            try {
                await this.bot.sendMessage(user.user_id, userMessage, {
                    parse_mode: 'Markdown'
                });
                
                // Registrar que el usuario recibió la señal
                await this.supabase
                    .from('trading_senales_usuario')
                    .insert([{
                        user_id: user.user_id,
                        señal_id: signal.id,
                        recibida: true
                    }]);
                
                sentCount++;
                
            } catch (error) {
                console.log(`No se pudo enviar señal al usuario ${user.user_id}`);
            }
        }
        
        // Crear mensaje para admin con botones de resultado
        const adminSignalMessage = `✅ *SEÑAL ENVIADA EXITOSAMENTE*\n\n` +
            `📊 *Activo:* ${pair}\n` +
            `⏰ *Temporalidad:* ${timeframe}\n` +
            `📈 *Dirección:* ${direction === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `🔢 *Señal #:* ${signalNumber}\n` +
            `📅 *Hora:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
            `👥 *Enviada a:* ${sentCount} usuarios VIP\n\n` +
            `Marca el resultado de esta señal:`;
        
        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Profit', callback_data: `trading_signal_profit:${signal.id}` },
                    { text: '❌ Pérdida', callback_data: `trading_signal_loss:${signal.id}` }
                ],
                [
                    { text: '📤 Enviar Otra Señal', callback_data: 'trading_admin_send_signal' },
                    { text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }
                ]
            ]
        };
        
        // Enviar mensaje al admin
        const adminMsg = await this.bot.sendMessage(chatId, adminSignalMessage, {
            parse_mode: 'Markdown',
            reply_markup: adminKeyboard
        });
        
        // Guardar ID del mensaje para actualizarlo después
        await this.supabase
            .from('trading_senales')
            .update({ admin_message_id: adminMsg.message_id })
            .eq('id', signal.id);
        
        // Limpiar estado del admin
        delete this.adminStates[chatId];
        
        // Actualizar mensaje original si existe messageId
        if (messageId) {
            await this.bot.deleteMessage(chatId, messageId);
        }
    }

    async markSignalResult(chatId, messageId, signalId, result) {
        // Obtener señal
        const { data: signal } = await this.supabase
            .from('trading_senales')
            .select('*')
            .eq('id', signalId)
            .single();
        
        if (!signal) {
            await this.bot.editMessageText('❌ Señal no encontrada.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Actualizar señal
        await this.supabase
            .from('trading_senales')
            .update({
                resultado: result,
                hora_cierre: new Date().toISOString(),
                profit_loss: result === 'ganada' ? 75 : -100 // Ejemplo: 75% profit, 100% loss
            })
            .eq('id', signalId);
        
        // Obtener usuarios que recibieron esta señal
        const { data: userSignals } = await this.supabase
            .from('trading_senales_usuario')
            .select('user_id')
            .eq('señal_id', signalId);
        
        // Notificar a usuarios
        if (userSignals) {
            const resultMessage = result === 'ganada' ? 
                `✅ *SEÑAL GANADA* (+75%)` : 
                `❌ *SEÑAL PERDIDA* (-100%)`;
            
            const userNotification = `📊 *RESULTADO DE SEÑAL*\n\n` +
                `📈 *Activo:* ${signal.activo} (${signal.temporalidad})\n` +
                `${resultMessage}\n\n` +
                `📅 *Hora cierre:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
                `🔢 *ID Señal:* #${signalId}`;
            
            for (const userSignal of userSignals) {
                try {
                    await this.bot.sendMessage(userSignal.user_id, userNotification, {
                        parse_mode: 'Markdown'
                    });
                } catch (error) {
                    console.log(`No se pudo notificar resultado al usuario ${userSignal.user_id}`);
                }
            }
        }
        
        // Actualizar mensaje del admin
        const updatedMessage = `📊 *RESULTADO REGISTRADO*\n\n` +
            `✅ *Señal #${signalId} marcada como ${result === 'ganada' ? 'GANADA' : 'PERDIDA'}*\n\n` +
            `📈 *Activo:* ${signal.activo} (${signal.temporalidad})\n` +
            `📊 *Dirección:* ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `💰 *Resultado:* ${result === 'ganada' ? '+75%' : '-100%'}\n` +
            `👥 *Usuarios notificados:* ${userSignals ? userSignals.length : 0}\n\n` +
            `Puedes continuar enviando señales o cerrar la sesión.`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📤 Enviar Otra Señal', callback_data: 'trading_admin_send_signal' },
                    { text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }
                ],
                [
                    { text: '🔙 Panel Trading', callback_data: 'trading_admin_menu' }
                ]
            ]
        };
        
        if (signal.admin_message_id) {
            try {
                await this.bot.editMessageText(updatedMessage, {
                    chat_id: chatId,
                    message_id: signal.admin_message_id,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } catch (error) {
                // Si falla, enviar nuevo mensaje
                await this.bot.sendMessage(chatId, updatedMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
        } else {
            await this.bot.sendMessage(chatId, updatedMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
        
        // Calcular rentabilidad semanal
        await this.calculateWeeklyROI();
    }

    async viewVIPRequests(chatId, messageId) {
        const { data: requests } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username, phone_number)')
            .eq('estado', 'pendiente')
            .order('created_at', { ascending: false });
        
        let message = `📋 *SOLICITUDES VIP PENDIENTES*\n\n`;
        
        if (!requests || requests.length === 0) {
            message += `✅ *No hay solicitudes pendientes*`;
        } else {
            requests.forEach((request, index) => {
                message += `${index + 1}. *${request.users.first_name}*\n`;
                message += `   🆔 Telegram: ${request.user_id}\n`;
                message += `   📱 @${request.users.username || 'N/A'}\n`;
                message += `   🆔 Quotex: ${request.quotex_id}\n`;
                message += `   📅 ${new Date(request.created_at).toLocaleDateString()}\n`;
                
                const keyboardRow = [
                    { text: `✅ Aprobar ${index + 1}`, callback_data: `trading_admin_approve_request:${request.id}` },
                    { text: `❌ Rechazar ${index + 1}`, callback_data: `trading_admin_reject_request:${request.id}` }
                ];
                
                // Aquí se mostraría el teclado, pero en el mensaje solo mostramos info
                message += `   [Aprobar] [Rechazar]\n\n`;
            });
        }
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔄 Actualizar', callback_data: 'trading_admin_view_requests' }
                ],
                [
                    { text: '🔙 Panel Trading', callback_data: 'trading_admin_menu' }
                ]
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
    }

    async approveVIPRequest(chatId, messageId, requestId) {
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username)')
            .eq('id', requestId)
            .single();
        
        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Actualizar estado de la solicitud
        await this.supabase
            .from('trading_solicitudes_vip')
            .update({
                estado: 'aprobada',
                admin_id: chatId,
                fecha_aprobacion: new Date().toISOString()
            })
            .eq('id', requestId);
        
        // Notificar al usuario
        try {
            await this.bot.sendMessage(request.user_id,
                `🎉 *¡SOLICITUD VIP APROBADA!*\n\n` +
                `Tu solicitud para ser miembro VIP ha sido aprobada.\n\n` +
                `🆔 *Tu ID de Quotex:* ${request.quotex_id}\n` +
                `✅ *Estado:* Aprobado\n\n` +
                `Ahora puedes comprar tu suscripción VIP:\n` +
                `1. Ve al menú de Trading\n` +
                `2. Selecciona "Comprar Señales"\n` +
                `3. Confirma el pago de ${this.VIP_PRICE} CUP\n\n` +
                `¡Te esperamos en las sesiones de trading!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log(`No se pudo notificar al usuario ${request.user_id}`);
        }
        
        const message = `✅ *SOLICITUD APROBADA*\n\n` +
            `La solicitud VIP de *${request.users.first_name}* ha sido aprobada.\n\n` +
            `👤 Usuario: ${request.users.first_name}\n` +
            `🆔 Telegram: ${request.user_id}\n` +
            `🆔 Quotex: ${request.quotex_id}\n\n` +
            `El usuario ha sido notificado y ahora puede comprar la suscripción.`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Ver Más Solicitudes', callback_data: 'trading_admin_view_requests' }
                ],
                [
                    { text: '🔙 Panel Trading', callback_data: 'trading_admin_menu' }
                ]
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
    }

    async rejectVIPRequest(chatId, messageId, requestId) {
        // Aquí podrías pedir un motivo, por simplicidad solo rechazamos
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username)')
            .eq('id', requestId)
            .single();
        
        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        
        // Actualizar estado
        await this.supabase
            .from('trading_solicitudes_vip')
            .update({
                estado: 'rechazada',
                admin_id: chatId,
                motivo_rechazo: 'Rechazada por el administrador'
            })
            .eq('id', requestId);
        
        // Notificar al usuario
        try {
            await this.bot.sendMessage(request.user_id,
                `❌ *SOLICITUD VIP RECHAZADA*\n\n` +
                `Lamentablemente tu solicitud VIP ha sido rechazada.\n\n` +
                `🆔 *Tu ID de Quotex:* ${request.quotex_id}\n` +
                `❌ *Estado:* Rechazado\n\n` +
                `Motivo: Revisión administrativa\n\n` +
                `Si crees que es un error, contacta al administrador.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log(`No se pudo notificar al usuario ${request.user_id}`);
        }
        
        const message = `❌ *SOLICITUD RECHAZADA*\n\n` +
            `La solicitud VIP de *${request.users.first_name}* ha sido rechazada.\n\n` +
            `👤 Usuario: ${request.users.first_name}\n` +
            `🆔 Telegram: ${request.user_id}\n` +
            `🆔 Quotex: ${request.quotex_id}\n\n` +
            `El usuario ha sido notificado del rechazo.`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Ver Más Solicitudes', callback_data: 'trading_admin_view_requests' }
                ],
                [
                    { text: '🔙 Panel Trading', callback_data: 'trading_admin_menu' }
                ]
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
    }

    // ============================================
    // FUNCIONES DE UTILIDAD
    // ============================================

    async getUser(telegramId) {
        const { data, error } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();
        
        if (error) return null;
        return data;
    }

    async isUserVIP(userId) {
        const { data: subscription } = await this.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', userId)
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString())
            .single();
        
        return !!subscription;
    }

    async getActiveSubscription(userId) {
        const { data: subscription } = await this.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', userId)
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString())
            .single();
        
        return subscription;
    }

    async getVIPUsers() {
        const { data: subscriptions } = await this.supabase
            .from('trading_suscripciones')
            .select('user_id')
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString());
        
        return subscriptions || [];
    }

    getDaysLeft(endDate) {
        const end = new Date(endDate);
        const now = new Date();
        const diffTime = end - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    }

    scheduleReminders(userId, subscriptionId, endDate) {
        const end = new Date(endDate);
        const now = new Date();
        
        // Calcular días para los recordatorios
        const tenDays = new Date(end);
        tenDays.setDate(tenDays.getDate() - 10);
        
        const fiveDays = new Date(end);
        fiveDays.setDate(fiveDays.getDate() - 5);
        
        const oneDay = new Date(end);
        oneDay.setDate(oneDay.getDate() - 1);
        
        // Programar recordatorios (en un sistema real usarías agenda o similar)
        // Por simplicidad, aquí solo mostramos la lógica
        console.log(`Recordatorios programados para usuario ${userId}`);
        console.log(`- 10 días antes: ${tenDays.toLocaleDateString()}`);
        console.log(`- 5 días antes: ${fiveDays.toLocaleDateString()}`);
        console.log(`- 1 día antes: ${oneDay.toLocaleDateString()}`);
    }

    async calculateWeeklyROI() {
        // Obtener lunes de esta semana
        const now = new Date();
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Ajuste para que lunes sea día 0
        const monday = new Date(now);
        monday.setDate(now.getDate() - diff);
        monday.setHours(0, 0, 0, 0);
        
        // Obtener señales de esta semana (lunes a viernes)
        const nextMonday = new Date(monday);
        nextMonday.setDate(monday.getDate() + 7);
        
        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('resultado, profit_loss')
            .gte('hora_envio', monday.toISOString())
            .lt('hora_envio', nextMonday.toISOString())
            .not('resultado', 'is', null);
        
        if (!signals || signals.length === 0) return;
        
        // Calcular rentabilidad
        const ganadas = signals.filter(s => s.resultado === 'ganada').length;
        const perdidas = signals.filter(s => s.resultado === 'perdida').length;
        const total = ganadas + perdidas;
        
        // Calcular ROI promedio (simplificado)
        let roi = 0;
        if (total > 0) {
            const totalProfit = signals
                .filter(s => s.profit_loss)
                .reduce((sum, s) => sum + (s.profit_loss || 0), 0);
            roi = totalProfit / total;
        }
        
        // Guardar rentabilidad semanal
        const { data: existing } = await this.supabase
            .from('trading_rentabilidad')
            .select('id')
            .eq('semana', monday.toISOString().split('T')[0])
            .single();
        
        if (existing) {
            await this.supabase
                .from('trading_rentabilidad')
                .update({
                    rentabilidad: roi,
                    señales_totales: total,
                    señales_ganadas: ganadas,
                    señales_perdidas: perdidas
                })
                .eq('id', existing.id);
        } else {
            await this.supabase
                .from('trading_rentabilidad')
                .insert([{
                    semana: monday.toISOString().split('T')[0],
                    rentabilidad: roi,
                    señales_totales: total,
                    señales_ganadas: ganadas,
                    señales_perdidas: perdidas
                }]);
        }
        
        // Verificar si se cumple la rentabilidad prometida
        if (roi < this.PROMISED_ROI) {
            // Notificar al admin que debe procesar reembolsos
            await this.bot.sendMessage(this.BOT_ADMIN_ID,
                `⚠️ *RENTABILIDAD SEMANAL BAJA*\n\n` +
                `La rentabilidad de esta semana es del ${roi.toFixed(2)}%\n` +
                `📊 *Prometido:* ${this.PROMISED_ROI}%\n\n` +
                `Debes procesar reembolsos del 50% a los usuarios VIP.\n\n` +
                `Señales: ${total} (✅ ${ganadas} | ❌ ${perdidas})`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async showBuySignals(chatId, messageId) {
        // Obtener planes activos
        const { data: plans } = await this.supabase
            .from('trading_planes')
            .select('*')
            .eq('activo', true)
            .order('precio', { ascending: true });
        
        let message = `💰 *COMPRAR SEÑALES DE TRADING*\n\n`;
        
        if (!plans || plans.length === 0) {
            message += `❌ *No hay planes disponibles*\n\n`;
            message += `Contacta al administrador para más información.`;
        } else {
            plans.forEach((plan, index) => {
                message += `${index + 1}. *${plan.nombre}*\n`;
                message += `   💵 ${plan.precio} CUP\n`;
                message += `   ⏳ ${plan.duracion_dias} días\n`;
                message += `   📝 ${plan.descripcion || 'Sin descripción'}\n\n`;
            });
            
            message += `Selecciona un plan para continuar:`;
        }
        
        // Crear teclado con planes
        const keyboardRows = [];
        if (plans) {
            plans.forEach((plan, index) => {
                keyboardRows.push([{
                    text: `${index + 1}. ${plan.nombre} - ${plan.precio} CUP`,
                    callback_data: `trading_confirm_vip:${plan.id}`
                }]);
            });
        }
        
        keyboardRows.push([
            { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
        ]);
        
        const keyboard = { inline_keyboard: keyboardRows };
        
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
    }

    async showSubscriptions(chatId, messageId) {
        const subscriptions = await this.getActiveSubscription(chatId);
        
        let message = `📋 *MIS SUSCRIPCIONES*\n\n`;
        
        if (!subscriptions) {
            message += `📭 *No tienes suscripciones activas*\n\n`;
            message += `Puedes comprar una suscripción VIP para acceder a las señales de trading.`;
        } else {
            message += `✅ *SUSCRIPCIÓN VIP ACTIVA*\n\n`;
            message += `📅 *Inicio:* ${new Date(subscriptions.fecha_inicio).toLocaleDateString()}\n`;
            message += `📅 *Fin:* ${new Date(subscriptions.fecha_fin).toLocaleDateString()}\n`;
            message += `⏳ *Días restantes:* ${this.getDaysLeft(subscriptions.fecha_fin)}\n`;
            message += `💰 *Precio pagado:* ${subscriptions.precio_pagado} CUP\n\n`;
            
            if (this.getDaysLeft(subscriptions.fecha_fin) <= 10) {
                message += `⚠️ *Tu suscripción está por vencer*\n`;
                message += `Renueva ahora para no perder el acceso a las señales.\n\n`;
            }
            
            message += `Recibirás avisos de renovación a los 10, 5 y 1 día antes del vencimiento.`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💰 Renovar VIP', callback_data: 'trading_buy_signals' },
                    { text: '📈 Ver Señales', callback_data: 'trading_signals_active' }
                ],
                [
                    { text: '🔙 Menú Trading', callback_data: 'trading_menu' }
                ]
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
    }

    // Limpiar estados antiguos
    cleanupOldStates() {
        const now = Date.now();
        const timeout = 30 * 60 * 1000; // 30 minutos
        
        // Limpiar estados de usuario
        for (const [userId, state] of Object.entries(this.userStates)) {
            if (state.requestTime && (now - state.requestTime) > timeout) {
                delete this.userStates[userId];
            }
        }
        
        // Limpiar estados de admin
        for (const [adminId, state] of Object.entries(this.adminStates)) {
            if (state.requestTime && (now - state.requestTime) > timeout) {
                delete this.adminStates[adminId];
            }
        }
    }

    // Limpiar estado de un usuario específico
    clearUserState(userId) {
        if (this.userStates[userId]) {
            delete this.userStates[userId];
        }
        if (this.adminStates[userId]) {
            delete this.adminStates[userId];
        }
    }
}

module.exports = TradingSignalsHandler;
