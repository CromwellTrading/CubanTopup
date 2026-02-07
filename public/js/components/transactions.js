// /public/js/components/transactions.js
class TransactionsComponent {
    constructor(app) {
        this.app = app;
        this.transactions = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Botón refrescar historial
        document.getElementById('refresh-history').addEventListener('click', () => {
            this.loadHistory();
        });

        // Filtros
        document.getElementById('filter-type').addEventListener('change', () => {
            this.renderFilteredHistory();
        });

        document.getElementById('filter-status').addEventListener('change', () => {
            this.renderFilteredHistory();
        });
    }

    async loadHistory() {
        try {
            const historyList = document.getElementById('history-list');
            historyList.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Cargando historial...</p>
                </div>
            `;

            const response = await fetch(`/api/user-history?telegram_id=${this.app.userData.telegram_id}`);
            this.transactions = await response.json();

            this.renderFilteredHistory();
        } catch (error) {
            console.error('Error cargando historial:', error);
            document.getElementById('history-list').innerHTML = `
                <div class="error-message">
                    <p>❌ Error cargando historial</p>
                    <button class="btn-secondary" onclick="window.cromwellApp.transactions.loadHistory()">🔄 Reintentar</button>
                </div>
            `;
        }
    }

    renderFilteredHistory() {
        const typeFilter = document.getElementById('filter-type').value;
        const statusFilter = document.getElementById('filter-status').value;

        let filtered = this.transactions;

        if (typeFilter !== 'all') {
            filtered = filtered.filter(t => t.type === typeFilter);
        }

        if (statusFilter !== 'all') {
            filtered = filtered.filter(t => t.status === statusFilter);
        }

        this.renderHistoryList(filtered);
    }

    renderHistoryList(transactions) {
        const historyList = document.getElementById('history-list');
        
        if (!transactions || transactions.length === 0) {
            historyList.innerHTML = `
                <div class="info-card">
                    <p>No hay transacciones registradas.</p>
                </div>
            `;
            return;
        }

        let html = '';
        transactions.forEach(transaction => {
            const icon = this.getTransactionIcon(transaction.type);
            const statusClass = this.getStatusClass(transaction.status);
            const statusText = this.getStatusText(transaction.status);
            const date = new Date(transaction.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const amount = Math.abs(transaction.amount || transaction.amount_requested);
            const currency = transaction.currency?.toUpperCase() || '';

            html += `
                <div class="transaction-card">
                    <div class="transaction-header">
                        <div class="transaction-type">
                            <span class="transaction-icon">${icon}</span>
                            <span class="transaction-title">${this.getTypeText(transaction.type)}</span>
                        </div>
                        <div class="transaction-status ${statusClass}">${statusText}</div>
                    </div>
                    
                    <div class="transaction-details">
                        <div class="detail-row">
                            <span class="detail-label">Fecha:</span>
                            <span class="detail-value">${date}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Monto:</span>
                            <span class="detail-value">${amount} ${currency}</span>
                        </div>
                        
                        ${transaction.tx_id ? `
                            <div class="detail-row">
                                <span class="detail-label">ID Transacción:</span>
                                <span class="detail-value"><code>${transaction.tx_id}</code></span>
                            </div>
                        ` : ''}
                        
                        ${transaction.details?.game ? `
                            <div class="detail-row">
                                <span class="detail-label">Juego:</span>
                                <span class="detail-value">${transaction.details.game}</span>
                            </div>
                        ` : ''}
                        
                        ${transaction.details?.package ? `
                            <div class="detail-row">
                                <span class="detail-label">Paquete:</span>
                                <span class="detail-value">${transaction.details.package}</span>
                            </div>
                        ` : ''}
                        
                        ${transaction.tokens_generated ? `
                            <div class="detail-row">
                                <span class="detail-label">Tokens generados:</span>
                                <span class="detail-value positive">+${transaction.tokens_generated} CWS</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        historyList.innerHTML = html;
    }

    getTransactionIcon(type) {
        switch(type) {
            case 'DEPOSIT': return '💰';
            case 'GAME_RECHARGE': return '🎮';
            case 'ETECSA_RECHARGE': return '📱';
            default: return '🔸';
        }
    }

    getTypeText(type) {
        switch(type) {
            case 'DEPOSIT': return 'Depósito';
            case 'GAME_RECHARGE': return 'Recarga Juego';
            case 'ETECSA_RECHARGE': return 'Recarga ETECSA';
            default: return type;
        }
    }

    getStatusClass(status) {
        switch(status) {
            case 'completed': return 'status-completed';
            case 'pending': return 'status-pending';
            case 'failed': return 'status-failed';
            default: return 'status-unknown';
        }
    }

    getStatusText(status) {
        switch(status) {
            case 'completed': return 'Completado';
            case 'pending': return 'Pendiente';
            case 'failed': return 'Fallido';
            default: return status;
        }
    }
}
