// TradingSignalsHandler.js - Manejador de Señales de Trading (VERSIÓN ÚNICA, SIN LISTENERS PROPIOS)
require('dotenv').config();

class TradingSignalsHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.userStates = {};
        this.adminStates = {};
        this.BOT_ADMIN_ID = process.env.BOT_ADMIN_ID ? process.env.BOT_ADMIN_ID.toString() : null;

        // Configuración
        this.VIP_PRICE = 3000;
        this.PROMISED_ROI = 60;
        this.MIN_ROI_FOR_REFUND = 50;
        this.REFUND_AMOUNT = 1500;
        this.SIGNALS_PER_SESSION = 10;
        this.SESSION_TIMES = ['10:00', '22:00'];
        this.REFERRAL_COMMISSION = 0.20; // 20%

        // Estado del sistema
        this.maintenanceMode = false;

        // Inicializar DB y tareas programadas (sin listeners de Telegram)
        this.initDatabase();
        this.startScheduledTasks();

        console.log('📈 TradingSignalsHandler inicializado (sin listeners propios)');
    }

    // ============================================
    // INICIALIZACIÓN
    // ============================================

    async initDatabase() {
        try {
            // Tabla de planes
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

            // Tabla de suscripciones
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
                    referido_por BIGINT,
                    comision_pagada BOOLEAN DEFAULT false,
                    notificado_10d BOOLEAN DEFAULT false,
                    notificado_5d BOOLEAN DEFAULT false,
                    notificado_1d BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de sesiones
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_sesiones',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    admin_id BIGINT NOT NULL,
                    fecha DATE NOT NULL,
                    hora TIME NOT NULL,
                    tipo VARCHAR(20) NOT NULL,
                    señales_totales INTEGER DEFAULT 10,
                    señales_enviadas INTEGER DEFAULT 0,
                    estado VARCHAR(20) DEFAULT 'abierta',
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de señales
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_senales',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    sesion_id INTEGER REFERENCES trading_sesiones(id),
                    activo VARCHAR(20) NOT NULL,
                    temporalidad VARCHAR(10) NOT NULL,
                    direccion VARCHAR(10) NOT NULL,
                    precio_entrada DECIMAL(10,5),
                    take_profit DECIMAL(10,5),
                    stop_loss DECIMAL(10,5),
                    resultado VARCHAR(10),
                    profit_loss DECIMAL(10,2),
                    hora_envio TIMESTAMP DEFAULT NOW(),
                    hora_cierre TIMESTAMP,
                    admin_message_id VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de señales por usuario
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_senales_usuario',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    señal_id INTEGER REFERENCES trading_senales(id),
                    recibida BOOLEAN DEFAULT false,
                    resultado_usuario VARCHAR(10),
                    profit_loss_usuario DECIMAL(10,2),
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de solicitudes VIP
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_solicitudes_vip',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    quotex_id VARCHAR(100) NOT NULL,
                    estado VARCHAR(20) DEFAULT 'pendiente',
                    motivo_rechazo TEXT,
                    admin_id BIGINT,
                    fecha_aprobacion TIMESTAMP,
                    referido_por BIGINT,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de rentabilidad semanal
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_rentabilidad',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    semana DATE NOT NULL,
                    rentabilidad DECIMAL(5,2) NOT NULL,
                    señales_totales INTEGER NOT NULL,
                    señales_ganadas INTEGER NOT NULL,
                    señales_perdidas INTEGER NOT NULL,
                    reembolsos_procesados BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de reembolsos
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_reembolsos',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    semana DATE NOT NULL,
                    monto DECIMAL(10,2) NOT NULL,
                    motivo VARCHAR(100),
                    estado VARCHAR(20) DEFAULT 'pendiente',
                    tx_id VARCHAR(100),
                    procesado_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de referidos
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_referidos',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    usuario_id BIGINT NOT NULL,
                    referido_id BIGINT NOT NULL,
                    suscripcion_id INTEGER REFERENCES trading_suscripciones(id),
                    comision DECIMAL(10,2) NOT NULL,
                    pagada BOOLEAN DEFAULT false,
                    fecha_pago TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de notificaciones
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_notificaciones',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    tipo VARCHAR(50) NOT NULL,
                    mensaje TEXT NOT NULL,
                    leida BOOLEAN DEFAULT false,
                    enviada BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de logs
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_logs',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    tipo VARCHAR(50) NOT NULL,
                    usuario_id BIGINT,
                    accion TEXT NOT NULL,
                    detalles JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Tabla de mantenimiento
            await this.supabase.rpc('create_table_if_not_exists', {
                table_name: 'trading_mantenimiento',
                table_def: `
                    id SERIAL PRIMARY KEY,
                    activo BOOLEAN DEFAULT false,
                    motivo TEXT,
                    inicio TIMESTAMP,
                    fin TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                `
            }).catch(() => {});

            // Plan VIP por defecto
            const { data: existingPlan } = await this.supabase
                .from('trading_planes')
                .select('id')
                .eq('nombre', 'VIP Mensual')
                .maybeSingle();

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

            console.log('✅ Tablas de trading inicializadas');

        } catch (error) {
            console.error('❌ Error inicializando tablas:', error);
        }
    }

    startScheduledTasks() {
        setInterval(() => this.checkRenewals(), 60 * 60 * 1000);
        setInterval(() => this.checkRefunds(), 6 * 60 * 60 * 1000);
        setInterval(() => this.sendPendingNotifications(), 5 * 60 * 1000);
        setInterval(() => this.cleanupOldStates(), 30 * 60 * 1000);
        console.log('✅ Tareas programadas de Trading iniciadas');
    }

    // ============================================
    // MANEJADORES PRINCIPALES (llamados desde handlers centralizados)
    // ============================================

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const userId = String(query.from.id);
        const messageId = query.message.message_id;
        const data = query.data;

        try {
            await this.bot.answerCallbackQuery(query.id);
            await this.logAction(userId, 'callback', { data });

            if (this.esAdmin(userId)) {
                const adminHandled = await this.handleAdminCallback(chatId, messageId, userId, data);
                if (adminHandled) return true;
            }

            const userHandled = await this.handleUserCallback(chatId, messageId, userId, data);
            return userHandled;
        } catch (error) {
            console.error('Error en trading callback:', error);
            await this.logAction(userId, 'callback_error', { error: error.message, data });
            await this.bot.sendMessage(chatId, '❌ Ocurrió un error. Por favor, intenta de nuevo.');
            return true;
        }
    }

    async handleAdminCallback(chatId, messageId, userId, data) {
        const [action, param1, param2, param3] = data.split(':');

        switch (action) {
            case 'trading_admin_menu':
                await this.showAdminMenu(chatId, messageId);
                return true;
            case 'trading_admin_open_session':
                await this.openSession(chatId, messageId);
                return true;
            case 'trading_admin_close_session':
                await this.closeSession(chatId, messageId);
                return true;
            case 'trading_admin_send_signal':
                await this.prepareSignal(chatId, messageId, userId);
                return true;
            case 'trading_admin_view_requests':
                await this.viewVIPRequests(chatId, messageId);
                return true;
            case 'trading_admin_approve_request':
                await this.approveVIPRequest(chatId, messageId, param1);
                return true;
            case 'trading_admin_reject_request':
                await this.rejectVIPRequest(chatId, messageId, param1);
                return true;
            case 'trading_signal_profit':
                await this.markSignalResult(chatId, messageId, param1, 'ganada');
                return true;
            case 'trading_signal_loss':
                await this.markSignalResult(chatId, messageId, param1, 'perdida');
                return true;
            case 'trading_signal_up':
                if (this.adminStates[userId]) {
                    await this.sendSignalToUsers(chatId, messageId, userId, 'alta');
                    return true;
                }
                break;
            case 'trading_signal_down':
                if (this.adminStates[userId]) {
                    await this.sendSignalToUsers(chatId, messageId, userId, 'baja');
                    return true;
                }
                break;
            case 'admin_trading_stats':
                await this.showAdminStatistics(chatId, messageId);
                return true;
            case 'admin_trading_users':
                await this.showVIPUsers(chatId, messageId);
                return true;
            case 'admin_trading_active_signals':
                await this.showAdminActiveSignals(chatId, messageId);
                return true;
            case 'admin_trading_maintenance':
                await this.toggleMaintenance(chatId, messageId);
                return true;
            case 'admin_trading_test_signal':
                await this.testSignal(chatId, messageId, userId);
                return true;
            case 'admin_trading_process_refunds':
                await this.processWeeklyRefunds(chatId, messageId);
                return true;
            case 'admin_trading_view_refunds':
                await this.viewRefunds(chatId, messageId);
                return true;
        }
        return false;
    }

    async handleUserCallback(chatId, messageId, userId, data) {
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
            case 'trading_calendar':
                await this.showCalendar(chatId, messageId, param1);
                return true;
            case 'trading_view_date':
                await this.viewSignalsByDate(chatId, messageId, param1);
                return true;
            case 'trading_referral':
                await this.showReferralInfo(chatId, messageId);
                return true;
            case 'trading_notifications':
                await this.showNotifications(chatId, messageId);
                return true;
        }
        return false;
    }

    async handleMessage(msg) {
        try {
            const chatId = msg.chat.id;
            const userId = String(msg.from.id);
            const text = msg.text;

            // Log de depuración (puedes quitarlo después)
            console.log(`📩 TradingHandler mensaje de ${userId}: "${text}"`);
            console.log(`   esAdmin: ${this.esAdmin(userId)}`);
            console.log(`   adminState existe: ${!!this.adminStates[userId]}`);

            if (this.maintenanceMode && !this.esAdmin(userId)) {
                await this.bot.sendMessage(chatId,
                    '🔧 *SISTEMA EN MANTENIMIENTO*\n\nEl sistema de señales está en mantenimiento.\nPor favor, inténtalo más tarde.',
                    { parse_mode: 'Markdown' }
                );
                return true;
            }

            // Admin enviando señal
            if (this.esAdmin(userId) && this.adminStates[userId]) {
                const state = this.adminStates[userId];
                if (state.step === 'waiting_pair') {
                    return await this.handlePairInput(chatId, userId, text);
                }
                if (state.step === 'waiting_timeframe') {
                    return await this.handleTimeframeInput(chatId, userId, text);
                }
            }

            // Usuario solicitando VIP
            if (this.userStates[userId] && this.userStates[userId].step === 'waiting_quotex_id') {
                return await this.handleQuotexIdInput(chatId, userId, text);
            }

            // Admin en modo test
            if (this.esAdmin(userId) && this.adminStates[userId] && this.adminStates[userId].step === 'test_signal') {
                return await this.handleTestSignal(chatId, userId, text);
            }

            return false;
        } catch (error) {
            console.error('❌ Error en TradingSignalsHandler.handleMessage:', error);
            await this.bot.sendMessage(msg.chat.id, '❌ Ocurrió un error interno. Intenta de nuevo.');
            return true;
        }
    }

    // ============================================
    // FUNCIONES PARA USUARIOS
    // ============================================

    async showTradingMenu(chatId, messageId) {
        const isVIP = await this.isUserVIP(chatId);
        let message = `📈 *SEÑALES DE TRADING PROFESIONAL*\n\n`;
        let keyboard;

        if (isVIP) {
            const subscription = await this.getActiveSubscription(chatId);
            const daysLeft = this.getDaysLeft(subscription.fecha_fin);
            message += `🎖️ *ESTADO: VIP ACTIVO*\n⏳ *Días restantes:* ${daysLeft}\n\n`;

            const { count } = await this.supabase
                .from('trading_notificaciones')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', chatId)
                .eq('leida', false);

            if (count > 0) message += `📬 *Tienes ${count} notificación(es) nueva(s)*\n\n`;
            message += `Selecciona una opción:`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Señales Activas', callback_data: 'trading_signals_active' }, { text: '📈 Mis Señales', callback_data: 'trading_my_signals' }],
                    [{ text: '📋 Historial', callback_data: 'trading_history' }, { text: '📊 Rendimiento', callback_data: 'trading_performance' }],
                    [{ text: '💰 Renovar VIP', callback_data: 'trading_buy_signals' }, { text: '👥 Referidos', callback_data: 'trading_referral' }],
                    [{ text: '🔔 Notificaciones', callback_data: 'trading_notifications' }, { text: '🔙 Menú Principal', callback_data: 'start_back' }]
                ]
            };
        } else {
            message += `🔒 *ACCESO RESTRINGIDO*\n\nPara recibir señales de trading necesitas ser miembro VIP.\n\n` +
                `🎖️ *BENEFICIOS VIP:*\n• 20 señales diarias (10am y 10pm)\n• Rentabilidad prometida: +${this.PROMISED_ROI}% semanal\n` +
                `• Garantía de devolución del 50% si no cumplimos\n• 20% por cada referido que se haga VIP\n\n` +
                `💵 *PRECIO:* ${this.VIP_PRICE} CUP mensual\n\n¿Deseas convertirte en VIP?`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '🎖️ Convertirse en VIP', callback_data: 'trading_request_vip' }, { text: '📋 Ver Historial', callback_data: 'trading_history' }],
                    [{ text: '❓ Cómo Funciona', callback_data: 'trading_how_it_works' }, { text: '📊 Rendimiento', callback_data: 'trading_performance' }],
                    [{ text: '👥 Programa de Referidos', callback_data: 'trading_referral' }, { text: '🔙 Menú Principal', callback_data: 'start_back' }]
                ]
            };
        }

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
        const userId = String(chatId);
        const { data: pendingRequest } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('id')
            .eq('user_id', chatId)
            .eq('estado', 'pendiente')
            .maybeSingle();

        if (pendingRequest) {
            await this.bot.editMessageText(
                '📝 *Ya tienes una solicitud pendiente*\n\nTu solicitud VIP está siendo revisada por el administrador.\nRecibirás una notificación cuando sea aprobada.',
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
            );
            return;
        }

        let referidoPor = null;
        if (this.userStates[userId] && this.userStates[userId].referidoPor) {
            referidoPor = this.userStates[userId].referidoPor;
        }

        this.userStates[userId] = {
            step: 'waiting_quotex_id',
            requestTime: Date.now(),
            referidoPor
        };

        const message = `🎖️ *SOLICITUD DE MEMBRESÍA VIP*\n\n` +
            `Para convertirte en VIP sigue estos pasos:\n\n` +
            `1️⃣ *Crear cuenta en Quotex*\n• Usa este enlace: ${process.env.QUOTEX_REF_LINK || 'https://broker-qx.pro/sign-up/?lid=123456'}\n• Crea una cuenta NUEVA (obligatorio)\n\n` +
            `2️⃣ *Verificar cuenta*\n• Completa el KYC (verificación de identidad)\n• Se permiten cubanos\n\n` +
            `3️⃣ *Hacer depósito*\n• Depósito mínimo: 10 USDT\n• Puedes usar cualquier método\n\n` +
            `4️⃣ *Enviar tu ID de Quotex*\n• Encuentra tu ID en el perfil de Quotex\n• Es un número único\n\nPor favor, escribe tu ID de Quotex:`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Cancelar', callback_data: 'trading_menu' }]] }
        });
    }

    async handleQuotexIdInput(chatId, userId, text) {
        const quotexId = text.trim();
        if (quotexId.length < 3) {
            await this.bot.sendMessage(chatId, '❌ ID inválido. Debe tener al menos 3 caracteres.');
            return true;
        }

        const userState = this.userStates[userId];
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .insert([{
                user_id: chatId,
                quotex_id: quotexId,
                estado: 'pendiente',
                referido_por: userState?.referidoPor || null
            }])
            .select()
            .single();

        await this.notifyAdminNewRequest(chatId, request.id, quotexId);
        await this.bot.sendMessage(chatId,
            `✅ *Solicitud enviada exitosamente*\n\nHemos recibido tu solicitud VIP.\n\n` +
            `🆔 *Tu ID de Quotex:* ${quotexId}\n⏳ *Estado:* En revisión\n\n` +
            `El administrador revisará tu solicitud y te notificará pronto.`,
            { parse_mode: 'Markdown' }
        );

        await this.logAction(chatId, 'vip_request', { request_id: request.id });
        delete this.userStates[userId];
        return true;
    }

    async confirmVIP(chatId, messageId, requestId) {
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name)')
            .eq('id', requestId)
            .single();

        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', { chat_id: chatId, message_id: messageId });
            return;
        }

        const message = `🎖️ *CONFIRMAR COMPRA DE VIP*\n\n` +
            `📋 *Plan:* VIP Mensual\n💰 *Precio:* ${this.VIP_PRICE} CUP\n⏳ *Duración:* 30 días\n\n` +
            `📊 *Beneficios:*\n• 20 señales diarias\n• Rentabilidad +${this.PROMISED_ROI}% semanal\n` +
            `• Garantía de devolución del 50%\n• 20% por referidos\n\n` +
            `El pago se realizará desde tu billetera CUP.\n\n¿Confirmas la compra?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirmar Pago', callback_data: `trading_pay_vip:${requestId}` }, { text: '❌ Cancelar', callback_data: 'trading_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async payVIP(chatId, messageId, requestId) {
        const user = await this.getUser(chatId);
        if (!user) {
            await this.bot.editMessageText('❌ Usuario no encontrado.', { chat_id: chatId, message_id: messageId });
            return;
        }

        if (user.balance_cup < this.VIP_PRICE) {
            await this.bot.editMessageText(
                `❌ *Saldo insuficiente*\n\nNecesitas ${this.VIP_PRICE} CUP\nTu saldo actual: ${user.balance_cup} CUP\n\nPor favor, recarga tu billetera primero.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '💰 Recargar', callback_data: 'recharge_menu' }]] }
                }
            );
            return;
        }

        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, referido_por')
            .eq('id', requestId)
            .single();

        const { data: plan } = await this.supabase
            .from('trading_planes')
            .select('*')
            .eq('nombre', 'VIP Mensual')
            .single();

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
                metodo_pago: 'billetera_cup',
                referido_por: request.referido_por
            }])
            .select()
            .single();

        await this.supabase
            .from('users')
            .update({ balance_cup: user.balance_cup - this.VIP_PRICE })
            .eq('telegram_id', chatId);

        await this.supabase
            .from('trading_solicitudes_vip')
            .update({ estado: 'aprobada', fecha_aprobacion: new Date().toISOString() })
            .eq('id', requestId);

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

        if (request.referido_por) {
            await this.processReferralCommission(request.referido_por, chatId, subscription.id);
        }

        await this.sendWelcomeMessage(chatId, subscription.id);
        this.scheduleRenewalReminders(chatId, subscription.id, fechaFin);

        const message = `🎉 *¡FELICIDADES, ERES VIP!*\n\n` +
            `✅ *Suscripción activada exitosamente*\n\n` +
            `📋 *Detalles:*\n• Plan: ${plan.nombre}\n• Precio: ${this.VIP_PRICE} CUP\n` +
            `• Inicio: ${fechaInicio.toLocaleDateString()}\n• Fin: ${fechaFin.toLocaleDateString()}\n• Días: ${plan.duracion_dias}\n\n` +
            `📬 *Revisa tus notificaciones para más información*`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📈 Ir a Señales', callback_data: 'trading_menu' }]] }
        });

        await this.logAction(chatId, 'vip_purchase', { subscription_id: subscription.id, amount: this.VIP_PRICE });
    }

    // ============================================
    // FUNCIONES PARA ADMIN
    // ============================================

    esAdmin(userId) {
        return userId && this.BOT_ADMIN_ID && String(userId) === String(this.BOT_ADMIN_ID);
    }

    async showAdminMenu(chatId, messageId) {
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .maybeSingle();

        let sessionStatus = '❌ *NO HAY SESIÓN ACTIVA*';
        let sessionButtonText = '📡 Abrir Sesión';
        let sessionCallback = 'trading_admin_open_session';

        if (activeSession) {
            sessionStatus = `✅ *SESIÓN ACTIVA*\n📅 ${new Date(activeSession.fecha).toLocaleDateString()} ${activeSession.hora}\n📊 Señales: ${activeSession.señales_enviadas}/${activeSession.señales_totales}`;
            sessionButtonText = '🔒 Cerrar Sesión';
            sessionCallback = 'trading_admin_close_session';
        }

        const maintenanceStatus = this.maintenanceMode ? '🔧 *MODO MANTENIMIENTO ACTIVO*' : '✅ *SISTEMA OPERATIVO*';
        const maintenanceButton = this.maintenanceMode ? '🔨 Desactivar Mantenimiento' : '🔧 Activar Mantenimiento';

        const message = `👑 *PANEL ADMIN - SEÑALES TRADING*\n\n${sessionStatus}\n\n${maintenanceStatus}\n\nSelecciona una opción:`;

        const keyboard = {
            inline_keyboard: [
                [{ text: sessionButtonText, callback_data: sessionCallback }, { text: '📤 Enviar Señal', callback_data: 'trading_admin_send_signal' }],
                [{ text: '📋 Solicitudes VIP', callback_data: 'trading_admin_view_requests' }, { text: '📊 Estadísticas', callback_data: 'admin_trading_stats' }],
                [{ text: '👥 Usuarios VIP', callback_data: 'admin_trading_users' }, { text: '📈 Señales Activas', callback_data: 'admin_trading_active_signals' }],
                [{ text: maintenanceButton, callback_data: 'admin_trading_maintenance' }, { text: '💰 Reembolsos', callback_data: 'admin_trading_view_refunds' }],
                [{ text: '🧪 Test Señal', callback_data: 'admin_trading_test_signal' }, { text: '🔄 Procesar Reembolsos', callback_data: 'admin_trading_process_refunds' }],
                [{ text: '🔙 Panel Admin', callback_data: 'admin_panel' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async openSession(chatId, messageId) {
        if (this.maintenanceMode) {
            await this.bot.editMessageText('❌ *No se puede abrir sesión en modo mantenimiento*', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }

        const now = new Date();
        const currentHour = now.getHours();

        if (!((currentHour >= 9 && currentHour <= 11) || (currentHour >= 21 && currentHour <= 23))) {
            await this.bot.editMessageText(
                `❌ *Horario no válido para abrir sesión*\n\nSolo se pueden abrir sesiones alrededor de:\n• 10:00 AM (9:00 - 11:00 AM)\n• 10:00 PM (9:00 - 11:00 PM)\n\nHora actual: ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
            );
            return;
        }

        const day = now.getDay();
        if (day === 0 || day === 6) {
            await this.bot.editMessageText('❌ *No se pueden abrir sesiones los fines de semana*', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }

        let tipo = currentHour < 12 ? 'matutina' : 'vespertina';
        const today = now.toISOString().split('T')[0];

        const { data: existingSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('fecha', today)
            .eq('tipo', tipo)
            .maybeSingle();

        if (existingSession) {
            await this.bot.editMessageText(`❌ *Ya existe una sesión ${tipo} hoy*`, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }

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

        const vipUsers = await this.getVIPUsers();
        let notifiedCount = 0;

        for (const user of vipUsers) {
            try {
                await this.bot.sendMessage(user.user_id,
                    `📢 *¡NUEVA SESIÓN DE TRADING ABIERTA!*\n\n📅 *Fecha:* ${new Date().toLocaleDateString()}\n` +
                    `🕙 *Hora:* ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
                    `📊 *Tipo:* Sesión ${tipo}\n📡 *Señales:* ${this.SIGNALS_PER_SESSION} señales programadas\n\n🔔 *Prepárate para recibir señales*`,
                    { parse_mode: 'Markdown' }
                );
                notifiedCount++;
            } catch (error) {
                console.log(`No se pudo notificar al usuario ${user.user_id}:`, error.message);
            }
        }

        const message = `✅ *SESIÓN ABIERTA EXITOSAMENTE*\n\n📅 *Fecha:* ${today}\n` +
            `🕙 *Hora:* ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n📊 *Tipo:* ${tipo}\n` +
            `📡 *Señales:* ${this.SIGNALS_PER_SESSION} señales programadas\n👥 *Usuarios notificados:* ${notifiedCount}/${vipUsers.length}\n\nAhora puedes enviar señales.`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📤 Enviar Primera Señal', callback_data: 'trading_admin_send_signal' }]] }
        });

        await this.logAction(chatId, 'session_opened', { session_id: session.id, tipo, users_notified: notifiedCount });
    }

    async prepareSignal(chatId, messageId, userId) {
        console.log(`🔧 prepareSignal llamado por userId ${userId}`);

        if (this.maintenanceMode) {
            await this.bot.editMessageText('❌ *No se puede enviar señales en modo mantenimiento*', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
            });
            return;
        }

        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .maybeSingle();

        if (!activeSession) {
            await this.bot.editMessageText('❌ *No hay sesión activa*\n\nDebes abrir una sesión primero.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '📡 Abrir Sesión', callback_data: 'trading_admin_open_session' }]] }
            });
            return;
        }

        if (activeSession.señales_enviadas >= activeSession.señales_totales) {
            await this.bot.editMessageText(
                `❌ *Límite de señales alcanzado*\n\nYa se enviaron ${activeSession.señales_enviadas}/${activeSession.señales_totales} señales.\nPuedes cerrar la sesión.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }]] }
                }
            );
            return;
        }

        // Guardar estado usando userId como string
        this.adminStates[userId] = {
            step: 'waiting_pair',
            sessionId: activeSession.id,
            signalNumber: activeSession.señales_enviadas + 1,
            requestTime: Date.now()
        };

        console.log(`✅ Estado creado para ${userId}:`, this.adminStates[userId]);

        const message = `📤 *PREPARANDO SEÑAL #${activeSession.señales_enviadas + 1}*\n\n` +
            `Por favor, escribe el par de divisas:\n\n📌 *Ejemplos:*\n• EUR/USD\n• GBP/JPY\n• XAU/USD\n• BTC/USD\n\nEscribe el par ahora:`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'trading_admin_menu' }]] }
        });
    }

    async handlePairInput(chatId, userId, text) {
        console.log(`🔧 handlePairInput llamado con text="${text}"`);

        const pair = text.trim().toUpperCase();
        const validPairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD',
            'NZD/USD', 'GBP/JPY', 'EUR/GBP', 'XAU/USD', 'BTC/USD'];

        if (!pair.includes('/') || pair.length < 6) {
            await this.bot.sendMessage(chatId,
                `❌ *Formato inválido*\n\nEl par debe tener formato: XXX/XXX\n\nEjemplos válidos:\n• EUR/USD\n• GBP/JPY\n• XAU/USD\n\nInténtalo de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        if (!this.adminStates[userId]) {
            await this.bot.sendMessage(chatId, '❌ Sesión expirada. Por favor, reinicia el proceso.');
            return true;
        }

        this.adminStates[userId].step = 'waiting_timeframe';
        this.adminStates[userId].pair = pair;
        this.adminStates[userId].requestTime = Date.now();

        await this.bot.sendMessage(chatId,
            `✅ *Par aceptado:* ${pair}\n\nAhora escribe la temporalidad:\n\n📌 *Ejemplos:*\n• 1min\n• 5min\n• 15min\n• 1h\n• 4h\n\nEscribe la temporalidad ahora:`,
            { parse_mode: 'Markdown' }
        );
        return true;
    }

    async handleTimeframeInput(chatId, userId, text) {
        const timeframe = text.trim().toLowerCase();
        const validTimeframes = ['1min', '5min', '15min', '30min', '1h', '4h'];

        if (!validTimeframes.includes(timeframe)) {
            await this.bot.sendMessage(chatId,
                `❌ *Temporalidad no válida*\n\nUsa una de estas opciones:\n• 1min\n• 5min\n• 15min\n• 30min\n• 1h\n• 4h\n\nInténtalo de nuevo:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        if (!this.adminStates[userId]) {
            await this.bot.sendMessage(chatId, '❌ Sesión expirada. Por favor, reinicia el proceso.');
            return true;
        }

        this.adminStates[userId].step = 'waiting_direction';
        this.adminStates[userId].timeframe = timeframe;

        const message = `✅ *Configuración lista:*\n\n📊 *Activo:* ${this.adminStates[userId].pair}\n⏰ *Temporalidad:* ${timeframe}\n🔢 *Señal #:* ${this.adminStates[userId].signalNumber}\n\nSelecciona la dirección de la señal:`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '⬆️ COMPRA (ALTA)', callback_data: 'trading_signal_up' }, { text: '⬇️ VENTA (BAJA)', callback_data: 'trading_signal_down' }],
                [{ text: '❌ Cancelar', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        return true;
    }

    async sendSignalToUsers(chatId, messageId, userId, direction) {
        const state = this.adminStates[userId];
        if (!state) {
            await this.bot.sendMessage(chatId, '❌ Estado no encontrado. Reinicia el proceso.');
            return;
        }

        const { pair, timeframe, sessionId, signalNumber } = state;

        const { data: session } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (!session) {
            await this.bot.editMessageText('❌ Sesión no encontrada.', { chat_id: chatId, message_id: messageId });
            delete this.adminStates[userId];
            return;
        }

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

        await this.supabase
            .from('trading_sesiones')
            .update({ señales_enviadas: session.señales_enviadas + 1 })
            .eq('id', sessionId);

        const vipUsers = await this.getVIPUsers();
        const userMessage = `🚨 *¡NUEVA SEÑAL DE TRADING!*\n\n` +
            `🎯 *Activo:* ${pair}\n⏰ *Temporalidad:* ${timeframe}\n📈 *Dirección:* ${direction === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `🔢 *Señal #:* ${signalNumber}\n📅 *Hora:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            `⚡ *¡ACTÚA RÁPIDO!*\nEsta es una señal para opciones binarias.`;

        let sentCount = 0, failedCount = 0;
        for (const user of vipUsers) {
            try {
                const msg = await this.bot.sendMessage(user.user_id, userMessage, { parse_mode: 'Markdown' });
                await this.supabase
                    .from('trading_senales_usuario')
                    .insert([{ user_id: user.user_id, señal_id: signal.id, recibida: true }]);
                sentCount++;
            } catch (error) {
                console.log(`Error enviando a ${user.user_id}:`, error.message);
                failedCount++;
                await this.logAction(user.user_id, 'signal_delivery_failed', { signal_id: signal.id, error: error.message });
            }
        }

        const adminMessage = `✅ *SEÑAL ENVIADA EXITOSAMENTE*\n\n` +
            `📊 *Activo:* ${pair}\n⏰ *Temporalidad:* ${timeframe}\n📈 *Dirección:* ${direction === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `🔢 *Señal #:* ${signalNumber}\n📅 *Hora:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
            `👥 *Enviada a:* ${sentCount} usuarios\n❌ *Fallos:* ${failedCount}\n\nMarca el resultado de esta señal:`;

        const adminKeyboard = {
            inline_keyboard: [
                [{ text: '✅ Profit', callback_data: `trading_signal_profit:${signal.id}` }, { text: '❌ Pérdida', callback_data: `trading_signal_loss:${signal.id}` }],
                [{ text: '📤 Enviar Otra Señal', callback_data: 'trading_admin_send_signal' }, { text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }]
            ]
        };

        const adminMsg = await this.bot.sendMessage(chatId, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: adminKeyboard
        });

        await this.supabase
            .from('trading_senales')
            .update({ admin_message_id: adminMsg.message_id })
            .eq('id', signal.id);

        delete this.adminStates[userId];
        await this.logAction(chatId, 'signal_sent', { signal_id: signal.id, sent: sentCount, failed: failedCount });

        if (messageId) {
            try { await this.bot.deleteMessage(chatId, messageId); } catch (e) { }
        }
    }

    // ============================================
    // NUEVAS FUNCIONALIDADES
    // ============================================

    async processReferralCommission(referrerId, referredId, subscriptionId) {
        try {
            const commission = this.VIP_PRICE * this.REFERRAL_COMMISSION;
            await this.supabase
                .from('trading_referidos')
                .insert([{
                    usuario_id: referrerId,
                    referido_id: referredId,
                    suscripcion_id: subscriptionId,
                    comision: commission,
                    pagada: false
                }]);

            const referrer = await this.getUser(referrerId);
            if (referrer) {
                await this.supabase
                    .from('users')
                    .update({ balance_cup: (referrer.balance_cup || 0) + commission })
                    .eq('telegram_id', referrerId);

                await this.supabase
                    .from('transactions')
                    .insert([{
                        user_id: referrerId,
                        type: 'REFERRAL_COMMISSION',
                        currency: 'cup',
                        amount: commission,
                        status: 'completed',
                        description: `Comisión por referido ${referredId}`,
                        created_at: new Date().toISOString()
                    }]);

                await this.bot.sendMessage(referrerId,
                    `💰 *¡COMISIÓN POR REFERIDO!*\n\nHas recibido ${commission} CUP por referir a un nuevo usuario VIP.\n\n` +
                    `👤 *Referido:* ${referredId}\n💰 *Comisión:* ${commission} CUP\n\n¡Sigue compartiendo tu enlace de referido!`,
                    { parse_mode: 'Markdown' }
                );
            }
            await this.logAction(referrerId, 'referral_commission', { referred_id: referredId, commission });
        } catch (error) {
            console.error('Error procesando comisión de referido:', error);
            await this.logAction(referrerId, 'referral_error', { error: error.message });
        }
    }

    async showReferralInfo(chatId, messageId) {
        const { data: referrals } = await this.supabase
            .from('trading_referidos')
            .select('*')
            .eq('usuario_id', chatId);

        const { data: totalCommissions } = await this.supabase
            .from('trading_referidos')
            .select('comision')
            .eq('usuario_id', chatId)
            .eq('pagada', true);

        const total = totalCommissions?.reduce((sum, r) => sum + r.comision, 0) || 0;
        const referralLink = `https://t.me/${(await this.bot.getMe()).username}?start=ref_${chatId}`;

        const message = `👥 *PROGRAMA DE REFERIDOS*\n\n` +
            `🎯 *Gana el 20% por cada referido* que se haga VIP\n\n📊 *Tus estadísticas:*\n` +
            `• Referidos totales: ${referrals?.length || 0}\n• Comisiones ganadas: ${total} CUP\n` +
            `• Comisiones pendientes: ${referrals?.filter(r => !r.pagada).length || 0}\n\n🔗 *Tu enlace de referido:*\n${referralLink}\n\n` +
            `📌 *Cómo funciona:*\n1. Comparte tu enlace\n2. Alguien se registra con tu enlace\n3. Se hace VIP\n4. Recibes ${this.VIP_PRICE * this.REFERRAL_COMMISSION} CUP automáticamente\n\n¡Entre más refieras, más ganas!`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📋 Ver Mis Referidos', callback_data: 'trading_my_referrals' }, { text: '📤 Compartir Enlace', callback_data: `share_referral:${chatId}` }],
                [{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async sendWelcomeMessage(userId, subscriptionId) {
        const message = `🎉 *¡BIENVENIDO AL CLUB VIP!*\n\n` +
            `Gracias por confiar en nuestras señales de trading.\n\n📋 *INFORMACIÓN IMPORTANTE:*\n\n` +
            `🕙 *Horario de señales:*\n• 10:00 AM - Sesión matutina (10 señales)\n• 10:00 PM - Sesión vespertina (10 señales)\n• No hay señales fines de semana\n\n` +
            `📊 *Rentabilidad prometida:*\n• Mínimo +${this.PROMISED_ROI}% semanal\n• Si baja del ${this.MIN_ROI_FOR_REFUND}%, reembolso del 50%\n\n` +
            `💎 *Garantía:*\n• Revisamos la rentabilidad cada semana\n• Si no cumplimos, reembolso automático de ${this.REFUND_AMOUNT} CUP\n• Se deposita en tu billetera Cromwell\n\n` +
            `👥 *Referidos:*\n• Gana el 20% (${this.VIP_PRICE * this.REFERRAL_COMMISSION} CUP)\n• Por cada amigo que invites y se haga VIP\n\n` +
            `🔔 *Recordatorios:*\n• Recibirás avisos a 10, 5 y 1 día antes del vencimiento\n\n📞 *Soporte:*\nSi tienes dudas, contacta al administrador.\n\n¡Buena suerte en tus trades! 🚀`;

        await this.bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
        await this.supabase
            .from('trading_notificaciones')
            .insert([{
                user_id: userId,
                tipo: 'bienvenida',
                mensaje: 'Guía de bienvenida VIP - Revisa esta información importante',
                leida: false
            }]);
    }

    async checkRefunds() {
        try {
            const { data: weeks } = await this.supabase
                .from('trading_rentabilidad')
                .select('*')
                .lt('rentabilidad', this.MIN_ROI_FOR_REFUND)
                .eq('reembolsos_procesados', false)
                .order('semana', { ascending: false });

            if (!weeks || weeks.length === 0) return;

            for (const week of weeks) {
                const monday = new Date(week.semana);
                const nextMonday = new Date(monday);
                nextMonday.setDate(nextMonday.getDate() + 7);

                const { data: activeSubscriptions } = await this.supabase
                    .from('trading_suscripciones')
                    .select('user_id')
                    .eq('estado', 'activa')
                    .lte('fecha_inicio', nextMonday.toISOString())
                    .gte('fecha_fin', monday.toISOString());

                if (!activeSubscriptions) continue;

                for (const sub of activeSubscriptions) {
                    const { data: existingRefund } = await this.supabase
                        .from('trading_reembolsos')
                        .select('id')
                        .eq('user_id', sub.user_id)
                        .eq('semana', week.semana)
                        .maybeSingle();

                    if (existingRefund) continue;

                    await this.supabase
                        .from('trading_reembolsos')
                        .insert([{
                            user_id: sub.user_id,
                            semana: week.semana,
                            monto: this.REFUND_AMOUNT,
                            motivo: `Rentabilidad semanal del ${week.rentabilidad}% menor al ${this.MIN_ROI_FOR_REFUND}% prometido`,
                            estado: 'pendiente'
                        }]);
                }

                await this.supabase
                    .from('trading_rentabilidad')
                    .update({ reembolsos_procesados: true })
                    .eq('id', week.id);
            }
            console.log('✅ Reembolsos verificados');
        } catch (error) {
            console.error('Error verificando reembolsos:', error);
        }
    }

    async processWeeklyRefunds(chatId, messageId) {
        try {
            const { data: pendingRefunds } = await this.supabase
                .from('trading_reembolsos')
                .select('*, users!inner(first_name, balance_cup)')
                .eq('estado', 'pendiente')
                .order('created_at', { ascending: true });

            if (!pendingRefunds || pendingRefunds.length === 0) {
                await this.bot.editMessageText('✅ *No hay reembolsos pendientes*', {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                });
                return;
            }

            let processed = 0, failed = 0;
            for (const refund of pendingRefunds) {
                try {
                    const newBalance = (refund.users.balance_cup || 0) + refund.monto;
                    await this.supabase
                        .from('users')
                        .update({ balance_cup: newBalance })
                        .eq('telegram_id', refund.user_id);

                    await this.supabase
                        .from('transactions')
                        .insert([{
                            user_id: refund.user_id,
                            type: 'TRADING_REFUND',
                            currency: 'cup',
                            amount: refund.monto,
                            status: 'completed',
                            description: `Reembolso garantía trading - Semana ${refund.semana}`,
                            created_at: new Date().toISOString()
                        }]);

                    await this.supabase
                        .from('trading_reembolsos')
                        .update({
                            estado: 'completado',
                            procesado_at: new Date().toISOString(),
                            tx_id: `REF-${Date.now()}-${refund.user_id}`
                        })
                        .eq('id', refund.id);

                    await this.bot.sendMessage(refund.user_id,
                        `💰 *¡REEMBOLSO PROCESADO!*\n\nHemos procesado tu reembolso por garantía.\n\n` +
                        `📅 *Semana:* ${new Date(refund.semana).toLocaleDateString()}\n💰 *Monto:* ${refund.monto} CUP\n` +
                        `📊 *Motivo:* ${refund.motivo}\n\nEl dinero ha sido depositado en tu billetera Cromwell.`,
                        { parse_mode: 'Markdown' }
                    );
                    processed++;
                } catch (error) {
                    console.error(`Error procesando reembolso ${refund.id}:`, error);
                    failed++;
                }
            }

            const message = `✅ *REEMBOLSOS PROCESADOS*\n\n📊 *Resultados:*\n✅ Completados: ${processed}\n❌ Fallados: ${failed}\n📋 Total: ${pendingRefunds.length}\n\nLos usuarios han sido notificados y el dinero depositado en sus billeteras.`;
            await this.bot.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            await this.logAction(chatId, 'refunds_processed', { processed, failed, total: pendingRefunds.length });
        } catch (error) {
            console.error('Error procesando reembolsos:', error);
            await this.bot.editMessageText('❌ *Error procesando reembolsos*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }
    }

    async toggleMaintenance(chatId, messageId) {
        this.maintenanceMode = !this.maintenanceMode;
        await this.supabase
            .from('trading_mantenimiento')
            .insert([{
                activo: this.maintenanceMode,
                motivo: this.maintenanceMode ? 'Activado por admin' : 'Desactivado por admin',
                inicio: this.maintenanceMode ? new Date().toISOString() : null,
                fin: !this.maintenanceMode ? new Date().toISOString() : null
            }]);

        const status = this.maintenanceMode ? 'ACTIVADO' : 'DESACTIVADO';
        let finalMessage = `🔧 *MODO MANTENIMIENTO ${status}*\n\n`;
        if (this.maintenanceMode) {
            finalMessage += `⚠️ *El sistema está ahora en mantenimiento*\n\nLos usuarios no podrán:\n• Ver señales activas\n• Solicitar VIP\n• Ver historial\n\nSolo el administrador puede operar.`;
        } else {
            finalMessage += `✅ *El sistema está ahora operativo*\n\nTodos los servicios han sido restaurados.`;
        }

        await this.bot.editMessageText(finalMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]] }
        });

        await this.logAction(chatId, 'maintenance_toggle', { mode: this.maintenanceMode ? 'on' : 'off' });
    }

    async testSignal(chatId, messageId, userId) {
        this.adminStates[userId] = {
            step: 'test_signal',
            testMode: true,
            requestTime: Date.now()
        };

        const message = `🧪 *MODO TEST DE SEÑAL*\n\n` +
            `Este modo te permite probar el formato de una señal sin enviarla a los usuarios.\n\n` +
            `Escribe el par y temporalidad en formato:\n\`PAR TEMPORALIDAD\`\n\n📌 *Ejemplo:*\n\`EUR/USD 5min\`\n\nEscribe ahora:`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'trading_admin_menu' }]] }
        });
    }

    async handleTestSignal(chatId, userId, text) {
        const parts = text.trim().split(' ');
        if (parts.length !== 2) {
            await this.bot.sendMessage(chatId,
                '❌ *Formato incorrecto*\n\nUsa: `PAR TEMPORALIDAD`\n\nEjemplo: `EUR/USD 5min`\n\nIntenta de nuevo:',
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        const [pair, timeframe] = parts;
        const pairUpper = pair.toUpperCase();
        const timeframeLower = timeframe.toLowerCase();

        if (!pairUpper.includes('/')) {
            await this.bot.sendMessage(chatId, '❌ Formato de par inválido');
            return true;
        }

        const validTimeframes = ['1min', '5min', '15min', '30min', '1h', '4h'];
        if (!validTimeframes.includes(timeframeLower)) {
            await this.bot.sendMessage(chatId, '❌ Temporalidad no válida');
            return true;
        }

        const preview = `🔍 *VISTA PREVIA DE SEÑAL*\n\n🎯 *Activo:* ${pairUpper}\n⏰ *Temporalidad:* ${timeframeLower}\n\n` +
            `📋 *Formato que verán los usuarios:*\n\n🚨 *¡NUEVA SEÑAL DE TRADING!*\n\n` +
            `🎯 *Activo:* ${pairUpper}\n⏰ *Temporalidad:* ${timeframeLower}\n📈 *Dirección:* [COMPRA/VENTA]\n` +
            `🔢 *Señal #:* [NÚMERO]\n📅 *Hora:* [HORA ACTUAL]\n\n⚡ *¡ACTÚA RÁPIDO!*\nEsta es una señal para opciones binarias.`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Continuar con esta señal', callback_data: 'trading_admin_send_signal' }, { text: '🔄 Probar otra', callback_data: 'admin_trading_test_signal' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.sendMessage(chatId, preview, { parse_mode: 'Markdown', reply_markup: keyboard });

        this.adminStates[userId] = {
            step: 'waiting_direction',
            pair: pairUpper,
            timeframe: timeframeLower,
            sessionId: null,
            signalNumber: 1,
            testMode: true,
            requestTime: Date.now()
        };
        return true;
    }

    async showAdminStatistics(chatId, messageId) {
        try {
            const totalVIPs = await this.getVIPUsersCount();
            const totalRevenue = await this.getTotalRevenue();
            const weeklyROI = await this.getCurrentWeeklyROI();
            const successRate = await this.getSuccessRate();
            const pendingRefunds = await this.getPendingRefundsCount();
            const upcomingRenewals = await this.getUpcomingRenewalsCount();

            const monday = this.getCurrentWeekMonday();
            const { data: weeklySignals } = await this.supabase
                .from('trading_senales')
                .select('resultado')
                .gte('created_at', monday.toISOString());

            const weeklyWon = weeklySignals?.filter(s => s.resultado === 'ganada').length || 0;
            const weeklyLost = weeklySignals?.filter(s => s.resultado === 'perdida').length || 0;
            const weeklyPending = weeklySignals?.filter(s => !s.resultado).length || 0;

            const message = `📊 *ESTADÍSTICAS DEL SISTEMA*\n\n` +
                `👥 *Usuarios VIP:* ${totalVIPs}\n💰 *Ingresos totales:* ${totalRevenue} CUP\n` +
                `📈 *Rentabilidad esta semana:* ${weeklyROI}%\n🎯 *Tasa de éxito:* ${successRate}%\n\n` +
                `📋 *Señales esta semana:*\n✅ Ganadas: ${weeklyWon}\n❌ Perdidas: ${weeklyLost}\n⏳ Pendientes: ${weeklyPending}\n\n` +
                `💰 *Reembolsos pendientes:* ${pendingRefunds}\n🔄 *Renovaciones próximas (7 días):* ${upcomingRenewals}\n\n` +
                `🔧 *Estado del sistema:* ${this.maintenanceMode ? '🛑 MANTENIMIENTO' : '✅ OPERATIVO'}\n` +
                `📅 *Actualizado:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Actualizar', callback_data: 'admin_trading_stats' }, { text: '📊 Detalles', callback_data: 'admin_trading_detailed_stats' }],
                    [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
                ]
            };

            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } catch (error) {
            console.error('Error mostrando estadísticas:', error);
            await this.bot.editMessageText('❌ *Error obteniendo estadísticas*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }
    }

    async showVIPUsers(chatId, messageId) {
        const { data: subscriptions } = await this.supabase
            .from('trading_suscripciones')
            .select('*, users!inner(first_name, username, phone_number)')
            .eq('estado', 'activa')
            .gte('fecha_fin', new Date().toISOString())
            .order('fecha_fin', { ascending: true });

        let message = `👥 *USUARIOS VIP ACTIVOS*\n\n`;
        if (!subscriptions || subscriptions.length === 0) {
            message += `📭 *No hay usuarios VIP activos*`;
        } else {
            message += `📋 *Total:* ${subscriptions.length} usuarios\n\n`;
            subscriptions.slice(0, 10).forEach((sub, index) => {
                const daysLeft = this.getDaysLeft(sub.fecha_fin);
                const username = sub.users.username ? `@${sub.users.username}` : 'Sin usuario';
                message += `${index + 1}. *${sub.users.first_name}*\n   📱 ${username}\n   🆔 ${sub.user_id}\n   ⏳ ${daysLeft} días restantes\n   📅 Vence: ${new Date(sub.fecha_fin).toLocaleDateString()}\n   ---\n`;
            });
            if (subscriptions.length > 10) message += `\n... y ${subscriptions.length - 10} más`;
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '📋 Exportar Lista', callback_data: 'admin_trading_export_users' }, { text: '🔄 Actualizar', callback_data: 'admin_trading_users' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    // ============================================
    // FUNCIONES DE UTILIDAD
    // ============================================

    async getUser(telegramId) {
        const { data } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();
        return data;
    }

    async isUserVIP(userId) {
        const { data: subscription } = await this.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', userId)
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString())
            .maybeSingle();
        return !!subscription;
    }

    async getActiveSubscription(userId) {
        const { data: subscription } = await this.supabase
            .from('trading_suscripciones')
            .select('*')
            .eq('user_id', userId)
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString())
            .maybeSingle();
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

    async getVIPUsersCount() {
        const { count } = await this.supabase
            .from('trading_suscripciones')
            .select('*', { count: 'exact', head: true })
            .eq('estado', 'activa')
            .gt('fecha_fin', new Date().toISOString());
        return count || 0;
    }

    async getTotalRevenue() {
        const { data: transactions } = await this.supabase
            .from('transactions')
            .select('amount')
            .eq('type', 'TRADING_SUSCRIPTION')
            .eq('status', 'completed');
        if (!transactions) return 0;
        return Math.abs(transactions.reduce((sum, t) => sum + (t.amount || 0), 0));
    }

    async getCurrentWeeklyROI() {
        const monday = this.getCurrentWeekMonday();
        const { data: week } = await this.supabase
            .from('trading_rentabilidad')
            .select('rentabilidad')
            .eq('semana', monday.toISOString().split('T')[0])
            .maybeSingle();
        return week?.rentabilidad || 0;
    }

    async getSuccessRate() {
        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('resultado')
            .not('resultado', 'is', null);
        if (!signals || signals.length === 0) return 0;
        const won = signals.filter(s => s.resultado === 'ganada').length;
        return ((won / signals.length) * 100).toFixed(2);
    }

    async getPendingRefundsCount() {
        const { count } = await this.supabase
            .from('trading_reembolsos')
            .select('*', { count: 'exact', head: true })
            .eq('estado', 'pendiente');
        return count || 0;
    }

    async getUpcomingRenewalsCount() {
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        const { count } = await this.supabase
            .from('trading_suscripciones')
            .select('*', { count: 'exact', head: true })
            .eq('estado', 'activa')
            .lte('fecha_fin', weekFromNow.toISOString())
            .gte('fecha_fin', new Date().toISOString());
        return count || 0;
    }

    getDaysLeft(endDate) {
        const end = new Date(endDate);
        const now = new Date();
        const diffTime = end - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    }

    getCurrentWeekMonday() {
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? 6 : day - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - diff);
        monday.setHours(0, 0, 0, 0);
        return monday;
    }

    async checkRenewals() {
        try {
            const now = new Date();
            for (const days of [10, 5, 1]) {
                const targetDate = new Date(now);
                targetDate.setDate(targetDate.getDate() + days);
                const { data: expiringSubs } = await this.supabase
                    .from('trading_suscripciones')
                    .select('*, users!inner(first_name)')
                    .eq('estado', 'activa')
                    .eq(`notificado_${days}d`, false)
                    .gte('fecha_fin', targetDate.toISOString())
                    .lt('fecha_fin', new Date(targetDate.getTime() + 24 * 60 * 60 * 1000).toISOString());

                if (!expiringSubs) continue;
                for (const sub of expiringSubs) {
                    await this.bot.sendMessage(sub.user_id,
                        `⚠️ *RENOVACIÓN DE SUSCRIPCIÓN*\n\nTu suscripción VIP vencerá en *${days} día${days !== 1 ? 's' : ''}*.\n\n` +
                        `📅 *Fecha de vencimiento:* ${new Date(sub.fecha_fin).toLocaleDateString()}\n💰 *Precio de renovación:* ${this.VIP_PRICE} CUP\n\n` +
                        `Para renovar:\n1. Ve al menú de Trading\n2. Selecciona "Renovar VIP"\n3. Confirma el pago\n\n¡No pierdas el acceso a las señales!`,
                        { parse_mode: 'Markdown' }
                    );
                    await this.supabase
                        .from('trading_suscripciones')
                        .update({ [`notificado_${days}d`]: true })
                        .eq('id', sub.id);
                }
            }

            const { data: expiredSubs } = await this.supabase
                .from('trading_suscripciones')
                .select('*')
                .eq('estado', 'activa')
                .lt('fecha_fin', now.toISOString());

            if (expiredSubs) {
                for (const sub of expiredSubs) {
                    await this.supabase
                        .from('trading_suscripciones')
                        .update({ estado: 'expirada' })
                        .eq('id', sub.id);
                    await this.bot.sendMessage(sub.user_id,
                        `❌ *SUSCRIPCIÓN VENCIDA*\n\nTu suscripción VIP ha vencido.\n\n` +
                        `📅 *Fecha de vencimiento:* ${new Date(sub.fecha_fin).toLocaleDateString()}\n\n` +
                        `Para renovar tu acceso a las señales:\n1. Ve al menú de Trading\n2. Selecciona "Renovar VIP"\n3. Confirma el pago de ${this.VIP_PRICE} CUP\n\n¡Te extrañaremos en las sesiones!`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        } catch (error) {
            console.error('Error verificando renovaciones:', error);
        }
    }

    scheduleRenewalReminders(userId, subscriptionId, endDate) {
        console.log(`Recordatorios programados para usuario ${userId}`);
    }

    async sendPendingNotifications() {
        try {
            const { data: notifications } = await this.supabase
                .from('trading_notificaciones')
                .select('*')
                .eq('enviada', false)
                .order('created_at', { ascending: true })
                .limit(10);

            if (!notifications) return;
            for (const notification of notifications) {
                try {
                    await this.bot.sendMessage(notification.user_id,
                        `🔔 *NOTIFICACIÓN*\n\n${notification.mensaje}`,
                        { parse_mode: 'Markdown' }
                    );
                    await this.supabase
                        .from('trading_notificaciones')
                        .update({ enviada: true, leida: true })
                        .eq('id', notification.id);
                } catch (error) {
                    console.log(`Error enviando notificación ${notification.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Error enviando notificaciones:', error);
        }
    }

    async logAction(userId, action, details = {}) {
        try {
            await this.supabase
                .from('trading_logs')
                .insert([{
                    tipo: action,
                    usuario_id: userId,
                    accion: action,
                    detalles: details,
                    created_at: new Date().toISOString()
                }]);
        } catch (error) {
            console.error('Error registrando log:', error);
        }
    }

    async notifyAdminNewRequest(userId, requestId, quotexId) {
        const user = await this.getUser(userId);
        const message = `🎖️ *NUEVA SOLICITUD VIP*\n\n` +
            `👤 *Usuario:* ${user?.first_name || 'Desconocido'}\n🆔 *Telegram ID:* ${userId}\n` +
            `📱 *Username:* @${user?.username || 'N/A'}\n🆔 *Quotex ID:* ${quotexId}\n\n` +
            `📅 *Fecha:* ${new Date().toLocaleString()}\n\n¿Aprobar solicitud?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Aprobar', callback_data: `trading_admin_approve_request:${requestId}` }, { text: '❌ Rechazar', callback_data: `trading_admin_reject_request:${requestId}` }],
                [{ text: '📋 Ver Todas', callback_data: 'trading_admin_view_requests' }]
            ]
        };
        await this.bot.sendMessage(this.BOT_ADMIN_ID, message, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

    async approveVIPRequest(chatId, messageId, requestId) {
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username)')
            .eq('id', requestId)
            .single();

        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', { chat_id: chatId, message_id: messageId });
            return;
        }

        await this.supabase
            .from('trading_solicitudes_vip')
            .update({ estado: 'aprobada', admin_id: chatId, fecha_aprobacion: new Date().toISOString() })
            .eq('id', requestId);

        try {
            await this.bot.sendMessage(request.user_id,
                `🎉 *¡SOLICITUD VIP APROBADA!*\n\nTu solicitud para ser miembro VIP ha sido aprobada.\n\n` +
                `🆔 *Tu ID de Quotex:* ${request.quotex_id}\n✅ *Estado:* Aprobado\n\n` +
                `Ahora puedes comprar tu suscripción VIP desde el menú de Trading.\nPrecio: ${this.VIP_PRICE} CUP\n\n¡Te esperamos en las sesiones!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log(`No se pudo notificar al usuario ${request.user_id}`);
        }

        const message = `✅ *SOLICITUD APROBADA*\n\nLa solicitud VIP ha sido aprobada.\n\n` +
            `👤 Usuario: ${request.users.first_name}\n🆔 Telegram: ${request.user_id}\n🆔 Quotex: ${request.quotex_id}\n\nEl usuario ha sido notificado.`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📋 Ver Más', callback_data: 'trading_admin_view_requests' }]] }
        });

        await this.logAction(chatId, 'vip_request_approved', { request_id: requestId });
    }

    async rejectVIPRequest(chatId, messageId, requestId) {
        const { data: request } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username)')
            .eq('id', requestId)
            .single();

        if (!request) {
            await this.bot.editMessageText('❌ Solicitud no encontrada.', { chat_id: chatId, message_id: messageId });
            return;
        }

        await this.supabase
            .from('trading_solicitudes_vip')
            .update({ estado: 'rechazada', admin_id: chatId, motivo_rechazo: 'Rechazada por el administrador' })
            .eq('id', requestId);

        try {
            await this.bot.sendMessage(request.user_id,
                `❌ *SOLICITUD VIP RECHAZADA*\n\nTu solicitud VIP ha sido rechazada.\n\n` +
                `🆔 *Tu ID de Quotex:* ${request.quotex_id}\n❌ *Estado:* Rechazado\n\nMotivo: Revisión administrativa\n\n` +
                `Si crees que es un error, contacta al administrador.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log(`No se pudo notificar al usuario ${request.user_id}`);
        }

        const message = `❌ *SOLICITUD RECHAZADA*\n\nLa solicitud VIP ha sido rechazada.\n\n` +
            `👤 Usuario: ${request.users.first_name}\n🆔 Telegram: ${request.user_id}\n🆔 Quotex: ${request.quotex_id}\n\nEl usuario ha sido notificado.`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📋 Ver Más', callback_data: 'trading_admin_view_requests' }]] }
        });

        await this.logAction(chatId, 'vip_request_rejected', { request_id: requestId });
    }

    async viewVIPRequests(chatId, messageId) {
        const { data: requests } = await this.supabase
            .from('trading_solicitudes_vip')
            .select('*, users!inner(first_name, username)')
            .eq('estado', 'pendiente')
            .order('created_at', { ascending: false });

        let message = `📋 *SOLICITUDES VIP PENDIENTES*\n\n`;
        if (!requests || requests.length === 0) {
            message += `✅ *No hay solicitudes pendientes*`;
        } else {
            message += `Total: ${requests.length} solicitudes\n\n`;
            requests.forEach((request, index) => {
                message += `${index + 1}. *${request.users.first_name}*\n   🆔 Telegram: ${request.user_id}\n   📱 @${request.users.username || 'N/A'}\n   🆔 Quotex: ${request.quotex_id}\n   📅 ${new Date(request.created_at).toLocaleDateString()}\n   ---\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Actualizar', callback_data: 'trading_admin_view_requests' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async closeSession(chatId, messageId) {
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .maybeSingle();

        if (!activeSession) {
            await this.bot.editMessageText('❌ No hay sesión activa.', { chat_id: chatId, message_id: messageId });
            return;
        }

        await this.supabase
            .from('trading_sesiones')
            .update({ estado: 'cerrada' })
            .eq('id', activeSession.id);

        const vipUsers = await this.getVIPUsers();
        for (const user of vipUsers) {
            try {
                await this.bot.sendMessage(user.user_id,
                    `📢 *SESIÓN CERRADA*\n\nLa sesión ${activeSession.tipo} ha finalizado.\n\n` +
                    `📊 *Resumen:*\n• Señales enviadas: ${activeSession.señales_enviadas}/${activeSession.señales_totales}\n• Fecha: ${new Date(activeSession.fecha).toLocaleDateString()}\n\n` +
                    `📅 *Próxima sesión:*\n• ${activeSession.tipo === 'matutina' ? '22:00' : '10:00'} (${activeSession.tipo === 'matutina' ? 'Vespertina' : 'Matutina'})\n\n¡Gracias por participar!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.log(`No se pudo notificar al usuario ${user.user_id}`);
            }
        }

        const message = `✅ *SESIÓN CERRADA*\n\n` +
            `📅 *Fecha:* ${activeSession.fecha}\n🕙 *Hora de cierre:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n` +
            `📊 *Tipo:* ${activeSession.tipo}\n📡 *Señales enviadas:* ${activeSession.señales_enviadas}/${activeSession.señales_totales}\n` +
            `👥 *Usuarios notificados:* ${vipUsers.length}\n\nLa sesión ha sido cerrada exitosamente.`;

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]] }
        });

        await this.logAction(chatId, 'session_closed', { session_id: activeSession.id, señales_enviadas: activeSession.señales_enviadas });
    }

    async markSignalResult(chatId, messageId, signalId, result) {
        const { data: signal } = await this.supabase
            .from('trading_senales')
            .select('*')
            .eq('id', signalId)
            .single();

        if (!signal) {
            await this.bot.editMessageText('❌ Señal no encontrada.', { chat_id: chatId, message_id: messageId });
            return;
        }

        const profitLoss = result === 'ganada' ? 75 : -100;

        await this.supabase
            .from('trading_senales')
            .update({ resultado: result, hora_cierre: new Date().toISOString(), profit_loss: profitLoss })
            .eq('id', signalId);

        await this.supabase
            .from('trading_senales_usuario')
            .update({ resultado_usuario: result, profit_loss_usuario: profitLoss })
            .eq('señal_id', signalId);

        const { data: userSignals } = await this.supabase
            .from('trading_senales_usuario')
            .select('user_id')
            .eq('señal_id', signalId);

        if (userSignals) {
            const resultMessage = result === 'ganada' ? `✅ *SEÑAL GANADA* (+75%)` : `❌ *SEÑAL PERDIDA* (-100%)`;
            const userNotification = `📊 *RESULTADO DE SEÑAL*\n\n📈 *Activo:* ${signal.activo} (${signal.temporalidad})\n${resultMessage}\n\n📅 *Hora cierre:* ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n🔢 *ID Señal:* #${signalId}`;
            for (const userSignal of userSignals) {
                try {
                    await this.bot.sendMessage(userSignal.user_id, userNotification, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.log(`No se pudo notificar resultado al usuario ${userSignal.user_id}`);
                }
            }
        }

        await this.updateWeeklyROI();

        const updatedMessage = `📊 *RESULTADO REGISTRADO*\n\n` +
            `✅ *Señal #${signalId} marcada como ${result === 'ganada' ? 'GANADA' : 'PERDIDA'}*\n\n` +
            `📈 *Activo:* ${signal.activo} (${signal.temporalidad})\n📊 *Dirección:* ${signal.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA'}\n` +
            `💰 *Resultado:* ${result === 'ganada' ? '+75%' : '-100%'}\n👥 *Usuarios notificados:* ${userSignals ? userSignals.length : 0}\n\n¿Qué deseas hacer ahora?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📤 Enviar Otra Señal', callback_data: 'trading_admin_send_signal' }, { text: '🔒 Cerrar Sesión', callback_data: 'trading_admin_close_session' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
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
                await this.bot.sendMessage(chatId, updatedMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
            }
        } else {
            await this.bot.sendMessage(chatId, updatedMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
        }

        await this.logAction(chatId, 'signal_result', { signal_id: signalId, result, users_notified: userSignals?.length || 0 });
    }

    async updateWeeklyROI() {
        try {
            const monday = this.getCurrentWeekMonday();
            const nextMonday = new Date(monday);
            nextMonday.setDate(nextMonday.getDate() + 7);

            const { data: signals } = await this.supabase
                .from('trading_senales')
                .select('resultado, profit_loss')
                .gte('created_at', monday.toISOString())
                .lt('created_at', nextMonday.toISOString())
                .not('resultado', 'is', null);

            if (!signals || signals.length === 0) return;

            const totalProfit = signals.reduce((sum, s) => sum + (s.profit_loss || 0), 0);
            const roi = signals.length > 0 ? (totalProfit / signals.length) : 0;
            const ganadas = signals.filter(s => s.resultado === 'ganada').length;
            const perdidas = signals.filter(s => s.resultado === 'perdida').length;

            const { data: existing } = await this.supabase
                .from('trading_rentabilidad')
                .select('id')
                .eq('semana', monday.toISOString().split('T')[0])
                .maybeSingle();

            if (existing) {
                await this.supabase
                    .from('trading_rentabilidad')
                    .update({ rentabilidad: roi, señales_totales: signals.length, señales_ganadas: ganadas, señales_perdidas: perdidas })
                    .eq('id', existing.id);
            } else {
                await this.supabase
                    .from('trading_rentabilidad')
                    .insert([{
                        semana: monday.toISOString().split('T')[0],
                        rentabilidad: roi,
                        señales_totales: signals.length,
                        señales_ganadas: ganadas,
                        señales_perdidas: perdidas
                    }]);
            }

            if (roi < this.MIN_ROI_FOR_REFUND) {
                await this.checkRefunds();
                await this.bot.sendMessage(this.BOT_ADMIN_ID,
                    `⚠️ *RENTABILIDAD BAJA DETECTADA*\n\nLa rentabilidad de esta semana es del ${roi.toFixed(2)}%\n` +
                    `📊 *Mínimo requerido:* ${this.MIN_ROI_FOR_REFUND}%\n\nSe han generado reembolsos pendientes por procesar.\n` +
                    `Usa "💰 Reembolsos" en el panel admin.`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            console.error('Error actualizando ROI:', error);
        }
    }

    async showAdminActiveSignals(chatId, messageId) {
        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .maybeSingle();

        let message = `📈 *SEÑALES ACTIVAS*\n\n`;
        if (!activeSession) {
            message += `❌ *No hay sesión activa*\n\nNo hay señales activas en este momento.`;
        } else {
            const { data: signals } = await this.supabase
                .from('trading_senales')
                .select('*')
                .eq('sesion_id', activeSession.id)
                .order('hora_envio', { ascending: false });

            message += `📅 *Sesión ${activeSession.tipo}*\n🕙 ${activeSession.hora}\n📡 ${activeSession.señales_enviadas}/${activeSession.señales_totales} señales\n\n`;
            if (!signals || signals.length === 0) {
                message += `📭 *No hay señales aún*`;
            } else {
                message += `📋 *ÚLTIMAS SEÑALES:*\n\n`;
                signals.slice(0, 5).forEach((signal, index) => {
                    const hora = new Date(signal.hora_envio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                    const resultado = signal.resultado ? (signal.resultado === 'ganada' ? '✅' : '❌') : '⏳';
                    message += `${index + 1}. *${signal.activo}* (${signal.temporalidad})\n   ${signal.direccion === 'alta' ? '⬆️' : '⬇️'} ${resultado}\n   🕙 ${hora}\n   🆔 #${signal.id}\n`;
                    if (signal.resultado) message += `   📊 ${signal.profit_loss}%\n`;
                    message += `\n`;
                });
            }
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Actualizar', callback_data: 'admin_trading_active_signals' }, { text: '📤 Enviar Señal', callback_data: 'trading_admin_send_signal' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async viewRefunds(chatId, messageId) {
        const { data: refunds } = await this.supabase
            .from('trading_reembolsos')
            .select('*, users!inner(first_name)')
            .order('created_at', { ascending: false })
            .limit(10);

        let message = `💰 *REEMBOLSOS*\n\n`;
        if (!refunds || refunds.length === 0) {
            message += `✅ *No hay reembolsos registrados*`;
        } else {
            message += `📋 *Últimos reembolsos:*\n\n`;
            refunds.forEach((refund, index) => {
                const estado = refund.estado === 'completado' ? '✅' : refund.estado === 'pendiente' ? '⏳' : '❌';
                message += `${index + 1}. *${refund.users.first_name}*\n   ${estado} ${refund.monto} CUP\n   📅 ${new Date(refund.semana).toLocaleDateString()}\n   🆔 ${refund.user_id}\n`;
                if (refund.motivo) message += `   📝 ${refund.motivo.substring(0, 50)}...\n`;
                message += `\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Procesar Pendientes', callback_data: 'admin_trading_process_refunds' }, { text: '📋 Ver Todos', callback_data: 'admin_trading_all_refunds' }],
                [{ text: '🔙 Panel Admin', callback_data: 'trading_admin_menu' }]
            ]
        };

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    cleanupOldStates() {
        try {
            const now = Date.now();
            const timeout = 30 * 60 * 1000; // 30 minutos
            for (const [userId, state] of Object.entries(this.userStates)) {
                if (state && state.requestTime && (now - state.requestTime) > timeout) {
                    delete this.userStates[userId];
                    console.log(`🧹 Limpiado estado antiguo de usuario ${userId}`);
                }
            }
            for (const [adminId, state] of Object.entries(this.adminStates)) {
                if (state && state.requestTime && (now - state.requestTime) > timeout) {
                    delete this.adminStates[adminId];
                    console.log(`🧹 Limpiado estado antiguo de admin ${adminId}`);
                }
            }
            console.log('✅ Estados antiguos de Trading limpiados');
        } catch (error) {
            console.error('Error limpiando estados de Trading:', error);
        }
    }

    clearUserState(userId) {
        const key = String(userId);
        if (this.userStates[key]) delete this.userStates[key];
        if (this.adminStates[key]) delete this.adminStates[key];
    }

    // ============================================
    // MÉTODOS PENDIENTES (stubs funcionales)
    // ============================================
    async showSubscriptions(chatId, messageId) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente podrás gestionar tus suscripciones aquí.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        });
    }

    async showBuySignals(chatId, messageId) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente podrás comprar señales sueltas.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        });
    }

    async showMySignals(chatId, messageId) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente verás tu historial de señales.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        });
    }

    async showHowItWorks(chatId, messageId) {
        const message = `❓ *¿CÓMO FUNCIONAN LAS SEÑALES?*\n\n` +
            `1️⃣ *Sesiones diarias*\n• 10:00 AM y 10:00 PM, de lunes a viernes.\n• 10 señales por sesión.\n\n` +
            `2️⃣ *Recepción de señales*\n• Recibirás un mensaje con el activo, temporalidad y dirección.\n• Debes abrir tu cuenta de Quotex y ejecutar la operación.\n\n` +
            `3️⃣ *Resultados*\n• Al finalizar la señal, se informará si fue ganadora o perdedora.\n• La rentabilidad semanal se publica los lunes.\n\n` +
            `4️⃣ *Garantía*\n• Si la rentabilidad semanal es menor al ${this.MIN_ROI_FOR_REFUND}%, recibirás un reembolso del 50% (${this.REFUND_AMOUNT} CUP).\n\n` +
            `🎖️ *Beneficios VIP*\n• Acceso a todas las señales.\n• Programa de referidos (20% de comisión).\n• Soporte prioritario.`;

        await this.bot.editMessageText(message, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async showPerformance(chatId, messageId) {
        const roi = await this.getCurrentWeeklyROI();
        const successRate = await this.getSuccessRate();
        const message = `📊 *RENDIMIENTO*\n\n📈 *Rentabilidad esta semana:* ${roi}%\n🎯 *Tasa de éxito global:* ${successRate}%\n\nPróximamente más estadísticas detalladas.`;
        await this.bot.editMessageText(message, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async showActiveSignals(chatId, messageId) {
        const isVIP = await this.isUserVIP(chatId);
        if (!isVIP) {
            await this.bot.editMessageText('🔒 *Solo para miembros VIP*\n\nActiva tu suscripción para ver las señales activas.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🎖️ Hacerse VIP', callback_data: 'trading_request_vip' }]] }
            });
            return;
        }

        const { data: activeSession } = await this.supabase
            .from('trading_sesiones')
            .select('*')
            .eq('estado', 'abierta')
            .maybeSingle();

        if (!activeSession) {
            await this.bot.editMessageText('📭 *No hay sesión activa*\n\nLa próxima sesión será a las 10:00 o 22:00.', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
            });
            return;
        }

        const { data: signals } = await this.supabase
            .from('trading_senales')
            .select('*')
            .eq('sesion_id', activeSession.id)
            .order('hora_envio', { ascending: false });

        let message = `📡 *SEÑALES DE HOY - ${activeSession.tipo}*\n\n`;
        if (!signals || signals.length === 0) {
            message += `⏳ *No hay señales enviadas aún.*\n\nEspera la próxima señal.`;
        } else {
            signals.slice(0, 5).forEach((s, i) => {
                const hora = new Date(s.hora_envio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const dir = s.direccion === 'alta' ? '⬆️ COMPRA' : '⬇️ VENTA';
                message += `${i + 1}. *${s.activo}* (${s.temporalidad}) - ${dir}\n   🕙 ${hora}\n`;
            });
        }

        await this.bot.editMessageText(message, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async showHistory(chatId, messageId) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente podrás consultar el historial completo de señales.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async showCalendar(chatId, messageId, param) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente calendario de señales.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async viewSignalsByDate(chatId, messageId, param) {
        await this.bot.editMessageText('⏳ *Funcionalidad en desarrollo*\n\nPróximamente consulta de señales por fecha.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }

    async showNotifications(chatId, messageId) {
        const { data: notifications } = await this.supabase
            .from('trading_notificaciones')
            .select('*')
            .eq('user_id', chatId)
            .eq('leida', false)
            .order('created_at', { ascending: false })
            .limit(10);

        let message = `🔔 *TUS NOTIFICACIONES*\n\n`;
        if (!notifications || notifications.length === 0) {
            message += `✅ *No tienes notificaciones nuevas.*`;
        } else {
            notifications.forEach((n, i) => {
                message += `${i + 1}. ${n.mensaje}\n   📅 ${new Date(n.created_at).toLocaleDateString()}\n\n`;
            });
            await this.supabase
                .from('trading_notificaciones')
                .update({ leida: true })
                .eq('user_id', chatId)
                .eq('leida', false);
        }

        await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menú Trading', callback_data: 'trading_menu' }]] }
        });
    }
}

module.exports = TradingSignalsHandler;
