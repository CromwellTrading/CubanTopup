// /public/js/components/games.js
class GamesComponent {
    constructor(app) {
        this.app = app;
        this.games = [];
        this.selectedGame = null;
        this.selectedVariation = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Botón refrescar juegos
        document.getElementById('refresh-games').addEventListener('click', () => {
            this.loadGames();
        });
    }

    async loadGames() {
        try {
            const gamesList = document.getElementById('games-list');
            gamesList.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Cargando juegos...</p>
                </div>
            `;

            const response = await fetch('/api/games');
            this.games = await response.json();

            this.renderGamesList();
        } catch (error) {
            console.error('Error cargando juegos:', error);
            document.getElementById('games-list').innerHTML = `
                <div class="error-message">
                    <p>❌ Error cargando juegos</p>
                    <button class="btn-secondary" onclick="window.cromwellApp.games.loadGames()">🔄 Reintentar</button>
                </div>
            `;
        }
    }

    renderGamesList() {
        const gamesList = document.getElementById('games-list');
        
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
                        <p>${Object.keys(game.variations || {}).length} paquetes</p>
                    </div>
                    <div class="game-arrow">→</div>
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

        gamesList.classList.add('hidden');
        gameDetails.classList.remove('hidden');

        // Renderizar variaciones
        let variationsHtml = '';
        Object.entries(this.selectedGame.variations || {}).forEach(([id, variation]) => {
            variationsHtml += `
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
                    <div class="variation-select">Seleccionar →</div>
                </div>
            `;
        });

        gameDetails.innerHTML = `
            <div class="screen-header">
                <h2>${this.selectedGame.name}</h2>
                <button class="btn-secondary" id="back-to-games">← Volver</button>
            </div>
            <div class="variations-list">
                ${variationsHtml}
            </div>
        `;

        // Event listeners
        document.getElementById('back-to-games').addEventListener('click', () => {
            gameDetails.classList.add('hidden');
            gamesList.classList.remove('hidden');
        });

        // Cargar precios para cada variación
        Object.keys(this.selectedGame.variations || {}).forEach(varId => {
            this.loadVariationPrice(varId);
        });

        // Seleccionar variación
        document.querySelectorAll('.variation-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const varId = e.currentTarget.dataset.varId;
                this.selectVariation(varId);
            });
        });
    }

    async loadVariationPrice(variationId) {
        try {
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
            
            if (data.success && data.prices) {
                // Actualizar precios en la UI
                document.getElementById(`price-cup-${variationId}`).textContent = `$${data.prices.cup}`;
                document.getElementById(`price-saldo-${variationId}`).textContent = `$${data.prices.saldo}`;
                document.getElementById(`price-cws-${variationId}`).textContent = data.prices.cws;
            }
        } catch (error) {
            console.error('Error cargando precio:', error);
        }
    }

    selectVariation(variationId) {
        this.selectedVariation = {
            id: variationId,
            name: this.selectedGame.variations[variationId].name,
            prices: {
                cup: document.getElementById(`price-cup-${variationId}`).textContent.replace('$', ''),
                saldo: document.getElementById(`price-saldo-${variationId}`).textContent.replace('$', ''),
                cws: document.getElementById(`price-cws-${variationId}`).textContent
            }
        };

        this.showGamePaymentForm();
    }

    showGamePaymentForm() {
        const gameDetails = document.getElementById('game-details');
        const gamePayment = document.getElementById('game-payment');

        gameDetails.classList.add('hidden');
        gamePayment.classList.remove('hidden');

        const variation = this.selectedVariation;
        const game = this.selectedGame;

        // Construir formulario de entrada
        let inputFieldsHtml = '';
        game.input_schema.fields.forEach((field, index) => {
            if (field.type === 'select') {
                inputFieldsHtml += `
                    <div class="form-group">
                        <label for="game-field-${field.key}">${field.label} ${field.required ? '*' : ''}</label>
                        <select id="game-field-${field.key}" ${field.required ? 'required' : ''}>
                            ${field.options.map(opt => `
                                <option value="${opt.value}">${opt.label}</option>
                            `).join('')}
                        </select>
                    </div>
                `;
            } else {
                inputFieldsHtml += `
                    <div class="form-group">
                        <label for="game-field-${field.key}">${field.label} ${field.required ? '*' : ''}</label>
                        <input type="${field.type}" 
                               id="game-field-${field.key}" 
                               placeholder="${field.label}"
                               ${field.required ? 'required' : ''}>
                    </div>
                `;
            }
        });

        gamePayment.innerHTML = `
            <div class="screen-header">
                <h2>${game.name}</h2>
                <button class="btn-secondary" id="back-to-variations">← Atrás</button>
            </div>
            <div class="recharge-form">
                <h3>${variation.name}</h3>
                
                <div class="price-summary">
                    <div class="price-row">
                        <span>Precio CUP:</span>
                        <span class="price-value">$${variation.prices.cup}</span>
                    </div>
                    <div class="price-row">
                        <span>Precio Saldo:</span>
                        <span class="price-value">$${variation.prices.saldo}</span>
                    </div>
                    <div class="price-row">
                        <span>Precio CWS:</span>
                        <span class="price-value">${variation.prices.cws} tokens</span>
                    </div>
                </div>

                <div class="form-group">
                    <label>Método de pago:</label>
                    <select id="game-payment-method">
                        <option value="cup">💳 Pagar con CUP - $${variation.prices.cup}</option>
                        <option value="saldo">📱 Pagar con Saldo Móvil - $${variation.prices.saldo}</option>
                        ${parseInt(variation.prices.cws) >= 100 ? 
                            `<option value="cws">🎫 Pagar con CWS - ${variation.prices.cws} tokens</option>` : ''}
                    </select>
                </div>

                <div id="game-input-fields">
                    ${inputFieldsHtml}
                </div>

                <div class="form-actions">
                    <button class="btn-primary" id="confirm-game-payment">✅ Confirmar Compra</button>
                    <button class="btn-secondary" id="cancel-game-payment">❌ Cancelar</button>
                </div>
            </div>
        `;

        // Event listeners
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
    }

    async confirmGamePurchase() {
        const method = document.getElementById('game-payment-method').value;
        const variation = this.selectedVariation;
        const game = this.selectedGame;

        // Recolectar datos del formulario
        const formData = {};
        let isValid = true;

        game.input_schema.fields.forEach(field => {
            const element = document.getElementById(`game-field-${field.key}`);
            const value = element?.value?.trim();
            
            if (field.required && !value) {
                isValid = false;
                this.app.showToast(`❌ El campo ${field.label} es requerido`, 'error');
                return;
            }
            
            formData[field.key] = value;
        });

        if (!isValid) return;

        try {
            this.app.showLoading('Procesando compra...');

            const response = await fetch('/api/game-purchase', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.app.userData.telegram_id,
                    game_id: game.id,
                    variation_id: variation.id,
                    payment_method: method,
                    user_data: formData,
                    amount: variation.prices[method]
                })
            });

            const data = await response.json();

            if (data.success) {
                this.app.showModal({
                    title: '✅ ¡Compra Exitosa!',
                    message: `Recarga Gold para ${game.name}\n\nPaquete: ${variation.name}\nMétodo: ${method.toUpperCase()}\nOrden #${data.orderId}`,
                    icon: '🎮',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.app.hideModal('confirm-modal');
                        this.app.showScreen('dashboard');
                        this.app.loadUserData();
                    }
                });
            } else {
                this.app.showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando compra:', error);
            this.app.showToast('❌ Error de conexión', 'error');
        } finally {
            this.app.hideLoading();
        }
    }
}
