// webapp.js - WebApp principal para Cromwell Store (VERSIÓN MEJORADA)
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
        this.currentScreen = 'dashboard';
        this.currentAction = null;
        this.selectedGame = null;
        this.selectedVariation = null;
        this.selectedOffer = null;
        
        // Variables globales de configuración
        window.PAGO_CUP_TARJETA = '';
        window.PAGO_SALDO_MOVIL = '';
        window.MINIMO_CUP = 1000;
        window.MINIMO_SALDO = 500;
        window.MAXIMO_CUP = 50000;
        window.USDT_RATE_0_30 = 650;
        window.USDT_RATE_30_PLUS = 680;
        window.SALDO_MOVIL_RATE = 2.1;
        window.MIN_CWS_USE = 100;
        window.CWS_PER_100_SALDO = 10;
        
        // Variables para juegos
        this.games = [];
        this.selectedGame = null;
        this.selectedVariation = null;
        
        this.init();
    }

    async init() {
        console.log('🚀 Inicializando Cromwell WebApp...');
        
        try {
            // Configurar Telegram WebApp si está disponible
            if (this.telegram) {
                console.log('📱 Telegram WebApp disponible');
                this.telegram.expand();
                this.telegram.enableClosingConfirmation();
                this.telegram.setHeaderColor('#00d4ff');
                this.telegram.setBackgroundColor('#0a0a16');
            } else {
                console.log('⚠️ Telegram WebApp no disponible (probablemente navegador normal)');
            }
            
            // Inicializar eventos
            this.initEvents();
            
            // Cargar configuración
            await this.loadConfig();
            
            // Cargar datos del usuario
            await this.loadUserData();
            
            // Configurar navegación
            this.setupNavigation();
            
            // Crear partículas para efecto futurista
            this.createParticles();
            
            console.log('✅ WebApp inicializada correctamente');
        } catch (error) {
            console.error('❌ Error inicializando WebApp:', error);
            this.showToast('❌ Error inicializando la aplicación', 'error');
        }
    }

    createParticles() {
        const particleCount = 15;
        const container = document.createElement('div');
        container.className = 'particles-container';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: -1;
            overflow: hidden;
        `;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.cssText = `
                position: absolute;
                width: ${Math.random() * 3 + 1}px;
                height: ${Math.random() * 3 + 1}px;
                background: linear-gradient(135deg, 
                    rgba(0, 212, 255, ${Math.random() * 0.5 + 0.2}), 
                    rgba(157, 0, 255, ${Math.random() * 0.5 + 0.2})
                );
                border-radius: 50%;
                filter: blur(${Math.random() * 2 + 1}px);
                animation: particleFloat ${Math.random() * 20 + 10}s linear infinite;
                animation-delay: ${Math.random() * 5}s;
            `;
            
            // Posición inicial aleatoria
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            
            container.appendChild(particle);
        }
        
        document.body.appendChild(container);
        
        // Añadir estilos de animación
        const style = document.createElement('style');
        style.textContent = `
            @keyframes particleFloat {
                0% {
                    transform: translateY(0) translateX(0) rotate(0deg);
                    opacity: 0;
                }
                10% {
                    opacity: ${Math.random() * 0.5 + 0.2};
                }
                90% {
                    opacity: ${Math.random() * 0.5 + 0.2};
                }
                100% {
                    transform: translateY(-100vh) translateX(${Math.random() * 100 - 50}px) rotate(${Math.random() * 360}deg);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    showErrorScreen(message) {
        document.body.innerHTML = `
            <div class="error-screen">
                <div class="error-icon">🚫</div>
                <h2>Error</h2>
                <p>${message}</p>
                <div class="error-actions">
                    <button onclick="location.reload()" class="btn-primary">
                        Reintentar
                    </button>
                </div>
            </div>
        `;
        
        // Añadir estilos
        const style = document.createElement('style');
        style.textContent = `
            .error-screen {
                padding: 40px 20px;
                text-align: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #0a0a16 0%, #121230 100%);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                color: white;
            }
            
            .error-icon {
                font-size: 4rem;
                margin-bottom: 20px;
                color: #ff4757;
                filter: drop-shadow(0 0 20px rgba(255, 71, 87, 0.5));
                animation: pulse 2s ease-in-out infinite;
            }
            
            .error-screen h2 {
                color: #ff4757;
                margin-bottom: 15px;
                font-size: 2rem;
            }
            
            .error-screen p {
                margin-bottom: 25px;
                color: #e5e7eb;
                font-size: 1rem;
                max-width: 400px;
                line-height: 1.6;
            }
            
            .error-actions {
                margin-top: 20px;
            }
        `;
        document.head.appendChild(style);
    }

    async loadConfig() {
        try {
            console.log('🔧 Cargando configuración...');
            const response = await fetch('/api/webapp-config');
            
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Actualizar variables globales con la configuración real
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
                    
                    console.log('✅ Configuración cargada desde API');
                } else {
                    console.warn('⚠️ API de configuración respondió con error:', data.error);
                }
            } else {
                console.warn('⚠️ No se pudo cargar la configuración, usando valores por defecto');
            }
        } catch (error) {
            console.error('❌ Error cargando configuración:', error);
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
        
        // Eventos específicos de juegos
        const refreshGames = document.getElementById('refresh-games');
        if (refreshGames) {
            refreshGames.addEventListener('click', () => {
                this.loadGames(true);
            });
        }
        
        console.log('✅ Eventos inicializados');
    }

    setupNavigation() {
        // Configurar navegación activa
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
            
            console.log('🔍 Enviando telegram_id:', this.userId);
            
            const response = await fetch('/api/user-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    telegram_id: this.userId
                })
            });

            console.log('🔍 Respuesta HTTP:', response.status, response.statusText);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Error de respuesta:', errorText);
                
                // Intentar parsear como JSON si es posible
                try {
                    const errorData = JSON.parse(errorText);
                    throw new Error(errorData.error || `Error HTTP: ${response.status} - ${response.statusText}`);
                } catch (e) {
                    throw new Error(`Error HTTP: ${response.status} - ${response.statusText}. Detalles: ${errorText}`);
                }
            }

            const data = await response.json();
            console.log('🔍 Datos recibidos:', data);

            if (data.success) {
                this.userData = data.user;
                console.log('✅ Datos de usuario cargados:', {
                    id: this.userData.id,
                    telegram_id: this.userData.telegram_id,
                    balance_cup: this.userData.balance_cup,
                    balance_saldo: this.userData.balance_saldo,
                    tokens_cws: this.userData.tokens_cws
                });
                this.updateUI();
                this.showToast('✅ Datos actualizados', 'success');
            } else {
                console.error('❌ Error en respuesta API:', data);
                throw new Error(data.error || 'Error desconocido al cargar datos');
            }
        } catch (error) {
            console.error('❌ Error completo cargando datos:', error);
            console.error('❌ Stack trace:', error.stack);
            
            // Mostrar error en la interfaz
            const welcomeTitle = document.getElementById('welcome-title');
            const welcomeSubtitle = document.getElementById('welcome-subtitle');
            
            if (welcomeTitle) {
                welcomeTitle.textContent = '❌ Error';
                welcomeTitle.style.color = '#ff4757';
            }
            if (welcomeSubtitle) {
                welcomeSubtitle.textContent = error.message.length > 50 ? 
                    error.message.substring(0, 50) + '...' : error.message;
                welcomeSubtitle.style.color = '#ff4757';
            }
            
            this.showToast(`❌ Error: ${error.message}`, 'error');
            
            // Crear elemento de debug si no existe
            let debugContainer = document.getElementById('debug-container');
            if (!debugContainer) {
                debugContainer = document.createElement('div');
                debugContainer.id = 'debug-container';
                debugContainer.style.cssText = `
                    margin: 20px;
                    padding: 10px;
                    background: rgba(255,71,87,0.1);
                    border-radius: 5px;
                    font-size: 12px;
                    color: #ff6b6b;
                `;
                document.querySelector('.info-section').appendChild(debugContainer);
            }
            
            debugContainer.innerHTML = `
                <small><strong>Debug info:</strong></small><br>
                <small>User ID: ${this.userId}</small><br>
                <small>Error: ${error.message}</small><br>
                <small>Time: ${new Date().toLocaleTimeString()}</small><br>
                <button onclick="window.cromwellApp.loadUserData()" style="
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 5px 10px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    margin-top: 5px;
                ">
                    Reintentar
                </button>
            `;
        } finally {
            this.hideLoading();
        }
    }

    updateUI() {
        if (!this.userData) {
            console.error('❌ No hay userData para actualizar UI');
            return;
        }

        console.log('🎨 Actualizando UI con datos:', this.userData);
        
        // Actualizar dashboard
        const welcomeTitle = document.getElementById('welcome-title');
        const welcomeSubtitle = document.getElementById('welcome-subtitle');
        
        if (welcomeTitle) {
            welcomeTitle.textContent = `¡Hola, ${this.userData.first_name || 'Usuario'}!`;
            welcomeTitle.style.color = '';
        }
        if (welcomeSubtitle) {
            welcomeSubtitle.textContent = 'Bienvenido a Cromwell Store';
            welcomeSubtitle.style.color = '';
        }
        
        // Actualizar saldos
        const updateElement = (id, value, prefix = '') => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = prefix + (value || 0);
                console.log(`📊 Actualizado ${id}: ${prefix}${value}`);
            } else {
                console.warn(`⚠️ Elemento ${id} no encontrado`);
            }
        };
        
        updateElement('dashboard-cup', this.userData.balance_cup, '$');
        updateElement('dashboard-saldo', this.userData.balance_saldo, '$');
        updateElement('dashboard-cws', this.userData.tokens_cws);
        
        updateElement('balance-cup', this.userData.balance_cup, '$');
        updateElement('wallet-cup', this.userData.balance_cup, '$');
        updateElement('wallet-saldo', this.userData.balance_saldo, '$');
        updateElement('wallet-cws', this.userData.tokens_cws);
        
        // Actualizar información de usuario
        updateElement('user-telegram-id', this.userData.telegram_id || 'No disponible');
        
        const phoneNumber = this.userData.phone_number ? 
            `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado';
        
        updateElement('user-phone', phoneNumber);
        updateElement('wallet-phone', phoneNumber);
        
        // Actualizar última actividad
        if (this.userData.last_active) {
            const lastActive = new Date(this.userData.last_active);
            const formattedDate = lastActive.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            updateElement('last-activity', formattedDate);
        } else {
            updateElement('last-activity', 'No disponible');
        }

        // Actualizar avatar en header
        const userAvatar = document.getElementById('user-avatar');
        if (userAvatar) {
            userAvatar.textContent = this.userData.first_name ? 
                this.userData.first_name.charAt(0).toUpperCase() : '👤';
            // Añadir animación al avatar
            userAvatar.style.animation = 'pulse 2s ease-in-out';
            setTimeout(() => {
                userAvatar.style.animation = '';
            }, 2000);
        }
        
        // Actualizar configuración en pantalla
        const minCwsUse = document.getElementById('min-cws-use');
        if (minCwsUse) minCwsUse.textContent = window.MIN_CWS_USE || 100;
        
        const minCup = document.getElementById('min-cup');
        if (minCup) minCup.textContent = window.MINIMO_CUP || 1000;
        
        const minSaldo = document.getElementById('min-saldo');
        if (minSaldo) minSaldo.textContent = window.MINIMO_SALDO || 500;
        
        // Ocultar debug container si existe
        const debugContainer = document.getElementById('debug-container');
        if (debugContainer) {
            debugContainer.style.display = 'none';
        }
        
        console.log('✅ UI actualizada correctamente');
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
            this.currentScreen = screenName;
            
            // Añadir efecto de transición
            targetScreen.style.animation = 'none';
            setTimeout(() => {
                targetScreen.style.animation = 'screenEnter 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            }, 10);
            
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
                case 'claim':
                    this.loadPendingPayments();
                    break;
            }
        } else {
            console.error(`❌ Pantalla no encontrada: screen-${screenName}`);
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
            // Añadir animación
            selectedCard.style.animation = 'pulse 0.5s ease';
            setTimeout(() => {
                selectedCard.style.animation = '';
            }, 500);
        }

        // Mostrar formulario de recarga
        const form = document.getElementById('recharge-form');
        if (form) {
            form.classList.remove('hidden');
            form.style.animation = 'screenEnter 0.3s ease';
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
        
        if (rechargeMethod) {
            rechargeMethod.textContent = method === 'cup' ? 'CUP (Tarjeta)' : 'Saldo Móvil';
        }
        
        if (minAmount) minAmount.textContent = minAmounts[method];
        if (maxAmount) maxAmount.textContent = maxAmounts[method];
        
        if (amountInput) {
            amountInput.min = minAmounts[method];
            amountInput.max = maxAmounts[method];
            amountInput.placeholder = `Ej: ${minAmounts[method]}`;
            amountInput.value = '';
        }

        // Configurar información de pago
        const paymentInfo = document.getElementById('payment-instructions');
        if (paymentInfo) {
            if (method === 'cup') {
                paymentInfo.innerHTML = `
                    <p><strong>💳 Tarjeta destino:</strong> <code>${window.PAGO_CUP_TARJETA || '[NO CONFIGURADO]'}</code></p>
                    <p><strong>📞 Teléfono para pagos:</strong> ${this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado'}</p>
                    <p>⚠️ <strong>IMPORTANTE:</strong> Activa "Mostrar número al destinatario" en Transfermóvil</p>
                `;
            } else {
                paymentInfo.innerHTML = `
                    <p><strong>📱 Número destino:</strong> <code>${window.PAGO_SALDO_MOVIL || '[NO CONFIGURADO]'}</code></p>
                    <p><strong>📞 Tu teléfono:</strong> ${this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado'}</p>
                    <p>🎫 <strong>Ganas tokens:</strong> ${window.CWS_PER_100_SALDO || 10} CWS por cada 100 de saldo</p>
                `;
            }
        }

        // Mostrar/ocultar información de bono
        const bonusInfo = document.getElementById('bonus-info');
        const hasBonus = method === 'cup' ? 
            (this.userData?.first_dep_cup || false) : 
            (this.userData?.first_dep_saldo || false);
        
        if (bonusInfo) {
            if (!hasBonus) {
                bonusInfo.style.display = 'block';
                const bonusPercent = document.getElementById('bonus-percent');
                if (bonusPercent) bonusPercent.textContent = '10%';
            } else {
                bonusInfo.style.display = 'none';
            }
        }

        this.currentAction = {
            type: 'deposit',
            method: method,
            hasBonus: !hasBonus // Primer depósito = tiene bono
        };
        
        // Calcular bono inicial
        this.calculateBonus(amountInput?.value || '');
    }

    calculateBonus(amount) {
        if (!this.currentAction || !amount) return;

        const amountNum = parseFloat(amount) || 0;
        let totalWithBonus = amountNum;

        if (this.currentAction.hasBonus && amountNum > 0) {
            const bonus = amountNum * 0.10;
            totalWithBonus = amountNum + bonus;
            const totalElement = document.getElementById('total-with-bonus');
            if (totalElement) {
                totalElement.textContent = `$${totalWithBonus.toFixed(2)}`;
                // Animación del bono
                totalElement.style.animation = 'pulse 0.5s ease';
                setTimeout(() => {
                    totalElement.style.animation = '';
                }, 500);
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
        const maxAmounts = { 
            cup: window.MAXIMO_CUP || 50000, 
            saldo: 10000 
        };

        if (amountNum < minAmounts[method] || amountNum > maxAmounts[method]) {
            this.showToast(`❌ El monto debe estar entre $${minAmounts[method]} y $${maxAmounts[method]}`, 'error');
            return;
        }

        try {
            this.showLoading('Creando solicitud de depósito...');

            const response = await fetch('/api/create-deposit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    method: method,
                    amount: amountNum,
                    phone: this.userData.phone_number
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error HTTP: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ Solicitud Creada',
                    message: `Orden #${data.orderId}\n\nMonto: $${amountNum} ${method.toUpperCase()}\n\nSigue las instrucciones en el bot de Telegram.`,
                    icon: '✅',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ Error: ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error creando depósito:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    // ===== FUNCIONALIDAD DE JUEGOS =====
    async loadGames(forceRefresh = false) {
        try {
            const gamesList = document.getElementById('games-list');
            if (!gamesList) return;
            
            // Mostrar loading solo si no hay datos o si es refresco forzado
            if (forceRefresh || this.games.length === 0) {
                gamesList.innerHTML = `
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>Cargando juegos...</p>
                    </div>
                `;
            }

            const response = await fetch('/api/games');
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const games = await response.json();
            this.games = games;
            
            this.renderGamesList();
        } catch (error) {
            console.error('Error cargando juegos:', error);
            const gamesList = document.getElementById('games-list');
            if (gamesList) {
                gamesList.innerHTML = 
                    '<div class="error-message"><p>❌ Error cargando juegos</p><button class="btn-secondary" onclick="window.cromwellApp.loadGames(true)">🔄 Reintentar</button></div>';
            }
            this.showToast('❌ Error cargando juegos', 'error');
        }
    }

    renderGamesList() {
        const gamesList = document.getElementById('games-list');
        if (!gamesList) return;
        
        if (!this.games || this.games.length === 0) {
            gamesList.innerHTML = `
                <div class="info-card">
                    <p>No hay juegos disponibles en este momento.</p>
                </div>
            `;
            return;
        }

        let html = '';
        this.games.forEach(game => {
            html += `
                <div class="game-card" data-game-id="${game.id}">
                    <div class="game-icon">🎮</div>
                    <div class="game-info">
                        <h4>${game.name}</h4>
                        <p>${Object.keys(game.variations || {}).length} paquetes disponibles</p>
                    </div>
                </div>
            `;
        });

        gamesList.innerHTML = html;

        // Agregar event listeners
        document.querySelectorAll('.game-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const gameId = e.currentTarget.dataset.gameId;
                this.selectGame(gameId);
            });
        });
    }

    selectGame(gameId) {
        this.selectedGame = this.games.find(g => g.id == gameId);
        if (!this.selectedGame) return;

        this.showGameDetails();
    }

    showGameDetails() {
        const gamesList = document.getElementById('games-list');
        const gameDetails = document.getElementById('game-details');

        if (gamesList) gamesList.classList.add('hidden');
        if (gameDetails) {
            gameDetails.classList.remove('hidden');
            
            // Renderizar variaciones con precios por cargar
            let variationsHtml = '';
            const variations = this.selectedGame.variations || {};
            
            Object.entries(variations).forEach(([id, variation]) => {
                variationsHtml += `
                    <div class="variation-card" data-var-id="${id}">
                        <div class="variation-name">${variation.name || 'Paquete'}</div>
                        <div class="variation-prices">
                            <div class="price-item">
                                <span class="price-label">CUP</span>
                                <span class="price-value" id="price-cup-${id}">...</span>
                            </div>
                            <div class="price-item">
                                <span class="price-label">Saldo</span>
                                <span class="price-value" id="price-saldo-${id}">...</span>
                            </div>
                            <div class="price-item">
                                <span class="price-label">CWS</span>
                                <span class="price-value" id="price-cws-${id}">...</span>
                            </div>
                        </div>
                    </div>
                `;
            });

            gameDetails.innerHTML = `
                <div class="screen-header">
                    <div class="header-left">
                        <button class="btn-icon" id="back-to-games">
                            <span class="icon">←</span>
                        </button>
                        <h2>${this.selectedGame.name}</h2>
                    </div>
                </div>
                <div class="variations-list">
                    ${variationsHtml}
                </div>
            `;

            // Event listeners
            document.getElementById('back-to-games').addEventListener('click', () => {
                if (gameDetails) gameDetails.classList.add('hidden');
                if (gamesList) gamesList.classList.remove('hidden');
            });

            // Configurar eventos para variaciones
            document.querySelectorAll('.variation-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    const varId = e.currentTarget.dataset.varId;
                    this.selectGameVariation(varId);
                });
            });
        }
    }

    async selectGameVariation(variationId) {
        try {
            this.showLoading('Consultando precios...');

            const response = await fetch('/api/game-price', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    game_id: this.selectedGame.id,
                    variation_id: variationId
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.selectedVariation = {
                    id: variationId,
                    name: this.selectedGame.variations[variationId]?.name || 'Paquete',
                    prices: data.prices || {}
                };
                // Actualizar los precios en la UI
                this.updateVariationPricesUI(variationId, data.prices);
                this.showGamePaymentForm();
            } else {
                this.showToast(`❌ ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error obteniendo precio:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    updateVariationPricesUI(variationId, prices) {
        // Actualizar solo los precios en la UI de variaciones
        const cupEl = document.getElementById(`price-cup-${variationId}`);
        const saldoEl = document.getElementById(`price-saldo-${variationId}`);
        const cwsEl = document.getElementById(`price-cws-${variationId}`);
        
        if (cupEl) cupEl.textContent = `$${prices.cup || '...'}`;
        if (saldoEl) saldoEl.textContent = `$${prices.saldo || '...'}`;
        if (cwsEl) cwsEl.textContent = `${prices.cws || '...'} tokens`;
    }

    showGamePaymentForm() {
        const gameDetails = document.getElementById('game-details');
        const gamePayment = document.getElementById('game-payment');
        
        if (gameDetails) gameDetails.classList.add('hidden');
        if (gamePayment) {
            gamePayment.classList.remove('hidden');
            gamePayment.style.animation = 'screenEnter 0.3s ease';
            
            const variation = this.selectedVariation;
            
            gamePayment.innerHTML = `
                <div class="screen-header">
                    <div class="header-left">
                        <button class="btn-icon" id="back-to-variations">
                            <span class="icon">←</span>
                        </button>
                        <h2>${this.selectedGame.name}</h2>
                    </div>
                </div>
                <div class="recharge-form">
                    <h3>${variation.name}</h3>
                    
                    <div class="price-summary">
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
                        <!-- Campos de entrada según el juego -->
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
            const methodSelect = document.getElementById('game-payment-method');

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

            if (methodSelect) {
                methodSelect.addEventListener('change', (e) => {
                    this.updateGamePaymentMethod(e.target.value);
                });
            }

            // Cargar campos de entrada iniciales
            this.updateGamePaymentMethod('cup');
        }
    }

    updateGamePaymentMethod(method) {
        const inputFields = document.getElementById('game-input-fields');
        if (!inputFields) return;
        
        const gameSchema = this.selectedGame.input_schema || { fields: [] };
        
        let html = '';
        if (gameSchema.fields && gameSchema.fields.length > 0) {
            gameSchema.fields.forEach(field => {
                if (field.type === 'select') {
                    html += `
                        <div class="form-group">
                            <label>${field.label || field.key}:</label>
                            <select id="game-field-${field.key}">
                                ${(field.options || []).map(opt => 
                                    `<option value="${opt.value || opt}">${opt.label || opt}</option>`
                                ).join('')}
                            </select>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="form-group">
                            <label>${field.label || field.key}:</label>
                            <input type="text" id="game-field-${field.key}" placeholder="${field.label || field.key}">
                        </div>
                    `;
                }
            });
        }
        
        inputFields.innerHTML = html;
    }

    async confirmGamePurchase() {
        const methodSelect = document.getElementById('game-payment-method');
        const method = methodSelect ? methodSelect.value : null;
        const variation = this.selectedVariation;
        
        if (!method || !variation) {
            this.showToast('❌ Error en los datos de compra', 'error');
            return;
        }

        // Recolectar datos del formulario
        const formData = {};
        const gameSchema = this.selectedGame.input_schema || { fields: [] };
        let isValid = true;
        
        gameSchema.fields.forEach(field => {
            const input = document.getElementById(`game-field-${field.key}`);
            const value = input?.value?.trim();
            
            if (field.required && !value) {
                isValid = false;
                this.showToast(`❌ El campo ${field.label || field.key} es requerido`, 'error');
                return;
            }
            
            formData[field.key] = value;
        });
        
        if (!isValid) return;

        try {
            this.showLoading('Procesando compra...');

            const response = await fetch('/api/game-purchase', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    game_id: this.selectedGame.id,
                    variation_id: variation.id,
                    payment_method: method,
                    user_data: formData,
                    amount: variation.prices[method] || 0
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Compra Exitosa!',
                    message: `Recarga para ${this.selectedGame.name || 'Juego'}\n\nPaquete: ${variation.name}\nPago: ${method === 'cws' ? (variation.prices[method] || 0) + ' CWS' : '$' + (variation.prices[method] || 0) + ' ' + method.toUpperCase()}\n\nOrden #${data.orderId || 'N/A'}`,
                    icon: '🎮',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ Error: ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando compra:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadEtecsaOffers() {
        try {
            const offersContainer = document.getElementById('etecsa-offers');
            if (!offersContainer) return;
            
            this.showLoading('Cargando ofertas ETECSA...');
            
            const response = await fetch('/api/etecsa-offers');
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const offers = await response.json();
            this.hideLoading();
            
            offersContainer.innerHTML = '';

            if (!offers || offers.length === 0) {
                offersContainer.innerHTML = '<div class="info-card"><p>No hay ofertas disponibles en este momento.</p></div>';
                return;
            }

            offers.forEach(offer => {
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
            this.hideLoading();
            const offersContainer = document.getElementById('etecsa-offers');
            if (offersContainer) {
                offersContainer.innerHTML = 
                    '<div class="error-card"><p>Error cargando ofertas</p></div>';
            }
            this.showToast('❌ Error cargando ofertas ETECSA', 'error');
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
            etecsaForm.style.animation = 'screenEnter 0.3s ease';
            
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
                    
                    ${this.selectedOffer.offer.requires_email ? `
                        <div class="form-group">
                            <label for="etecsa-email">Email de Nauta:</label>
                            <input type="email" id="etecsa-email" placeholder="usuario@nauta.com.cu">
                            <p class="form-hint">Requerido para esta recarga</p>
                        </div>
                    ` : ''}
                    
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
        const email = this.selectedOffer.offer.requires_email ? 
            (document.getElementById('etecsa-email')?.value || null) : null;

        // Validar teléfono
        const cleanPhone = phone ? phone.replace(/[^\d]/g, '') : '';
        if (!cleanPhone.startsWith('53') || cleanPhone.length !== 10) {
            this.showToast('❌ Formato de teléfono incorrecto', 'error');
            return;
        }

        // Validar email si es requerido
        if (this.selectedOffer.offer.requires_email && email) {
            const emailRegex = /^[a-zA-Z0-9._%+-]+@nauta\.(com\.cu|cu)$/i;
            if (!emailRegex.test(email)) {
                this.showToast('❌ Email de Nauta inválido', 'error');
                return;
            }
        }

        // Verificar saldo
        const priceCup = price?.cup_price || 0;
        if ((this.userData?.balance_cup || 0) < priceCup) {
            this.showToast('❌ Saldo CUP insuficiente', 'error');
            return;
        }

        try {
            this.showLoading('Procesando recarga ETECSA...');

            const response = await fetch('/api/etecsa-recharge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    offer_id: this.selectedOffer.offer.id,
                    price_id: this.selectedOffer.priceId,
                    phone: cleanPhone,
                    email: email,
                    amount: priceCup
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Recarga Exitosa!',
                    message: `Recarga ETECSA completada\n\nDestino: +${cleanPhone}\nPaquete: ${price?.label || 'N/A'}\nPrecio: $${priceCup} CUP\n\nID Transacción: ${data.transactionId || 'N/A'}`,
                    icon: '📱',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ Error: ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando recarga:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadHistory() {
        try {
            const historyList = document.getElementById('history-list');
            if (!historyList) return;
            
            this.showLoading('Cargando historial...');
            
            const response = await fetch(`/api/user-history?telegram_id=${this.userId}`);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const transactions = await response.json();
            this.hideLoading();
            
            historyList.innerHTML = '';

            if (!transactions || transactions.length === 0) {
                historyList.innerHTML = '<div class="info-card"><p>No hay transacciones registradas.</p></div>';
                return;
            }

            transactions.forEach(transaction => {
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
                
                const amount = Math.abs(transaction.amount || transaction.amount_requested || 0);
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
                        ${transaction.tokens_generated ? `
                            <div class="detail-item">
                                <span class="detail-label">Tokens:</span>
                                <span class="detail-value">+${transaction.tokens_generated} CWS</span>
                            </div>
                        ` : ''}
                    </div>
                `;
                
                historyList.appendChild(transactionCard);
            });
            
            // Configurar filtros
            const filterType = document.getElementById('filter-type');
            const filterStatus = document.getElementById('filter-status');
            
            if (filterType) {
                filterType.addEventListener('change', () => {
                    this.applyHistoryFilters();
                });
            }
            
            if (filterStatus) {
                filterStatus.addEventListener('change', () => {
                    this.applyHistoryFilters();
                });
            }
            
        } catch (error) {
            console.error('Error cargando historial:', error);
            this.hideLoading();
            const historyList = document.getElementById('history-list');
            if (historyList) {
                historyList.innerHTML = 
                    '<div class="error-card"><p>Error cargando historial</p></div>';
            }
            this.showToast('❌ Error cargando historial', 'error');
        }
    }

    applyHistoryFilters() {
        const filterType = document.getElementById('filter-type')?.value || 'all';
        const filterStatus = document.getElementById('filter-status')?.value || 'all';
        
        const transactionCards = document.querySelectorAll('.transaction-card');
        
        transactionCards.forEach(card => {
            const typeElement = card.querySelector('.transaction-type span:last-child');
            const statusElement = card.querySelector('.transaction-status');
            
            const type = typeElement?.textContent || '';
            const status = statusElement?.textContent || '';
            
            let typeMatch = true;
            let statusMatch = true;
            
            if (filterType !== 'all') {
                switch(filterType) {
                    case 'DEPOSIT':
                        typeMatch = type.includes('Depósito');
                        break;
                    case 'GAME_RECHARGE':
                        typeMatch = type.includes('Juego');
                        break;
                    case 'ETECSA_RECHARGE':
                        typeMatch = type.includes('ETECSA');
                        break;
                }
            }
            
            if (filterStatus !== 'all') {
                switch(filterStatus) {
                    case 'completed':
                        statusMatch = status.includes('Completado');
                        break;
                    case 'pending':
                        statusMatch = status.includes('Pendiente');
                        break;
                    case 'failed':
                        statusMatch = status.includes('Fallido');
                        break;
                }
            }
            
            if (typeMatch && statusMatch) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    }

    async loadPendingPayments() {
        try {
            const pendingList = document.getElementById('pending-list');
            if (!pendingList) return;
            
            this.showLoading('Cargando pagos pendientes...');
            
            const response = await fetch(`/api/pending-payments?telegram_id=${this.userId}`);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const pendingPayments = await response.json();
            this.hideLoading();
            
            pendingList.innerHTML = '';
            
            if (!pendingPayments || pendingPayments.length === 0) {
                pendingList.innerHTML = '<div class="info-card"><p>No hay pagos pendientes de reclamar.</p></div>';
                return;
            }
            
            pendingPayments.forEach(payment => {
                const paymentCard = document.createElement('div');
                paymentCard.className = 'payment-card';
                paymentCard.innerHTML = `
                    <div class="payment-header">
                        <div class="payment-type">
                            <span>💰</span>
                            <span>${payment.method === 'cup' ? 'CUP' : 'Saldo Móvil'}</span>
                        </div>
                        <div class="payment-amount">$${payment.amount}</div>
                    </div>
                    <div class="payment-details">
                        <div class="detail-item">
                            <span class="detail-label">Fecha:</span>
                            <span class="detail-value">${new Date(payment.created_at).toLocaleDateString('es-ES')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">ID:</span>
                            <span class="detail-value"><code>${payment.tx_id || 'N/A'}</code></span>
                        </div>
                    </div>
                    <button class="btn-primary claim-payment-btn" data-payment-id="${payment.id}">
                        🎁 Reclamar
                    </button>
                `;
                
                pendingList.appendChild(paymentCard);
            });
            
            // Configurar eventos para reclamar pagos
            document.querySelectorAll('.claim-payment-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const paymentId = e.currentTarget.dataset.paymentId;
                    this.claimPendingPayment(paymentId);
                });
            });
            
        } catch (error) {
            console.error('Error cargando pagos pendientes:', error);
            this.hideLoading();
            const pendingList = document.getElementById('pending-list');
            if (pendingList) {
                pendingList.innerHTML = 
                    '<div class="error-card"><p>Error cargando pagos pendientes</p></div>';
            }
        }
    }

    async claimPendingPayment(paymentId) {
        try {
            this.showLoading('Reclamando pago...');

            const response = await fetch('/api/claim-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    payment_id: paymentId
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Pago Reclamado!',
                    message: `Pago procesado correctamente\n\nMonto: $${data.amount || 0} ${data.currency || ''}\n\nEl saldo ha sido acreditado a tu billetera.`,
                    icon: '💰',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.loadPendingPayments();
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ ${data.message || 'Error al reclamar pago'}`, 'error');
            }
        } catch (error) {
            console.error('Error reclamando pago:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
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

            const response = await fetch('/api/claim-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    tx_id: txId
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Pago Reclamado!',
                    message: `Pago encontrado y procesado\n\nMonto: $${data.amount || 0} ${data.currency || ''}\nID: ${txId}\n\nEl saldo ha sido acreditado a tu billetera.`,
                    icon: '💰',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ ${data.message || 'Pago no encontrado'}`, 'error');
            }
        } catch (error) {
            console.error('Error buscando pago:', error);
            this.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.hideLoading();
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

            const response = await fetch('/api/update-phone', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.userId,
                    phone: newPhone
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.showToast('✅ Teléfono actualizado correctamente', 'success');
                this.hideModal('phone-modal');
                this.loadUserData();
            } else {
                this.showToast(`❌ Error: ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error actualizando teléfono:', error);
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
                modal.style.animation = 'fadeIn 0.3s ease';
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
                modal.style.animation = 'fadeIn 0.3s ease';
            }
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.style.animation = '';
            }, 300);
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
        
        // Añadir efecto de entrada
        toast.style.animation = 'toastSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        
        // Auto-remover después de 5 segundos
        setTimeout(() => {
            toast.style.animation = 'toastSlideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
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
        const loadingText = document.getElementById('loading-text-modal');
        const loadingOverlay = document.getElementById('loading-overlay');
        
        if (loadingText) loadingText.textContent = text;
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.animation = 'fadeIn 0.3s ease';
        }
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => {
                loadingOverlay.classList.add('hidden');
                loadingOverlay.style.animation = '';
            }, 300);
        }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 webapp.js: DOM cargado');
    
    // NOTA: La aplicación se inicializa desde webapp-main.html
    // Solo definimos la clase aquí
});
