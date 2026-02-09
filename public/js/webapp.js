// webapp.js - WebApp principal para Cromwell Store
class CromwellWebApp {
    constructor() {
        console.log('🔄 Constructor CromwellWebApp llamado');
        
        // Obtener userId de variable global
        this.userId = window.TELEGRAM_USER_ID;
        
        // Fallbacks
        if (!this.userId) {
            const urlParams = new URLSearchParams(window.location.search);
            this.userId = urlParams.get('userId');
        }
        if (!this.userId) {
            this.userId = localStorage.getItem('cromwell_telegram_id');
        }
        
        if (!this.userId) {
            console.error('❌ No se encontró userId');
            this.showErrorScreen('No se detectó usuario. Por favor, abre la WebApp desde el bot.');
            return;
        }
        
        this.userId = this.userId.toString();
        this.telegram = window.Telegram?.WebApp;
        this.userData = null;
        
        // Inicializar inmediatamente
        this.init();
    }

    async init() {
        console.log('🚀 Inicializando Cromwell WebApp...');
        
        try {
            if (this.telegram) {
                this.telegram.expand();
                this.telegram.enableClosingConfirmation();
            }
            
            this.initEvents();
            await this.loadUserData(); // Carga crítica
            this.setupNavigation();
            await this.loadConfig();
            
            console.log('✅ WebApp inicializada completamente');
        } catch (error) {
            console.error('❌ Error fatal inicializando:', error);
            this.showToast('Error de inicialización', 'error');
        }
    }

    showErrorScreen(message) {
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; font-family: Arial, sans-serif;">
                <h2 style="color: #dc3545;">❌ Error</h2>
                <p>${message}</p>
                <div style="margin-top: 30px;">
                    <button onclick="location.reload()" style="
                        background: #4f46e5;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 16px;
                    ">
                        Reintentar
                    </button>
                </div>
            </div>
        `;
    }

    async loadConfig() {
        try {
            console.log('🔧 Cargando configuración...');
            const response = await fetch('/api/webapp-config');
            
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    window.PAGO_CUP_TARJETA = data.config.pago_cup_tarjeta || '';
                    window.PAGO_SALDO_MOVIL = data.config.pago_saldo_movil || '';
                    window.MINIMO_CUP = data.config.minimo_cup || 1000;
                    window.MINIMO_SALDO = data.config.minimo_saldo || 500;
                    window.MAXIMO_CUP = data.config.maximo_cup || 50000;
                    window.USDT_RATE_0_30 = data.config.usdt_rate_0_30 || 650;
                    window.USDT_RATE_30_PLUS = data.config.usdt_rate_30_plus || 680;
                    window.SALDO_MOVIL_RATE = data.config.saldo_movil_rate || 2.1;
                    window.MIN_CWS_USE = data.config.min_cws_use || 100;
                    window.CWS_PER_100_SALDO = data.config.cws_per_100_saldo || 10;
                    
                    console.log('✅ Configuración cargada');
                }
            }
        } catch (error) {
            console.warn('⚠️ Configuración no disponible, usando valores por defecto:', error);
        }
    }

    initEvents() {
        console.log('🎮 Inicializando eventos...');
        
        // Eventos de navegación
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const screen = e.currentTarget.dataset.screen;
                this.switchScreen(screen);
            });
        });

        // Eventos de acciones rápidas
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleQuickAction(action);
            });
        });

        // Eventos de recarga
        document.querySelectorAll('.method-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const method = e.currentTarget.dataset.method;
                this.selectPaymentMethod(method);
            });
        });

        // Eventos modales
        const closePhoneModal = document.getElementById('close-phone-modal');
        if (closePhoneModal) {
            closePhoneModal.addEventListener('click', () => {
                this.hideModal('phone-modal');
            });
        }

        const cancelPhone = document.getElementById('cancel-phone');
        if (cancelPhone) {
            cancelPhone.addEventListener('click', () => {
                this.hideModal('phone-modal');
            });
        }

        const savePhone = document.getElementById('save-phone');
        if (savePhone) {
            savePhone.addEventListener('click', () => {
                this.updatePhoneNumber();
            });
        }

        const modalCancel = document.getElementById('modal-cancel');
        if (modalCancel) {
            modalCancel.addEventListener('click', () => {
                this.hideModal('confirm-modal');
            });
        }

        // Eventos de formularios
        const amountInput = document.getElementById('amount');
        if (amountInput) {
            amountInput.addEventListener('input', (e) => {
                this.calculateBonus(e.target.value);
            });
        }

        const confirmDeposit = document.getElementById('confirm-deposit');
        if (confirmDeposit) {
            confirmDeposit.addEventListener('click', () => {
                this.confirmDeposit();
            });
        }

        const cancelDeposit = document.getElementById('cancel-deposit');
        if (cancelDeposit) {
            cancelDeposit.addEventListener('click', () => {
                this.showScreen('recharge');
            });
        }

        const refreshWallet = document.getElementById('refresh-wallet');
        if (refreshWallet) {
            refreshWallet.addEventListener('click', () => {
                this.loadUserData();
            });
        }

        const changePhone = document.getElementById('change-phone');
        if (changePhone) {
            changePhone.addEventListener('click', () => {
                this.showPhoneModal();
            });
        }

        const searchPayment = document.getElementById('search-payment');
        if (searchPayment) {
            searchPayment.addEventListener('click', () => {
                this.searchPayment();
            });
        }

        const cancelSearch = document.getElementById('cancel-search');
        if (cancelSearch) {
            cancelSearch.addEventListener('click', () => {
                this.showScreen('claim');
            });
        }
        
        console.log('✅ Eventos inicializados');
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                navItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    async loadUserData() {
        try {
            this.showLoading('Cargando información...');
            console.log('🔍 Solicitando datos para:', this.userId);
            
            try {
                const response = await fetch('/api/user-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegram_id: this.userId })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.userData = data.user;
                        this.updateUI();
                        this.showToast('✅ Datos cargados correctamente', 'success');
                        return;
                    } else {
                        console.warn('⚠️ API respondió con error:', data.error);
                        throw new Error(data.error || 'Error en la API');
                    }
                }
                throw new Error(`Error HTTP: ${response.status}`);

            } catch (apiError) {
                console.warn('⚠️ API no disponible o falló. Usando datos de prueba.', apiError);
                // DATOS DE PRUEBA (MOCK)
                this.userData = {
                    id: 1,
                    telegram_id: this.userId,
                    first_name: "Usuario Demo",
                    username: "demo_user",
                    balance_cup: 5000,
                    balance_saldo: 250,
                    tokens_cws: 150,
                    phone_number: "5350000000",
                    last_active: new Date().toISOString(),
                    first_dep_cup: true,
                    first_dep_saldo: true
                };
                this.updateUI();
                this.showToast('⚠️ Modo Demo: Datos de prueba', 'warning');
            }

        } catch (error) {
            console.error('❌ Error crítico cargando datos:', error);
            
            // Actualizar UI con mensaje de error
            const welcomeTitle = document.getElementById('welcome-title');
            const welcomeSubtitle = document.getElementById('welcome-subtitle');
            
            if (welcomeTitle) {
                welcomeTitle.textContent = '❌ Error';
                welcomeTitle.style.color = '#ef4444';
            }
            if (welcomeSubtitle) {
                welcomeSubtitle.textContent = 'No se pudieron cargar los datos';
                welcomeSubtitle.style.color = '#ef4444';
            }
            
            this.showToast('❌ Error cargando datos del usuario', 'error');
        } finally {
            this.hideLoading();
        }
    }

    updateUI() {
        if (!this.userData) {
            console.warn('⚠️ No hay datos para actualizar UI');
            return;
        }
        
        console.log('🎨 Actualizando UI con datos:', this.userData);
        
        // Header y Dashboard
        const elements = {
            'welcome-title': `¡Hola, ${this.userData.first_name || 'Usuario'}!`,
            'welcome-subtitle': 'Bienvenido a Cromwell Store',
            'dashboard-cup': `$${this.userData.balance_cup || 0}`,
            'dashboard-saldo': `$${this.userData.balance_saldo || 0}`,
            'dashboard-cws': this.userData.tokens_cws || 0,
            'balance-cup': `$${this.userData.balance_cup || 0}`,
            'user-telegram-id': this.userData.telegram_id || 'No disponible',
            'user-phone': this.userData.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado',
            'last-activity': this.formatDate(this.userData.last_active),
            'wallet-cup': `$${this.userData.balance_cup || 0}`,
            'wallet-saldo': `$${this.userData.balance_saldo || 0}`,
            'wallet-cws': this.userData.tokens_cws || 0,
            'wallet-phone': this.userData.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado'
        };

        for (const [id, text] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = text;
            } else {
                console.warn(`⚠️ Elemento ${id} no encontrado`);
            }
        }

        // Actualizar avatar
        const userAvatar = document.getElementById('user-avatar');
        if (userAvatar) {
            userAvatar.textContent = this.userData.first_name ? 
                this.userData.first_name.charAt(0).toUpperCase() : '👤';
        }
        
        console.log('✅ UI actualizada correctamente');
    }

    formatDate(dateString) {
        if (!dateString) return 'No disponible';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return 'Fecha inválida';
        }
    }

    switchScreen(screenName) {
        console.log(`🔄 Cambiando a pantalla: ${screenName}`);
        
        // Ocultar todas las pantallas
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Mostrar pantalla seleccionada
        const targetScreen = document.getElementById(`screen-${screenName}`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            
            // Cargar datos específicos de la pantalla
            switch(screenName) {
                case 'games':
                    this.loadGames();
                    break;
                case 'etecsa':
                    this.loadEtecsaOffers();
                    break;
                case 'history':
                    this.loadHistory();
                    break;
            }
        }
    }

    showScreen(screenName) {
        console.log(`📱 Mostrando pantalla: ${screenName}`);
        
        // Actualizar navegación
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.screen === screenName) {
                item.classList.add('active');
            }
        });

        // Cambiar a la pantalla
        this.switchScreen(screenName);
    }

    handleQuickAction(action) {
        console.log(`⚡ Acción rápida: ${action}`);
        
        switch(action) {
            case 'deposit-cup':
                this.selectPaymentMethod('cup');
                this.showScreen('recharge');
                break;
            case 'deposit-saldo':
                this.selectPaymentMethod('saldo');
                this.showScreen('recharge');
                break;
            case 'show-games':
                this.showScreen('games');
                break;
            case 'show-etecsa':
                this.showScreen('etecsa');
                break;
            case 'claim-payment':
                this.showScreen('claim');
                break;
            case 'history':
                this.showScreen('history');
                break;
            default:
                console.warn(`⚠️ Acción desconocida: ${action}`);
        }
    }

    selectPaymentMethod(method) {
        console.log(`💰 Seleccionando método: ${method}`);
        
        // Remover selección anterior
        document.querySelectorAll('.method-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Seleccionar nueva tarjeta
        const selectedCard = document.querySelector(`[data-method="${method}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }

        // Mostrar formulario de recarga
        const form = document.getElementById('recharge-form');
        if (form) {
            form.classList.remove('hidden');
        }

        // Configurar formulario según método
        const minAmounts = {
            cup: window.MINIMO_CUP || 1000,
            saldo: window.MINIMO_SALDO || 500
        };

        const maxAmounts = {
            cup: window.MAXIMO_CUP || 50000,
            saldo: 10000
        };

        const rechargeMethod = document.getElementById('recharge-method');
        const minAmount = document.getElementById('min-amount');
        const maxAmount = document.getElementById('max-amount');
        const amountInput = document.getElementById('amount');
        
        if (rechargeMethod) rechargeMethod.textContent = method === 'cup' ? 'CUP (Tarjeta)' : 'Saldo Móvil';
        if (minAmount) minAmount.textContent = minAmounts[method];
        if (maxAmount) maxAmount.textContent = maxAmounts[method];
        
        if (amountInput) {
            amountInput.min = minAmounts[method];
            amountInput.max = maxAmounts[method];
            amountInput.placeholder = `Ej: ${minAmounts[method]}`;
            amountInput.value = '';
        }

        // Configurar información de pago (versión mock)
        const paymentInfo = document.getElementById('payment-instructions');
        if (paymentInfo) {
            if (method === 'cup') {
                paymentInfo.innerHTML = `
                    <p><strong>💳 Tarjeta destino:</strong> <code>${window.PAGO_CUP_TARJETA || 'XXXX-XXXX-XXXX-1234'}</code></p>
                    <p><strong>📞 Teléfono para pagos:</strong> ${this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado'}</p>
                    <p>⚠️ <strong>IMPORTANTE:</strong> Activa "Mostrar número al destinatario" en Transfermóvil</p>
                `;
            } else {
                paymentInfo.innerHTML = `
                    <p><strong>📱 Número destino:</strong> <code>${window.PAGO_SALDO_MOVIL || '5350000000'}</code></p>
                    <p><strong>📞 Tu teléfono:</strong> ${this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado'}</p>
                    <p>🎫 <strong>Ganas tokens:</strong> ${window.CWS_PER_100_SALDO || 10} CWS por cada 100 de saldo</p>
                `;
            }
        }

        this.currentAction = {
            type: 'deposit',
            method: method
        };
        
        // Calcular bono inicial
        this.calculateBonus(amountInput?.value || '');
    }

    calculateBonus(amount) {
        if (!this.currentAction || !amount) return;

        const amountNum = parseFloat(amount) || 0;
        let totalWithBonus = amountNum;

        if (amountNum > 0) {
            const bonus = amountNum * 0.10;
            totalWithBonus = amountNum + bonus;
            const totalElement = document.getElementById('total-with-bonus');
            if (totalElement) {
                totalElement.textContent = `$${totalWithBonus.toFixed(2)}`;
            }
        }
    }

    async confirmDeposit() {
        const amountInput = document.getElementById('amount');
        const amount = amountInput ? amountInput.value : null;
        const method = this.currentAction?.method;

        if (!amount || !method) {
            this.showToast('❌ Por favor, ingresa un monto válido', 'error');
            return;
        }

        const amountNum = parseFloat(amount);
        const minAmounts = { 
            cup: window.MINIMO_CUP || 1000, 
            saldo: window.MINIMO_SALDO || 500 
        };

        if (amountNum < minAmounts[method]) {
            this.showToast(`❌ El monto mínimo es $${minAmounts[method]}`, 'error');
            return;
        }

        try {
            this.showLoading('Creando solicitud de depósito...');
            
            // Simulación de éxito (modo demo)
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            this.showModal({
                title: '✅ Solicitud Creada (Demo)',
                message: `Orden #DEMO-${Date.now()}\n\nMonto: $${amountNum} ${method.toUpperCase()}\n\nEn modo real, seguirías las instrucciones en Telegram.`,
                icon: '✅',
                confirmText: 'Aceptar',
                onConfirm: () => {
                    this.hideModal('confirm-modal');
                    this.showScreen('dashboard');
                    
                    // Actualizar saldos en modo demo
                    if (this.userData) {
                        if (method === 'cup') {
                            this.userData.balance_cup += amountNum;
                        } else {
                            this.userData.balance_saldo += amountNum;
                            this.userData.tokens_cws += Math.floor(amountNum / 100) * (window.CWS_PER_100_SALDO || 10);
                        }
                        this.updateUI();
                    }
                }
            });
        } catch (error) {
            console.error('Error creando depósito:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadGames() {
        try {
            // Simulación de carga de juegos
            const gamesList = document.getElementById('games-list');
            if (!gamesList) return;
            
            // Mostrar loading
            gamesList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando juegos...</p></div>';
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Datos de prueba
            const mockGames = [
                {
                    id: 1,
                    name: "Steam Wallet",
                    variations: {
                        "5": { name: "$5 USD" },
                        "10": { name: "$10 USD" },
                        "20": { name: "$20 USD" }
                    }
                },
                {
                    id: 2,
                    name: "Google Play",
                    variations: {
                        "5": { name: "$5 USD" },
                        "10": { name: "$10 USD" }
                    }
                },
                {
                    id: 3,
                    name: "PlayStation Network",
                    variations: {
                        "10": { name: "$10 USD" },
                        "20": { name: "$20 USD" },
                        "50": { name: "$50 USD" }
                    }
                }
            ];
            
            gamesList.innerHTML = '';
            
            if (!mockGames || mockGames.length === 0) {
                gamesList.innerHTML = '<div class="info-card"><p>No hay juegos disponibles en este momento.</p></div>';
                return;
            }

            mockGames.forEach(game => {
                const gameCard = document.createElement('div');
                gameCard.className = 'game-card';
                gameCard.dataset.gameId = game.id;
                gameCard.innerHTML = `
                    <div class="game-icon">🎮</div>
                    <div class="game-info">
                        <h4>${game.name || 'Juego'}</h4>
                        <p>${Object.keys(game.variations || {}).length} paquetes disponibles</p>
                    </div>
                `;

                gameCard.addEventListener('click', () => {
                    this.showGameDetails(game);
                });

                gamesList.appendChild(gameCard);
            });
        } catch (error) {
            console.error('Error cargando juegos:', error);
            const gamesList = document.getElementById('games-list');
            if (gamesList) {
                gamesList.innerHTML = 
                    '<div class="error-card"><p>Error cargando juegos</p></div>';
            }
        }
    }

    showGameDetails(game) {
        this.selectedGame = game;
        
        const gamesList = document.getElementById('games-list');
        const gameDetails = document.getElementById('game-details');
        
        if (gamesList) gamesList.classList.add('hidden');
        if (gameDetails) {
            gameDetails.classList.remove('hidden');
            
            gameDetails.innerHTML = `
                <div class="screen-header">
                    <h2>${game.name || 'Juego'}</h2>
                    <button class="btn-secondary" id="back-to-games">← Volver</button>
                </div>
                <div class="variations-list" id="variations-list">
                    ${this.generateVariationsList(game)}
                </div>
            `;

            const backButton = document.getElementById('back-to-games');
            if (backButton) {
                backButton.addEventListener('click', () => {
                    if (gamesList) gamesList.classList.remove('hidden');
                    gameDetails.classList.add('hidden');
                });
            }

            // Configurar eventos para variaciones
            document.querySelectorAll('.variation-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    const varId = e.currentTarget.dataset.varId;
                    this.selectGameVariation(varId);
                });
            });
        }
    }

    generateVariationsList(game) {
        let html = '';
        const variations = game.variations || {};
        
        Object.entries(variations).forEach(([id, variation]) => {
            // Precios mock
            const cupPrice = parseInt(id) * (window.USDT_RATE_0_30 || 650);
            const saldoPrice = cupPrice * (window.SALDO_MOVIL_RATE || 2.1);
            const cwsPrice = Math.max(parseInt(id) * 100, window.MIN_CWS_USE || 100);
            
            html += `
                <div class="variation-card" data-var-id="${id}">
                    <div class="variation-name">${variation.name || 'Paquete'}</div>
                    <div class="variation-prices">
                        <div class="price-item">
                            <span class="price-label">CUP</span>
                            <span class="price-value">$${cupPrice}</span>
                        </div>
                        <div class="price-item">
                            <span class="price-label">Saldo</span>
                            <span class="price-value">$${saldoPrice.toFixed(2)}</span>
                        </div>
                        <div class="price-item">
                            <span class="price-label">CWS</span>
                            <span class="price-value">${cwsPrice}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        return html;
    }

    async selectGameVariation(variationId) {
        try {
            this.showLoading('Consultando precios...');

            await new Promise(resolve => setTimeout(resolve, 800));
            
            // Precios mock
            const usdtPrice = parseInt(variationId);
            const cupPrice = usdtPrice * (window.USDT_RATE_0_30 || 650);
            const saldoPrice = cupPrice * (window.SALDO_MOVIL_RATE || 2.1);
            const cwsPrice = Math.max(usdtPrice * 100, window.MIN_CWS_USE || 100);

            this.selectedVariation = {
                id: variationId,
                name: this.selectedGame.variations[variationId]?.name || 'Paquete',
                prices: {
                    usdt: usdtPrice,
                    cup: cupPrice,
                    saldo: saldoPrice,
                    cws: cwsPrice
                }
            };
            
            this.showGamePaymentForm();
        } catch (error) {
            console.error('Error obteniendo precio:', error);
            this.showToast('❌ Error: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    showGamePaymentForm() {
        const gameDetails = document.getElementById('game-details');
        const gamePayment = document.getElementById('game-payment');
        
        if (gameDetails) gameDetails.classList.add('hidden');
        if (gamePayment) {
            gamePayment.classList.remove('hidden');
            
            const variation = this.selectedVariation;
            
            gamePayment.innerHTML = `
                <div class="screen-header">
                    <h2>${this.selectedGame.name || 'Juego'}</h2>
                    <button class="btn-secondary" id="back-to-variations">← Atrás</button>
                </div>
                <div class="recharge-form">
                    <h3>${variation.name}</h3>
                    
                    <div class="price-summary">
                        <div class="price-row">
                            <span>Precio en USDT:</span>
                            <span class="price-value">$${variation.prices.usdt || 0}</span>
                        </div>
                        <div class="price-row">
                            <span>CUP:</span>
                            <span class="price-value">$${variation.prices.cup || 0}</span>
                        </div>
                        <div class="price-row">
                            <span>Saldo Móvil:</span>
                            <span class="price-value">$${variation.prices.saldo || 0}</span>
                        </div>
                        <div class="price-row">
                            <span>CWS:</span>
                            <span class="price-value">${variation.prices.cws || 0} tokens</span>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Método de pago:</label>
                        <select id="game-payment-method">
                            <option value="cup">💳 Pagar con CUP - $${variation.prices.cup || 0}</option>
                            <option value="saldo">📱 Pagar con Saldo Móvil - $${variation.prices.saldo || 0}</option>
                            ${(variation.prices.cws || 0) >= (window.MIN_CWS_USE || 100) ? 
                                `<option value="cws">🎫 Pagar con CWS - ${variation.prices.cws || 0} tokens</option>` : ''}
                        </select>
                    </div>
                    
                    <div id="game-input-fields">
                        <div class="form-group">
                            <label>ID o Email del juego:</label>
                            <input type="text" id="game-account" placeholder="Ej: steamID, email@gmail.com">
                        </div>
                    </div>
                    
                    <div class="form-actions">
                        <button class="btn-primary" id="confirm-game-payment">✅ Confirmar Compra</button>
                        <button class="btn-secondary" id="cancel-game-payment">❌ Cancelar</button>
                    </div>
                </div>
            `;

            const backButton = document.getElementById('back-to-variations');
            const cancelButton = document.getElementById('cancel-game-payment');
            const confirmButton = document.getElementById('confirm-game-payment');

            if (backButton) {
                backButton.addEventListener('click', () => {
                    if (gamePayment) gamePayment.classList.add('hidden');
                    if (gameDetails) gameDetails.classList.remove('hidden');
                });
            }

            if (cancelButton) {
                cancelButton.addEventListener('click', () => {
                    if (gamePayment) gamePayment.classList.add('hidden');
                    if (gameDetails) gameDetails.classList.remove('hidden');
                });
            }

            if (confirmButton) {
                confirmButton.addEventListener('click', () => {
                    this.confirmGamePurchase();
                });
            }
        }
    }

    async confirmGamePurchase() {
        const methodSelect = document.getElementById('game-payment-method');
        const method = methodSelect ? methodSelect.value : null;
        const variation = this.selectedVariation;
        
        if (!method || !variation) {
            this.showToast('❌ Error en los datos de compra', 'error');
            return;
        }

        const accountInput = document.getElementById('game-account');
        const account = accountInput ? accountInput.value.trim() : '';
        
        if (!account) {
            this.showToast('❌ Ingresa el ID o email del juego', 'error');
            return;
        }

        try {
            this.showLoading('Procesando compra...');
            
            // Simulación de compra
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            this.showModal({
                title: '✅ ¡Compra Exitosa! (Demo)',
                message: `Recarga para ${this.selectedGame.name || 'Juego'}\n\nPaquete: ${variation.name}\nCuenta: ${account}\nPago: ${method === 'cws' ? (variation.prices[method] || 0) + ' CWS' : '$' + (variation.prices[method] || 0) + ' ' + method.toUpperCase()}\n\nOrden #GAME-${Date.now()}`,
                icon: '🎮',
                confirmText: 'Aceptar',
                onConfirm: () => {
                    this.hideModal('confirm-modal');
                    this.showScreen('dashboard');
                    
                    // Actualizar saldos en modo demo
                    if (this.userData) {
                        const price = variation.prices[method] || 0;
                        if (method === 'cup' && this.userData.balance_cup >= price) {
                            this.userData.balance_cup -= price;
                        } else if (method === 'saldo' && this.userData.balance_saldo >= price) {
                            this.userData.balance_saldo -= price;
                        } else if (method === 'cws' && this.userData.tokens_cws >= price) {
                            this.userData.tokens_cws -= price;
                        }
                        this.updateUI();
                    }
                }
            });
        } catch (error) {
            console.error('Error procesando compra:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadEtecsaOffers() {
        try {
            // Simulación de carga
            const offersContainer = document.getElementById('etecsa-offers');
            if (!offersContainer) return;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Datos de prueba
            const mockOffers = [
                {
                    id: 1,
                    name: "Recarga Nauta Hogar",
                    prices: [
                        { id: "1h", label: "1 Hora", cup_price: 150, original_usdt: 0.25 },
                        { id: "5h", label: "5 Horas", cup_price: 450, original_usdt: 0.75 }
                    ]
                },
                {
                    id: 2,
                    name: "Paquete de Datos",
                    prices: [
                        { id: "600mb", label: "600 MB", cup_price: 780, original_usdt: 1.2 },
                        { id: "2gb", label: "2 GB", cup_price: 1950, original_usdt: 3.0 }
                    ]
                },
                {
                    id: 3,
                    name: "Recarga Saldo",
                    prices: [
                        { id: "5cup", label: "$5 USD", cup_price: 3250, original_usdt: 5.0 },
                        { id: "10cup", label: "$10 USD", cup_price: 6500, original_usdt: 10.0 }
                    ]
                }
            ];
            
            offersContainer.innerHTML = '';

            mockOffers.forEach(offer => {
                const offerCard = document.createElement('div');
                offerCard.className = 'offer-card';
                offerCard.dataset.offerId = offer.id;
                offerCard.innerHTML = `
                    <div class="offer-header">
                        <div class="offer-icon">📱</div>
                        <div class="offer-name">${offer.name || 'Oferta'}</div>
                    </div>
                    <div class="offer-prices">
                        ${(offer.prices || []).map(price => `
                            <div class="offer-price" data-price-id="${price.id}">
                                <span>${price.label || 'Paquete'}</span>
                                <span class="price-value">$${price.cup_price || 0} CUP</span>
                            </div>
                        `).join('')}
                    </div>
                `;

                offerCard.addEventListener('click', (e) => {
                    if (e.target.closest('.offer-price')) {
                        const priceId = e.target.closest('.offer-price').dataset.priceId;
                        this.selectEtecsaOffer(offer, priceId);
                    }
                });

                offersContainer.appendChild(offerCard);
            });
        } catch (error) {
            console.error('Error cargando ofertas:', error);
            const offersContainer = document.getElementById('etecsa-offers');
            if (offersContainer) {
                offersContainer.innerHTML = 
                    '<div class="error-card"><p>Error cargando ofertas</p></div>';
            }
        }
    }

    selectEtecsaOffer(offer, priceId) {
        this.selectedOffer = { offer, priceId };
        this.showEtecsaForm();
    }

    showEtecsaForm() {
        const offersContainer = document.getElementById('etecsa-offers');
        const etecsaForm = document.getElementById('etecsa-form');
        
        if (offersContainer) offersContainer.classList.add('hidden');
        if (etecsaForm) {
            etecsaForm.classList.remove('hidden');
            
            const price = (this.selectedOffer.offer.prices || []).find(p => p.id === this.selectedOffer.priceId);
            
            etecsaForm.innerHTML = `
                <div class="screen-header">
                    <h2>📱 Recarga ETECSA</h2>
                    <button class="btn-secondary" id="back-to-offers">← Volver</button>
                </div>
                <div class="recharge-form">
                    <h3>${this.selectedOffer.offer.name || 'Oferta'}</h3>
                    <div class="price-summary">
                        <div class="price-row">
                            <span>Paquete:</span>
                            <span class="price-value">${price?.label || 'N/A'}</span>
                        </div>
                        <div class="price-row">
                            <span>Precio:</span>
                            <span class="price-value">$${price?.cup_price || 0} CUP</span>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="etecsa-phone">Número de teléfono destino:</label>
                        <input type="tel" id="etecsa-phone" placeholder="5351234567" maxlength="10">
                        <p class="form-hint">Formato: 10 dígitos, comenzando con 53</p>
                    </div>
                    
                    <div class="balance-check">
                        <p>Tu saldo CUP: <strong>$${this.userData?.balance_cup || 0}</strong></p>
                        <p>Saldo después: <strong>$${(this.userData?.balance_cup || 0) - (price?.cup_price || 0)}</strong></p>
                    </div>
                    
                    <div class="form-actions">
                        <button class="btn-primary" id="confirm-etecsa">✅ Confirmar Recarga</button>
                        <button class="btn-secondary" id="cancel-etecsa">❌ Cancelar</button>
                    </div>
                </div>
            `;

            const backButton = document.getElementById('back-to-offers');
            const cancelButton = document.getElementById('cancel-etecsa');
            const confirmButton = document.getElementById('confirm-etecsa');

            if (backButton) {
                backButton.addEventListener('click', () => {
                    if (etecsaForm) etecsaForm.classList.add('hidden');
                    if (offersContainer) offersContainer.classList.remove('hidden');
                });
            }

            if (cancelButton) {
                cancelButton.addEventListener('click', () => {
                    if (etecsaForm) etecsaForm.classList.add('hidden');
                    if (offersContainer) offersContainer.classList.remove('hidden');
                });
            }

            if (confirmButton) {
                confirmButton.addEventListener('click', () => {
                    this.confirmEtecsaRecharge(price);
                });
            }
        }
    }

    async confirmEtecsaRecharge(price) {
        const phoneInput = document.getElementById('etecsa-phone');
        const phone = phoneInput ? phoneInput.value : null;

        const cleanPhone = phone ? phone.replace(/[^\d]/g, '') : '';
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            this.showToast('❌ Formato de teléfono incorrecto', 'error');
            return;
        }

        const priceCup = price?.cup_price || 0;
        if ((this.userData?.balance_cup || 0) < priceCup) {
            this.showToast('❌ Saldo CUP insuficiente', 'error');
            return;
        }

        try {
            this.showLoading('Procesando recarga ETECSA...');
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            this.showModal({
                title: '✅ ¡Recarga Exitosa! (Demo)',
                message: `Recarga ETECSA completada\n\nDestino: +${cleanPhone}\nPaquete: ${price?.label || 'N/A'}\nPrecio: $${priceCup} CUP\n\nID: ETECSA-${Date.now()}`,
                icon: '📱',
                confirmText: 'Aceptar',
                onConfirm: () => {
                    this.hideModal('confirm-modal');
                    this.showScreen('dashboard');
                    
                    // Actualizar saldo en modo demo
                    if (this.userData) {
                        this.userData.balance_cup -= priceCup;
                        this.updateUI();
                    }
                }
            });
        } catch (error) {
            console.error('Error procesando recarga:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadHistory() {
        try {
            // Simulación de historial
            const historyList = document.getElementById('history-list');
            if (!historyList) return;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Datos de prueba
            const mockTransactions = [
                {
                    id: 1,
                    type: 'DEPOSIT',
                    status: 'completed',
                    amount: 5000,
                    currency: 'CUP',
                    created_at: new Date(Date.now() - 86400000).toISOString(), // 1 día atrás
                    tx_id: 'TMW123456789'
                },
                {
                    id: 2,
                    type: 'GAME_RECHARGE',
                    status: 'completed',
                    amount: 6500,
                    currency: 'CUP',
                    created_at: new Date(Date.now() - 172800000).toISOString(), // 2 días atrás
                    tx_id: 'STEAM-001'
                },
                {
                    id: 3,
                    type: 'ETECSA_RECHARGE',
                    status: 'pending',
                    amount: 1500,
                    currency: 'CUP',
                    created_at: new Date().toISOString(),
                    tx_id: 'ETECSA-001'
                }
            ];
            
            historyList.innerHTML = '';

            mockTransactions.forEach(transaction => {
                const transactionCard = document.createElement('div');
                transactionCard.className = 'transaction-card';
                
                let icon = '🔸';
                let statusClass = '';
                let statusText = '';
                
                switch(transaction.status) {
                    case 'completed':
                        icon = '✅';
                        statusClass = 'status-completed';
                        statusText = 'Completado';
                        break;
                    case 'pending':
                        icon = '⏳';
                        statusClass = 'status-pending';
                        statusText = 'Pendiente';
                        break;
                    case 'failed':
                        icon = '❌';
                        statusClass = 'status-failed';
                        statusText = 'Fallido';
                        break;
                    default:
                        statusText = transaction.status;
                }
                
                const date = new Date(transaction.created_at || Date.now()).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                let typeText = '';
                switch(transaction.type) {
                    case 'DEPOSIT':
                        typeText = 'Depósito';
                        break;
                    case 'GAME_RECHARGE':
                        typeText = 'Recarga Juego';
                        break;
                    case 'ETECSA_RECHARGE':
                        typeText = 'Recarga ETECSA';
                        break;
                    default:
                        typeText = transaction.type || 'Transacción';
                }
                
                const amount = Math.abs(transaction.amount || 0);
                const currency = transaction.currency?.toUpperCase() || '';
                
                transactionCard.innerHTML = `
                    <div class="transaction-header">
                        <div class="transaction-type">
                            <span>${icon}</span>
                            <span>${typeText}</span>
                        </div>
                        <div class="transaction-status ${statusClass}">${statusText}</div>
                    </div>
                    <div class="transaction-details">
                        <div class="detail-item">
                            <span class="detail-label">Fecha:</span>
                            <span class="detail-value">${date}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Monto:</span>
                            <span class="detail-value">${amount} ${currency}</span>
                        </div>
                        ${transaction.tx_id ? `
                            <div class="detail-item">
                                <span class="detail-label">ID:</span>
                                <span class="detail-value"><code>${transaction.tx_id}</code></span>
                            </div>
                        ` : ''}
                    </div>
                `;
                
                historyList.appendChild(transactionCard);
            });
        } catch (error) {
            console.error('Error cargando historial:', error);
            const historyList = document.getElementById('history-list');
            if (historyList) {
                historyList.innerHTML = 
                    '<div class="error-card"><p>Error cargando historial</p></div>';
            }
        }
    }

    showPhoneModal() {
        const currentPhoneDisplay = document.getElementById('current-phone-display');
        const newPhoneInput = document.getElementById('new-phone');
        
        if (currentPhoneDisplay) {
            currentPhoneDisplay.textContent = 
                this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado';
        }
        
        if (newPhoneInput) {
            newPhoneInput.value = '';
        }
        
        this.showModal('phone-modal');
    }

    async updatePhoneNumber() {
        const newPhoneInput = document.getElementById('new-phone');
        const newPhone = newPhoneInput ? newPhoneInput.value.trim() : '';
        
        if (!newPhone.startsWith('53') || newPhone.length !== 10) {
            this.showToast('❌ Formato inválido. Debe comenzar con 53 y tener 10 dígitos.', 'error');
            return;
        }

        try {
            this.showLoading('Actualizando teléfono...');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Actualizar en modo demo
            if (this.userData) {
                this.userData.phone_number = newPhone;
                this.updateUI();
            }
            
            this.showToast('✅ Teléfono actualizado correctamente (Demo)', 'success');
            this.hideModal('phone-modal');
            
        } catch (error) {
            console.error('Error actualizando teléfono:', error);
            this.showToast('❌ Error: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async searchPayment() {
        const txIdInput = document.getElementById('tx-id');
        const txId = txIdInput ? txIdInput.value.trim().toUpperCase() : '';
        
        if (!txId) {
            this.showToast('❌ Ingresa un ID de transacción', 'error');
            return;
        }

        try {
            this.showLoading('Buscando pago...');
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            this.showModal({
                title: '✅ ¡Pago Encontrado! (Demo)',
                message: `Pago simulado encontrado\n\nMonto: $5000 CUP\nID: ${txId}\n\nEn modo real, el saldo sería acreditado a tu billetera.`,
                icon: '💰',
                confirmText: 'Aceptar',
                onConfirm: () => {
                    this.hideModal('confirm-modal');
                    this.showScreen('dashboard');
                }
            });
        } catch (error) {
            console.error('Error buscando pago:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    showModal(options) {
        if (typeof options === 'string') {
            // Mostrar modal por ID
            const modal = document.getElementById(options);
            if (modal) {
                modal.classList.remove('hidden');
            }
        } else {
            // Mostrar modal de confirmación con opciones
            const modalIcon = document.getElementById('modal-icon');
            const modalTitle = document.getElementById('modal-title');
            const modalMessage = document.getElementById('modal-message');
            const confirmBtn = document.getElementById('modal-confirm');
            
            if (modalIcon) modalIcon.textContent = options.icon || '⚠️';
            if (modalTitle) modalTitle.textContent = options.title || '';
            if (modalMessage) modalMessage.textContent = options.message || '';
            
            if (confirmBtn) {
                confirmBtn.textContent = options.confirmText || 'Confirmar';
                
                // Remover event listeners previos
                const newConfirmBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                
                newConfirmBtn.onclick = () => {
                    if (options.onConfirm) options.onConfirm();
                    this.hideModal('confirm-modal');
                };
            }
            
            const modal = document.getElementById('confirm-modal');
            if (modal) {
                modal.classList.remove('hidden');
            }
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${this.getToastIcon(type)}</span>
            <span class="toast-message">${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Auto-remover después de 5 segundos
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }

    getToastIcon(type) {
        switch(type) {
            case 'success': return '✅';
            case 'error': return '❌';
            case 'warning': return '⚠️';
            default: return 'ℹ️';
        }
    }

    showLoading(text = 'Cargando...') {
        const loadingText = document.getElementById('loading-text');
        const loadingOverlay = document.getElementById('loading-overlay');
        
        if (loadingText) loadingText.textContent = text;
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
    }
}

// Inicializar la WebApp cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 webapp.js: DOM cargado');
    
    // Configurar variables globales por defecto
    window.PAGO_CUP_TARJETA = window.PAGO_CUP_TARJETA || '';
    window.PAGO_SALDO_MOVIL = window.PAGO_SALDO_MOVIL || '';
    window.MINIMO_CUP = window.MINIMO_CUP || 1000;
    window.MINIMO_SALDO = window.MINIMO_SALDO || 500;
    window.MAXIMO_CUP = window.MAXIMO_CUP || 50000;
    window.USDT_RATE_0_30 = window.USDT_RATE_0_30 || 650;
    window.USDT_RATE_30_PLUS = window.USDT_RATE_30_PLUS || 680;
    window.SALDO_MOVIL_RATE = window.SALDO_MOVIL_RATE || 2.1;
    window.MIN_CWS_USE = window.MIN_CWS_USE || 100;
    window.CWS_PER_100_SALDO = window.CWS_PER_100_SALDO || 10;
    
    console.log('📱 webapp.js: Variables globales configuradas');
    console.log('📱 webapp.js: TELEGRAM_USER_ID actual:', window.TELEGRAM_USER_ID);
    
    // Verificar si tenemos userId
    if (window.TELEGRAM_USER_ID) {
        console.log('🚀 webapp.js: Inicializando CromwellWebApp...');
        window.cromwellApp = new CromwellWebApp();
    } else {
        console.error('❌ webapp.js: No hay TELEGRAM_USER_ID disponible');
        
        // Intentar obtener de localStorage como último recurso
        const storedId = localStorage.getItem('cromwell_telegram_id');
        if (storedId) {
            console.log('🔍 webapp.js: Usando ID de localStorage:', storedId);
            window.TELEGRAM_USER_ID = storedId;
            window.cromwellApp = new CromwellWebApp();
        } else {
            document.body.innerHTML = `
                <div style="padding: 40px 20px; text-align: center; font-family: Arial, sans-serif;">
                    <h2 style="color: #dc3545;">❌ Error de Inicialización</h2>
                    <p>No se detectó el ID del usuario.</p>
                    <p>Por favor, abre la WebApp desde el bot de Telegram.</p>
                    <button onclick="location.reload()" style="
                        background: #4f46e5;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 16px;
                        margin-top: 20px;
                    ">
                        Reintentar
                    </button>
                </div>
            `;
        }
    }
});
