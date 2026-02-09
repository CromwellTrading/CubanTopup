// BolitaHandler.js - Sistema completo de La Bolita con Florida 3 (7 dígitos)
class BolitaHandler {
    constructor(bot, supabase) {
        this.bot = bot;
        this.supabase = supabase;
        this.adminChatId = process.env.ADMIN_GROUP;
        this.botAdminId = process.env.BOT_ADMIN_ID; // ID único del admin
        
        // Multiplicadores basados en Florida 3 (7 dígitos)
        this.multiplicadores = {
            'centena': 500,   // Acertar los 3 primeros dígitos en orden exacto
            'fijo': 75,       // Acertar los 2 últimos dígitos de la centena
            'corrido': 25,    // Acertar un par de la cuarteta (45 o 67)
            'parlet': 10,     // Combinación de dos apuestas
            'candado': 1000   // Combinación exacta de fijo + corridos
        };
    }

    // ==================== VERIFICACIÓN DE ADMIN ====================
    esAdmin(userId) {
        return userId.toString() === this.botAdminId.toString();
    }

    // ==================== PROCESAR NÚMERO GANADOR (SOLO ADMIN) ====================
    async procesarResultadoAdmin(chatId, userId, numeroCompleto) {
        try {
            // Verificar permisos de admin
            if (!this.esAdmin(userId)) {
                await this.bot.sendMessage(chatId, '❌ Solo el administrador puede ingresar resultados.');
                return;
            }

            // Validar formato: 7 dígitos
            if (!/^\d{7}$/.test(numeroCompleto)) {
                await this.bot.sendMessage(chatId, 
                    '❌ *Formato incorrecto*\n\n' +
                    'Debe ser un número de *7 dígitos* (ej: 1234567)\n' +
                    'Este es el formato de Florida 3',
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Descomponer número Florida 3
            const centena = numeroCompleto.substring(0, 3);     // 123
            const fijo = numeroCompleto.substring(1, 3);        // 23 (últimos 2 dígitos de centena)
            const cuarteta = numeroCompleto.substring(3, 7);    // 4567
            const corrido1 = cuarteta.substring(0, 2);          // 45
            const corrido2 = cuarteta.substring(2, 4);          // 67

            // Obtener sorteo activo (hoy)
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
                sorteo = nuevoSorteo;
            }

            // Actualizar sorteo con número ganador
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

            // Procesar todas las apuestas de este sorteo
            const resultado = await this.procesarApuestasSorteo(sorteo.id, {
                completo: numeroCompleto,
                centena: centena,
                fijo: fijo,
                cuarteta: cuarteta,
                corrido1: corrido1,
                corrido2: corrido2
            });

            // Mostrar resumen al admin
            await this.mostrarResumenAdmin(chatId, sorteo.id, numeroCompleto, resultado);

        } catch (error) {
            console.error('Error procesando resultado:', error);
            await this.bot.sendMessage(chatId, '❌ Error al procesar el resultado.');
        }
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
                // Formato: "XX-YY" donde cada uno puede ser fijo o corrido
                const [ap1, ap2] = numeroApostado.split('-');
                const gana1 = this.validarApuesta('fijo', ap1, numeroGanador) || 
                              this.validarApuesta('corrido', ap1, numeroGanador);
                const gana2 = this.validarApuesta('fijo', ap2, numeroGanador) || 
                              this.validarApuesta('corrido', ap2, numeroGanador);
                return gana1 && gana2;
                
            case 'candado':
                // Formato: "XX-YY-ZZ" (fijo-corrido1-corrido2)
                const [cFijo, cCorrido1, cCorrido2] = numeroApostado.split('-');
                return cFijo === fijo && cCorrido1 === corrido1 && cCorrido2 === corrido2;
                
            default:
                return false;
        }
    }

    calcularGanancia(tipo, monto) {
        return Math.floor(monto * this.multiplicadores[tipo]);
    }

    // ==================== PROCESAR APUESTAS DEL SORTEO ====================
    async procesarApuestasSorteo(sorteoId, numeroGanador) {
        // Obtener todas las apuestas pendientes de este sorteo
        const { data: apuestas, error } = await this.supabase
            .from('bolita_apuestas')
            .select('*, users!inner(first_name, username, tokens_cws)')
            .eq('sorteo_id', sorteoId)
            .eq('estado', 'pendiente');

        if (error) throw error;

        let ganadores = [];
        let totalAPagar = 0;

        // Procesar cada apuesta
        for (let apuesta of apuestas) {
            const esGanadora = this.validarApuesta(
                apuesta.tipo_apuesta,
                apuesta.numero_apostado,
                numeroGanador
            );

            if (esGanadora) {
                const ganancia = this.calcularGanancia(apuesta.tipo_apuesta, apuesta.monto);
                
                // Actualizar apuesta como ganada
                await this.supabase
                    .from('bolita_apuestas')
                    .update({
                        estado: 'ganada',
                        ganancia: ganancia,
                        ganado_en: new Date().toISOString()
                    })
                    .eq('id', apuesta.id);

                // Acreditar ganancia al usuario
                await this.acreditarGanancia(apuesta.user_id, ganancia);

                // Agregar a lista de ganadores
                ganadores.push({
                    ticket_id: apuesta.id,
                    user_id: apuesta.user_id,
                    nombre: apuesta.users.first_name,
                    username: apuesta.users.username,
                    tipo: apuesta.tipo_apuesta,
                    numeros: apuesta.numero_apostado,
                    monto_apostado: apuesta.monto,
                    ganancia: ganancia
                });

                totalAPagar += ganancia;

                // Notificar al usuario ganador
                await this.notificarGanadorUsuario(apuesta.user_id, apuesta, numeroGanador.completo, ganancia);
            } else {
                // Marcar como perdida
                await this.supabase
                    .from('bolita_apuestas')
                    .update({ estado: 'perdida' })
                    .eq('id', apuesta.id);

                // Notificar al usuario perdedor
                await this.notificarPerdedorUsuario(apuesta.user_id, apuesta, numeroGanador.completo);
            }
        }

        return { ganadores, totalAPagar, totalApuestas: apuestas.length };
    }

    // ==================== FUNCIONES PARA USUARIOS ====================
    async procesarApuestaUsuario(chatId, userId, tipo, numero, monto) {
        try {
            // Validar formato de la apuesta
            if (!this.validarFormatoApuesta(tipo, numero)) {
                await this.bot.sendMessage(chatId, 
                    '❌ *Formato incorrecto*\n\n' +
                    'Ejemplos válidos:\n' +
                    '• Centena: `/apostar centena 123 10`\n' +
                    '• Fijo: `/apostar fijo 23 10`\n' +
                    '• Corrido: `/apostar corrido 45 10`\n' +
                    '• Parlet: `/apostar parlet 23-45 10` (fijo + corrido)\n' +
                    '• Parlet: `/apostar parlet 45-67 10` (dos corridos)\n' +
                    '• Candado: `/apostar candado 23-45-67 10`',
                    { parse_mode: 'Markdown' }
                );
                return false;
            }

            // Verificar saldo
            const user = await this.getUser(userId);
            if (!user || user.tokens_cws < monto) {
                await this.bot.sendMessage(chatId, 
                    `❌ *Saldo insuficiente*\n\n` +
                    `Necesitas: ${monto} CWS\n` +
                    `Tienes: ${user?.tokens_cws || 0} CWS`,
                    { parse_mode: 'Markdown' }
                );
                return false;
            }

            // Obtener sorteo activo
            const sorteo = await this.obtenerSorteoActivo();
            if (!sorteo) {
                await this.bot.sendMessage(chatId, 
                    '❌ No hay sorteo activo en este momento.',
                    { parse_mode: 'Markdown' }
                );
                return false;
            }

            // Descontar saldo
            await this.descontarSaldo(userId, monto);

            // Registrar apuesta
            const { data: apuesta, error } = await this.supabase
                .from('bolita_apuestas')
                .insert([{
                    user_id: userId,
                    tipo_apuesta: tipo,
                    numero_apostado: numero,
                    monto: monto,
                    sorteo_id: sorteo.id,
                    estado: 'pendiente',
                    fecha_apuesta: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;

            // Notificar al usuario
            await this.bot.sendMessage(chatId,
                `✅ *Apuesta registrada*\n\n` +
                `🎫 Ticket #${apuesta.id}\n` +
                `🎯 Tipo: ${this.obtenerNombreTipo(tipo)}\n` +
                `🔢 Números: ${numero}\n` +
                `💰 Monto: ${monto} CWS\n` +
                `📅 Sorteo: ${sorteo.fecha} (${sorteo.hora === 'midday' ? 'Medio día' : 'Noche'})\n\n` +
                `Los resultados se publicarán después del sorteo.`,
                { parse_mode: 'Markdown' }
            );

            // Enviar ticket al admin
            await this.enviarTicketAdmin(apuesta, user);

            return true;

        } catch (error) {
            console.error('Error procesando apuesta:', error);
            await this.bot.sendMessage(chatId, '❌ Error al procesar la apuesta.');
            return false;
        }
    }

    // ==================== HISTORIAL Y CONSULTAS ====================
    async verResultadosRecientes(chatId, userId) {
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

    async buscarResultadoPorFecha(chatId, userId, fecha) {
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

    async verEstadisticasSemanales(chatId, userId) {
        try {
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

            // Analizar frecuencia
            const frecuenciaCentenas = {};
            const frecuenciaFijos = {};
            const frecuenciaCorridos = {};
            const ultimaAparicion = {};

            sorteos.forEach((sorteo, index) => {
                // Centenas
                frecuenciaCentenas[sorteo.centena] = (frecuenciaCentenas[sorteo.centena] || 0) + 1;
                ultimaAparicion[sorteo.centena] = index;

                // Fijos
                frecuenciaFijos[sorteo.fijo] = (frecuenciaFijos[sorteo.fijo] || 0) + 1;
                ultimaAparicion[sorteo.fijo] = index;

                // Corridos
                frecuenciaCorridos[sorteo.corrido1] = (frecuenciaCorridos[sorteo.corrido1] || 0) + 1;
                frecuenciaCorridos[sorteo.corrido2] = (frecuenciaCorridos[sorteo.corrido2] || 0) + 1;
                ultimaAparicion[sorteo.corrido1] = index;
                ultimaAparicion[sorteo.corrido2] = index;
            });

            // Encontrar los más frecuentes
            const centenaMasFrecuente = this.encontrarMasFrecuente(frecuenciaCentenas);
            const fijoMasFrecuente = this.encontrarMasFrecuente(frecuenciaFijos);
            const corridoMasFrecuente = this.encontrarMasFrecuente(frecuenciaCorridos);

            // Encontrar los que más tiempo llevan sin salir
            const centenaMasAtrasada = this.encontrarMasAtrasado(frecuenciaCentenas, ultimaAparicion, sorteos.length);
            const fijoMasAtrasado = this.encontrarMasAtrasado(frecuenciaFijos, ultimaAparicion, sorteos.length);
            const corridoMasAtrasado = this.encontrarMasAtrasado(frecuenciaCorridos, ultimaAparicion, sorteos.length);

            let mensaje = `📊 *Estadísticas de la última semana*\n\n`;
            mensaje += `📅 Período: ${fechaInicioStr} - Hoy\n`;
            mensaje += `🎯 Total sorteos: ${sorteos.length}\n\n`;

            mensaje += `*NÚMEROS MÁS FRECUENTES:*\n`;
            mensaje += `• Centena: ${centenaMasFrecuente.numero} (${centenaMasFrecuente.veces} veces)\n`;
            mensaje += `• Fijo: ${fijoMasFrecuente.numero} (${fijoMasFrecuente.veces} veces)\n`;
            mensaje += `• Corrido: ${corridoMasFrecuente.numero} (${corridoMasFrecuente.veces} veces)\n\n`;

            mensaje += `*NÚMEROS MÁS ATRASADOS:*\n`;
            mensaje += `• Centena: ${centenaMasAtrasada.numero} (${centenaMasAtrasada.diasSinSalir} días)\n`;
            mensaje += `• Fijo: ${fijoMasAtrasado.numero} (${fijoMasAtrasado.diasSinSalir} días)\n`;
            mensaje += `• Corrido: ${corridoMasAtrasado.numero} (${corridoMasAtrasado.diasSinSalir} días)\n\n`;

            mensaje += `_Estadísticas basadas en ${sorteos.length} sorteos._`;

            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error generando estadísticas:', error);
            await this.bot.sendMessage(chatId, '❌ Error al generar estadísticas.');
        }
    }

    // ==================== FUNCIONES SOLO PARA ADMIN ====================
    async mostrarPanelAdmin(chatId, userId) {
        if (!this.esAdmin(userId)) {
            await this.bot.sendMessage(chatId, '❌ Solo el administrador puede acceder a este panel.');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎯 Ingresar Resultado', callback_data: 'bolita_admin_resultado' },
                    { text: '📊 Ver Reporte Actual', callback_data: 'bolita_admin_reporte' }
                ],
                [
                    { text: '📈 Estadísticas Avanzadas', callback_data: 'bolita_admin_estadisticas' },
                    { text: '📋 Ver Sorteos Recientes', callback_data: 'bolita_admin_sorteos' }
                ],
                [
                    { text: '🔙 Volver al Menú', callback_data: 'bolita_menu' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId,
            `👑 *Panel de Administración - La Bolita*\n\n` +
            `Selecciona una opción:`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    }

    async mostrarReporteAdmin(chatId, userId, sorteoId = null) {
        if (!this.esAdmin(userId)) return;

        try {
            // Obtener el último sorteo completado
            let query = this.supabase
                .from('bolita_sorteos')
                .select('*')
                .eq('estado', 'completado')
                .order('fecha', { ascending: false })
                .limit(1);

            if (sorteoId) {
                query = query.eq('id', sorteoId);
            }

            const { data: sorteos } = await query;

            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay sorteos completados.');
                return;
            }

            const sorteo = sorteos[0];

            // Obtener ganadores de este sorteo
            const { data: ganadores } = await this.supabase
                .from('bolita_apuestas')
                .select('*, users!inner(first_name, username)')
                .eq('sorteo_id', sorteo.id)
                .eq('estado', 'ganada');

            let mensaje = `📊 *REPORTE DEL ADMINISTRADOR*\n\n`;
            mensaje += `🆔 Sorteo #${sorteo.id}\n`;
            mensaje += `📅 ${sorteo.fecha} (${sorteo.hora === 'midday' ? 'Mediodía' : 'Noche'})\n`;
            mensaje += `🎯 Número Ganador: *${sorteo.numero_ganador}*\n\n`;
            mensaje += `🔢 *Desglose:*\n`;
            mensaje += `• Centena: ${sorteo.centena}\n`;
            mensaje += `• Fijo: ${sorteo.fijo}\n`;
            mensaje += `• Corrido 1: ${sorteo.corrido1}\n`;
            mensaje += `• Corrido 2: ${sorteo.corrido2}\n\n`;

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

    async mostrarResumenAdmin(chatId, sorteoId, numeroCompleto, resultado) {
        const { ganadores, totalAPagar, totalApuestas } = resultado;

        let mensaje = `📋 *RESUMEN DEL SORTEO #${sorteoId}*\n\n`;
        mensaje += `🎯 Número: *${numeroCompleto}*\n`;
        mensaje += `📊 Total apuestas: ${totalApuestas}\n`;
        mensaje += `🏆 Ganadores: ${ganadores.length}\n`;
        mensaje += `💰 Total a pagar: ${totalAPagar} CWS\n\n`;

        if (ganadores.length > 0) {
            mensaje += `*DETALLE DE GANADORES:*\n`;

            ganadores.forEach((ganador, index) => {
                mensaje += `\n${index + 1}. Ticket #${ganador.ticket_id}\n`;
                mensaje += `   👤 ${ganador.nombre} (@${ganador.username || 'N/A'})\n`;
                mensaje += `   🎯 ${this.obtenerNombreTipo(ganador.tipo)}: ${ganador.numeros}\n`;
                mensaje += `   💰 ${ganador.monto_apostado} CWS → ${ganador.ganancia} CWS\n`;
            });
        }

        // Teclado para acciones adicionales
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📊 Ver Reporte Detallado', callback_data: `bolita_admin_reporte_detalle:${sorteoId}` },
                    { text: '📋 Exportar Datos', callback_data: `bolita_admin_exportar:${sorteoId}` }
                ],
                [
                    { text: '🔙 Volver al Panel', callback_data: 'bolita_admin_panel' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, mensaje, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }

    // ==================== FUNCIONES AUXILIARES ====================
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

    async descontarSaldo(userId, monto) {
        await this.supabase.rpc('descontar_cws', {
            user_id: userId,
            monto: monto
        });
    }

    async acreditarGanancia(userId, ganancia) {
        await this.supabase.rpc('acreditar_cws', {
            user_id: userId,
            monto: ganancia
        });
    }

    async enviarTicketAdmin(apuesta, user) {
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

    async notificarGanadorUsuario(userId, apuesta, numeroGanador, ganancia) {
        try {
            await this.bot.sendMessage(userId,
                `🎉 *¡FELICIDADES! GANASTE EN LA BOLITA*\n\n` +
                `🎫 Ticket #${apuesta.id}\n` +
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

    async notificarPerdedorUsuario(userId, apuesta, numeroGanador) {
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

    encontrarMasFrecuente(frecuencia) {
        let maxNum = null;
        let maxVeces = 0;

        for (const [numero, veces] of Object.entries(frecuencia)) {
            if (veces > maxVeces) {
                maxVeces = veces;
                maxNum = numero;
            }
        }

        return { numero: maxNum, veces: maxVeces };
    }

    encontrarMasAtrasado(frecuencia, ultimaAparicion, totalSorteos) {
        let masAtrasado = null;
        let maxDiasSinSalir = 0;

        for (const [numero] of Object.entries(frecuencia)) {
            const diasSinSalir = totalSorteos - (ultimaAparicion[numero] || 0);
            if (diasSinSalir > maxDiasSinSalir) {
                maxDiasSinSalir = diasSinSalir;
                masAtrasado = numero;
            }
        }

        return { 
            numero: masAtrasado || 'N/A', 
            diasSinSalir: maxDiasSinSalir 
        };
    }

    async getUser(telegramId) {
        const { data } = await this.supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();
        return data;
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
                        await this.mostrarMenuPrincipal(chatId, messageId, userId);
                        break;
                    case 'apostar':
                        await this.mostrarTiposApuesta(chatId, messageId);
                        break;
                    case 'type':
                        const tipo = parts[2];
                        await this.solicitarNumeroApuesta(chatId, messageId, tipo);
                        break;
                    case 'resultados':
                        await this.verResultadosRecientes(chatId, userId);
                        break;
                    case 'historial':
                        await this.verMisApuestas(chatId, userId);
                        break;
                    case 'estadisticas':
                        await this.verEstadisticasSemanales(chatId, userId);
                        break;
                    case 'buscar':
                        await this.solicitarFechaBusqueda(chatId, messageId);
                        break;
                    case 'admin':
                        await this.mostrarPanelAdmin(chatId, userId);
                        break;
                    case 'admin_resultado':
                        await this.solicitarNumeroGanador(chatId, messageId, userId);
                        break;
                    case 'admin_reporte':
                        await this.mostrarReporteAdmin(chatId, userId);
                        break;
                    case 'admin_estadisticas':
                        await this.mostrarEstadisticasAvanzadas(chatId, userId);
                        break;
                    case 'admin_sorteos':
                        await this.mostrarSorteosRecientesAdmin(chatId, userId);
                        break;
                    default:
                        console.log(`Acción no reconocida: ${action}`);
                }
                return true;
            }

            // Callbacks específicos de admin
            if (data.startsWith('admin_')) {
                const parts = data.split(':');
                const action = parts[0];
                const param = parts[1];

                if (action === 'bolita_admin_reporte_detalle') {
                    await this.mostrarReporteAdmin(chatId, userId, parseInt(param));
                }
                return true;
            }

        } catch (error) {
            console.error('Error en callback de La Bolita:', error);
        }

        return false;
    }

    async mostrarMenuPrincipal(chatId, messageId, userId) {
        const esAdmin = this.esAdmin(userId);
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎯 Apostar', callback_data: 'bolita_apostar' },
                    { text: '📜 Mis Apuestas', callback_data: 'bolita_historial' }
                ],
                [
                    { text: '📅 Ver Resultados', callback_data: 'bolita_resultados' },
                    { text: '🔍 Buscar por Fecha', callback_data: 'bolita_buscar' }
                ],
                [
                    { text: '📊 Estadísticas', callback_data: 'bolita_estadisticas' }
                ]
            ]
        };

        if (esAdmin) {
            keyboard.inline_keyboard.push([
                { text: '👑 Panel Admin', callback_data: 'bolita_admin' }
            ]);
        }

        keyboard.inline_keyboard.push([
            { text: '🔙 Volver', callback_data: 'start_back' }
        ]);

        await this.bot.editMessageText(
            `🎱 *La Bolita - Sistema de Apuestas*\n\n` +
            `Basado en Florida 3 (7 dígitos)\n\n` +
            `*Tipos de apuesta:*\n` +
            `• Centena: 3 primeros dígitos\n` +
            `• Fijo: 2 últimos dígitos de la centena\n` +
            `• Corrido: Pares de la cuarteta (45 o 67)\n` +
            `• Parlet: Combinación de dos apuestas\n` +
            `• Candado: Fijo + corridos exactos\n\n` +
            `Selecciona una opción:`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    async mostrarTiposApuesta(chatId, messageId) {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔢 Centena', callback_data: 'bolita_type_centena' },
                    { text: '🎯 Fijo', callback_data: 'bolita_type_fijo' }
                ],
                [
                    { text: '🔄 Corrido', callback_data: 'bolita_type_corrido' },
                    { text: '🔗 Parlet', callback_data: 'bolita_type_parlet' }
                ],
                [
                    { text: '🔐 Candado', callback_data: 'bolita_type_candado' },
                    { text: '🔙 Volver', callback_data: 'bolita_menu' }
                ]
            ]
        };

        await this.bot.editMessageText(
            `🎯 *Selecciona el tipo de apuesta:*\n\n` +
            `1. *Centena* (3 dígitos): Ej: "123"\n` +
            `   - Pago: ${this.multiplicadores.centena}x\n\n` +
            `2. *Fijo* (2 dígitos): Ej: "23"\n` +
            `   - Pago: ${this.multiplicadores.fijo}x\n\n` +
            `3. *Corrido* (2 dígitos): Ej: "45" o "67"\n` +
            `   - Pago: ${this.multiplicadores.corrido}x\n\n` +
            `4. *Parlet* (XX-YY): Ej: "23-45" o "45-67"\n` +
            `   - Pago: ${this.multiplicadores.parlet}x\n\n` +
            `5. *Candado* (XX-YY-ZZ): Ej: "23-45-67"\n` +
            `   - Pago: ${this.multiplicadores.candado}x`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    async solicitarNumeroApuesta(chatId, messageId, tipo) {
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

        await this.bot.editMessageText(
            `🎯 *Apuesta: ${this.obtenerNombreTipo(tipo)}*\n\n` +
            `Formato: ${descripcion}\n` +
            `Ejemplo: \`${ejemplo}\`\n\n` +
            `Por favor, escribe los números (sin espacios):`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }
        );
    }

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

    async solicitarNumeroGanador(chatId, messageId, userId) {
        if (!this.esAdmin(userId)) return;

        await this.bot.editMessageText(
            `👑 *Ingresar Número Ganador*\n\n` +
            `Por favor, escribe el número completo de Florida (7 dígitos):\n\n` +
            `Ejemplo: \`1234567\`\n\n` +
            `Recuerda: Debe ser el número exacto que salió en Florida.`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }
        );
    }

    async mostrarEstadisticasAvanzadas(chatId, userId) {
        if (!this.esAdmin(userId)) return;

        // Aquí se pueden agregar estadísticas más detalladas para el admin
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

    async mostrarSorteosRecientesAdmin(chatId, userId) {
        if (!this.esAdmin(userId)) return;

        try {
            const { data: sorteos } = await this.supabase
                .from('bolita_sorteos')
                .select('*')
                .order('fecha', { ascending: false })
                .limit(10);

            if (!sorteos || sorteos.length === 0) {
                await this.bot.sendMessage(chatId, '📭 No hay sorteos registrados.');
                return;
            }

            let mensaje = `📋 *Últimos 10 Sorteos*\n\n`;

            sorteos.forEach((sorteo, index) => {
                const estado = sorteo.estado === 'completado' ? '✅' : '⏳';
                mensaje += `${index + 1}. ${estado} ${sorteo.fecha} (${sorteo.hora})\n`;
                if (sorteo.numero_ganador) {
                    mensaje += `   🎯 ${sorteo.numero_ganador}\n`;
                }
                mensaje += `   🆔 ID: ${sorteo.id}\n`;
                mensaje += `   ---\n`;
            });

            await this.bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error mostrando sorteos:', error);
            await this.bot.sendMessage(chatId, '❌ Error al obtener sorteos.');
        }
    }

    // ==================== MANEJO DE MENSAJES ====================
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        // Si el mensaje es un comando, no lo procesamos aquí
        if (text.startsWith('/')) return false;

        // Verificar si es admin ingresando resultado
        if (this.esAdmin(userId) && /^\d{7}$/.test(text)) {
            await this.procesarResultadoAdmin(chatId, userId, text);
            return true;
        }

        // Para otros mensajes, se manejarían con activeSessions en el bot principal
        // (como solicitar número de apuesta, fecha de búsqueda, etc.)

        return false;
    }

    // ==================== COMANDOS DE TEXTO ====================
    async handleTextCommand(chatId, userId, command, params) {
        switch(command) {
            case 'apostar':
                if (params.length < 3) {
                    await this.bot.sendMessage(chatId,
                        '❌ *Formato incorrecto*\n\n' +
                        'Uso: `/apostar <tipo> <numero> <monto>`\n\n' +
                        'Ejemplos:\n' +
                        '• `/apostar centena 123 10`\n' +
                        '• `/apostar fijo 23 10`\n' +
                        '• `/apostar corrido 45 10`\n' +
                        '• `/apostar parlet 23-45 10`\n' +
                        '• `/apostar candado 23-45-67 10`',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                const tipo = params[0];
                const numero = params[1];
                const monto = parseInt(params[2]);

                if (isNaN(monto) || monto <= 0) {
                    await this.bot.sendMessage(chatId, '❌ El monto debe ser un número válido.');
                    return;
                }

                await this.procesarApuestaUsuario(chatId, userId, tipo, numero, monto);
                break;

            case 'resultado':
                // Solo admin puede usar este comando directamente
                if (params.length === 1 && this.esAdmin(userId)) {
                    await this.procesarResultadoAdmin(chatId, userId, params[0]);
                } else if (!this.esAdmin(userId)) {
                    await this.bot.sendMessage(chatId, '❌ Solo el administrador puede usar este comando.');
                } else {
                    await this.bot.sendMessage(chatId,
                        '❌ Formato: `/resultado <7_dígitos>`\n' +
                        'Ejemplo: `/resultado 1234567`',
                        { parse_mode: 'Markdown' }
                    );
                }
                break;

            case 'buscar':
                if (params.length === 1) {
                    let fecha = params[0];
                    if (fecha.toLowerCase() === 'hoy') {
                        fecha = new Date().toISOString().split('T')[0];
                    }
                    await this.buscarResultadoPorFecha(chatId, userId, fecha);
                } else {
                    await this.bot.sendMessage(chatId,
                        '❌ Formato: `/buscar <fecha>`\n' +
                        'Ejemplo: `/buscar 2026-02-10` o `/buscar hoy`',
                        { parse_mode: 'Markdown' }
                    );
                }
                break;

            case 'estadisticas':
                await this.verEstadisticasSemanales(chatId, userId);
                break;

            case 'historial':
                await this.verMisApuestas(chatId, userId);
                break;
        }
    }
}

module.exports = BolitaHandler;
