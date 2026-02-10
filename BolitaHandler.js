// BolitaHandler.js - Sistema completo de La Bolita
class BolitaHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.adminChatId = process.env.ADMIN_GROUP;
        this.botAdminId = process.env.BOT_ADMIN_ID;
        
        // Estados de usuario (para manejar el flujo de apuestas)
        this.userStates = new Map();
        
        // Multiplicadores basados en Florida 3 (7 dígitos)
        this.multiplicadores = {
            'centena': 500,   // Acertar los 3 primeros dígitos en orden exacto
            'fijo': 75,       // Acertar los 2 últimos dígitos de la centena
            'corrido': 25,    // Acertar un par de la cuarteta (45 o 67)
            'parlet': 10,     // Combinación de dos apuestas
            'candado': 1000   // Combinación exacta de fijo + corridos
        };
        
        // Mínimos y máximos
        this.minimoApuesta = 10;  // Mínimo de CWS para apostar
        this.maximoApuesta = 1000; // Máximo de CWS para apostar
    }

    // ==================== VERIFICACIÓN DE ADMIN ====================
    esAdmin(userId) {
        return userId.toString() === this.botAdminId.toString();
    }

    // ==================== MANEJO DE ESTADOS DE USUARIO ====================
    setUserState(userId, stateData) {
        this.userStates.set(userId, { ...stateData, timestamp: Date.now() });
    }

    getUserState(userId) {
        const state = this.userStates.get(userId);
        // Limpiar estados antiguos (más de 30 minutos)
        if (state && (Date.now() - state.timestamp) > 30 * 60 * 1000) {
            this.userStates.delete(userId);
            return null;
        }
        return state;
    }

    clearUserState(userId) {
        this.userStates.delete(userId);
    }

    // ==================== MENÚ PRINCIPAL DE LA BOLITA ====================
    async mostrarMenuPrincipal(chatId, messageId = null) {
        const teclado = {
            inline_keyboard: [
                [
                    { text: '🎯 Hacer Apuesta', callback_data: 'bolita_apostar' },
                    { text: '📜 Mis Apuestas', callback_data: 'bolita_mis_apuestas' }
                ],
                [
                    { text: '📅 Ver Resultados', callback_data: 'bolita_resultados' },
                    { text: '🔍 Buscar por Fecha', callback_data: 'bolita_buscar' }
                ],
                [
                    { text: '📊 Estadísticas', callback_data: 'bolita_estadisticas' },
                    { text: '❓ Cómo Apostar', callback_data: 'bolita_ayuda' }
                ],
                [
                    { text: '🔙 Volver al Menú', callback_data: 'start_back' }
                ]
            ]
        };

        const mensaje = `🎱 *Sistema de Apuestas - La Bolita*\n\n` +
            `*Basado en Florida 3 (7 dígitos)*\n\n` +
            `*Tipos de apuesta:*\n` +
            `• Centena (3 dígitos): 500x\n` +
            `• Fijo (2 dígitos): 75x\n` +
            `• Corrido (2 dígitos): 25x\n` +
            `• Parlet (XX-YY): 10x\n` +
            `• Candado (XX-YY-ZZ): 1000x\n\n` +
            `*Mínimo de apuesta:* ${this.minimoApuesta} CWS\n` +
            `*Máximo de apuesta:* ${this.maximoApuesta} CWS\n\n` +
            `Selecciona una opción:`;

        if (messageId) {
            await this.bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        } else {
            await this.bot.sendMessage(chatId, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        }
    }

    // ==================== MENÚ DE TIPOS DE APUESTA ====================
    async mostrarTiposApuesta(chatId, messageId = null) {
        const teclado = {
            inline_keyboard: [
                [
                    { text: '🎯 Fijo (2 dígitos)', callback_data: 'bolita_tipo_fijo' },
                    { text: '🔢 Centena (3 dígitos)', callback_data: 'bolita_tipo_centena' }
                ],
                [
                    { text: '🔄 Corrido (2 dígitos)', callback_data: 'bolita_tipo_corrido' },
                    { text: '🔗 Parlet (XX-YY)', callback_data: 'bolita_tipo_parlet' }
                ],
                [
                    { text: '🔐 Candado (XX-YY-ZZ)', callback_data: 'bolita_tipo_candado' },
                    { text: '🔙 Volver', callback_data: 'bolita_menu' }
                ]
            ]
        };

        const mensaje = `🎯 *Selecciona el tipo de apuesta:*\n\n` +
            `1. *Fijo* (2 dígitos): Ej: "23"\n` +
            `   - Pago: ${this.multiplicadores.fijo}x\n\n` +
            `2. *Centena* (3 dígitos): Ej: "123"\n` +
            `   - Pago: ${this.multiplicadores.centena}x\n\n` +
            `3. *Corrido* (2 dígitos): Ej: "45" o "67"\n` +
            `   - Pago: ${this.multiplicadores.corrido}x\n\n` +
            `4. *Parlet* (XX-YY): Ej: "23-45" o "45-67"\n` +
            `   - Pago: ${this.multiplicadores.parlet}x\n\n` +
            `5. *Candado* (XX-YY-ZZ): Ej: "23-45-67"\n` +
            `   - Pago: ${this.multiplicadores.candado}x`;

        if (messageId) {
            await this.bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        } else {
            await this.bot.sendMessage(chatId, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        }
    }

    // ==================== INICIAR FLUJO DE APUESTA ====================
    async iniciarFlujoApuesta(chatId, userId, tipo) {
        let ejemplo = '';
        let descripcion = '';
        
        switch(tipo) {
            case 'centena':
                ejemplo = '123';
                descripcion = '3 dígitos (centena)';
                break;
            case 'fijo':
                ejemplo = '23';
                descripcion = '2 dígitos (fijo)';
                break;
            case 'corrido':
                ejemplo = '45';
                descripcion = '2 dígitos (corrido)';
                break;
            case 'parlet':
                ejemplo = '23-45';
                descripcion = 'XX-YY (fijo y corrido, o dos corridos)';
                break;
            case 'candado':
                ejemplo = '23-45-67';
                descripcion = 'XX-YY-ZZ (fijo + corrido1 + corrido2)';
                break;
        }
        
        this.setUserState(userId, {
            step: 'esperando_numero',
            tipo: tipo
        });
        
        await this.bot.sendMessage(chatId,
            `🎯 *Apuesta: ${this.obtenerNombreTipo(tipo)}*\n\n` +
            `Formato: ${descripcion}\n` +
            `Ejemplo: \`${ejemplo}\`\n\n` +
            `Por favor, escribe los números (sin espacios):`,
            { parse_mode: 'Markdown' }
        );
    }

    // ==================== VALIDAR NÚMERO DE APUESTA ====================
    validarFormatoApuesta(tipo, numero) {
        switch(tipo) {
            case 'centena':
                return /^\d{3}$/.test(numero);
            case 'fijo':
                return /^\d{2}$/.test(numero);
            case 'corrido':
                return /^\d{2}$/.test(numero);
            case 'parlet':
                const partesParlet = numero.split('-');
                if (partesParlet.length !== 2) return false;
                return /^\d{2}$/.test(partesParlet[0]) && /^\d{2}$/.test(partesParlet[1]);
            case 'candado':
                const partesCandado = numero.split('-');
                if (partesCandado.length !== 3) return false;
                return partesCandado.every(p => /^\d{2}$/.test(p));
            default:
                return false;
        }
    }

    async procesarNumeroApuesta(chatId, userId, numeroTexto) {
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'esperando_numero') {
            return false;
        }
        
        const tipo = estado.tipo;
        
        // Validar formato
        if (!this.validarFormatoApuesta(tipo, numeroTexto)) {
            let ejemplo = '';
            switch(tipo) {
                case 'centena': ejemplo = '123'; break;
                case 'fijo': ejemplo = '23'; break;
                case 'corrido': ejemplo = '45'; break;
                case 'parlet': ejemplo = '23-45'; break;
                case 'candado': ejemplo = '23-45-67'; break;
            }
            
            await this.bot.sendMessage(chatId,
                `❌ *Formato incorrecto*\n\n` +
                `Para ${this.obtenerNombreTipo(tipo)}, el formato debe ser:\n` +
                `Ejemplo: \`${ejemplo}\`\n\n` +
                `Por favor, escribe los números correctamente:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        // Actualizar estado
        estado.step = 'esperando_monto';
        estado.numero = numeroTexto;
        this.setUserState(userId, estado);
        
        await this.bot.sendMessage(chatId,
            `✅ *Número aceptado:* ${numeroTexto}\n\n` +
            `💰 *¿Cuánto quieres apostar?*\n\n` +
            `Mínimo: ${this.minimoApuesta} CWS\n` +
            `Máximo: ${this.maximoApuesta} CWS\n\n` +
            `Escribe la cantidad de CWS:`,
            { parse_mode: 'Markdown' }
        );
        
        return true;
    }

    // ==================== VALIDAR MONTO DE APUESTA ====================
    async procesarMontoApuesta(chatId, userId, montoTexto) {
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'esperando_monto') {
            return false;
        }
        
        const monto = parseInt(montoTexto);
        
        // Validar que sea un número
        if (isNaN(monto)) {
            await this.bot.sendMessage(chatId,
                `❌ *Monto inválido*\n\n` +
                `Por favor, escribe un número válido.`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        // Validar límites
        if (monto < this.minimoApuesta || monto > this.maximoApuesta) {
            await this.bot.sendMessage(chatId,
                `❌ *Monto fuera de límites*\n\n` +
                `El monto debe estar entre ${this.minimoApuesta} y ${this.maximoApuesta} CWS.`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        // Verificar saldo del usuario
        const user = await this.getUser(userId);
        if (!user) {
            await this.bot.sendMessage(chatId,
                `❌ *Usuario no encontrado*\n\n` +
                `Por favor, inicia sesión nuevamente con /start`,
                { parse_mode: 'Markdown' }
            );
            this.clearUserState(userId);
            return true;
        }
        
        if (user.tokens_cws < monto) {
            await this.bot.sendMessage(chatId,
                `❌ *Saldo insuficiente*\n\n` +
                `Necesitas: ${monto} CWS\n` +
                `Tienes: ${user.tokens_cws} CWS\n\n` +
                `Recarga tu billetera con CWS primero.`,
                { parse_mode: 'Markdown' }
            );
            this.clearUserState(userId);
            return true;
        }
        
        // Obtener sorteo activo
        const sorteo = await this.obtenerSorteoActivo();
        if (!sorteo) {
            await this.bot.sendMessage(chatId,
                `❌ *No hay sorteo activo*\n\n` +
                `No hay un sorteo disponible en este momento.`,
                { parse_mode: 'Markdown' }
            );
            this.clearUserState(userId);
            return true;
        }
        
        // Crear apuesta
        const apuestaCreada = await this.crearApuesta(userId, estado.tipo, estado.numero, monto, sorteo.id);
        
        if (apuestaCreada) {
            // Descontar saldo
            await this.descontarSaldo(userId, monto);
            
            // Limpiar estado
            this.clearUserState(userId);
            
            // Mostrar confirmación
            const gananciaPotencial = this.calcularGanancia(estado.tipo, monto);
            
            await this.bot.sendMessage(chatId,
                `✅ *¡Apuesta registrada!*\n\n` +
                `🎫 *Ticket #${apuestaCreada.id}*\n` +
                `🎯 *Tipo:* ${this.obtenerNombreTipo(estado.tipo)}\n` +
                `🔢 *Números:* ${estado.numero}\n` +
                `💰 *Monto:* ${monto} CWS\n` +
                `🎁 *Ganancia potencial:* ${gananciaPotencial} CWS\n` +
                `📅 *Sorteo:* ${sorteo.fecha} (${sorteo.hora === 'midday' ? 'Mediodía' : 'Noche'})\n\n` +
                `¡Buena suerte! Los resultados se publicarán después del sorteo.`,
                { parse_mode: 'Markdown' }
            );
            
            // Notificar al admin
            await this.enviarNotificacionAdmin(apuestaCreada, user);
        } else {
            await this.bot.sendMessage(chatId,
                `❌ *Error al crear la apuesta*\n\n` +
                `Por favor, intenta de nuevo más tarde.`,
                { parse_mode: 'Markdown' }
            );
            this.clearUserState(userId);
        }
        
        return true;
    }

    // ==================== PROCESAR APUESTA ====================
    async crearApuesta(userId, tipo, numero, monto, sorteoId) {
        try {
            const { data: apuesta, error } = await this.supabase
                .from('bolita_apuestas')
                .insert([{
                    user_id: userId,
                    tipo_apuesta: tipo,
                    numero_apostado: numero,
                    monto: monto,
                    sorteo_id: sorteoId,
                    estado: 'pendiente',
                    fecha_apuesta: new Date().toISOString()
                }])
                .select()
                .single();
            
            if (error) throw error;
            return apuesta;
        } catch (error) {
            console.error('Error creando apuesta:', error);
            return null;
        }
    }

    async descontarSaldo(userId, monto) {
        try {
            const { data: user } = await this.supabase
                .from('users')
                .select('tokens_cws')
                .eq('telegram_id', userId)
                .single();
            
            if (user) {
                await this.supabase
                    .from('users')
                    .update({ tokens_cws: user.tokens_cws - monto })
                    .eq('telegram_id', userId);
                
                // Registrar transacción
                await this.supabase
                    .from('transactions')
                    .insert([{
                        user_id: userId,
                        type: 'BOLITA_APUESTA',
                        currency: 'cws',
                        amount: -monto,
                        status: 'completed',
                        description: `Apuesta en La Bolita`,
                        created_at: new Date().toISOString()
                    }]);
            }
        } catch (error) {
            console.error('Error descontando saldo:', error);
        }
    }

    // ==================== PROCESAR RESULTADOS (ADMIN) ====================
    async mostrarMenuResultadosAdmin(chatId, messageId = null) {
        const teclado = {
            inline_keyboard: [
                [
                    { text: '☀️ Cargar Mediodía', callback_data: 'bolita_admin_midday' },
                    { text: '🌙 Cargar Noche', callback_data: 'bolita_admin_evening' }
                ],
                [
                    { text: '📊 Ver Reporte', callback_data: 'bolita_admin_reporte' },
                    { text: '📈 Estadísticas', callback_data: 'bolita_admin_estadisticas' }
                ],
                [
                    { text: '🔙 Volver', callback_data: 'bolita_menu' }
                ]
            ]
        };

        const mensaje = `👑 *Panel de Administración - La Bolita*\n\n` +
            `Selecciona una opción:`;

        if (messageId) {
            await this.bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        } else {
            await this.bot.sendMessage(chatId, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: teclado
            });
        }
    }

    async iniciarCargaResultado(chatId, userId, tanda) {
        if (!this.esAdmin(userId)) return;
        
        this.setUserState(userId, {
            step: 'admin_esperando_resultado',
            tanda: tanda
        });
        
        const nombreTanda = tanda === 'midday' ? 'Mediodía ☀️' : 'Noche 🌙';
        
        await this.bot.sendMessage(chatId,
            `👑 *Cargar Resultado - ${nombreTanda}*\n\n` +
            `Por favor, escribe el número completo de Florida (7 dígitos):\n\n` +
            `Ejemplo: \`1234567\`\n\n` +
            `Formato: 7 dígitos exactos\n` +
            `Basado en el resultado oficial de Florida.`,
            { parse_mode: 'Markdown' }
        );
    }

    async procesarResultadoAdmin(chatId, userId, numeroCompleto) {
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'admin_esperando_resultado') {
            return false;
        }
        
        // Validar formato
        if (!/^\d{7}$/.test(numeroCompleto)) {
            await this.bot.sendMessage(chatId,
                `❌ *Formato incorrecto*\n\n` +
                `Debe ser un número de *7 dígitos* (ej: 1234567)\n` +
                `Este es el formato de Florida 3`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        const tanda = estado.tanda;
        
        try {
            await this.bot.sendMessage(chatId, `⏳ *Procesando resultado...*`, { parse_mode: 'Markdown' });
            
            // Desglosar número
            const centena = numeroCompleto.substring(0, 3);
            const fijo = numeroCompleto.substring(1, 3);
            const cuarteta = numeroCompleto.substring(3, 7);
            const corrido1 = cuarteta.substring(0, 2);
            const corrido2 = cuarteta.substring(2, 4);
            
            // Obtener o crear sorteo
            const sorteo = await this.obtenerOSorteoActivo(tanda);
            
            // Actualizar sorteo
            await this.supabase
                .from('bolita_sorteos')
                .update({
                    numero_ganador: numeroCompleto,
                    centena: centena,
                    fijo: fijo,
                    cuarteta: cuarteta,
                    corrido1: corrido1,
                    corrido2: corrido2,
                    estado: 'completado'
                })
                .eq('id', sorteo.id);
            
            // Procesar apuestas
            const resultado = await this.procesarApuestasSorteo(sorteo.id, {
                completo: numeroCompleto,
                centena: centena,
                fijo: fijo,
                cuarteta: cuarteta,
                corrido1: corrido1,
                corrido2: corrido2
            });
            
            // Mostrar resumen
            await this.bot.sendMessage(chatId,
                `✅ *Resultado cargado exitosamente*\n\n` +
                `📅 *Tanda:* ${tanda === 'midday' ? 'Mediodía ☀️' : 'Noche 🌙'}\n` +
                `🎯 *Número ganador:* ${numeroCompleto}\n` +
                `🔢 *Desglose:*\n` +
                `• Centena: ${centena}\n` +
                `• Fijo: ${fijo}\n` +
                `• Cuarteta: ${cuarteta}\n` +
                `• Corridos: ${corrido1}, ${corrido2}\n\n` +
                `📊 *Resumen:*\n` +
                `• Total apuestas: ${resultado.totalApuestas}\n` +
                `• Ganadores: ${resultado.ganadores.length}\n` +
                `• Total pagado: ${resultado.totalPagado} CWS`,
                { parse_mode: 'Markdown' }
            );
            
            // Limpiar estado
            this.clearUserState(userId);
            
        } catch (error) {
            console.error('Error procesando resultado:', error);
            await this.bot.sendMessage(chatId,
                `❌ *Error al procesar resultado*\n\n` +
                `Por favor, intenta de nuevo.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        return true;
    }

    // ==================== PROCESAR APUESTAS DEL SORTEO ====================
    async procesarApuestasSorteo(sorteoId, numeroGanador) {
        const { data: apuestas } = await this.supabase
            .from('bolita_apuestas')
            .select('*, users!inner(first_name, username, tokens_cws)')
            .eq('sorteo_id', sorteoId)
            .eq('estado', 'pendiente');
        
        let ganadores = [];
        let totalPagado = 0;
        
        if (apuestas) {
            for (const apuesta of apuestas) {
                const esGanadora = this.validarApuesta(
                    apuesta.tipo_apuesta,
                    apuesta.numero_apostado,
                    numeroGanador
                );
                
                if (esGanadora) {
                    const ganancia = this.calcularGanancia(apuesta.tipo_apuesta, apuesta.monto);
                    
                    // Actualizar apuesta
                    await this.supabase
                        .from('bolita_apuestas')
                        .update({
                            estado: 'ganada',
                            ganancia: ganancia,
                            ganado_en: new Date().toISOString()
                        })
                        .eq('id', apuesta.id);
                    
                    // Acreditar ganancia
                    await this.acreditarGanancia(apuesta.user_id, ganancia);
                    
                    // Agregar a ganadores
                    ganadores.push({
                        ticket_id: apuesta.id,
                        user_id: apuesta.user_id,
                        nombre: apuesta.users.first_name,
                        tipo: apuesta.tipo_apuesta,
                        numeros: apuesta.numero_apostado,
                        monto_apostado: apuesta.monto,
                        ganancia: ganancia
                    });
                    
                    totalPagado += ganancia;
                    
                    // Notificar usuario
                    await this.notificarGanador(apuesta.user_id, apuesta, numeroGanador.completo, ganancia);
                } else {
                    // Marcar como perdida
                    await this.supabase
                        .from('bolita_apuestas')
                        .update({ estado: 'perdida' })
                        .eq('id', apuesta.id);
                    
                    // Notificar usuario
                    await this.notificarPerdedor(apuesta.user_id, apuesta, numeroGanador.completo);
                }
            }
        }
        
        return {
            ganadores: ganadores,
            totalPagado: totalPagado,
            totalApuestas: apuestas ? apuestas.length : 0
        };
    }

    // ==================== VALIDACIÓN DE APUESTAS ====================
    validarApuesta(tipo, numeroApostado, numeroGanador) {
        const { centena, fijo, corrido1, corrido2 } = numeroGanador;
        
        switch(tipo) {
            case 'centena':
                return numeroApostado === centena;
                
            case 'fijo':
                return numeroApostado === fijo;
                
            case 'corrido':
                return numeroApostado === corrido1 || numeroApostado === corrido2;
                
            case 'parlet':
                const [ap1, ap2] = numeroApostado.split('-');
                const gana1 = this.validarApuesta('fijo', ap1, numeroGanador) || 
                              this.validarApuesta('corrido', ap1, numeroGanador);
                const gana2 = this.validarApuesta('fijo', ap2, numeroGanador) || 
                              this.validarApuesta('corrido', ap2, numeroGanador);
                return gana1 && gana2;
                
            case 'candado':
                const [cFijo, cCorrido1, cCorrido2] = numeroApostado.split('-');
                return cFijo === fijo && cCorrido1 === corrido1 && cCorrido2 === corrido2;
                
            default:
                return false;
        }
    }

    calcularGanancia(tipo, monto) {
        return Math.floor(monto * this.multiplicadores[tipo]);
    }

    // ==================== FUNCIONES DE NOTIFICACIÓN ====================
    async notificarGanador(userId, apuesta, numeroGanador, ganancia) {
        try {
            await this.bot.sendMessage(userId,
                `🎉 *¡FELICIDADES! GANASTE EN LA BOLITA*\n\n` +
                `🎫 *Ticket #${apuesta.id}*\n` +
                `🎯 Tu apuesta: ${this.obtenerNombreTipo(apuesta.tipo_apuesta)} ${apuesta.numero_apostado}\n` +
                `✅ Número ganador: *${numeroGanador}*\n` +
                `💰 Ganancia: *${ganancia} CWS*\n\n` +
                `El monto ha sido acreditado a tu billetera.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error(`Error notificando ganador ${userId}:`, error);
        }
    }

    async notificarPerdedor(userId, apuesta, numeroGanador) {
        try {
            await this.bot.sendMessage(userId,
                `😔 *Tu apuesta no fue ganadora*\n\n` +
                `🎫 Ticket #${apuesta.id}\n` +
                `🎯 Tu apuesta: ${this.obtenerNombreTipo(apuesta.tipo_apuesta)} ${apuesta.numero_apostado}\n` +
                `❌ Número ganador: ${numeroGanador}\n` +
                `💸 Monto apostado: ${apuesta.monto} CWS\n\n` +
                `¡Suerte en la próxima!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            // Usuario puede haber bloqueado el bot
        }
    }

    async enviarNotificacionAdmin(apuesta, user) {
        if (!this.adminChatId) return;
        
        const ticketMsg = `🎫 *NUEVA APUESTA - LA BOLITA*\n\n` +
            `🆔 Ticket #${apuesta.id}\n` +
            `👤 ${user.first_name} (@${user.username || 'N/A'})\n` +
            `🆔 ID: ${user.telegram_id}\n` +
            `🎯 ${this.obtenerNombreTipo(apuesta.tipo_apuesta)}: ${apuesta.numero_apostado}\n` +
            `💰 ${apuesta.monto} CWS\n` +
            `⏰ ${new Date().toLocaleTimeString()}`;

        await this.bot.sendMessage(this.adminChatId, ticketMsg, { parse_mode: 'Markdown' });
    }

    // ==================== FUNCIONES AUXILIARES ====================
    obtenerNombreTipo(tipo) {
        const nombres = {
            'centena': 'Centena',
            'fijo': 'Fijo',
            'corrido': 'Corrido',
            'parlet': 'Parlet',
            'candado': 'Candado'
        };
        return nombres[tipo] || tipo;
    }

    async obtenerSorteoActivo() {
        const hoy = new Date().toISOString().split('T')[0];
        const ahora = new Date();
        const hora = ahora.getHours() < 12 ? 'midday' : 'evening';
        
        let { data: sorteo } = await this.supabase
            .from('bolita_sorteos')
            .select('*')
            .eq('fecha', hoy)
            .eq('hora', hora)
            .single();
        
        if (!sorteo) {
            const { data: nuevoSorteo } = await this.supabase
                .from('bolita_sorteos')
                .insert([{ 
                    fecha: hoy, 
                    hora: hora,
                    estado: 'pendiente'
                }])
                .select()
                .single();
            return nuevoSorteo;
        }
        
        return sorteo;
    }

    async obtenerOSorteoActivo(tanda) {
        const hoy = new Date().toISOString().split('T')[0];
        
        let { data: sorteo } = await this.supabase
            .from('bolita_sorteos')
            .select('*')
            .eq('fecha', hoy)
            .eq('hora', tanda)
            .single();
        
        if (!sorteo) {
            const { data: nuevoSorteo } = await this.supabase
                .from('bolita_sorteos')
                .insert([{ 
                    fecha: hoy, 
                    hora: tanda,
                    estado: 'pendiente'
                }])
                .select()
                .single();
            return nuevoSorteo;
        }
        
        return sorteo;
    }

    async acreditarGanancia(userId, ganancia) {
        try {
            const { data: user } = await this.supabase
                .from('users')
                .select('tokens_cws')
                .eq('telegram_id', userId)
                .single();
            
            if (user) {
                await this.supabase
                    .from('users')
                    .update({ tokens_cws: user.tokens_cws + ganancia })
                    .eq('telegram_id', userId);
                
                // Registrar transacción
                await this.supabase
                    .from('transactions')
                    .insert([{
                        user_id: userId,
                        type: 'BOLITA_GANANCIA',
                        currency: 'cws',
                        amount: ganancia,
                        status: 'completed',
                        description: `Ganancia en La Bolita`,
                        created_at: new Date().toISOString()
                    }]);
            }
        } catch (error) {
            console.error('Error acreditando ganancia:', error);
        }
    }

    async getUser(telegramId) {
        const { data } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();
        return data;
    }

    // ==================== FUNCIONES DE CONSULTA ====================
    async verResultadosRecientes(chatId) {
        try {
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado', 'completado')
                .order('fecha', { ascending: false })
                .limit(5);
            
            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay resultados disponibles.');
                return;
            }
            
            let mensaje = `📅 *Últimos Resultados*\n\n`;
            
            sorteos.forEach((sorteo, index) => {
                const fecha = new Date(sorteo.fecha).toLocaleDateString('es-ES', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short'
                });
                
                mensaje += `${index + 1}. *${fecha}* (${sorteo.hora === 'midday' ? 'Mediodía' : 'Noche'})\n`;
                mensaje += `   🎯 Número: *${sorteo.numero_ganador}*\n`;
                mensaje += `   🔢 Centena: ${sorteo.centena} | Fijo: ${sorteo.fijo} | Corridos: ${sorteo.corrido1}, ${sorteo.corrido2}\n`;
                mensaje += `   ---\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error obteniendo resultados:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener resultados.');
        }
    }

    async verMisApuestas(chatId, userId) {
        try {
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*, bolita_sorteos(numero_ganador, centena, fijo, corrido1, corrido2, fecha, hora)')
                .eq('user_id', userId)
                .order('fecha_apuesta', { ascending: false })
                .limit(10);
            
            if (!apuestas || apuestas.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No tienes apuestas registradas.');
                return;
            }
            
            let mensaje = `📜 *Tus últimas apuestas*\n\n`;
            
            apuestas.forEach((apuesta, index) => {
                const fecha = new Date(apuesta.fecha_apuesta).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit'
                });
                
                mensaje += `${index + 1}. Ticket #${apuesta.id} (${fecha})\n`;
                mensaje += `   🎯 ${this.obtenerNombreTipo(apuesta.tipo_apuesta)}: ${apuesta.numero_apostado}\n`;
                mensaje += `   💰 ${apuesta.monto} CWS\n`;
                
                if (apuesta.estado === 'ganada') {
                    mensaje += `   ✅ Ganaste: ${apuesta.ganancia} CWS\n`;
                } else if (apuesta.estado === 'perdida') {
                    mensaje += `   ❌ Perdiste\n`;
                } else {
                    mensaje += `   ⏳ Pendiente\n`;
                }
                
                if (apuesta.bolita_sorteos?.numero_ganador) {
                    mensaje += `   🎯 Resultado: ${apuesta.bolita_sorteos.numero_ganador}\n`;
                }
                
                mensaje += `   ---\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error obteniendo apuestas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener tus apuestas.');
        }
    }

    async buscarResultadoPorFecha(chatId, fecha) {
        try {
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', fecha)
                .eq('estado', 'completado')
                .order('hora', { ascending: false });
            
            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, `📭 No hay resultados para la fecha ${fecha}.`);
                return;
            }
            
            let mensaje = `📅 *Resultados del ${fecha}*\n\n`;
            
            sorteos.forEach((sorteo, index) => {
                mensaje += `${index + 1}. *${sorteo.hora === 'midday' ? 'Mediodía' : 'Noche'}*\n`;
                mensaje += `   🎯 Número: *${sorteo.numero_ganador}*\n`;
                mensaje += `   🔢 Desglose:\n`;
                mensaje += `      • Centena: ${sorteo.centena}\n`;
                mensaje += `      • Fijo: ${sorteo.fijo}\n`;
                mensaje += `      • Corridos: ${sorteo.corrido1} y ${sorteo.corrido2}\n`;
                mensaje += `   ---\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error buscando resultado:', error);
            await this.bot.sendMessage(chatId, '❌ Error al buscar resultados.');
        }
    }

    // ==================== MANEJO DE CALLBACKS ====================
    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const messageId = query.message.message_id;
        const data = query.data;

        try {
            await this.bot.answerCallbackQuery(query.id);

            if (data.startsWith('bolita_')) {
                const parts = data.split('_');
                const action = parts[1];

                switch (action) {
                    case 'menu':
                        await this.mostrarMenuPrincipal(chatId, messageId);
                        return true;
                        
                    case 'apostar':
                        await this.mostrarTiposApuesta(chatId, messageId);
                        return true;
                        
                    case 'tipo':
                        const tipo = parts[2];
                        await this.iniciarFlujoApuesta(chatId, userId, tipo);
                        return true;
                        
                    case 'resultados':
                        await this.verResultadosRecientes(chatId);
                        return true;
                        
                    case 'mis':
                        if (parts[2] === 'apuestas') {
                            await this.verMisApuestas(chatId, userId);
                        }
                        return true;
                        
                    case 'buscar':
                        await this.solicitarFechaBusqueda(chatId, messageId);
                        return true;
                        
                    case 'estadisticas':
                        await this.mostrarEstadisticasSemanales(chatId, userId);
                        return true;
                        
                    case 'ayuda':
                        await this.mostrarAyuda(chatId);
                        return true;
                        
                    case 'admin':
                        if (this.esAdmin(userId)) {
                            if (parts[2] === 'menu') {
                                await this.mostrarMenuResultadosAdmin(chatId, messageId);
                            } else if (parts[2] === 'midday' || parts[2] === 'evening') {
                                await this.iniciarCargaResultado(chatId, userId, parts[2]);
                            } else if (parts[2] === 'reporte') {
                                await this.mostrarReporteAdmin(chatId, userId);
                            } else if (parts[2] === 'estadisticas') {
                                await this.mostrarEstadisticasAvanzadas(chatId, userId);
                            }
                        }
                        return true;
                        
                    default:
                        console.log(`Acción no reconocida: ${action}`);
                }
                return true;
            }
        } catch (error) {
            console.error('Error en callback de La Bolita:', error);
        }

        return false;
    }

    // ==================== MANEJO DE MENSAJES ====================
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        // Si es un comando, no lo procesamos aquí
        if (text && text.startsWith('/')) {
            // Manejar comandos específicos de la bolita
            if (text === '/bolita' || text === '/bolita@' + this.bot.username) {
                await this.mostrarMenuPrincipal(chatId);
                return true;
            }
            if (text === '/cancelar' || text === '/cancelar@' + this.bot.username) {
                this.clearUserState(userId);
                await this.bot.sendMessage(chatId, '❌ Operación cancelada.');
                return true;
            }
            return false;
        }

        // Verificar si el usuario está en un estado activo de la bolita
        const estado = this.getUserState(userId);
        
        if (estado) {
            if (estado.step === 'esperando_numero') {
                return await this.procesarNumeroApuesta(chatId, userId, text);
            }
            
            if (estado.step === 'esperando_monto') {
                return await this.procesarMontoApuesta(chatId, userId, text);
            }
            
            if (estado.step === 'admin_esperando_resultado') {
                return await this.procesarResultadoAdmin(chatId, userId, text);
            }
            
            if (estado.step === 'buscando_fecha') {
                await this.buscarResultadoPorFecha(chatId, text);
                this.clearUserState(userId);
                return true;
            }
        }

        // Verificar si es admin ingresando resultado (sin estado previo)
        if (this.esAdmin(userId) && /^\d{7}$/.test(text)) {
            // Si es un número de 7 dígitos y es admin, sugerir cargar resultado
            await this.bot.sendMessage(chatId,
                `👑 *¿Quieres cargar este resultado?*\n\n` +
                `Número: ${text}\n\n` +
                `Selecciona la tanda:\n` +
                `☀️ Mediodía o 🌙 Noche`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        return false;
    }

    // ==================== FUNCIONES AUXILIARES ADICIONALES ====================
    async solicitarFechaBusqueda(chatId, messageId) {
        await this.bot.editMessageText(
            `🔍 *Buscar Resultado por Fecha*\n\n` +
            `Por favor, escribe la fecha en formato:\n` +
            `\`AAAA-MM-DD\`\n\n` +
            `Ejemplo: \`2026-02-10\`\n\n` +
            `O escribe "hoy" para ver resultados de hoy:`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }
        );
    }

    async mostrarAyuda(chatId) {
        const mensaje = `❓ *Cómo Apostar en La Bolita*\n\n` +
            `1. Selecciona "Hacer Apuesta"\n` +
            `2. Elige el tipo de apuesta\n` +
            `3. Escribe los números según el formato\n` +
            `4. Escribe el monto en CWS\n\n` +
            `*Tipos de apuesta:*\n` +
            `• Fijo: 2 últimos dígitos de la centena\n` +
            `• Centena: 3 primeros dígitos\n` +
            `• Corrido: Pares de la cuarteta (45 o 67)\n` +
            `• Parlet: Combinación de dos apuestas\n` +
            `• Candado: Combinación exacta\n\n` +
            `*Ejemplo de número Florida:* 1234567\n` +
            `• Centena: 123\n` +
            `• Fijo: 23\n` +
            `• Cuarteta: 4567\n` +
            `• Corridos: 45 y 67`;

        await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
    }

    async mostrarEstadisticasSemanales(chatId, userId) {
        // Calcular fecha de hace 7 días
        const fechaInicio = new Date();
        fechaInicio.setDate(fechaInicio.getDate() - 7);
        const fechaInicioStr = fechaInicio.toISOString().split('T')[0];

        // Obtener sorteos de la última semana
        const { data: sorteos } = await this.supabase
            .from('bolita_sorteos')
            .select('centena, fijo, corrido1, corrido2')
            .gte('fecha', fechaInicioStr)
            .eq('estado', 'completado');

        if (!sorteos || sorteos.length === 0) {
            await this.bot.sendMessage(chatId, '📭 No hay suficientes datos para estadísticas.');
            return;
        }

        // Análisis básico
        let mensaje = `📊 *Estadísticas de la última semana*\n\n`;
        mensaje += `📅 Período: ${fechaInicioStr} - Hoy\n`;
        mensaje += `🎯 Total sorteos: ${sorteos.length}\n\n`;

        await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
    }

    async mostrarReporteAdmin(chatId, userId) {
        if (!this.esAdmin(userId)) return;

        try {
            // Obtener el último sorteo completado
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado', 'completado')
                .order('fecha', { ascending: false })
                .limit(1);

            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay sorteos completados.');
                return;
            }

            const sorteo = sorteos[0];

            // Obtener ganadores
            const { data: ganadores } = await this.supabase
                .from('bolita_apuestas')
                .select('*, users!inner(first_name, username)')
                .eq('sorteo_id', sorteo.id)
                .eq('estado', 'ganada');

            let mensaje = `📊 *REPORTE DEL ADMINISTRADOR*\n\n`;
            mensaje += `🆔 Sorteo #${sorteo.id}\n`;
            mensaje += `📅 ${sorteo.fecha} (${sorteo.hora === 'midday' ? 'Mediodía' : 'Noche'})\n`;
            mensaje += `🎯 Número Ganador: *${sorteo.numero_ganador}*\n\n`;

            if (ganadores && ganadores.length > 0) {
                mensaje += `🏆 *GANADORES (${ganadores.length}):*\n\n`;

                let totalAPagar = 0;
                ganadores.forEach((ganador, index) => {
                    mensaje += `${index + 1}. Ticket #${ganador.id}\n`;
                    mensaje += `   👤 ${ganador.users.first_name} (@${ganador.users.username || 'N/A'})\n`;
                    mensaje += `   🎯 ${this.obtenerNombreTipo(ganador.tipo_apuesta)}: ${ganador.numero_apostado}\n`;
                    mensaje += `   💰 Apostó: ${ganador.monto} CWS → Ganó: ${ganador.ganancia} CWS\n`;
                    mensaje += `   ---\n`;
                    totalAPagar += ganador.ganancia;
                });

                mensaje += `\n💰 *TOTAL A PAGAR:* ${totalAPagar} CWS`;
            } else {
                mensaje += `❌ No hubo ganadores en este sorteo.`;
            }

            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error mostrando reporte:', error);
            await this.bot.sendMessage(chatId, '❌ Error al generar reporte.');
        }
    }

    async mostrarEstadisticasAvanzadas(chatId, userId) {
        if (!this.esAdmin(userId)) return;

        await this.bot.sendMessage(chatId,
            `📈 *Estadísticas Avanzadas (Admin)*\n\n` +
            `Funcionalidad en desarrollo...\n\n` +
            `Próximamente:\n` +
            `• Análisis de tendencias\n` +
            `• Predicciones basadas en IA\n` +
            `• Reportes de rentabilidad\n` +
            `• Gráficos de frecuencia`,
            { parse_mode: 'Markdown' }
        );
    }
}

module.exports = BolitaHandler;
