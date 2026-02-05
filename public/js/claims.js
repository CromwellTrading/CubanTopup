// Sistema completo de Reclamos de Pagos
class ClaimsManager {
    constructor() {
        this.pendingPayments = [];
        this.searchResults = [];
        this.init();
    }

    async init() {
        this.initEventListeners();
        await this.loadPendingPayments();
        this.updateUI();
    }

    initEventListeners() {
        // Opciones de reclamo
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleAction(e));
        });

        // Buscar por ID
        document.getElementById('searchTxId')?.addEventListener('click', () => this.searchById());
        document.getElementById('txIdSearch')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchById();
        });

        // Escanear QR
        document.getElementById('scanQr')?.addEventListener('click', () => this.scanQR());

        // Cerrar búsqueda/pendientes
        document.getElementById('closeSearch')?.addEventListener('click', () => this.closeSearch());
        document.getElementById('closePending')?.addEventListener('click', () => this.closePending());

        // Refrescar pendientes
        document.getElementById('refreshPending')?.addEventListener('click', () => this.refreshPending());

        // Verificación manual
        document.getElementById('manualVerify')?.addEventListener('click', () => this.manualVerification());
    }

    async loadPendingPayments() {
        try {
            const response = await fetch('/api/pending-payments', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.pendingPayments = data.payments || [];
            } else {
                throw new Error('Error cargando pagos pendientes');
            }
        } catch (error) {
            this.showError('Error cargando pendientes', error.message);
        }
    }

    updateUI() {
        this.updatePendingCount();
        this.updatePaymentOptions();
    }

    updatePendingCount() {
        const viewPendingOption = document.getElementById('viewPendingOption');
        if (viewPendingOption) {
            const count = this.pendingPayments.length;
            if (count > 0) {
                viewPendingOption.querySelector('.option-content p').innerHTML = 
                    `${count} pago${count !== 1 ? 's' : ''} por confirmar`;
            }
        }
    }

    updatePaymentOptions() {
        const options = {
            'searchByIdOption': this.pendingPayments.length > 0,
            'viewPendingOption': true,
            'manualVerificationOption': true
        };

        Object.entries(options).forEach(([id, enabled]) => {
            const element = document.getElementById(id);
            if (element) {
                element.style.opacity = enabled ? '1' : '0.5';
                element.style.pointerEvents = enabled ? 'all' : 'none';
            }
        });
    }

    handleAction(e) {
        const action = e.currentTarget.getAttribute('data-action');
        
        switch(action) {
            case 'search-by-id':
                this.showSearch();
                break;
            case 'view-pending':
                this.showPendingPayments();
                break;
            case 'manual-verify':
                this.showManualVerification();
                break;
        }
    }

    showSearch() {
        document.getElementById('claimsSearch')?.classList.remove('hidden');
        document.getElementById('claimsOptions')?.classList.add('hidden');
        document.getElementById('txIdSearch')?.focus();
    }

    closeSearch() {
        document.getElementById('claimsSearch')?.classList.add('hidden');
        document.getElementById('claimsOptions')?.classList.remove('hidden');
        this.clearSearchResults();
    }

    showPendingPayments() {
        document.getElementById('pendingPayments')?.classList.remove('hidden');
        document.getElementById('claimsOptions')?.classList.add('hidden');
        this.renderPendingPayments();
    }

    closePending() {
        document.getElementById('pendingPayments')?.classList.add('hidden');
        document.getElementById('claimsOptions')?.classList.remove('hidden');
    }

    async searchById() {
        const txIdInput = document.getElementById('txIdSearch');
        const txId = txIdInput?.value?.trim().toUpperCase();

        if (!txId) {
            this.showError('ID requerido', 'Ingresa un ID de transacción');
            return;
        }

        try {
            this.showLoading('Buscando transacción...');

            const response = await fetch(`/api/search-payment/${encodeURIComponent(txId)}`, {
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                this.searchResults = data.results || [];
                this.renderSearchResults();
            } else {
                throw new Error(data.error || 'Error en la búsqueda');
            }
        } catch (error) {
            this.showError('Error buscando', error.message);
            this.searchResults = [];
            this.renderSearchResults();
        } finally {
            this.hideLoading();
        }
    }

    renderSearchResults() {
        const container = document.getElementById('searchResults');
        if (!container) return;

        if (this.searchResults.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No se encontraron transacciones con ese ID</p>
                    <p class="hint">Verifica que el ID sea correcto</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.searchResults.map(payment => this.createSearchResultItem(payment)).join('');
        
        // Añadir event listeners a los botones de reclamar
        container.querySelectorAll('.claim-payment-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const paymentId = e.currentTarget.getAttribute('data-id');
                this.claimPayment(paymentId);
            });
        });
    }

    createSearchResultItem(payment) {
        const date = new Date(payment.created_at);
        const formattedDate = date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const isClaimable = !payment.claimed && 
                           (payment.user_id || payment.phone) && 
                           payment.amount > 0;

        return `
            <div class="payment-item ${payment.claimed ? 'claimed' : ''}">
                <div class="payment-info">
                    <div class="payment-icon">
                        <i class="fas ${payment.claimed ? 'fa-check-circle' : 'fa-clock'}"></i>
                    </div>
                    <div class="payment-details">
                        <div class="payment-amount">${this.formatCurrency(payment.amount, payment.currency)}</div>
                        <div class="payment-id">ID: <code>${payment.tx_id}</code></div>
                        <div class="payment-time">${formattedDate}</div>
                        <div class="payment-status">
                            ${payment.claimed ? 
                                `<span class="status-badge completed">Reclamado</span>` : 
                                `<span class="status-badge pending">Pendiente</span>`
                            }
                        </div>
                    </div>
                </div>
                <div class="payment-actions">
                    ${isClaimable ? 
                        `<button class="btn-primary claim-payment-btn" data-id="${payment.id}">
                            <i class="fas fa-gift"></i> Reclamar
                        </button>` :
                        `<button class="btn-secondary" disabled>
                            ${payment.claimed ? 'Ya reclamado' : 'No reclamable'}
                        </button>`
                    }
                </div>
            </div>
        `;
    }

    renderPendingPayments() {
        const container = document.getElementById('paymentsList');
        if (!container) return;

        if (this.pendingPayments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No tienes pagos pendientes</p>
                    <p class="hint">Los pagos pendientes aparecerán aquí automáticamente</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.pendingPayments.map(payment => this.createPendingPaymentItem(payment)).join('');
        
        // Añadir event listeners
        container.querySelectorAll('.claim-payment-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const paymentId = e.currentTarget.getAttribute('data-id');
                this.claimPayment(paymentId);
            });
        });

        container.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const paymentId = e.currentTarget.getAttribute('data-id');
                this.viewPaymentDetails(paymentId);
            });
        });
    }

    createPendingPaymentItem(payment) {
        const date = new Date(payment.created_at);
        const timeAgo = this.timeSince(date);

        return `
            <div class="payment-item">
                <div class="payment-info">
                    <div class="payment-icon">
                        <i class="fas fa-${payment.currency === 'usdt' ? 'usd' : 'money-bill-wave'}"></i>
                    </div>
                    <div class="payment-details">
                        <div class="payment-amount">${this.formatCurrency(payment.amount, payment.currency)}</div>
                        <div class="payment-id">ID: <code>${payment.tx_id}</code></div>
                        <div class="payment-method">${this.getMethodName(payment.tipo_pago)}</div>
                        <div class="payment-time">Hace ${timeAgo}</div>
                    </div>
                </div>
                <div class="payment-actions">
                    <button class="btn-primary claim-payment-btn" data-id="${payment.id}">
                        <i class="fas fa-gift"></i> Reclamar
                    </button>
                    <button class="btn-secondary view-details-btn" data-id="${payment.id}">
                        <i class="fas fa-eye"></i> Detalles
                    </button>
                </div>
            </div>
        `;
    }

    async claimPayment(paymentId) {
        if (!confirm('¿Estás seguro de que quieres reclamar este pago?')) {
            return;
        }

        try {
            this.showLoading('Procesando reclamación...');

            const response = await fetch('/api/claim-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ payment_id: paymentId })
            });

            const data = await response.json();

            if (response.ok) {
                if (data.success) {
                    this.showSuccess('¡Pago reclamado!', 'El monto ha sido acreditado a tu wallet');
                    
                    // Actualizar lista de pendientes
                    await this.refreshPending();
                    
                    // Si está en búsqueda, actualizar resultados
                    if (document.getElementById('claimsSearch')?.classList.contains('hidden') === false) {
                        await this.searchById();
                    }
                } else {
                    throw new Error(data.message || 'Error reclamando pago');
                }
            } else {
                throw new Error(data.error || 'Error en la reclamación');
            }
        } catch (error) {
            this.showError('Error reclamando pago', error.message);
        } finally {
            this.hideLoading();
        }
    }

    viewPaymentDetails(paymentId) {
        const payment = this.pendingPayments.find(p => p.id == paymentId);
        if (!payment) return;

        const modalContent = `
            <div class="payment-details-modal">
                <h3><i class="fas fa-receipt"></i> Detalles del Pago</h3>
                
                <div class="details-grid">
                    <div class="detail-item">
                        <span class="detail-label">Monto:</span>
                        <span class="detail-value">${this.formatCurrency(payment.amount, payment.currency)}</span>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">ID Transacción:</span>
                        <span class="detail-value"><code>${payment.tx_id}</code></span>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Método:</span>
                        <span class="detail-value">${this.getMethodName(payment.tipo_pago)}</span>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Fecha:</span>
                        <span class="detail-value">${new Date(payment.created_at).toLocaleString()}</span>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Estado:</span>
                        <span class="detail-value">
                            <span class="status-badge ${payment.claimed ? 'completed' : 'pending'}">
                                ${payment.claimed ? 'Reclamado' : 'Pendiente'}
                            </span>
                        </span>
                    </div>
                    
                    ${payment.receptor ? `
                        <div class="detail-item">
                            <span class="detail-label">Destino:</span>
                            <span class="detail-value"><code>${payment.receptor}</code></span>
                        </div>
                    ` : ''}
                    
                    ${payment.phone ? `
                        <div class="detail-item">
                            <span class="detail-label">Teléfono:</span>
                            <span class="detail-value">${payment.phone}</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="instructions-box">
                    <h4><i class="fas fa-info-circle"></i> Para reclamar este pago:</h4>
                    <ol>
                        <li>Verifica que este pago corresponde a una transferencia que realizaste</li>
                        <li>Asegúrate de que el monto y método coinciden</li>
                        <li>Si todo es correcto, presiona "Reclamar"</li>
                        <li>El monto será acreditado automáticamente a tu wallet</li>
                    </ol>
                </div>
                
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').classList.remove('active')">
                        Cerrar
                    </button>
                    ${!payment.claimed ? `
                        <button class="btn-primary" onclick="window.claimsManager.claimPayment('${payment.id}')">
                            <i class="fas fa-gift"></i> Reclamar
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        this.showModal('Detalles del Pago', modalContent);
    }

    scanQR() {
        this.showInfo('Escaneo QR', 'Función en desarrollo. Por ahora, ingresa el ID manualmente.');
        
        // En una implementación real, aquí se integraría con una API de escaneo QR
        // Por ahora, mostramos un ejemplo simulado
        setTimeout(() => {
            document.getElementById('txIdSearch').value = 'TMW' + Math.random().toString().slice(2, 11);
            this.searchById();
        }, 1000);
    }

    async refreshPending() {
        await this.loadPendingPayments();
        this.updateUI();
        this.renderPendingPayments();
        this.showNotification('Lista actualizada', 'success');
    }

    showManualVerification() {
        const modalContent = `
            <div class="manual-verification-modal">
                <h3><i class="fas fa-upload"></i> Verificación Manual</h3>
                
                <div class="info-box">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Usa esta opción solo si:</p>
                    <ul>
                        <li>Hiciste un pago pero no tienes el ID de transacción</li>
                        <li>ETECSA no envió el SMS de confirmación</li>
                        <li>Tienes captura de pantalla válida del pago</li>
                    </ul>
                </div>
                
                <form id="manualVerificationForm">
                    <div class="form-group">
                        <label for="manualAmount">
                            <i class="fas fa-money-bill-wave"></i> Monto Transferido
                        </label>
                        <input type="number" id="manualAmount" step="0.01" min="1" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="manualMethod">
                            <i class="fas fa-credit-card"></i> Método de Pago
                        </label>
                        <select id="manualMethod" required>
                            <option value="">Selecciona método</option>
                            <option value="cup">CUP (Tarjeta)</option>
                            <option value="saldo">Saldo Móvil</option>
                            <option value="usdt">USDT</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="manualDate">
                            <i class="fas fa-calendar"></i> Fecha y Hora
                        </label>
                        <input type="datetime-local" id="manualDate" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="manualDescription">
                            <i class="fas fa-file-alt"></i> Descripción
                        </label>
                        <textarea id="manualDescription" rows="3" placeholder="Describe la transferencia: a quién, desde qué número/wallet, etc." required></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>
                            <i class="fas fa-image"></i> Captura de Pantalla
                        </label>
                        <div class="file-upload">
                            <input type="file" id="manualScreenshot" accept="image/*" required>
                            <label for="manualScreenshot" class="btn-secondary">
                                <i class="fas fa-upload"></i> Seleccionar Archivo
                            </label>
                            <span id="fileName">No se seleccionó archivo</span>
                        </div>
                        <div class="hint">Formatos: JPG, PNG, GIF (Máx: 5MB)</div>
                    </div>
                    
                    <div class="form-group">
                        <button type="submit" class="btn-primary">
                            <i class="fas fa-paper-plane"></i> Enviar para Revisión
                        </button>
                    </div>
                </form>
                
                <div class="warning-box">
                    <i class="fas fa-clock"></i>
                    <p><strong>Nota:</strong> Las verificaciones manuales toman 24-48 horas en ser procesadas por un administrador.</p>
                </div>
            </div>
        `;

        this.showModal('Verificación Manual', modalContent);
        
        // Configurar event listeners para el formulario
        setTimeout(() => {
            const form = document.getElementById('manualVerificationForm');
            const fileInput = document.getElementById('manualScreenshot');
            const fileName = document.getElementById('fileName');
            
            if (fileInput && fileName) {
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        fileName.textContent = file.name;
                        
                        // Validar tamaño
                        if (file.size > 5 * 1024 * 1024) {
                            this.showError('Archivo muy grande', 'El tamaño máximo es 5MB');
                            fileInput.value = '';
                            fileName.textContent = 'No se seleccionó archivo';
                        }
                    }
                });
            }
            
            if (form) {
                form.addEventListener('submit', (e) => this.submitManualVerification(e));
            }
            
            // Establecer fecha actual por defecto
            const dateInput = document.getElementById('manualDate');
            if (dateInput) {
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                dateInput.value = now.toISOString().slice(0, 16);
            }
        }, 100);
    }

    async submitManualVerification(e) {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('amount', document.getElementById('manualAmount').value);
        formData.append('method', document.getElementById('manualMethod').value);
        formData.append('date', document.getElementById('manualDate').value);
        formData.append('description', document.getElementById('manualDescription').value);
        
        const fileInput = document.getElementById('manualScreenshot');
        if (fileInput.files[0]) {
            formData.append('screenshot', fileInput.files[0]);
        }
        
        try {
            this.showLoading('Enviando verificación...');
            
            const response = await fetch('/api/manual-verification', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showSuccess('Verificación enviada', 'Un administrador revisará tu solicitud en 24-48 horas');
                this.closeModal();
            } else {
                throw new Error(data.error || 'Error enviando verificación');
            }
        } catch (error) {
            this.showError('Error enviando verificación', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // Métodos de utilidad
    getMethodName(tipoPago) {
        const methods = {
            'PAGO_IDENTIFICADO': 'Tarjeta a Tarjeta',
            'PAGO_ANONIMO': 'Tarjeta a Monedero',
            'SALDO_RECIBIDO': 'Saldo Móvil',
            'USDT_BEP20': 'USDT BEP20',
            'TARJETA_MONEDERO': 'Tarjeta a Monedero'
        };
        
        return methods[tipoPago] || tipoPago || 'Desconocido';
    }

    formatCurrency(amount, currency) {
        const symbols = {
            'cup': 'CUP',
            'saldo': 'Saldo',
            'usdt': 'USDT'
        };
        
        const symbol = symbols[currency] || currency.toUpperCase();
        
        if (currency === 'usdt') {
            return `${parseFloat(amount).toFixed(2)} ${symbol}`;
        }
        
        return `$${parseFloat(amount).toFixed(2)} ${symbol}`;
    }

    timeSince(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + ' años';
        
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + ' meses';
        
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + ' días';
        
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + ' horas';
        
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + ' minutos';
        
        return Math.floor(seconds) + ' segundos';
    }

    clearSearchResults() {
        this.searchResults = [];
        const container = document.getElementById('searchResults');
        if (container) container.innerHTML = '';
        document.getElementById('txIdSearch').value = '';
    }

    showModal(title, content) {
        const modal = document.getElementById('transactionModal');
        if (!modal) return;
        
        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            modalBody.innerHTML = content;
        }
        
        const modalHeader = modal.querySelector('.modal-header h2');
        if (modalHeader) {
            modalHeader.innerHTML = `<i class="fas fa-receipt"></i> ${title}`;
        }
        
        modal.classList.add('active');
    }

    closeModal() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }

    showLoading(message = 'Cargando...') {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const text = overlay.querySelector('.loading-text');
            if (text) text.textContent = message;
            overlay.classList.add('active');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }

    showSuccess(title, message) {
        this.showNotification(`${title}: ${message}`, 'success');
    }

    showInfo(title, message) {
        this.showNotification(`${title}: ${message}`, 'info');
    }
}

// Inicializar cuando se cargue la página de reclamos
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('claims-page')) {
        window.claimsManager = new ClaimsManager();
    }
});
