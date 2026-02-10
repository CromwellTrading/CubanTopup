// /public/js/components/etecsa.js
class EtecsaComponent {
    constructor(app) {
        this.app = app;
        this.offers = [];
        this.selectedOffer = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Botón refrescar ofertas
        const refreshBtn = document.getElementById('refresh-etecsa');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadOffers();
            });
        }
    }

    async loadOffers() {
        try {
            const offersContainer = document.getElementById('etecsa-offers');
            if (!offersContainer) return;
            
            offersContainer.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Cargando ofertas...</p>
                </div>
            `;

            console.log('🔍 Solicitando ofertas ETECSA a la API...');
            const response = await fetch('/api/etecsa-offers');
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('📦 Respuesta de API:', data);
            
            if (data.success && data.offers) {
                this.offers = data.offers;
                this.renderOffers();
            } else {
                throw new Error(data.error || 'No hay ofertas disponibles');
            }
        } catch (error) {
            console.error('Error cargando ofertas:', error);
            const offersContainer = document.getElementById('etecsa-offers');
            if (offersContainer) {
                offersContainer.innerHTML = `
                    <div class="error-message">
                        <p>❌ Error cargando ofertas ETECSA: ${error.message}</p>
                        <button class="btn-secondary" onclick="window.cromwellApp.etecsa.loadOffers()">🔄 Reintentar</button>
                    </div>
                `;
            }
        }
    }

    renderOffers() {
        const offersContainer = document.getElementById('etecsa-offers');
        if (!offersContainer) return;
        
        if (!this.offers || this.offers.length === 0) {
            offersContainer.innerHTML = `
                <div class="info-card">
                    <p>No hay ofertas disponibles en este momento.</p>
                </div>
            `;
            return;
        }

        let html = '';
        this.offers.forEach(offer => {
            html += `
                <div class="offer-card">
                    <div class="offer-header">
                        <div class="offer-icon">📱</div>
                        <div class="offer-info">
                            <h3 class="offer-name">${offer.name || 'Oferta ETECSA'}</h3>
                            <p class="offer-description">${offer.description || 'Recarga de saldo'}</p>
                        </div>
                    </div>
                    <div class="offer-prices">
                        ${(offer.prices || []).map(price => `
                            <div class="price-option" 
                                 data-offer-id="${offer.id}" 
                                 data-price-id="${price.id}">
                                <div class="price-main">
                                    <span class="price-label">${price.label || 'Paquete'}</span>
                                    <span class="price-value">$${price.cup_price || 0} CUP</span>
                                </div>
                                ${price.original_usdt ? `
                                    <div class="price-details">
                                        <small>$${price.original_usdt} USDT</small>
                                    </div>
                                ` : ''}
                                <div class="price-select-btn">
                                    <span>👉 Seleccionar</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        offersContainer.innerHTML = html;

        // Event listeners para seleccionar oferta
        document.querySelectorAll('.price-option').forEach(priceElement => {
            priceElement.addEventListener('click', (e) => {
                // Remover selección anterior
                document.querySelectorAll('.price-option').forEach(el => {
                    el.classList.remove('selected');
                });
                
                // Seleccionar actual
                priceElement.classList.add('selected');
                
                const offerId = priceElement.dataset.offerId;
                const priceId = priceElement.dataset.priceId;
                
                // Añadir animación
                priceElement.style.animation = 'pulse 0.5s ease';
                setTimeout(() => {
                    priceElement.style.animation = '';
                    this.selectOffer(offerId, priceId);
                }, 300);
            });
        });
    }

    selectOffer(offerId, priceId) {
        const offer = this.offers.find(o => o.id == offerId);
        if (!offer) return;

        const price = (offer.prices || []).find(p => p.id === priceId);
        if (!price) return;

        this.selectedOffer = {
            offer: offer,
            price: price
        };

        this.showEtecsaForm();
    }

    showEtecsaForm() {
        const offersContainer = document.getElementById('etecsa-offers');
        const etecsaForm = document.getElementById('etecsa-form');

        if (offersContainer) offersContainer.classList.add('hidden');
        if (etecsaForm) {
            etecsaForm.classList.remove('hidden');
            etecsaForm.style.animation = 'screenEnter 0.3s ease';

            const offer = this.selectedOffer.offer;
            const price = this.selectedOffer.price;
            const user = this.app.userData || { balance_cup: 0 };

            etecsaForm.innerHTML = `
                <div class="screen-header">
                    <div class="header-left">
                        <button class="btn-icon" id="back-to-offers">
                            <span class="icon">←</span>
                        </button>
                        <h2>📱 Recarga ETECSA</h2>
                    </div>
                </div>
                <div class="recharge-form">
                    <h3>${offer.name || 'Recarga'}</h3>
                    
                    <div class="selected-offer-card">
                        <div class="selected-offer-header">
                            <span class="offer-icon">📱</span>
                            <span class="offer-name">${price.label || 'Paquete'}</span>
                        </div>
                        <div class="selected-offer-details">
                            <div class="price-row">
                                <span>Precio:</span>
                                <span class="price-value">$${price.cup_price || 0} CUP</span>
                            </div>
                            ${price.original_usdt ? `
                                <div class="price-row">
                                    <span>Valor original:</span>
                                    <span class="price-value">$${price.original_usdt} USDT</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    ${offer.requires_email ? `
                        <div class="warning-note">
                            ⚠️ Esta recarga requiere email de Nauta
                        </div>
                    ` : ''}

                    <div class="balance-check">
                        <div class="balance-row">
                            <span>Tu saldo CUP:</span>
                            <span class="balance-value">$${user.balance_cup || 0}</span>
                        </div>
                        <div class="balance-row">
                            <span>Costo recarga:</span>
                            <span class="balance-value negative">-$${price.cup_price || 0}</span>
                        </div>
                        <div class="balance-row total">
                            <span>Saldo después:</span>
                            <span class="balance-value">$${(user.balance_cup || 0) - (price.cup_price || 0)}</span>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="etecsa-phone">Número de teléfono destino *</label>
                        <!-- CAMBIADO: Solo 8 dígitos, no se agrega 53 -->
                        <input type="tel" 
                               id="etecsa-phone" 
                               placeholder="51234567" 
                               maxlength="8"
                               pattern="[0-9]{8}"
                               required>
                        <p class="form-hint">Formato: 8 dígitos exactos (ej: 51234567, 59190241)</p>
                        <p class="form-hint"><strong>No incluyas el prefijo 53</strong></p>
                    </div>

                    ${offer.requires_email ? `
                        <div class="form-group">
                            <label for="etecsa-email">Email de Nauta *</label>
                            <input type="email" 
                                   id="etecsa-email" 
                                   placeholder="usuario@nauta.com.cu"
                                   required>
                            <p class="form-hint">Ejemplo: usuario@nauta.com.cu</p>
                        </div>
                    ` : ''}

                    <div class="form-actions">
                        <button class="btn-primary" id="confirm-etecsa">✅ Confirmar Recarga</button>
                        <button class="btn-secondary" id="cancel-etecsa">❌ Cancelar</button>
                    </div>
                </div>
            `;

            // Event listeners
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
                    this.confirmEtecsaRecharge();
                });
            }
        }
    }

    async confirmEtecsaRecharge() {
        const phoneInput = document.getElementById('etecsa-phone');
        const emailInput = document.getElementById('etecsa-email');
        
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const email = this.selectedOffer.offer.requires_email && emailInput ? 
            emailInput.value.trim() : null;

        // Validaciones del teléfono - AHORA SOLO 8 DÍGITOS EXACTOS
        const cleanPhone = phone.replace(/[^\d]/g, '');
        
        if (cleanPhone.length !== 8) {
            this.app.showToast('❌ Formato de teléfono incorrecto. Debe tener exactamente 8 dígitos (ej: 51234567). No incluyas el prefijo 53.', 'error');
            return;
        }
        
        // Guardamos solo los 8 dígitos
        console.log(`✅ Número guardado (8 dígitos): ${cleanPhone}`);

        if (this.selectedOffer.offer.requires_email && email) {
            const emailRegex = /^[a-zA-Z0-9._%+-]+@nauta\.(com\.cu|cu)$/i;
            if (!emailRegex.test(email)) {
                this.app.showToast('❌ Email de Nauta inválido. Formato: usuario@nauta.com.cu', 'error');
                return;
            }
        }

        // Verificar saldo
        const price = this.selectedOffer.price.cup_price || 0;
        const userBalance = this.app.userData?.balance_cup || 0;
        
        if (userBalance < price) {
            const faltante = price - userBalance;
            this.app.showModal({
                title: '❌ Saldo Insuficiente',
                message: `Necesitas $${price} CUP\nTienes: $${userBalance} CUP\nFaltan: $${faltante} CUP\n\nRecarga tu billetera primero.`,
                icon: '💰',
                confirmText: 'Recargar Billetera',
                onConfirm: () => {
                    this.app.hideModal('confirm-modal');
                    this.app.showScreen('recharge');
                }
            });
            return;
        }

        try {
            this.app.showLoading('Procesando recarga ETECSA...');

            const response = await fetch('/api/etecsa-recharge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: this.app.userId,
                    offer_id: this.selectedOffer.offer.id,
                    price_id: this.selectedOffer.price.id,
                    phone: cleanPhone, // Enviamos SOLO los 8 dígitos
                    email: email,
                    amount: price
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.app.showModal({
                    title: '✅ ¡Recarga Exitosa!',
                    message: `Recarga ETECSA completada\n\nDestino: 53${cleanPhone}\nPaquete: ${this.selectedOffer.price.label || 'N/A'}\nPrecio: $${price} CUP\nID: ${data.transactionId || 'N/A'}`,
                    icon: '📱',
                    confirmText: 'Aceptar',
                    onConfirm: () => {
                        this.app.hideModal('confirm-modal');
                        this.app.showScreen('dashboard');
                        this.app.loadUserData();
                    }
                });
            } else {
                this.app.showToast(`❌ Error: ${data.error || 'Error desconocido'}`, 'error');
            }
        } catch (error) {
            console.error('Error procesando recarga:', error);
            this.app.showToast('❌ Error de conexión: ' + error.message, 'error');
        } finally {
            this.app.hideLoading();
        }
    }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.EtecsaComponent = EtecsaComponent;
}
