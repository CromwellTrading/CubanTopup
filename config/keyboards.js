module.exports = {
    // Main keyboard with WebApp button
    createMainKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '👛 Mi Billetera', callback_data: 'wallet' },
                { text: '💰 Recargar Billetera', callback_data: 'recharge_menu' }
            ],
            [
                { text: '📱 Recargas ETECSA', callback_data: 'soky_offers' },
                { text: '🎮 Recargar Juegos', callback_data: 'games_menu' }
            ],
            [
                { text: '📱 Cambiar Teléfono', callback_data: 'link_phone' },
                { text: '🎁 Reclamar Pago', callback_data: 'claim_payment' }
            ],
            [
                { text: '🌐 Abrir WebApp', callback_data: 'open_webapp' },
                { text: '🎱 La Bolita', callback_data: 'bolita_menu' }
            ],
            [
                { text: '📈 Señales Trading', callback_data: 'trading_menu' },
                { text: '⚽ Apuestas', callback_data: 'apuestas_menu' }
            ],
            [
                { text: '🔄 Actualizar', callback_data: 'refresh_wallet' },
                { text: '❓ Ayuda', callback_data: 'help_menu' }
            ]
        ]
    }),
    
    // Wallet keyboard
    createWalletKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '💰 Recargar Billetera', callback_data: 'recharge_menu' },
                { text: '📱 Recargas ETECSA', callback_data: 'soky_offers' }
            ],
            [
                { text: '🎮 Recargar Juegos', callback_data: 'games_menu' },
                { text: '🎱 La Bolita', callback_data: 'bolita_menu' }
            ],
            [
                { text: '📈 Señales Trading', callback_data: 'trading_menu' },
                { text: '⚽ Apuestas', callback_data: 'apuestas_menu' }
            ],
            [
                { text: '📱 Cambiar Teléfono', callback_data: 'link_phone' },
                { text: '📊 Saldo Pendiente', callback_data: 'view_pending' }
            ],
            [
                { text: '📜 Historial', callback_data: 'history' },
                { text: '🌐 Abrir WebApp', callback_data: 'open_webapp' }
            ],
            [
                { text: '❌ Cancelar Orden Pendiente', callback_data: 'cancel_pending_order' },
                { text: '🔙 Volver al Inicio', callback_data: 'start_back' }
            ]
        ]
    }),
    
    // Trading keyboard
    createTradingKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '📊 Ver Señales Activas', callback_data: 'trading_signals_active' },
                { text: '📈 Suscripciones', callback_data: 'trading_subscriptions' }
            ],
            [
                { text: '💰 Comprar Señales', callback_data: 'trading_buy_signals' },
                { text: '📋 Mis Señales', callback_data: 'trading_my_signals' }
            ],
            [
                { text: '📊 Rendimiento', callback_data: 'trading_performance' },
                { text: '❓ Cómo Funciona', callback_data: 'trading_how_it_works' }
            ],
            [
                { text: '🔙 Volver al Menú', callback_data: 'start_back' }
            ]
        ]
    }),
    
    // Recharge methods keyboard
    createRechargeMethodsKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '💳 CUP (Tarjeta)', callback_data: 'dep_init:cup' },
                { text: '📲 Saldo Móvil', callback_data: 'dep_init:saldo' }
            ],
            [
                { text: '🔙 Volver a Billetera', callback_data: 'wallet' }
            ]
        ]
    }),
    
    // Cancel order keyboard
    createCancelOrderKeyboard: (ordenId, currency) => ({
        inline_keyboard: [
            [
                { text: '✅ Sí, cancelar orden', callback_data: `confirm_cancel:${ordenId}:${currency}` },
                { text: '❌ No, mantener orden', callback_data: 'recharge_menu' }
            ]
        ]
    }),
    
    // Terms keyboard
    createTermsKeyboard: () => ({
        inline_keyboard: [
            [{ text: '✅ Aceptar Términos', callback_data: 'accept_terms' }],
            [{ text: '🔙 Volver', callback_data: 'start_back' }]
        ]
    }),
    
    // Claim payment keyboard
    createClaimPaymentKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '🔍 Buscar por ID', callback_data: 'search_payment_id' },
                { text: '📋 Ver Pendientes', callback_data: 'view_pending_payments' }
            ],
            [
                { text: '🔙 Volver al Inicio', callback_data: 'start_back' }
            ]
        ]
    }),
    
    // Back keyboard
    createBackKeyboard: (callback_data) => ({
        inline_keyboard: [[{ text: '🔙 Volver', callback_data }]]
    }),
    
    // Deposit confirmation keyboard
    createDepositConfirmKeyboard: (currency, amount) => ({
        inline_keyboard: [
            [
                { text: '✅ Confirmar Depósito', callback_data: `confirm_deposit:${currency}:${amount}` },
                { text: '❌ Cancelar', callback_data: 'recharge_menu' }
            ]
        ]
    }),
    
    // Help keyboard
    createHelpKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '❓ Preguntas Frecuentes', callback_data: 'help_faq' },
                { text: '📞 Contactar Soporte', callback_data: 'help_contact' }
            ],
            [
                { text: '📜 Términos y Condiciones', callback_data: 'terms' },
                { text: '🔧 Reportar Problema', callback_data: 'help_report' }
            ],
            [
                { text: '🔙 Volver al Menú', callback_data: 'start_back' }
            ]
        ]
    }),
    
    // Admin keyboard
    createAdminKeyboard: () => ({
        inline_keyboard: [
            [
                { text: '📊 Estadísticas Totales', callback_data: 'admin_stats_total' },
                { text: '🔍 Buscar Usuario', callback_data: 'admin_search_user' }
            ],
            [
                { text: '📋 Ver Todas Órdenes Pendientes', callback_data: 'admin_pending_orders' },
                { text: '🎮 Ver Juegos Activos', callback_data: 'admin_active_games' }
            ],
            [
                { text: '💰 Ver Pagos Pendientes', callback_data: 'admin_pending_payments' },
                { text: '📈 Señales Trading', callback_data: 'trading_admin_menu' }
            ],
            [
                { text: '🎱 La Bolita Admin', callback_data: 'bolita_admin_menu' },
                { text: '🔄 Sincronizar Base de Datos', callback_data: 'admin_sync_db' }
            ],
            [
                { text: '🔙 Volver al Menú Principal', callback_data: 'start_back' }
            ]
        ]
    }),
    
    // User search keyboard
    createUserSearchKeyboard: (userId) => ({
        inline_keyboard: [
            [
                { text: '👛 Ver Billetera', callback_data: `admin_user_wallet:${userId}` },
                { text: '📜 Historial Transacciones', callback_data: `admin_user_history:${userId}` }
            ],
            [
                { text: '📋 Órdenes Pendientes', callback_data: `admin_user_orders:${userId}` },
                { text: '🎱 Apuestas La Bolita', callback_data: `admin_user_bets:${userId}` }
            ],
            [
                { text: '📈 Señales Trading', callback_data: `admin_user_trading:${userId}` },
                { text: '📊 Estadísticas Detalladas', callback_data: `admin_user_stats:${userId}` }
            ],
            [
                { text: '📞 Contactar Usuario', callback_data: `admin_contact_user:${userId}` },
                { text: '🔧 Modificar Saldo', callback_data: `admin_modify_balance:${userId}` }
            ],
            [
                { text: '🔙 Volver al Panel Admin', callback_data: 'admin_panel' },
                { text: '🔄 Buscar Otro Usuario', callback_data: 'admin_search_user' }
            ]
        ]
    })
};
