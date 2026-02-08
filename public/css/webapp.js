// webapp.js - WebApp principal para Cromwell Store
class CromwellWebApp {
    constructor() {
        this.telegram = window.Telegram.WebApp;
        this.userData = null;
        this.currentScreen = 'dashboard';
        this.currentAction = null;
        this.selectedGame = null;
        this.selectedVariation = null;
        this.selectedOffer = null;
        
        this.init();
    }

    async init() {
        console.log('🚀 Inicializando Cromwell WebApp...');
        
        // Configurar Telegram WebApp
        this.telegram.expand();
        this.telegram.enableClosingConfirmation();
        this.telegram.setHeaderColor('#667eea');
        this.telegram.setBackgroundColor('#f8f9fa');
        
        // Inicializar eventos
        this.initEvents();
        
        // Cargar datos del usuario
        await this.loadUserData();
        
        // Configurar navegación
        this.setupNavigation();
        
        console.log('✅ WebApp inicializada correctamente');
    }

    initEvents() {
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
        document.getElementById('close-phone-modal').addEventListener('click', () => {
            this.hideModal('phone-modal');
        });

        document.getElementById('cancel-phone').addEventListener('click', () => {
            this.hideModal('phone-modal');
        });

        document.getElementById('save-phone').addEventListener('click', () => {
            this.updatePhoneNumber();
        });

        document.getElementById('modal-cancel').addEventListener('click', () => {
            this.hideModal('confirm-modal');
        });

        // Eventos de formularios
        document.getElementById('amount').addEventListener('input', (e) => {
            this.calculateBonus(e.target.value);
        });

        document.getElementById('confirm-deposit').addEventListener('click', () => {
            this.confirmDeposit();
        });

        document.getElementById('cancel-deposit').addEventListener('click', () => {
            this.showScreen('recharge');
        });

        document.getElementById('refresh-wallet').addEventListener('click', () => {
            this.loadUserData();
        });

        document.getElementById('change-phone').addEventListener('click', () => {
            this.showPhoneModal();
        });

        document.getElementById('search-payment').addEventListener('click', () => {
            this.searchPayment();
        });

        document.getElementById('cancel-search').addEventListener('click', () => {
            this.showScreen('claim');
        });
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
            
            const userId = this.telegram.initDataUnsafe.user?.id;
            if (!userId) {
                this.showToast('❌ Error: No se pudo obtener tu ID de Telegram', 'error');
                return;
            }

            // Obtener datos del usuario desde la API
            const response = await fetch('/api/user-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ telegram_id: userId })
            });

            const data = await response.json();

            if (data.success) {
                this.userData = data.user;
                this.updateUI();
                this.showToast('✅ Datos actualizados', 'success');
            } else {
                this.showToast('❌ Error al cargar datos', 'error');
            }
        } catch (error) {
            console.error('Error cargando datos:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    updateUI() {
        if (!this.userData) return;

        // Actualizar dashboard
        document.getElementById('welcome-title').textContent = `¡Hola, ${this.userData.first_name}!`;
        document.getElementById('welcome-subtitle').textContent = 'Bienvenido a Cromwell Store';
        
        // Actualizar saldos
        document.getElementById('dashboard-cup').textContent = `$${this.userData.balance_cup || 0}`;
        document.getElementById('dashboard-saldo').textContent = `$${this.userData.balance_saldo || 0}`;
        document.getElementById('dashboard-cws').textContent = this.userData.tokens_cws || 0;
        
        document.getElementById('balance-cup').textContent = `$${this.userData.balance_cup || 0}`;
        document.getElementById('wallet-cup').textContent = `$${this.userData.balance_cup || 0}`;
        document.getElementById('wallet-saldo').textContent = `$${this.userData.balance_saldo || 0}`;
        document.getElementById('wallet-cws').textContent = this.userData.tokens_cws || 0;
        
        // Actualizar información de usuario
        document.getElementById('user-telegram-id').textContent = this.userData.telegram_id;
        document.getElementById('user-phone').textContent = 
            this.userData.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado';
        document.getElementById('wallet-phone').textContent = 
            this.userData.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado';
        
        // Actualizar última actividad
        if (this.userData.last_active) {
            const lastActive = new Date(this.userData.last_active);
            document.getElementById('last-activity').textContent = 
                lastActive.toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
        }

        // Actualizar avatar en header
        const userAvatar = document.getElementById('user-avatar');
        userAvatar.textContent = this.userData.first_name ? this.userData.first_name.charAt(0).toUpperCase() : '👤';
    }

    switchScreen(screenName) {
        // Ocultar todas las pantallas
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Mostrar pantalla seleccionada
        const targetScreen = document.getElementById(`screen-${screenName}`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenName;
            
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
        }
    }

    selectPaymentMethod(method) {
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
        form.classList.remove('hidden');

        // Configurar formulario según método
        const minAmounts = {
            cup: 1000,
            saldo: 500
        };

        const maxAmounts = {
            cup: 50000,
            saldo: 10000
        };

        document.getElementById('recharge-method').textContent = 
            method === 'cup' ? 'CUP (Tarjeta)' : 'Saldo Móvil';
        
        document.getElementById('min-amount').textContent = minAmounts[method];
        document.getElementById('max-amount').textContent = maxAmounts[method];
        
        document.getElementById('amount').min = minAmounts[method];
        document.getElementById('amount').max = maxAmounts[method];
        document.getElementById('amount').placeholder = `Ej: ${minAmounts[method]}`;

        // Configurar información de pago
        const paymentInfo = document.getElementById('payment-instructions');
        if (method === 'cup') {
            paymentInfo.innerHTML = `
                <p><strong>💳 Tarjeta destino:</strong> <code>${window.PAGO_CUP_TARJETA || '[NO CONFIGURADO]'}</code></p>
                <p><strong>📞 Teléfono para pagos:</strong> +53 ${this.userData?.phone_number?.substring(2) || 'No vinculado'}</p>
                <p>⚠️ <strong>IMPORTANTE:</strong> Activa "Mostrar número al destinatario" en Transfermóvil</p>
            `;
        } else {
            paymentInfo.innerHTML = `
                <p><strong>📱 Número destino:</strong> <code>${window.PAGO_SALDO_MOVIL || '[NO CONFIGURADO]'}</code></p>
                <p><strong>📞 Tu teléfono:</strong> +53 ${this.userData?.phone_number?.substring(2) || 'No vinculado'}</p>
                <p>🎫 <strong>Ganas tokens:</strong> 10 CWS por cada 100 de saldo</p>
            `;
        }

        // Mostrar/ocultar información de bono
        const bonusInfo = document.getElementById('bonus-info');
        const hasBonus = method === 'cup' ? 
            (this.userData?.first_dep_cup || false) : 
            (this.userData?.first_dep_saldo || false);
        
        if (hasBonus) {
            bonusInfo.classList.remove('hidden');
            document.getElementById('bonus-percent').textContent = '10%';
        } else {
            bonusInfo.classList.add('hidden');
        }

        this.currentAction = {
            type: 'deposit',
            method: method,
            hasBonus: hasBonus
        };
    }

    calculateBonus(amount) {
        if (!this.currentAction || !amount) return;

        const amountNum = parseFloat(amount) || 0;
        let totalWithBonus = amountNum;

        if (this.currentAction.hasBonus) {
            const bonus = amountNum * 0.10;
            totalWithBonus = amountNum + bonus;
            document.getElementById('total-with-bonus').textContent = `$${totalWithBonus.toFixed(2)}`;
        }
    }

    async confirmDeposit() {
        const amount = document.getElementById('amount').value;
        const method = this.currentAction?.method;

        if (!amount || !method) {
            this.showToast('❌ Por favor, ingresa un monto válido', 'error');
            return;
        }

        const amountNum = parseFloat(amount);
        const minAmounts = { cup: 1000, saldo: 500 };
        const maxAmounts = { cup: 50000, saldo: 10000 };

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
                    telegram_id: this.userData.telegram_id,
                    method: method,
                    amount: amountNum,
                    phone: this.userData.phone_number
                })
            });

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
                this.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error creando depósito:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadGames() {
        try {
            const response = await fetch('/api/games');
            const games = await response.json();

            const gamesList = document.getElementById('games-list');
            gamesList.innerHTML = '';

            if (games.length === 0) {
                gamesList.innerHTML = '<div class="info-card"><p>No hay juegos disponibles en este momento.</p></div>';
                return;
            }

            games.forEach(game => {
                const gameCard = document.createElement('div');
                gameCard.className = 'game-card';
                gameCard.dataset.gameId = game.id;
                gameCard.innerHTML = `
                    <div class="game-icon">🎮</div>
                    <div class="game-info">
                        <h4>${game.name}</h4>
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
            document.getElementById('games-list').innerHTML = 
                '<div class="error-card"><p>Error cargando juegos</p></div>';
        }
    }

    showGameDetails(game) {
        this.selectedGame = game;
        
        const gamesList = document.getElementById('games-list');
        const gameDetails = document.getElementById('game-details');
        
        gamesList.classList.add('hidden');
        gameDetails.classList.remove('hidden');
        
        gameDetails.innerHTML = `
            <div class="screen-header">
                <h2>${game.name}</h2>
                <button class="btn-secondary" id="back-to-games">← Volver</button>
            </div>
            <div class="variations-list" id="variations-list">
                ${this.generateVariationsList(game)}
            </div>
        `;

        document.getElementById('back-to-games').addEventListener('click', () => {
            gamesList.classList.remove('hidden');
            gameDetails.classList.add('hidden');
        });

        // Configurar eventos para variaciones
        document.querySelectorAll('.variation-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const varId = e.currentTarget.dataset.varId;
                this.selectGameVariation(varId);
            });
        });
    }

    generateVariationsList(game) {
        let html = '';
        const variations = game.variations || {};
        
        Object.entries(variations).forEach(([id, variation]) => {
            html += `
                <div class="variation-card" data-var-id="${id}">
                    <div class="variation-name">${variation.name}</div>
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
        
        return html;
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

            const data = await response.json();

            if (data.success) {
                this.selectedVariation = {
                    id: variationId,
                    name: this.selectedGame.variations[variationId].name,
                    prices: data.prices
                };
                this.showGamePaymentForm();
            } else {
                this.showToast(`❌ ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error obteniendo precio:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    showGamePaymentForm() {
        const gameDetails = document.getElementById('game-details');
        const gamePayment = document.getElementById('game-payment');
        
        gameDetails.classList.add('hidden');
        gamePayment.classList.remove('hidden');
        
        const variation = this.selectedVariation;
        
        gamePayment.innerHTML = `
            <div class="screen-header">
                <h2>${this.selectedGame.name}</h2>
                <button class="btn-secondary" id="back-to-variations">← Atrás</button>
            </div>
            <div class="recharge-form">
                <h3>${variation.name}</h3>
                
                <div class="price-summary">
                    <div class="price-row">
                        <span>Precio en USDT:</span>
                        <span class="price-value">$${variation.prices.usdt}</span>
                    </div>
                    <div class="price-row">
                        <span>CUP:</span>
                        <span class="price-value">$${variation.prices.cup}</span>
                    </div>
                    <div class="price-row">
                        <span>Saldo Móvil:</span>
                        <span class="price-value">$${variation.prices.saldo}</span>
                    </div>
                    <div class="price-row">
                        <span>CWS:</span>
                        <span class="price-value">${variation.prices.cws} tokens</span>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Método de pago:</label>
                    <select id="game-payment-method">
                        <option value="cup">💳 Pagar con CUP - $${variation.prices.cup}</option>
                        <option value="saldo">📱 Pagar con Saldo Móvil - $${variation.prices.saldo}</option>
                        ${variation.prices.cws >= 100 ? 
                            `<option value="cws">🎫 Pagar con CWS - ${variation.prices.cws} tokens</option>` : ''}
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

        document.getElementById('back-to-variations').addEventListener('click', () => {
            gamePayment.classList.add('hidden');
            gameDetails.classList.remove('hidden');
        });

        document.getElementById('cancel-game-payment').addEventListener('click', () => {
            gamePayment.classList.add('hidden');
            gameDetails.classList.remove('hidden');
        });

        document.getElementById('confirm-game-payment').addEventListener('click', () => {
            this.confirmGamePurchase();
        });

        document.getElementById('game-payment-method').addEventListener('change', (e) => {
            this.updateGamePaymentMethod(e.target.value);
        });

        // Cargar campos de entrada iniciales
        this.updateGamePaymentMethod('cup');
    }

    updateGamePaymentMethod(method) {
        const inputFields = document.getElementById('game-input-fields');
        const gameSchema = this.selectedGame.input_schema || { fields: [] };
        
        let html = '';
        gameSchema.fields.forEach(field => {
            if (field.type === 'select') {
                html += `
                    <div class="form-group">
                        <label>${field.label}:</label>
                        <select id="game-field-${field.key}">
                            ${field.options.map(opt => 
                                `<option value="${opt.value}">${opt.label}</option>`
                            ).join('')}
                        </select>
                    </div>
                `;
            } else {
                html += `
                    <div class="form-group">
                        <label>${field.label}:</label>
                        <input type="text" id="game-field-${field.key}" placeholder="${field.label}">
                    </div>
                `;
            }
        });
        
        inputFields.innerHTML = html;
    }

    async confirmGamePurchase() {
        const method = document.getElementById('game-payment-method').value;
        const variation = this.selectedVariation;
        
        // Recolectar datos del formulario
        const formData = {};
        const gameSchema = this.selectedGame.input_schema || { fields: [] };
        let isValid = true;
        
        gameSchema.fields.forEach(field => {
            const input = document.getElementById(`game-field-${field.key}`);
            const value = input?.value?.trim();
            
            if (field.required && !value) {
                isValid = false;
                this.showToast(`❌ El campo ${field.label} es requerido`, 'error');
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
                    telegram_id: this.userData.telegram_id,
                    game_id: this.selectedGame.id,
                    variation_id: variation.id,
                    payment_method: method,
                    user_data: formData,
                    amount: variation.prices[method]
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Compra Exitosa!',
                    message: `Recarga Gold para ${this.selectedGame.name}\n\nPaquete: ${variation.name}\nPago: ${method === 'cws' ? variation.prices[method] + ' CWS' : '$' + variation.prices[method] + ' ' + method.toUpperCase()}\n\nOrden #${data.orderId}`,
                    icon: '🎮',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando compra:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadEtecsaOffers() {
        try {
            const response = await fetch('/api/etecsa-offers');
            const offers = await response.json();

            const offersContainer = document.getElementById('etecsa-offers');
            offersContainer.innerHTML = '';

            if (offers.length === 0) {
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
                        <div class="offer-name">${offer.name}</div>
                    </div>
                    <div class="offer-prices">
                        ${offer.prices.map(price => `
                            <div class="offer-price" data-price-id="${price.id}">
                                <span>${price.label}</span>
                                <span class="price-value">$${price.cup_price} CUP</span>
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
            document.getElementById('etecsa-offers').innerHTML = 
                '<div class="error-card"><p>Error cargando ofertas</p></div>';
        }
    }

    selectEtecsaOffer(offer, priceId) {
        this.selectedOffer = { offer, priceId };
        this.showEtecsaForm();
    }

    showEtecsaForm() {
        const offersContainer = document.getElementById('etecsa-offers');
        const etecsaForm = document.getElementById('etecsa-form');
        
        offersContainer.classList.add('hidden');
        etecsaForm.classList.remove('hidden');
        
        const price = this.selectedOffer.offer.prices.find(p => p.id === this.selectedOffer.priceId);
        
        etecsaForm.innerHTML = `
            <div class="screen-header">
                <h2>📱 Recarga ETECSA</h2>
                <button class="btn-secondary" id="back-to-offers">← Volver</button>
            </div>
            <div class="recharge-form">
                <h3>${this.selectedOffer.offer.name}</h3>
                <div class="price-summary">
                    <div class="price-row">
                        <span>Paquete:</span>
                        <span class="price-value">${price.label}</span>
                    </div>
                    <div class="price-row">
                        <span>Precio:</span>
                        <span class="price-value">$${price.cup_price} CUP</span>
                    </div>
                    <div class="price-row">
                        <span>Original:</span>
                        <span class="price-value">$${price.original_usdt} USDT</span>
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
                    <p>Saldo después: <strong>$${(this.userData?.balance_cup || 0) - price.cup_price}</strong></p>
                </div>
                
                <div class="form-actions">
                    <button class="btn-primary" id="confirm-etecsa">✅ Confirmar Recarga</button>
                    <button class="btn-secondary" id="cancel-etecsa">❌ Cancelar</button>
                </div>
            </div>
        `;

        document.getElementById('back-to-offers').addEventListener('click', () => {
            etecsaForm.classList.add('hidden');
            offersContainer.classList.remove('hidden');
        });

        document.getElementById('cancel-etecsa').addEventListener('click', () => {
            etecsaForm.classList.add('hidden');
            offersContainer.classList.remove('hidden');
        });

        document.getElementById('confirm-etecsa').addEventListener('click', () => {
            this.confirmEtecsaRecharge(price);
        });
    }

    async confirmEtecsaRecharge(price) {
        const phone = document.getElementById('etecsa-phone').value;
        const email = this.selectedOffer.offer.requires_email ? 
            document.getElementById('etecsa-email').value : null;

        // Validar teléfono
        const cleanPhone = phone.replace(/[^\d]/g, '');
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
        if ((this.userData?.balance_cup || 0) < price.cup_price) {
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
                    telegram_id: this.userData.telegram_id,
                    offer_id: this.selectedOffer.offer.id,
                    price_id: this.selectedOffer.priceId,
                    phone: cleanPhone,
                    email: email,
                    amount: price.cup_price
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Recarga Exitosa!',
                    message: `Recarga ETECSA completada\n\nDestino: +${cleanPhone}\nPaquete: ${price.label}\nPrecio: $${price.cup_price} CUP\n\nID Transacción: ${data.transactionId}`,
                    icon: '📱',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.hideModal('confirm-modal');
                        this.showScreen('dashboard');
                        this.loadUserData();
                    }
                });
            } else {
                this.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando recarga:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadHistory() {
        try {
            const response = await fetch(`/api/user-history?telegram_id=${this.userData?.telegram_id}`);
            const transactions = await response.json();

            const historyList = document.getElementById('history-list');
            historyList.innerHTML = '';

            if (transactions.length === 0) {
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
                }
                
                const date = new Date(transaction.created_at).toLocaleDateString('es-ES', {
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
                        typeText = transaction.type;
                }
                
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
                            <span class="detail-value">${Math.abs(transaction.amount || transaction.amount_requested)} ${transaction.currency?.toUpperCase()}</span>
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
        } catch (error) {
            console.error('Error cargando historial:', error);
            document.getElementById('history-list').innerHTML = 
                '<div class="error-card"><p>Error cargando historial</p></div>';
        }
    }

    showPhoneModal() {
        document.getElementById('current-phone-display').textContent = 
            this.userData?.phone_number ? `+53 ${this.userData.phone_number.substring(2)}` : 'No vinculado';
        
        document.getElementById('new-phone').value = '';
        this.showModal('phone-modal');
    }

    async updatePhoneNumber() {
        const newPhone = document.getElementById('new-phone').value.trim();
        
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
                    telegram_id: this.userData.telegram_id,
                    phone: newPhone
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('✅ Teléfono actualizado correctamente', 'success');
                this.hideModal('phone-modal');
                this.loadUserData();
            } else {
                this.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error actualizando teléfono:', error);
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async searchPayment() {
        const txId = document.getElementById('tx-id').value.trim().toUpperCase();
        
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
                    telegram_id: this.userData.telegram_id,
                    tx_id: txId
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showModal({
                    title: '✅ ¡Pago Reclamado!',
                    message: `Pago encontrado y procesado\n\nMonto: $${data.amount} ${data.currency}\nID: ${txId}\n\nEl saldo ha sido acreditado a tu billetera.`,
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
            this.showToast('❌ Error de conexión', 'error');
        } finally {
            this.hideLoading();
        }
    }

    showModal(options) {
        if (typeof options === 'string') {
            // Mostrar modal por ID
            document.getElementById(options).classList.remove('hidden');
        } else {
            // Mostrar modal de confirmación con opciones
            document.getElementById('modal-icon').textContent = options.icon || '⚠️';
            document.getElementById('modal-title').textContent = options.title;
            document.getElementById('modal-message').textContent = options.message;
            
            const confirmBtn = document.getElementById('modal-confirm');
            confirmBtn.textContent = options.confirmText || 'Confirmar';
            
            confirmBtn.onclick = () => {
                if (options.onConfirm) options.onConfirm();
                this.hideModal('confirm-modal');
            };
            
            document.getElementById('confirm-modal').classList.remove('hidden');
        }
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        
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
                container.removeChild(toast);
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
        document.getElementById('loading-text').textContent = text;
        document.getElementById('loading-overlay').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

// Inicializar la WebApp cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.cromwellApp = new CromwellWebApp();
});
