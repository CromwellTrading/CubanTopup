// BolitaHandler.js - Sistema completo de La Bolita con control de sesiones por admin
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
        
        // Mínimos y máximos - AHORA EN CUP
        this.minimoApuesta = 10;  // Mínimo de CUP para apostar
        this.maximoApuesta = 1000; // Máximo de CUP para apostar
        
        // Sesiones disponibles
        this.sesiones = {
            'midday': 'Mediodía ☀️',
            'evening': 'Noche/Tarde 🌙'
        };
        
        // Estados de sesión
        this.estadosSesion = {
            'inactiva': '❌ Inactiva',
            'abierta': '✅ Abierta',
            'cerrada': '⏸️ Cerrada',
            'completada': '🏁 Completada'
        };
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

    // ==================== LIMPIAR ESTADOS ANTIGUOS ====================
    cleanupOldStates() {
        try {
            const now = Date.now();
            const timeout = 30 * 60 * 1000; // 30 minutos

            // Limpiar estados de usuario
            for (const [userId, state] of this.userStates.entries()) {
                if (state && state.timestamp && (now - state.timestamp) > timeout) {
                    this.userStates.delete(userId);
                    console.log(`🧹 Limpiado estado antiguo de Bolita para usuario ${userId}`);
                }
            }

            console.log('✅ Estados antiguos de Bolita limpiados');
        } catch (error) {
            console.error('Error limpiando estados de Bolita:', error);
        }
    }

    // ==================== OBTENER SESIÓN ACTIVA ====================
    async obtenerEstadoSesion(sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                return {
                    estado: 'inactiva',
                    sorteo: null,
                    mensaje: 'Sesión no iniciada'
                };
            }
            
            return {
                estado: sorteo.estado_sesion || 'inactiva',
                sorteo: sorteo,
                mensaje: this.estadosSesion[sorteo.estado_sesion] || 'Desconocido'
            };
        } catch (error) {
            console.error('Error obteniendo estado sesión:', error);
            return { estado: 'inactiva', sorteo: null, mensaje: 'Error' };
        }
    }

    // ==================== MENÚ PRINCIPAL DE LA BOLITA ====================
    async mostrarMenuPrincipal(chatId, messageId = null) {
        const esAdministrador = this.esAdmin(chatId);
        
        if (esAdministrador) {
            await this.mostrarMenuAdmin(chatId, messageId);
            return;
        }

        const hoy = new Date().toISOString().split('T')[0];
        const estados = await Promise.all([
            this.obtenerEstadoSesion('midday'),
            this.obtenerEstadoSesion('evening')
        ]);

        const estadoMediodia = estados[0];
        const estadoNoche = estados[1];

        let infoSesiones = `📅 *Fecha:* ${hoy}\n\n`;

        infoSesiones += `☀️ *MEDIODÍA:* ${estadoMediodia.mensaje}\n`;
        if (estadoMediodia.sorteo?.numero_ganador) {
            infoSesiones += `🎯 Ganador: ${estadoMediodia.sorteo.numero_ganador}\n`;
        }
        infoSesiones += `\n`;

        infoSesiones += `🌙 *NOCHE:* ${estadoNoche.mensaje}\n`;
        if (estadoNoche.sorteo?.numero_ganador) {
            infoSesiones += `🎯 Ganador: ${estadoNoche.sorteo.numero_ganador}\n`;
        }

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
            `*Moneda de apuesta:* 💵 *CUP*\n\n` +
            `*Tipos de apuesta:*\n` +
            `• Centena (3 dígitos): 500x\n` +
            `• Fijo (2 dígitos): 75x\n` +
            `• Corrido (2 dígitos): 25x\n` +
            `• Parlet (XX-YY): 10x\n` +
            `• Candado (XX-YY-ZZ): 1000x\n\n` +
            `*Límites de apuesta:*\n` +
            `• Mínimo: ${this.minimoApuesta} CUP\n` +
            `• Máximo: ${this.maximoApuesta} CUP\n\n` +
            `*ESTADO DE SESIONES HOY:*\n` +
            infoSesiones +
            `\nSelecciona una opción:`;

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

    // ==================== MENÚ DE ADMINISTRACIÓN ====================
    async mostrarMenuAdmin(chatId, messageId = null) {
        const hoy = new Date().toISOString().split('T')[0];
        const estados = await Promise.all([
            this.obtenerEstadoSesion('midday'),
            this.obtenerEstadoSesion('evening')
        ]);

        const estadoMediodia = estados[0];
        const estadoNoche = estados[1];

        const teclado = {
            inline_keyboard: [
                [
                    { text: `☀️ Mediodía (${estadoMediodia.estado})`, callback_data: 'bolita_admin_gestion:midday' },
                    { text: `🌙 Noche (${estadoNoche.estado})`, callback_data: 'bolita_admin_gestion:evening' }
                ],
                [
                    { text: '📊 Ver Reporte Diario', callback_data: 'bolita_admin_reporte_diario' },
                    { text: '📋 Ver Todas Apuestas', callback_data: 'bolita_admin_todas_apuestas' }
                ],
                [
                    { text: '👥 Ver Ganadores', callback_data: 'bolita_admin_ganadores' },
                    { text: '💰 Balance General', callback_data: 'bolita_admin_balance' }
                ],
                [
                    { text: '🔍 Buscar Usuario', callback_data: 'bolita_admin_buscar_usuario' },
                    { text: '📅 Historial Sorteos', callback_data: 'bolita_admin_historial' }
                ],
                [
                    { text: '📊 Estadísticas Completas', callback_data: 'bolita_admin_estadisticas_completas' },
                    { text: '🔄 Actualizar Estado', callback_data: 'bolita_menu' }
                ],
                [
                    { text: '🔙 Volver al Menú Usuario', callback_data: 'bolita_menu_user' }
                ]
            ]
        };

        const mensaje = `👑 *PANEL DE ADMINISTRACIÓN - LA BOLITA*\n\n` +
            `📅 *Fecha:* ${hoy}\n\n` +
            `*ESTADO DE SESIONES:*\n` +
            `☀️ MEDIODÍA: ${estadoMediodia.mensaje}\n` +
            `🌙 NOCHE: ${estadoNoche.mensaje}\n\n` +
            `*ACCIONES DISPONIBLES:*\n` +
            `• Gestionar cada sesión (abrir/cerrar/completar)\n` +
            `• Ver reportes y estadísticas\n` +
            `• Buscar información de usuarios\n` +
            `• Consultar balance general\n\n` +
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

    // ==================== GESTIÓN DE SESIÓN (ADMIN) ====================
    async mostrarGestionSesion(chatId, messageId, sesion) {
        const estado = await this.obtenerEstadoSesion(sesion);
        const sesionNombre = this.sesiones[sesion];
        
        const teclado = {
            inline_keyboard: []
        };

        // Botones según estado actual
        switch(estado.estado) {
            case 'inactiva':
                teclado.inline_keyboard.push([
                    { text: '✅ Abrir Apuestas', callback_data: `bolita_admin_abrir:${sesion}` }
                ]);
                break;
                
            case 'abierta':
                teclado.inline_keyboard.push([
                    { text: '⏸️ Cerrar Apuestas', callback_data: `bolita_admin_cerrar:${sesion}` }
                ]);
                // Mostrar resumen de apuestas
                const resumen = await this.obtenerResumenApuestasSesion(sesion);
                if (resumen.total > 0) {
                    teclado.inline_keyboard.push([
                        { text: `📊 Ver Apuestas (${resumen.total})`, callback_data: `bolita_admin_ver_apuestas:${sesion}` }
                    ]);
                }
                break;
                
            case 'cerrada':
                teclado.inline_keyboard.push([
                    { text: '🎯 Cargar Resultado', callback_data: `bolita_admin_cargar:${sesion}` },
                    { text: '🔄 Reabrir Apuestas', callback_data: `bolita_admin_reabrir:${sesion}` }
                ]);
                break;
                
            case 'completada':
                teclado.inline_keyboard.push([
                    { text: '📋 Ver Ganadores', callback_data: `bolita_admin_ver_ganadores:${sesion}` },
                    { text: '📊 Ver Reporte', callback_data: `bolita_admin_reporte:${sesion}` }
                ]);
                break;
        }

        // Botones fijos
        teclado.inline_keyboard.push([
            { text: '📈 Estadísticas Sesión', callback_data: `bolita_admin_stats_sesion:${sesion}` }
        ]);
        teclado.inline_keyboard.push([
            { text: '🔙 Volver al Panel', callback_data: 'bolita_admin_menu' }
        ]);

        let mensaje = `👑 *GESTIÓN DE SESIÓN - ${sesionNombre}*\n\n`;
        mensaje += `📅 *Fecha:* ${new Date().toISOString().split('T')[0]}\n`;
        mensaje += `📊 *Estado:* ${estado.mensaje}\n\n`;

        // Información adicional según estado
        if (estado.sorteo) {
            if (estado.sorteo.numero_ganador) {
                mensaje += `🎯 *Número Ganador:* ${estado.sorteo.numero_ganador}\n`;
                mensaje += `🔢 *Desglose:* ${estado.sorteo.centena || ''} | ${estado.sorteo.fijo || ''} | ${estado.sorteo.corrido1 || ''}, ${estado.sorteo.corrido2 || ''}\n\n`;
            }
            
            const resumen = await this.obtenerResumenApuestasSesion(sesion);
            mensaje += `📊 *RESUMEN DE APUESTAS:*\n`;
            mensaje += `• Total apuestas: ${resumen.total}\n`;
            mensaje += `• Total apostado: ${resumen.total_apostado} CUP\n`;
            
            if (estado.estado === 'completada') {
                mensaje += `• Ganadores: ${resumen.ganadores}\n`;
                mensaje += `• Total a pagar: ${resumen.total_pagado} CUP\n`;
            }
        }

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

    // ==================== ACCIONES DE ADMINISTRACIÓN ====================
    async abrirSesion(chatId, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const sesionNombre = this.sesiones[sesion];
            
            // Verificar si ya existe un sorteo para hoy
            const { data: sorteoExistente } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (sorteoExistente) {
                // Actualizar estado
                await this.supabase
                    .from('bolita_sorteos')
                    .update({
                        estado_sesion: 'abierta',
                        hora_apertura: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', sorteoExistente.id);
            } else {
                // Crear nuevo sorteo
                await this.supabase
                    .from('bolita_sorteos')
                    .insert([{
                        fecha: hoy,
                        sesion: sesion,
                        estado_sesion: 'abierta',
                        hora_apertura: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }]);
            }
            
            const mensaje = `✅ *SESIÓN ABIERTA*\n\n` +
                `📅 *Sesión:* ${sesionNombre}\n` +
                `📅 *Fecha:* ${hoy}\n` +
                `⏰ *Hora de apertura:* ${new Date().toLocaleTimeString()}\n\n` +
                `Los usuarios ya pueden comenzar a apostar.`;
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
            // Notificar a los usuarios si está configurado
            await this.notificarAperturaSesion(sesion);
            
            // Actualizar el menú de gestión
            await this.mostrarGestionSesion(chatId, null, sesion);
            
        } catch (error) {
            console.error('Error abriendo sesión:', error);
            await this.bot.sendMessage(chatId, '❌ Error al abrir la sesión.');
        }
    }

    async cerrarSesion(chatId, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const sesionNombre = this.sesiones[sesion];
            
            // Obtener sorteo
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                await this.bot.sendMessage(chatId, '❌ No hay sesión activa para cerrar.');
                return;
            }
            
            // Actualizar estado
            await this.supabase
                .from('bolita_sorteos')
                .update({
                    estado_sesion: 'cerrada',
                    hora_cierre: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', sorteo.id);
            
            // Obtener resumen
            const resumen = await this.obtenerResumenApuestasSesion(sesion);
            
            const mensaje = `⏸️ *SESIÓN CERRADA*\n\n` +
                `📅 *Sesión:* ${sesionNombre}\n` +
                `📅 *Fecha:* ${hoy}\n` +
                `⏰ *Hora de cierre:* ${new Date().toLocaleTimeString()}\n\n` +
                `📊 *RESUMEN DE APUESTAS:*\n` +
                `• Total apuestas: ${resumen.total}\n` +
                `• Total apostado: ${resumen.total_apostado} CUP\n` +
                `• Número de apostadores: ${resumen.apostadores}\n\n` +
                `Ahora puedes cargar el resultado del sorteo.`;
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
            // Actualizar el menú de gestión
            await this.mostrarGestionSesion(chatId, null, sesion);
            
        } catch (error) {
            console.error('Error cerrando sesión:', error);
            await this.bot.sendMessage(chatId, '❌ Error al cerrar la sesión.');
        }
    }

    async iniciarCargaResultado(chatId, sesion) {
        const sesionNombre = this.sesiones[sesion];
        
        this.setUserState(chatId, {
            step: 'admin_cargando_resultado',
            sesion: sesion
        });
        
        await this.bot.sendMessage(chatId,
            `🎯 *CARGAR RESULTADO - ${sesionNombre}*\n\n` +
            `Por favor, escribe el número ganador de Florida (7 dígitos):\n\n` +
            `Ejemplo: \`1234567\`\n\n` +
            `Formato: 7 dígitos exactos\n` +
            `Basado en el resultado oficial de Florida.\n\n` +
            `⚠️ *IMPORTANTE:*\n` +
            `• Verifica que el número sea correcto\n` +
            `• Esta acción no se puede deshacer\n` +
            `• Se procesarán automáticamente todas las apuestas`,
            { parse_mode: 'Markdown' }
        );
    }

    async procesarResultado(chatId, userId, numeroCompleto) {
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'admin_cargando_resultado') {
            return false;
        }
        
        const sesion = estado.sesion;
        const sesionNombre = this.sesiones[sesion];
        
        // Validar formato
        if (!/^\d{7}$/.test(numeroCompleto)) {
            await this.bot.sendMessage(chatId,
                `❌ *Formato incorrecto*\n\n` +
                `Debe ser un número de *7 dígitos* (ej: 1234567)\n` +
                `Este es el formato de Florida 3\n\n` +
                `Por favor, escribe el número correctamente:`,
                { parse_mode: 'Markdown' }
            );
            return true;
        }
        
        try {
            await this.bot.sendMessage(chatId, `⏳ *Procesando resultado...*`, { parse_mode: 'Markdown' });
            
            const hoy = new Date().toISOString().split('T')[0];
            
            // Desglosar número
            const centena = numeroCompleto.substring(0, 3);
            const fijo = numeroCompleto.substring(1, 3);
            const cuarteta = numeroCompleto.substring(3, 7);
            const corrido1 = cuarteta.substring(0, 2);
            const corrido2 = cuarteta.substring(2, 4);
            
            // Obtener sorteo
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                await this.bot.sendMessage(chatId, '❌ No se encontró la sesión.');
                this.clearUserState(userId);
                return true;
            }
            
            // Actualizar sorteo con resultado
            await this.supabase
                .from('bolita_sorteos')
                .update({
                    numero_ganador: numeroCompleto,
                    centena: centena,
                    fijo: fijo,
                    cuarteta: cuarteta,
                    corrido1: corrido1,
                    corrido2: corrido2,
                    estado_sesion: 'completada',
                    hora_resultado: new Date().toISOString(),
                    updated_at: new Date().toISOString()
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
            
            // Mostrar resumen completo
            await this.mostrarResumenResultado(chatId, sesion, numeroCompleto, resultado);
            
            // Limpiar estado
            this.clearUserState(userId);
            
            // Notificar a los ganadores
            await this.notificarResultadoSesion(sesion, numeroCompleto, resultado.ganadores);
            
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

    async mostrarResumenResultado(chatId, sesion, numeroGanador, resultado) {
        const sesionNombre = this.sesiones[sesion];
        const hoy = new Date().toISOString().split('T')[0];
        
        let mensaje = `🏁 *RESULTADO PROCESADO - ${sesionNombre}*\n\n`;
        mensaje += `📅 *Fecha:* ${hoy}\n`;
        mensaje += `🎯 *Número Ganador:* ${numeroGanador}\n\n`;
        
        // Desglose del número
        const centena = numeroGanador.substring(0, 3);
        const fijo = numeroGanador.substring(1, 3);
        const corrido1 = numeroGanador.substring(3, 5);
        const corrido2 = numeroGanador.substring(5, 7);
        
        mensaje += `🔢 *Desglose:*\n`;
        mensaje += `• Centena: ${centena}\n`;
        mensaje += `• Fijo: ${fijo}\n`;
        mensaje += `• Corridos: ${corrido1}, ${corrido2}\n\n`;
        
        mensaje += `📊 *RESUMEN DEL SORTEO:*\n`;
        mensaje += `• Total apuestas: ${resultado.totalApuestas}\n`;
        mensaje += `• Total apostado: ${resultado.totalApostado} CUP\n`;
        mensaje += `• Ganadores: ${resultado.ganadores.length}\n`;
        mensaje += `• Total a pagar: ${resultado.totalPagado} CUP\n`;
        mensaje += `• Balance neto: ${resultado.totalApostado - resultado.totalPagado} CUP\n\n`;
        
        if (resultado.ganadores.length > 0) {
            mensaje += `🏆 *LISTA DE GANADORES:*\n\n`;
            
            resultado.ganadores.slice(0, 10).forEach((ganador, index) => {
                mensaje += `${index + 1}. Ticket #${ganador.ticket_id}\n`;
                mensaje += `   👤 ${ganador.nombre}\n`;
                mensaje += `   🎯 ${ganador.tipo}: ${ganador.numeros}\n`;
                mensaje += `   💰 Ganó: ${ganador.ganancia} CUP\n`;
                mensaje += `   ---\n`;
            });
            
            if (resultado.ganadores.length > 10) {
                mensaje += `\n... y ${resultado.ganadores.length - 10} ganadores más`;
            }
        } else {
            mensaje += `😔 *No hubo ganadores en esta sesión*`;
        }
        
        await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        
        // Mostrar teclado de opciones
        const teclado = {
            inline_keyboard: [
                [
                    { text: '📋 Ver Reporte Detallado', callback_data: `bolita_admin_reporte_detalle:${sesion}` },
                    { text: '👥 Contactar Ganadores', callback_data: `bolita_admin_contactar_ganadores:${sesion}` }
                ],
                [
                    { text: '💰 Ver Balance', callback_data: `bolita_admin_balance_sesion:${sesion}` },
                    { text: '📊 Estadísticas', callback_data: `bolita_admin_stats_sesion:${sesion}` }
                ],
                [
                    { text: '🔙 Volver al Panel', callback_data: 'bolita_admin_menu' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, '¿Qué deseas hacer ahora?', { reply_markup: teclado });
    }

    // ==================== PROCESAR APUESTAS DEL SORTEO ====================
    async procesarApuestasSorteo(sorteoId, numeroGanador) {
        const { data: apuestas } = await this.supabase
            .from('bolita_apuestas')
            .select('*, users!inner(first_name, username, balance_cup)')
            .eq('sorteo_id', sorteoId)
            .eq('estado', 'pendiente');
        
        let ganadores = [];
        let totalPagado = 0;
        let totalApostado = 0;
        
        if (apuestas) {
            for (const apuesta of apuestas) {
                totalApostado += apuesta.monto;
                
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
                    
                    // Acreditar ganancia (EN CUP)
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
                    
                } else {
                    // Marcar como perdida
                    await this.supabase
                        .from('bolita_apuestas')
                        .update({ estado: 'perdida' })
                        .eq('id', apuesta.id);
                }
            }
        }
        
        return {
            ganadores: ganadores,
            totalPagado: totalPagado,
            totalApostado: totalApostado,
            totalApuestas: apuestas ? apuestas.length : 0
        };
    }

    // ==================== MENÚ DE TIPOS DE APUESTA (USUARIO) ====================
    async mostrarTiposApuesta(chatId, messageId = null) {
        const hoy = new Date().toISOString().split('T')[0];
        const estados = await Promise.all([
            this.obtenerEstadoSesion('midday'),
            this.obtenerEstadoSesion('evening')
        ]);

        // Verificar si hay alguna sesión abierta
        const sesionesAbiertas = estados.filter(e => e.estado === 'abierta');
        
        if (sesionesAbiertas.length === 0) {
            let mensaje = `⏳ *No hay sesiones abiertas*\n\n`;
            mensaje += `*Estado de sesiones hoy:*\n`;
            
            estados.forEach((estado, index) => {
                const sesionNombre = index === 0 ? '☀️ Mediodía' : '🌙 Noche';
                mensaje += `${sesionNombre}: ${estado.mensaje}\n`;
            });
            
            mensaje += `\nSolo puedes apostar cuando el administrador abra una sesión.`;
            
            await this.bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'bolita_menu' }]] }
            });
            return;
        }

        // Si hay sesiones abiertas, mostrar selección
        const teclado = {
            inline_keyboard: []
        };

        estados.forEach((estado, index) => {
            if (estado.estado === 'abierta') {
                const sesion = index === 0 ? 'midday' : 'evening';
                const sesionNombre = this.sesiones[sesion];
                teclado.inline_keyboard.push([
                    { text: `${sesionNombre} - APOSTAR`, callback_data: `bolita_seleccionar_sesion:${sesion}` }
                ]);
            }
        });

        teclado.inline_keyboard.push([
            { text: '🔙 Volver', callback_data: 'bolita_menu' }
        ]);

        let mensaje = `🎯 *SELECCIONA SESIÓN PARA APOSTAR*\n\n`;
        mensaje += `📅 *Fecha:* ${hoy}\n\n`;
        mensaje += `*Sesiones disponibles:*\n`;

        estados.forEach((estado, index) => {
            const sesionNombre = index === 0 ? '☀️ Mediodía' : '🌙 Noche';
            const icono = estado.estado === 'abierta' ? '✅' : '❌';
            mensaje += `${icono} ${sesionNombre}: ${estado.mensaje}\n`;
        });

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

    // ==================== SELECCIONAR SESIÓN PARA APOSTAR ====================
    async seleccionarSesionParaApostar(chatId, userId, sesion) {
        const estadoSesion = await this.obtenerEstadoSesion(sesion);
        
        if (estadoSesion.estado !== 'abierta') {
            await this.bot.sendMessage(chatId,
                `❌ *Sesión no disponible*\n\n` +
                `La sesión ${this.sesiones[sesion]} ya no está abierta para apuestas.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const teclado = {
            inline_keyboard: [
                [
                    { text: '🎯 Fijo (2 dígitos)', callback_data: `bolita_tipo_fijo:${sesion}` },
                    { text: '🔢 Centena (3 dígitos)', callback_data: `bolita_tipo_centena:${sesion}` }
                ],
                [
                    { text: '🔄 Corrido (2 dígitos)', callback_data: `bolita_tipo_corrido:${sesion}` },
                    { text: '🔗 Parlet (XX-YY)', callback_data: `bolita_tipo_parlet:${sesion}` }
                ],
                [
                    { text: '🔐 Candado (XX-YY-ZZ)', callback_data: `bolita_tipo_candado:${sesion}` },
                    { text: '🔙 Volver', callback_data: 'bolita_apostar' }
                ]
            ]
        };

        const mensaje = `🎯 *Selecciona el tipo de apuesta*\n\n` +
            `📅 *Sesión:* ${this.sesiones[sesion]}\n\n` +
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

        await this.bot.sendMessage(chatId, mensaje, {
            parse_mode: 'Markdown',
            reply_markup: teclado
        });
    }

    // ==================== INICIAR FLUJO DE APUESTA ====================
    async iniciarFlujoApuesta(chatId, userId, tipo, sesion) {
        // Verificar que la sesión esté abierta
        const estadoSesion = await this.obtenerEstadoSesion(sesion);
        if (estadoSesion.estado !== 'abierta') {
            await this.bot.sendMessage(chatId,
                `❌ *Sesión cerrada*\n\n` +
                `La sesión ${this.sesiones[sesion]} ya no acepta apuestas.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

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
            tipo: tipo,
            sesion: sesion
        });
        
        await this.bot.sendMessage(chatId,
            `🎯 *Apuesta: ${this.obtenerNombreTipo(tipo)}*\n\n` +
            `📅 *Sesión:* ${this.sesiones[sesion]}\n` +
            `📋 *Formato:* ${descripcion}\n` +
            `📝 *Ejemplo:* \`${ejemplo}\`\n\n` +
            `Por favor, escribe los números (sin espacios):`,
            { parse_mode: 'Markdown' }
        );
    }

    // ==================== FUNCIONES ADMIN COMPLETAS ====================

    // 1. VER TODAS LAS APUESTAS
    async mostrarTodasApuestasAdmin(chatId) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*, users!inner(first_name, username), bolita_sorteos(fecha, sesion)')
                .eq('bolita_sorteos.fecha', hoy)
                .order('created_at', { ascending: false })
                .limit(50);
            
            if (!apuestas || apuestas.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay apuestas hoy.');
                return;
            }
            
            // Agrupar por sesión
            const porSesion = {};
            let totalGeneral = 0;
            let totalApostado = 0;
            
            apuestas.forEach(apuesta => {
                const sesion = apuesta.sesion || 'midday';
                if (!porSesion[sesion]) {
                    porSesion[sesion] = {
                        apuestas: [],
                        total: 0,
                        totalApostado: 0
                    };
                }
                porSesion[sesion].apuestas.push(apuesta);
                porSesion[sesion].total++;
                porSesion[sesion].totalApostado += apuesta.monto;
                totalGeneral++;
                totalApostado += apuesta.monto;
            });
            
            let mensaje = `📋 *TODAS LAS APUESTAS DE HOY*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n`;
            mensaje += `📊 *Total apuestas:* ${totalGeneral}\n`;
            mensaje += `💰 *Total apostado:* ${totalApostado} CUP\n\n`;
            
            Object.keys(porSesion).forEach(sesion => {
                const sesionNombre = this.sesiones[sesion];
                mensaje += `*${sesionNombre}*\n`;
                mensaje += `• Apuestas: ${porSesion[sesion].total}\n`;
                mensaje += `• Total: ${porSesion[sesion].totalApostado} CUP\n`;
                
                // Top 3 apostadores
                const apostadores = {};
                porSesion[sesion].apuestas.forEach(a => {
                    if (!apostadores[a.user_id]) {
                        apostadores[a.user_id] = {
                            nombre: a.users.first_name,
                            total: 0
                        };
                    }
                    apostadores[a.user_id].total += a.monto;
                });
                
                const topApostadores = Object.values(apostadores)
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 3);
                
                if (topApostadores.length > 0) {
                    mensaje += `🏆 *Top apostadores:*\n`;
                    topApostadores.forEach((ap, idx) => {
                        mensaje += `${idx + 1}. ${ap.nombre}: ${ap.total} CUP\n`;
                    });
                }
                
                mensaje += `\n`;
            });
            
            // Mostrar últimas 5 apuestas
            mensaje += `🔄 *ÚLTIMAS APUESTAS:*\n`;
            apuestas.slice(0, 5).forEach((apuesta, index) => {
                const hora = new Date(apuesta.created_at).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                mensaje += `${index + 1}. ${apuesta.users.first_name} - ${apuesta.tipo_apuesta} ${apuesta.numero_apostado}\n`;
                mensaje += `   💰 ${apuesta.monto} CUP - ${hora}\n`;
                mensaje += `   ---\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando todas apuestas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener las apuestas.');
        }
    }

    // 2. VER GANADORES
    async mostrarGanadoresAdmin(chatId) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const { data: ganadores } = await this.supabase
                .from('bolita_apuestas')
                .select('*, users!inner(first_name, username), bolita_sorteos(fecha, sesion, numero_ganador)')
                .eq('bolita_sorteos.fecha', hoy)
                .eq('estado', 'ganada')
                .order('ganado_en', { ascending: false });
            
            if (!ganadores || ganadores.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay ganadores hoy.');
                return;
            }
            
            // Agrupar por sesión
            const porSesion = {};
            let totalGanado = 0;
            
            ganadores.forEach(ganador => {
                const sesion = ganador.sesion || 'midday';
                if (!porSesion[sesion]) {
                    porSesion[sesion] = {
                        ganadores: [],
                        total: 0,
                        totalGanado: 0
                    };
                }
                porSesion[sesion].ganadores.push(ganador);
                porSesion[sesion].total++;
                porSesion[sesion].totalGanado += ganador.ganancia;
                totalGanado += ganador.ganancia;
            });
            
            let mensaje = `🏆 *GANADORES DE HOY*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n`;
            mensaje += `👥 *Total ganadores:* ${ganadores.length}\n`;
            mensaje += `💰 *Total a pagar:* ${totalGanado} CUP\n\n`;
            
            Object.keys(porSesion).forEach(sesion => {
                const sesionNombre = this.sesiones[sesion];
                const sesionData = porSesion[sesion];
                
                mensaje += `*${sesionNombre}*\n`;
                mensaje += `• Ganadores: ${sesionData.total}\n`;
                mensaje += `• Total: ${sesionData.totalGanado} CUP\n`;
                
                // Número ganador
                if (sesionData.ganadores[0]?.bolita_sorteos?.numero_ganador) {
                    mensaje += `• Número: ${sesionData.ganadores[0].bolita_sorteos.numero_ganador}\n`;
                }
                
                // Top 3 ganadores
                const topGanadores = sesionData.ganadores
                    .sort((a, b) => b.ganancia - a.ganancia)
                    .slice(0, 3);
                
                if (topGanadores.length > 0) {
                    mensaje += `🥇 *Mayores ganancias:*\n`;
                    topGanadores.forEach((g, idx) => {
                        const emoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
                        mensaje += `${emoji} ${g.users.first_name}: ${g.ganancia} CUP\n`;
                    });
                }
                
                mensaje += `\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando ganadores:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener los ganadores.');
        }
    }

    // 3. BALANCE GENERAL
    async mostrarBalanceGeneralAdmin(chatId) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            // Obtener todas las apuestas de hoy
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*, bolita_sorteos(fecha, sesion)')
                .eq('bolita_sorteos.fecha', hoy);
            
            if (!apuestas || apuestas.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay actividad hoy.');
                return;
            }
            
            // Calcular balances por sesión
            const balanceSesiones = {};
            let totalApostado = 0;
            let totalPagado = 0;
            
            apuestas.forEach(apuesta => {
                const sesion = apuesta.sesion || 'midday';
                if (!balanceSesiones[sesion]) {
                    balanceSesiones[sesion] = {
                        apostado: 0,
                        pagado: 0
                    };
                }
                
                balanceSesiones[sesion].apostado += apuesta.monto;
                totalApostado += apuesta.monto;
                
                if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                    balanceSesiones[sesion].pagado += apuesta.ganancia;
                    totalPagado += apuesta.ganancia;
                }
            });
            
            const balanceNeto = totalApostado - totalPagado;
            
            let mensaje = `💰 *BALANCE GENERAL - HOY*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n\n`;
            mensaje += `📊 *RESUMEN GENERAL:*\n`;
            mensaje += `• Total apostado: ${totalApostado} CUP\n`;
            mensaje += `• Total pagado: ${totalPagado} CUP\n`;
            mensaje += `• Balance neto: ${balanceNeto} CUP\n`;
            mensaje += `• Rentabilidad: ${((balanceNeto / totalApostado) * 100).toFixed(1)}%\n\n`;
            
            mensaje += `📈 *POR SESIÓN:*\n`;
            Object.keys(balanceSesiones).forEach(sesion => {
                const sesionNombre = this.sesiones[sesion];
                const sesionData = balanceSesiones[sesion];
                const balanceSesion = sesionData.apostado - sesionData.pagado;
                
                mensaje += `*${sesionNombre}*\n`;
                mensaje += `• Apostado: ${sesionData.apostado} CUP\n`;
                mensaje += `• Pagado: ${sesionData.pagado} CUP\n`;
                mensaje += `• Balance: ${balanceSesion} CUP\n`;
                mensaje += `• Rentabilidad: ${sesionData.apostado > 0 ? ((balanceSesion / sesionData.apostado) * 100).toFixed(1) : 0}%\n\n`;
            });
            
            // Estadísticas adicionales
            const apuestasActivas = apuestas.filter(a => a.estado === 'pendiente').length;
            const apuestasGanadas = apuestas.filter(a => a.estado === 'ganada').length;
            const apuestasPerdidas = apuestas.filter(a => a.estado === 'perdida').length;
            
            mensaje += `📈 *ESTADÍSTICAS ADICIONALES:*\n`;
            mensaje += `• Apuestas activas: ${apuestasActivas}\n`;
            mensaje += `• Apuestas ganadas: ${apuestasGanadas}\n`;
            mensaje += `• Apuestas perdidas: ${apuestasPerdidas}\n`;
            mensaje += `• Tasa de ganancia: ${apuestas.length > 0 ? ((apuestasGanadas / apuestas.length) * 100).toFixed(1) : 0}%\n`;
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando balance:', error);
            await this.bot.sendMessage(chatId, '❌ Error al calcular el balance.');
        }
    }

    // 4. BUSCAR USUARIO ESPECÍFICO
    async buscarUsuarioEspecificoAdmin(chatId) {
        this.setUserState(chatId, {
            step: 'admin_buscando_usuario',
            timestamp: Date.now()
        });
        
        await this.bot.sendMessage(chatId,
            `🔍 *BUSCAR USUARIO ESPECÍFICO*\n\n` +
            `Por favor, envía:\n` +
            `1. ID de Telegram del usuario\n` +
            `2. Nombre del usuario\n` +
            `3. O "cancelar" para volver\n\n` +
            `Ejemplo de ID: \`123456789\``,
            { parse_mode: 'Markdown' }
        );
    }

    // 5. HISTORIAL DE SORTEOS
    async mostrarHistorialSorteosAdmin(chatId) {
        try {
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado_sesion', 'completada')
                .order('fecha', { ascending: false })
                .limit(10);
            
            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay historial de sorteos.');
                return;
            }
            
            let mensaje = `📅 *HISTORIAL DE SORTEOS*\n\n`;
            
            sorteos.forEach((sorteo, index) => {
                const fecha = new Date(sorteo.fecha).toLocaleDateString('es-ES', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                });
                
                const sesionNombre = this.sesiones[sorteo.sesion];
                
                mensaje += `${index + 1}. *${fecha}*\n`;
                mensaje += `   📅 Sesión: ${sesionNombre}\n`;
                
                if (sorteo.numero_ganador) {
                    mensaje += `   🎯 Número: ${sorteo.numero_ganador}\n`;
                    mensaje += `   🔢 Centena: ${sorteo.centena} | Fijo: ${sorteo.fijo}\n`;
                }
                
                if (sorteo.hora_apertura && sorteo.hora_resultado) {
                    const apertura = new Date(sorteo.hora_apertura).toLocaleTimeString();
                    const resultado = new Date(sorteo.hora_resultado).toLocaleTimeString();
                    mensaje += `   ⏰ Apertura: ${apertura} | Resultado: ${resultado}\n`;
                }
                
                mensaje += `\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando historial:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener el historial.');
        }
    }

    // 6. ESTADÍSTICAS COMPLETAS
    async mostrarEstadisticasCompletasAdmin(chatId) {
        try {
            // Obtener datos de los últimos 7 días
            const fechaInicio = new Date();
            fechaInicio.setDate(fechaInicio.getDate() - 7);
            const fechaInicioStr = fechaInicio.toISOString().split('T')[0];
            
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*, bolita_apuestas(monto, estado, ganancia)')
                .gte('fecha', fechaInicioStr)
                .eq('estado_sesion', 'completada');
            
            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay suficientes datos para estadísticas.');
                return;
            }
            
            // Calcular estadísticas
            let totalSorteos = 0;
            let totalApostado = 0;
            let totalPagado = 0;
            const porSesion = {};
            
            sorteos.forEach(sorteo => {
                totalSorteos++;
                
                if (sorteo.bolita_apuestas) {
                    sorteo.bolita_apuestas.forEach(apuesta => {
                        totalApostado += apuesta.monto;
                        if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                            totalPagado += apuesta.ganancia;
                        }
                    });
                }
                
                // Contar por sesión
                if (!porSesion[sorteo.sesion]) {
                    porSesion[sorteo.sesion] = {
                        sorteos: 0,
                        apostado: 0,
                        pagado: 0
                    };
                }
                porSesion[sorteo.sesion].sorteos++;
            });
            
            const balanceNeto = totalApostado - totalPagado;
            const rentabilidad = totalApostado > 0 ? (balanceNeto / totalApostado * 100) : 0;
            
            let mensaje = `📊 *ESTADÍSTICAS COMPLETAS (Últimos 7 días)*\n\n`;
            mensaje += `📅 *Período:* ${fechaInicioStr} - Hoy\n\n`;
            
            mensaje += `📈 *RESUMEN GENERAL:*\n`;
            mensaje += `• Sorteos completados: ${totalSorteos}\n`;
            mensaje += `• Total apostado: ${totalApostado} CUP\n`;
            mensaje += `• Total pagado: ${totalPagado} CUP\n`;
            mensaje += `• Balance neto: ${balanceNeto} CUP\n`;
            mensaje += `• Rentabilidad: ${rentabilidad.toFixed(1)}%\n\n`;
            
            mensaje += `📊 *POR SESIÓN:*\n`;
            Object.keys(porSesion).forEach(sesion => {
                const sesionNombre = this.sesiones[sesion];
                mensaje += `*${sesionNombre}*\n`;
                mensaje += `• Sorteos: ${porSesion[sesion].sorteos}\n`;
                mensaje += `• Porcentaje: ${(porSesion[sesion].sorteos / totalSorteos * 100).toFixed(1)}%\n\n`;
            });
            
            // Promedios
            const promedioApostado = totalApostado / totalSorteos;
            const promedioPagado = totalPagado / totalSorteos;
            
            mensaje += `📉 *PROMEDIOS POR SORTEO:*\n`;
            mensaje += `• Apostado: ${promedioApostado.toFixed(0)} CUP\n`;
            mensaje += `• Pagado: ${promedioPagado.toFixed(0)} CUP\n`;
            mensaje += `• Balance: ${(promedioApostado - promedioPagado).toFixed(0)} CUP\n`;
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando estadísticas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al calcular estadísticas.');
        }
    }

    // ==================== FUNCIONES AUXILIARES ====================
    async obtenerResumenApuestasSesion(sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*')
                .eq('sesion', sesion)
                .eq('fecha_apuesta', '>=', hoy + 'T00:00:00')
                .eq('fecha_apuesta', '<=', hoy + 'T23:59:59');
            
            if (!apuestas) {
                return {
                    total: 0,
                    total_apostado: 0,
                    apostadores: 0,
                    ganadores: 0,
                    total_pagado: 0
                };
            }
            
            const apostadores = new Set();
            let ganadores = 0;
            let totalPagado = 0;
            let totalApostado = 0;
            
            apuestas.forEach(apuesta => {
                apostadores.add(apuesta.user_id);
                totalApostado += apuesta.monto;
                
                if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                    ganadores++;
                    totalPagado += apuesta.ganancia;
                }
            });
            
            return {
                total: apuestas.length,
                total_apostado: totalApostado,
                apostadores: apostadores.size,
                ganadores: ganadores,
                total_pagado: totalPagado
            };
        } catch (error) {
            console.error('Error obteniendo resumen:', error);
            return { total: 0, total_apostado: 0, apostadores: 0, ganadores: 0, total_pagado: 0 };
        }
    }

    async notificarAperturaSesion(sesion) {
        try {
            // Aquí podrías enviar una notificación a todos los usuarios
            // Por ahora solo lo registramos en el log
            console.log(`Sesión ${sesion} abierta para apuestas`);
        } catch (error) {
            console.error('Error notificando apertura:', error);
        }
    }

    async notificarResultadoSesion(sesion, numeroGanador, ganadores) {
        try {
            // Notificar a cada ganador individualmente
            for (const ganador of ganadores) {
                try {
                    await this.bot.sendMessage(ganador.user_id,
                        `🎉 *¡FELICIDADES! GANASTE EN LA BOLITA*\n\n` +
                        `📅 *Sesión:* ${this.sesiones[sesion]}\n` +
                        `🎯 *Número ganador:* ${numeroGanador}\n` +
                        `💰 *Ganaste:* ${ganador.ganancia} CUP\n\n` +
                        `El monto ha sido acreditado a tu billetera en CUP.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (error) {
                    // Usuario puede haber bloqueado el bot
                    console.error(`Error notificando ganador ${ganador.user_id}:`, error);
                }
            }
            
            // También podrías enviar un anuncio general al canal
            if (this.adminChatId) {
                await this.bot.sendMessage(this.adminChatId,
                    `🏁 *RESULTADO PUBLICADO*\n\n` +
                    `📅 *Sesión:* ${this.sesiones[sesion]}\n` +
                    `🎯 *Número ganador:* ${numeroGanador}\n` +
                    `👥 *Ganadores:* ${ganadores.length} usuario(s)\n` +
                    `💰 *Total pagado:* ${ganadores.reduce((sum, g) => sum + g.ganancia, 0)} CUP`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            console.error('Error notificando resultado:', error);
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
                const parts = data.split(':');
                const actionPart = parts[0];
                const actionParts = actionPart.split('_');
                const action = actionParts[1];
                const subaction = actionParts[2];
                const parametro = parts[1];

                // MENÚ PRINCIPAL
                if (action === 'menu') {
                    if (subaction === 'user') {
                        // Forzar modo usuario
                        await this.mostrarMenuPrincipal(chatId, messageId);
                    } else {
                        await this.mostrarMenuPrincipal(chatId, messageId);
                    }
                    return true;
                }
                
                // ADMIN MENU
                if (action === 'admin') {
                    if (!this.esAdmin(userId)) {
                        await this.bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
                        return true;
                    }
                    
                    if (subaction === 'menu') {
                        await this.mostrarMenuAdmin(chatId, messageId);
                        return true;
                    }
                    
                    if (subaction === 'gestion' && parametro) {
                        await this.mostrarGestionSesion(chatId, messageId, parametro);
                        return true;
                    }
                    
                    if (subaction === 'abrir' && parametro) {
                        await this.abrirSesion(chatId, parametro);
                        return true;
                    }
                    
                    if (subaction === 'cerrar' && parametro) {
                        await this.cerrarSesion(chatId, parametro);
                        return true;
                    }
                    
                    if (subaction === 'cargar' && parametro) {
                        await this.iniciarCargaResultado(chatId, parametro);
                        return true;
                    }
                    
                    if (subaction === 'reabrir' && parametro) {
                        await this.abrirSesion(chatId, parametro);
                        return true;
                    }
                    
                    if (subaction === 'ver' && parametro) {
                        if (subaction === 'ver' && actionParts[3] === 'apuestas') {
                            await this.mostrarApuestasSesionAdmin(chatId, parametro);
                            return true;
                        }
                    }
                    
                    if (subaction === 'reporte') {
                        if (parametro === 'diario') {
                            await this.mostrarReporteDiarioAdmin(chatId);
                            return true;
                        }
                        if (parametro) {
                            await this.mostrarReporteSesionAdmin(chatId, parametro);
                            return true;
                        }
                    }
                    
                    if (subaction === 'todas' && actionParts[2] === 'apuestas') {
                        await this.mostrarTodasApuestasAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'ganadores') {
                        await this.mostrarGanadoresAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'balance') {
                        await this.mostrarBalanceGeneralAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'buscar' && actionParts[2] === 'usuario') {
                        await this.buscarUsuarioEspecificoAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'historial') {
                        await this.mostrarHistorialSorteosAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'estadisticas' && actionParts[2] === 'completas') {
                        await this.mostrarEstadisticasCompletasAdmin(chatId);
                        return true;
                    }
                    
                    if (subaction === 'stats' && parametro) {
                        await this.mostrarEstadisticasSesionAdmin(chatId, parametro);
                        return true;
                    }
                    
                    return true;
                }
                
                // USUARIO - APOSTAR
                if (action === 'apostar') {
                    await this.mostrarTiposApuesta(chatId, messageId);
                    return true;
                }
                
                // USUARIO - SELECCIONAR SESIÓN
                if (action === 'seleccionar' && subaction === 'sesion' && parametro) {
                    await this.seleccionarSesionParaApostar(chatId, userId, parametro);
                    return true;
                }
                
                // USUARIO - TIPO DE APUESTA
                if (action === 'tipo' && parametro) {
                    const tipoParts = parametro.split(':');
                    const tipo = actionParts[2];
                    const sesion = tipoParts[1] || tipoParts[0];
                    
                    await this.iniciarFlujoApuesta(chatId, userId, tipo, sesion);
                    return true;
                }
                
                // USUARIO - MIS APUESTAS
                if (action === 'mis' && subaction === 'apuestas') {
                    await this.verMisApuestas(chatId, userId);
                    return true;
                }
                
                // USUARIO - RESULTADOS
                if (action === 'resultados') {
                    await this.verResultadosRecientes(chatId);
                    return true;
                }
                
                // USUARIO - BUSCAR
                if (action === 'buscar') {
                    await this.solicitarFechaBusqueda(chatId, messageId);
                    return true;
                }
                
                // USUARIO - ESTADÍSTICAS
                if (action === 'estadisticas') {
                    await this.mostrarEstadisticasSemanales(chatId, userId);
                    return true;
                }
                
                // USUARIO - AYUDA
                if (action === 'ayuda') {
                    await this.mostrarAyuda(chatId);
                    return true;
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
            if (text === '/bolita' || text === '/bolita@' + this.bot.username) {
                await this.mostrarMenuPrincipal(chatId);
                return true;
            }
            if (text === '/cancelar' || text === '/cancelar@' + this.bot.username) {
                this.clearUserState(userId);
                await this.bot.sendMessage(chatId, '❌ Operación cancelada.');
                return true;
            }
            if (text === '/admin_bolita' && this.esAdmin(userId)) {
                await this.mostrarMenuAdmin(chatId);
                return true;
            }
            return false;
        }

        // Verificar si el usuario está en un estado activo
        const estado = this.getUserState(userId);
        
        if (estado) {
            // Estados de usuario normal
            if (estado.step === 'esperando_numero') {
                return await this.procesarNumeroApuesta(chatId, userId, text);
            }
            
            if (estado.step === 'esperando_monto') {
                return await this.procesarMontoApuesta(chatId, userId, text);
            }
            
            // Estados de administrador
            if (estado.step === 'admin_cargando_resultado') {
                return await this.procesarResultado(chatId, userId, text);
            }
            
            if (estado.step === 'buscando_fecha') {
                await this.buscarResultadoPorFecha(chatId, text);
                this.clearUserState(userId);
                return true;
            }
            
            if (estado.step === 'admin_buscando_usuario') {
                await this.procesarBusquedaUsuarioAdmin(chatId, text);
                return true;
            }
        }

        // Si es admin y escribe un número de 7 dígitos
        if (this.esAdmin(userId) && /^\d{7}$/.test(text)) {
            // Preguntar para qué sesión es
            await this.bot.sendMessage(chatId,
                `👑 *¿Para qué sesión es este resultado?*\n\n` +
                `Número: ${text}\n\n` +
                `Selecciona la sesión:`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '☀️ Mediodía', callback_data: `bolita_admin_cargar:midday` },
                                { text: '🌙 Noche', callback_data: `bolita_admin_cargar:evening` }
                            ]
                        ]
                    }
                }
            );
            return true;
        }

        return false;
    }

    // ==================== FUNCIONES RESTANTES (MANTENIDAS DEL CÓDIGO ANTERIOR) ====================
    // Nota: Las siguientes funciones son similares a las del código anterior,
    // pero se mantienen por compatibilidad. Solo se muestran los prototipos.

    async procesarNumeroApuesta(chatId, userId, numeroTexto) {
        // Implementación similar a la anterior
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'esperando_numero') {
            return false;
        }
        
        // ... resto de la implementación
        return true;
    }

    async procesarMontoApuesta(chatId, userId, montoTexto) {
        // Implementación similar a la anterior
        const estado = this.getUserState(userId);
        if (!estado || estado.step !== 'esperando_monto') {
            return false;
        }
        
        // ... resto de la implementación
        return true;
    }

    async verMisApuestas(chatId, userId) {
        // Implementación similar a la anterior
        try {
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*, bolita_sorteos(numero_ganador, fecha, hora, sesion)')
                .eq('user_id', userId)
                .order('fecha_apuesta', { ascending: false })
                .limit(15);
            
            // ... resto de la implementación
        } catch (error) {
            console.error('Error obteniendo apuestas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener tus apuestas.');
        }
    }

    async verResultadosRecientes(chatId) {
        // Implementación similar a la anterior
        try {
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado_sesion', 'completada')
                .order('fecha', { ascending: false })
                .limit(5);
            
            // ... resto de la implementación
        } catch (error) {
            console.error('Error obteniendo resultados:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener resultados.');
        }
    }

    async buscarResultadoPorFecha(chatId, fecha) {
        // Implementación similar a la anterior
        try {
            const fechaBusqueda = fecha.toLowerCase() === 'hoy' 
                ? new Date().toISOString().split('T')[0] 
                : fecha;
            
            // ... resto de la implementación
        } catch (error) {
            console.error('Error buscando resultado:', error);
            await this.bot.sendMessage(chatId, '❌ Error al buscar resultados.');
        }
    }

    async solicitarFechaBusqueda(chatId, messageId) {
        this.setUserState(chatId, { step: 'buscando_fecha', timestamp: Date.now() });
        
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
            `2. Elige la sesión disponible (Mediodía/Noche)\n` +
            `3. Selecciona el tipo de apuesta\n` +
            `4. Escribe los números según el formato\n` +
            `5. Escribe el monto en *CUP*\n\n` +
            `*Moneda:* 💵 *Solo se acepta CUP*\n\n` +
            `*Tipos de apuesta:*\n` +
            `• Fijo: 2 últimos dígitos de la centena\n` +
            `• Centena: 3 primeros dígitos\n` +
            `• Corrido: Pares de la cuarteta (45 o 67)\n` +
            `• Parlet: Combinación de dos apuestas\n` +
            `• Candado: Combinación exacta\n\n` +
            `*Proceso controlado por administrador:*\n` +
            `1. Admin abre sesión para apuestas\n` +
            `2. Usuarios apuestan\n` +
            `3. Admin cierra apuestas\n` +
            `4. Admin carga resultado\n` +
            `5. Sistema paga automáticamente a ganadores`;

        await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
    }

    async mostrarEstadisticasSemanales(chatId, userId) {
        // Implementación básica de estadísticas
        const fechaInicio = new Date();
        fechaInicio.setDate(fechaInicio.getDate() - 7);
        const fechaInicioStr = fechaInicio.toISOString().split('T')[0];

        try {
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*')
                .eq('user_id', userId)
                .gte('fecha_apuesta', fechaInicioStr);

            if (!apuestas || apuestas.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No tienes apuestas en la última semana.');
                return;
            }

            let totalApostado = 0;
            let totalGanado = 0;
            let ganadas = 0;
            let perdidas = 0;

            apuestas.forEach(apuesta => {
                totalApostado += apuesta.monto;
                if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                    totalGanado += apuesta.ganancia;
                    ganadas++;
                } else if (apuesta.estado === 'perdida') {
                    perdidas++;
                }
            });

            const balance = totalGanado - totalApostado;
            const porcentajeGanadas = apuestas.length > 0 ? (ganadas / apuestas.length * 100).toFixed(1) : 0;

            const mensaje = `📊 *TUS ESTADÍSTICAS (Última semana)*\n\n` +
                `📅 Período: ${fechaInicioStr} - Hoy\n\n` +
                `📈 *RESUMEN:*\n` +
                `• Apuestas realizadas: ${apuestas.length}\n` +
                `• Ganadas: ${ganadas} (${porcentajeGanadas}%)\n` +
                `• Perdidas: ${perdidas}\n\n` +
                `💰 *FINANCIERO:*\n` +
                `• Total apostado: ${totalApostado} CUP\n` +
                `• Total ganado: ${totalGanado} CUP\n` +
                `• Balance: ${balance} CUP\n` +
                `• Rentabilidad: ${totalApostado > 0 ? (balance / totalApostado * 100).toFixed(1) : 0}%`;

            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener estadísticas.');
        }
    }

    async procesarBusquedaUsuarioAdmin(chatId, texto) {
        try {
            const userId = parseInt(texto.trim());
            
            if (isNaN(userId)) {
                // Buscar por nombre
                const { data: usuarios } = await this.supabase
                    .from('users')
                    .select('telegram_id, first_name, username, phone_number')
                    .ilike('first_name', `%${texto}%`)
                    .limit(5);
                
                if (!usuarios || usuarios.length === 0) {
                    await this.bot.sendMessage(chatId, `❌ No se encontraron usuarios con "${texto}".`);
                    return;
                }
                
                if (usuarios.length === 1) {
                    await this.mostrarInfoUsuarioAdmin(chatId, usuarios[0].telegram_id);
                } else {
                    let mensaje = `🔍 *Usuarios encontrados (${usuarios.length}):*\n\n`;
                    
                    usuarios.forEach((usuario, index) => {
                        mensaje += `${index + 1}. ${usuario.first_name} (@${usuario.username || 'N/A'})\n`;
                        mensaje += `   🆔 ID: ${usuario.telegram_id}\n`;
                        mensaje += `   📞 ${usuario.phone_number ? `+53 ${usuario.phone_number.substring(2)}` : 'Sin teléfono'}\n`;
                        mensaje += `   ---\n`;
                    });
                    
                    mensaje += `\nEnvía el ID del usuario para ver más detalles.`;
                    
                    await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
                }
            } else {
                await this.mostrarInfoUsuarioAdmin(chatId, userId);
            }
            
            this.clearUserState(chatId);
            
        } catch (error) {
            console.error('Error buscando usuario:', error);
            await this.bot.sendMessage(chatId, '❌ Error al buscar usuario.');
        }
    }

    async mostrarInfoUsuarioAdmin(chatId, userId) {
        try {
            const user = await this.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, `❌ Usuario con ID ${userId} no encontrado.`);
                return;
            }
            
            // Obtener apuestas del usuario
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*')
                .eq('user_id', userId)
                .order('fecha_apuesta', { ascending: false })
                .limit(10);
            
            // Calcular estadísticas
            let totalApostado = 0;
            let totalGanado = 0;
            let apuestasGanadas = 0;
            let apuestasPerdidas = 0;
            let apuestasPendientes = 0;
            
            if (apuestas) {
                apuestas.forEach(apuesta => {
                    totalApostado += apuesta.monto;
                    
                    if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                        totalGanado += apuesta.ganancia;
                        apuestasGanadas++;
                    } else if (apuesta.estado === 'perdida') {
                        apuestasPerdidas++;
                    } else if (apuesta.estado === 'pendiente') {
                        apuestasPendientes++;
                    }
                });
            }
            
            const balance = totalGanado - totalApostado;
            const totalApuestas = apuestas ? apuestas.length : 0;
            const porcentajeGanadas = totalApuestas > 0 ? (apuestasGanadas / totalApuestas * 100).toFixed(1) : 0;
            
            let mensaje = `👤 *INFORMACIÓN DEL USUARIO*\n\n`;
            mensaje += `*Datos personales:*\n`;
            mensaje += `• Nombre: ${user.first_name}\n`;
            mensaje += `• ID: ${user.telegram_id}\n`;
            mensaje += `• Usuario: @${user.username || 'N/A'}\n`;
            mensaje += `• Teléfono: ${user.phone_number ? `+53 ${user.phone_number.substring(2)}` : 'No vinculado'}\n`;
            mensaje += `• Saldo CUP: ${user.balance_cup || 0}\n`;
            mensaje += `• Saldo Saldo: ${user.balance_saldo || 0}\n`;
            mensaje += `• CWS: ${user.tokens_cws || 0}\n\n`;
            
            mensaje += `📊 *ESTADÍSTICAS LA BOLITA:*\n`;
            mensaje += `• Total apuestas: ${totalApuestas}\n`;
            mensaje += `• Ganadas: ${apuestasGanadas} (${porcentajeGanadas}%)\n`;
            mensaje += `• Perdidas: ${apuestasPerdidas}\n`;
            mensaje += `• Pendientes: ${apuestasPendientes}\n\n`;
            
            mensaje += `💰 *FINANCIERO:*\n`;
            mensaje += `• Total apostado: ${totalApostado} CUP\n`;
            mensaje += `• Total ganado: ${totalGanado} CUP\n`;
            mensaje += `• Balance: ${balance} CUP\n`;
            mensaje += `• Rentabilidad: ${totalApostado > 0 ? (balance / totalApostado * 100).toFixed(1) : 0}%\n\n`;
            
            if (apuestas && apuestas.length > 0) {
                mensaje += `🔄 *ÚLTIMAS APUESTAS:*\n`;
                
                apuestas.slice(0, 5).forEach((apuesta, index) => {
                    const fecha = new Date(apuesta.fecha_apuesta).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit'
                    });
                    
                    const estadoEmoji = apuesta.estado === 'ganada' ? '✅' : 
                                      apuesta.estado === 'perdida' ? '❌' : '⏳';
                    
                    mensaje += `${index + 1}. ${estadoEmoji} ${apuesta.tipo_apuesta} ${apuesta.numero_apostado}\n`;
                    mensaje += `   💰 ${apuesta.monto} CUP - ${fecha}\n`;
                    if (apuesta.ganancia) {
                        mensaje += `   🎁 Ganó: ${apuesta.ganancia} CUP\n`;
                    }
                    mensaje += `   ---\n`;
                });
            }
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
            // Teclado de acciones
            const teclado = {
                inline_keyboard: [
                    [
                        { text: '📋 Ver Todas Apuestas', callback_data: `bolita_admin_todas_usuario:${userId}` },
                        { text: '💰 Ver Balance Detallado', callback_data: `bolita_admin_balance_usuario:${userId}` }
                    ],
                    [
                        { text: '📞 Contactar Usuario', callback_data: `bolita_admin_contactar:${userId}` },
                        { text: '📊 Estadísticas Completas', callback_data: `bolita_admin_stats_usuario:${userId}` }
                    ],
                    [
                        { text: '🔍 Buscar Otro Usuario', callback_data: 'bolita_admin_buscar_usuario' },
                        { text: '🔙 Volver al Panel', callback_data: 'bolita_admin_menu' }
                    ]
                ]
            };
            
            await this.bot.sendMessage(chatId, 'Selecciona una acción:', { reply_markup: teclado });
            
        } catch (error) {
            console.error('Error mostrando info usuario:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener información del usuario.');
        }
    }

    // ==================== FUNCIONES DE VALIDACIÓN Y CÁLCULO ====================
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

    async getUser(telegramId) {
        const { data } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();
        return data;
    }

    async crearApuesta(userId, tipo, numero, monto, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            // Obtener sorteo activo para esta sesión
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                return null;
            }
            
            const { data: apuesta, error } = await this.supabase
                .from('bolita_apuestas')
                .insert([{
                    user_id: userId,
                    tipo_apuesta: tipo,
                    numero_apostado: numero,
                    monto: monto,
                    sorteo_id: sorteo.id,
                    sesion: sesion,
                    estado: 'pendiente',
                    fecha_apuesta: new Date().toISOString(),
                    moneda: 'cup'
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
                .select('balance_cup')
                .eq('telegram_id', userId)
                .single();
            
            if (user) {
                await this.supabase
                    .from('users')
                    .update({ balance_cup: user.balance_cup - monto })
                    .eq('telegram_id', userId);
                
                await this.supabase
                    .from('transactions')
                    .insert([{
                        user_id: userId,
                        type: 'BOLITA_APUESTA',
                        currency: 'cup',
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

    async acreditarGanancia(userId, ganancia) {
        try {
            const { data: user } = await this.supabase
                .from('users')
                .select('balance_cup')
                .eq('telegram_id', userId)
                .single();
            
            if (user) {
                await this.supabase
                    .from('users')
                    .update({ balance_cup: user.balance_cup + ganancia })
                    .eq('telegram_id', userId);
                
                await this.supabase
                    .from('transactions')
                    .insert([{
                        user_id: userId,
                        type: 'BOLITA_GANANCIA',
                        currency: 'cup',
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

    // ==================== FUNCIONES ADICIONALES PARA ADMIN ====================
    async mostrarReporteDiarioAdmin(chatId) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*, bolita_apuestas(monto, estado, ganancia)')
                .eq('fecha', hoy);
            
            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, `📭 No hay actividad hoy (${hoy}).`);
                return;
            }
            
            let mensaje = `📊 *REPORTE DIARIO - ${hoy}*\n\n`;
            
            let totalApostado = 0;
            let totalPagado = 0;
            let totalApuestas = 0;
            let totalGanadores = 0;
            
            sorteos.forEach(sorteo => {
                const sesionNombre = this.sesiones[sorteo.sesion];
                let apostadoSesion = 0;
                let pagadoSesion = 0;
                let apuestasSesion = 0;
                let ganadoresSesion = 0;
                
                if (sorteo.bolita_apuestas) {
                    sorteo.bolita_apuestas.forEach(apuesta => {
                        apostadoSesion += apuesta.monto;
                        apuestasSesion++;
                        
                        if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                            pagadoSesion += apuesta.ganancia;
                            ganadoresSesion++;
                        }
                    });
                }
                
                totalApostado += apostadoSesion;
                totalPagado += pagadoSesion;
                totalApuestas += apuestasSesion;
                totalGanadores += ganadoresSesion;
                
                const balanceSesion = apostadoSesion - pagadoSesion;
                
                mensaje += `*${sesionNombre}*\n`;
                mensaje += `• Estado: ${sorteo.estado_sesion}\n`;
                mensaje += `• Apuestas: ${apuestasSesion}\n`;
                mensaje += `• Apostado: ${apostadoSesion} CUP\n`;
                mensaje += `• Ganadores: ${ganadoresSesion}\n`;
                mensaje += `• Pagado: ${pagadoSesion} CUP\n`;
                mensaje += `• Balance: ${balanceSesion} CUP\n\n`;
            });
            
            const balanceTotal = totalApostado - totalPagado;
            
            mensaje += `📈 *TOTAL DEL DÍA:*\n`;
            mensaje += `• Total apuestas: ${totalApuestas}\n`;
            mensaje += `• Total apostado: ${totalApostado} CUP\n`;
            mensaje += `• Total ganadores: ${totalGanadores}\n`;
            mensaje += `• Total pagado: ${totalPagado} CUP\n`;
            mensaje += `• Balance total: ${balanceTotal} CUP\n`;
            mensaje += `• Rentabilidad: ${totalApostado > 0 ? (balanceTotal / totalApostado * 100).toFixed(1) : 0}%`;
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando reporte diario:', error);
            await this.bot.sendMessage(chatId, '❌ Error al generar reporte diario.');
        }
    }

    async mostrarReporteSesionAdmin(chatId, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const sesionNombre = this.sesiones[sesion];
            
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*, bolita_apuestas(*, users!inner(first_name, username))')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                await this.bot.sendMessage(chatId, `📭 No hay datos para ${sesionNombre} hoy.`);
                return;
            }
            
            let mensaje = `📋 *REPORTE DETALLADO - ${sesionNombre}*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n`;
            mensaje += `📊 *Estado:* ${sorteo.estado_sesion}\n`;
            
            if (sorteo.numero_ganador) {
                mensaje += `🎯 *Número ganador:* ${sorteo.numero_ganador}\n`;
                mensaje += `🔢 *Desglose:* ${sorteo.centena} | ${sorteo.fijo} | ${sorteo.corrido1}, ${sorteo.corrido2}\n`;
            }
            
            if (sorteo.hora_apertura) {
                const apertura = new Date(sorteo.hora_apertura).toLocaleTimeString();
                mensaje += `⏰ *Apertura:* ${apertura}\n`;
            }
            
            if (sorteo.hora_cierre) {
                const cierre = new Date(sorteo.hora_cierre).toLocaleTimeString();
                mensaje += `⏰ *Cierre:* ${cierre}\n`;
            }
            
            if (sorteo.hora_resultado) {
                const resultado = new Date(sorteo.hora_resultado).toLocaleTimeString();
                mensaje += `⏰ *Resultado:* ${resultado}\n`;
            }
            
            mensaje += `\n`;
            
            if (sorteo.bolita_apuestas && sorteo.bolita_apuestas.length > 0) {
                const apuestas = sorteo.bolita_apuestas;
                
                // Estadísticas
                let totalApostado = 0;
                let totalPagado = 0;
                let apuestasGanadas = 0;
                let apuestasPerdidas = 0;
                let apuestasPendientes = 0;
                const apostadores = new Set();
                
                apuestas.forEach(apuesta => {
                    totalApostado += apuesta.monto;
                    apostadores.add(apuesta.user_id);
                    
                    if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                        totalPagado += apuesta.ganancia;
                        apuestasGanadas++;
                    } else if (apuesta.estado === 'perdida') {
                        apuestasPerdidas++;
                    } else if (apuesta.estado === 'pendiente') {
                        apuestasPendientes++;
                    }
                });
                
                const balance = totalApostado - totalPagado;
                
                mensaje += `📊 *ESTADÍSTICAS:*\n`;
                mensaje += `• Total apuestas: ${apuestas.length}\n`;
                mensaje += `• Apostadores únicos: ${apostadores.size}\n`;
                mensaje += `• Ganadas: ${apuestasGanadas}\n`;
                mensaje += `• Perdidas: ${apuestasPerdidas}\n`;
                mensaje += `• Pendientes: ${apuestasPendientes}\n\n`;
                
                mensaje += `💰 *FINANCIERO:*\n`;
                mensaje += `• Total apostado: ${totalApostado} CUP\n`;
                mensaje += `• Total pagado: ${totalPagado} CUP\n`;
                mensaje += `• Balance: ${balance} CUP\n`;
                mensaje += `• Rentabilidad: ${totalApostado > 0 ? (balance / totalApostado * 100).toFixed(1) : 0}%\n\n`;
                
                // Top 5 apuestas más grandes
                const apuestasOrdenadas = [...apuestas].sort((a, b) => b.monto - a.monto);
                if (apuestasOrdenadas.length > 0) {
                    mensaje += `🏆 *TOP 5 APUESTAS MÁS GRANDES:*\n`;
                    
                    apuestasOrdenadas.slice(0, 5).forEach((apuesta, index) => {
                        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
                        mensaje += `${emoji} ${apuesta.users.first_name}: ${apuesta.monto} CUP\n`;
                        mensaje += `   🎯 ${apuesta.tipo_apuesta} ${apuesta.numero_apostado}\n`;
                        if (apuesta.estado === 'ganada' && apuesta.ganancia) {
                            mensaje += `   💰 Ganó: ${apuesta.ganancia} CUP\n`;
                        }
                        mensaje += `   ---\n`;
                    });
                }
                
            } else {
                mensaje += `📭 *No hay apuestas en esta sesión.*`;
            }
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando reporte sesión:', error);
            await this.bot.sendMessage(chatId, '❌ Error al generar reporte de sesión.');
        }
    }

    async mostrarEstadisticasSesionAdmin(chatId, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const sesionNombre = this.sesiones[sesion];
            
            const { data: sorteo } = await this.supabase
                .from('bolita_sorteos')
                .select('*, bolita_apuestas(*)')
                .eq('fecha', hoy)
                .eq('sesion', sesion)
                .single();
            
            if (!sorteo) {
                await this.bot.sendMessage(chatId, `📭 No hay datos para ${sesionNombre} hoy.`);
                return;
            }
            
            let mensaje = `📈 *ESTADÍSTICAS - ${sesionNombre}*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n`;
            mensaje += `📊 *Estado:* ${sorteo.estado_sesion}\n\n`;
            
            if (sorteo.bolita_apuestas && sorteo.bolita_apuestas.length > 0) {
                const apuestas = sorteo.bolita_apuestas;
                
                // Distribución por tipo de apuesta
                const porTipo = {};
                apuestas.forEach(apuesta => {
                    if (!porTipo[apuesta.tipo_apuesta]) {
                        porTipo[apuesta.tipo_apuesta] = {
                            cantidad: 0,
                            monto: 0
                        };
                    }
                    porTipo[apuesta.tipo_apuesta].cantidad++;
                    porTipo[apuesta.tipo_apuesta].monto += apuesta.monto;
                });
                
                // Distribución por monto
                const porMonto = {
                    pequenas: { min: 10, max: 100, cantidad: 0, monto: 0 },
                    medianas: { min: 101, max: 500, cantidad: 0, monto: 0 },
                    grandes: { min: 501, max: 1000, cantidad: 0, monto: 0 }
                };
                
                apuestas.forEach(apuesta => {
                    if (apuesta.monto <= 100) {
                        porMonto.pequenas.cantidad++;
                        porMonto.pequenas.monto += apuesta.monto;
                    } else if (apuesta.monto <= 500) {
                        porMonto.medianas.cantidad++;
                        porMonto.medianas.monto += apuesta.monto;
                    } else {
                        porMonto.grandes.cantidad++;
                        porMonto.grandes.monto += apuesta.monto;
                    }
                });
                
                mensaje += `🎯 *DISTRIBUCIÓN POR TIPO:*\n`;
                Object.keys(porTipo).forEach(tipo => {
                    const porcentaje = (porTipo[tipo].cantidad / apuestas.length * 100).toFixed(1);
                    mensaje += `• ${this.obtenerNombreTipo(tipo)}: ${porTipo[tipo].cantidad} (${porcentaje}%)\n`;
                    mensaje += `  💰 ${porTipo[tipo].monto} CUP\n`;
                });
                
                mensaje += `\n💰 *DISTRIBUCIÓN POR MONTO:*\n`;
                mensaje += `• Pequeñas (10-100 CUP): ${porMonto.pequenas.cantidad}\n`;
                mensaje += `  💰 ${porMonto.pequenas.monto} CUP\n`;
                mensaje += `• Medianas (101-500 CUP): ${porMonto.medianas.cantidad}\n`;
                mensaje += `  💰 ${porMonto.medianas.monto} CUP\n`;
                mensaje += `• Grandes (501-1000 CUP): ${porMonto.grandes.cantidad}\n`;
                mensaje += `  💰 ${porMonto.grandes.monto} CUP\n`;
                
                // Promedios
                const promedioMonto = apuestas.reduce((sum, a) => sum + a.monto, 0) / apuestas.length;
                mensaje += `\n📉 *PROMEDIOS:*\n`;
                mensaje += `• Apuesta promedio: ${promedioMonto.toFixed(0)} CUP\n`;
                mensaje += `• Apuestas por hora: ${(apuestas.length / 24).toFixed(1)}\n`;
                
            } else {
                mensaje += `📭 *No hay apuestas para analizar.*`;
            }
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando estadísticas sesión:', error);
            await this.bot.sendMessage(chatId, '❌ Error al calcular estadísticas.');
        }
    }

    async mostrarApuestasSesionAdmin(chatId, sesion) {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const sesionNombre = this.sesiones[sesion];
            
            const { data: apuestas } = await this.supabase
                .from('bolita_apuestas')
                .select('*, users!inner(first_name, username)')
                .eq('sesion', sesion)
                .eq('fecha_apuesta', '>=', hoy + 'T00:00:00')
                .eq('fecha_apuesta', '<=', hoy + 'T23:59:59')
                .order('created_at', { ascending: false })
                .limit(20);
            
            if (!apuestas || apuestas.length === 0) {
                await this.bot.sendMessage(chatId, `📭 No hay apuestas para ${sesionNombre} hoy.`);
                return;
            }
            
            let mensaje = `📋 *APUESTAS - ${sesionNombre}*\n\n`;
            mensaje += `📅 *Fecha:* ${hoy}\n`;
            mensaje += `📊 *Total apuestas:* ${apuestas.length}\n\n`;
            
            apuestas.forEach((apuesta, index) => {
                const hora = new Date(apuesta.created_at).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                const estadoEmoji = apuesta.estado === 'ganada' ? '✅' : 
                                  apuesta.estado === 'perdida' ? '❌' : '⏳';
                
                mensaje += `${index + 1}. ${estadoEmoji} *${apuesta.users.first_name}*\n`;
                mensaje += `   🎯 ${apuesta.tipo_apuesta} ${apuesta.numero_apostado}\n`;
                mensaje += `   💰 ${apuesta.monto} CUP\n`;
                mensaje += `   ⏰ ${hora}\n`;
                
                if (apuesta.ganancia) {
                    mensaje += `   🎁 Ganó: ${apuesta.ganancia} CUP\n`;
                }
                
                mensaje += `   ---\n`;
            });
            
            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error mostrando apuestas sesión:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener apuestas.');
        }
    }
}

module.exports = BolitaHandler;
