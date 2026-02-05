// Sistema completo de Historial de Transacciones
class HistoryManager {
    constructor() {
        this.transactions = [];
        this.filteredTransactions = [];
        this.currentPage = 1;
        this.itemsPerPage = 25;
        this.totalPages = 1;
        this.filters = {
            type: 'all',
            period: '30',
            status: 'all'
        };
        this.chart = null;
        this.init();
    }

    async init() {
        this.initEventListeners();
        await this.loadHistory();
        this.renderHistory();
        this.initChart();
    }

    initEventListeners() {
        // Filtros
        document.getElementById('historyFilter')?.addEventListener('change', (e) => {
            this.filters.type = e.target.value;
            this.applyFilters();
        });

        document.getElementById('historyPeriod')?.addEventListener('change', (e) => {
            this.filters.period = e.target.value;
            this.applyFilters();
        });

        document.getElementById('itemsPerPage')?.addEventListener('change', (e) => {
            this.itemsPerPage = parseInt(e.target.value);
            this.currentPage = 1;
            this.renderHistory();
        });

        // Paginación
        document.getElementById('prevPage')?.addEventListener('click', () => this.prevPage());
        document.getElementById('nextPage')?.addEventListener('click', () => this.nextPage());

        // Botón exportar
        document.getElementById('exportHistory')?.addEventListener('click', () => this.exportHistory());

        // Botón primer depósito
        document.getElementById('makeFirstDeposit')?.addEventListener('click', () => {
            window.dashboard?.switchPage('deposit');
        });
    }

    async loadHistory() {
        try {
            const response = await fetch('/api/user-data', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Error cargando historial');
            }

            const data = await response.json();
            
            if (data.success) {
                this.transactions = data.transactions || [];
                this.filteredTransactions = [...this.transactions];
                this.updateStats();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showError('Error cargando historial', error.message);
        }
    }

    applyFilters() {
        let filtered = [...this.transactions];

        // Filtrar por periodo
        const periodDays = parseInt(this.filters.period);
        if (periodDays !== 365) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - periodDays);
            filtered = filtered.filter(tx => new Date(tx.created_at) >= cutoffDate);
        }

        // Filtrar por tipo
        if (this.filters.type !== 'all') {
            if (this.filters.type === 'deposit') {
                filtered = filtered.filter(tx => tx.type.includes('DEPOSIT'));
            } else {
                filtered = filtered.filter(tx => tx.status === this.filters.type);
            }
        }

        // Ordenar por fecha (más reciente primero)
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        this.filteredTransactions = filtered;
        this.currentPage = 1;
        this.renderHistory();
        this.updateChart();
    }

    renderHistory() {
        this.updatePagination();
        this.renderTable();
        this.updateEmptyState();
    }

    renderTable() {
        const tbody = document.getElementById('historyTableBody');
        if (!tbody) return;

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageTransactions = this.filteredTransactions.slice(startIndex, endIndex);

        if (pageTransactions.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = pageTransactions.map(tx => this.createTableRow(tx)).join('');
    }

    createTableRow(transaction) {
        const date = new Date(transaction.created_at);
        const formattedDate = date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const typeIcon = this.getTransactionIcon(transaction.type);
        const statusBadge = this.getStatusBadge(transaction.status);
        const amountFormatted = this.formatCurrency(transaction.amount || transaction.amount_requested, transaction.currency);
        const txId = transaction.tx_id ? this.truncateId(transaction.tx_id) : 'N/A';

        return `
            <tr>
                <td>${formattedDate}</td>
                <td>
                    <div class="tx-type">
                        <i class="${typeIcon.icon}" style="color: ${typeIcon.color}; margin-right: 8px;"></i>
                        ${this.getTransactionType(transaction.type)}
                    </div>
                </td>
                <td>
                    <span class="currency-badge ${transaction.currency}">
                        ${transaction.currency.toUpperCase()}
                    </span>
                </td>
                <td>
                    <strong>${amountFormatted}</strong>
                    ${transaction.tokens_generated > 0 ? 
                        `<div class="tx-tokens">+${transaction.tokens_generated} ${transaction.currency === 'saldo' ? 'CWS' : 'CWT'}</div>` : 
                        ''}
                </td>
                <td>${statusBadge}</td>
                <td><code>${txId}</code></td>
                <td>
                    <button class="btn-small view-details" data-id="${transaction.id}">
                        <i class="fas fa-eye"></i> Detalles
                    </button>
                </td>
            </tr>
        `;
    }

    updatePagination() {
        this.totalPages = Math.ceil(this.filteredTransactions.length / this.itemsPerPage) || 1;
        
        const currentPageEl = document.getElementById('currentPage');
        const totalPagesEl = document.getElementById('totalPages');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');

        if (currentPageEl) currentPageEl.textContent = this.currentPage;
        if (totalPagesEl) totalPagesEl.textContent = this.totalPages;
        
        if (prevBtn) {
            prevBtn.disabled = this.currentPage === 1;
            prevBtn.style.opacity = this.currentPage === 1 ? '0.5' : '1';
        }
        
        if (nextBtn) {
            nextBtn.disabled = this.currentPage === this.totalPages;
            nextBtn.style.opacity = this.currentPage === this.totalPages ? '0.5' : '1';
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.renderHistory();
        }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.renderHistory();
        }
    }

    updateEmptyState() {
        const emptyState = document.getElementById('emptyHistory');
        const tableContainer = document.querySelector('.history-table-container');
        
        if (this.filteredTransactions.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (tableContainer) tableContainer.style.display = 'none';
        } else {
            if (emptyState) emptyState.classList.add('hidden');
            if (tableContainer) tableContainer.style.display = 'block';
        }
    }

    updateStats() {
        if (this.transactions.length === 0) return;

        const completedDeposits = this.transactions.filter(tx => 
            tx.type.includes('DEPOSIT') && tx.status === 'completed'
        );

        const totalDeposits = completedDeposits.length;
        const totalAmount = completedDeposits.reduce((sum, tx) => sum + (tx.amount || 0), 0);
        const totalTokens = completedDeposits.reduce((sum, tx) => sum + (tx.tokens_generated || 0), 0);
        const avgDeposit = totalDeposits > 0 ? totalAmount / totalDeposits : 0;

        document.getElementById('totalDeposits').textContent = totalDeposits;
        document.getElementById('totalDepositsAmount').textContent = this.formatCurrency(totalAmount, 'cup');
        document.getElementById('totalTokensEarned').textContent = Math.round(totalTokens);
        document.getElementById('avgDeposit').textContent = this.formatCurrency(avgDeposit, 'cup');
    }

    initChart() {
        const ctx = document.getElementById('historyChart')?.getContext('2d');
        if (!ctx) return;

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: 'var(--text-color)',
                            padding: 20
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: 'var(--text-muted)'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'var(--text-muted)',
                            callback: (value) => `$${value}`
                        }
                    }
                }
            }
        });

        this.updateChart();
    }

    updateChart() {
        if (!this.chart) return;

        const monthlyData = this.getMonthlyData();
        
        this.chart.data.labels = monthlyData.labels;
        this.chart.data.datasets = monthlyData.datasets;
        this.chart.update();
    }

    getMonthlyData() {
        const months = [];
        const currentDate = new Date();
        
        // Obtener últimos 6 meses
        for (let i = 5; i >= 0; i--) {
            const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
            months.push({
                year: date.getFullYear(),
                month: date.getMonth(),
                label: date.toLocaleDateString('es-ES', { month: 'short' })
            });
        }

        const datasets = [
            {
                label: 'CUP',
                data: [],
                backgroundColor: 'rgba(106, 17, 203, 0.7)',
                borderColor: 'rgba(106, 17, 203, 1)',
                borderWidth: 1
            },
            {
                label: 'Saldo',
                data: [],
                backgroundColor: 'rgba(0, 176, 155, 0.7)',
                borderColor: 'rgba(0, 176, 155, 1)',
                borderWidth: 1
            },
            {
                label: 'USDT',
                data: [],
                backgroundColor: 'rgba(33, 150, 243, 0.7)',
                borderColor: 'rgba(33, 150, 243, 1)',
                borderWidth: 1
            }
        ];

        // Calcular totales por mes y moneda
        months.forEach(monthData => {
            const monthTransactions = this.filteredTransactions.filter(tx => {
                const txDate = new Date(tx.created_at);
                return txDate.getFullYear() === monthData.year && 
                       txDate.getMonth() === monthData.month &&
                       tx.status === 'completed';
            });

            const totals = { cup: 0, saldo: 0, usdt: 0 };
            
            monthTransactions.forEach(tx => {
                if (totals[tx.currency] !== undefined) {
                    totals[tx.currency] += parseFloat(tx.amount || tx.amount_requested);
                }
            });

            datasets[0].data.push(totals.cup);
            datasets[1].data.push(totals.saldo);
            datasets[2].data.push(totals.usdt);
        });

        return {
            labels: months.map(m => m.label),
            datasets: datasets
        };
    }

    async exportHistory() {
        try {
            const data = {
                fecha_exportacion: new Date().toISOString(),
                total_transacciones: this.filteredTransactions.length,
                transacciones: this.filteredTransactions.map(tx => ({
                    id: tx.id,
                    fecha: tx.created_at,
                    tipo: tx.type,
                    moneda: tx.currency,
                    monto: tx.amount || tx.amount_requested,
                    bono: tx.estimated_bonus,
                    tokens: tx.tokens_generated,
                    estado: tx.status,
                    id_transaccion: tx.tx_id,
                    wallet_usdt: tx.usdt_wallet,
                    notas_admin: tx.admin_notes
                }))
            };

            // Crear y descargar archivo JSON
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `historial_cromwell_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showNotification('Historial exportado exitosamente', 'success');
        } catch (error) {
            this.showError('Error exportando historial', error.message);
        }
    }

    // Métodos de utilidad
    getTransactionIcon(type) {
        const icons = {
            'DEPOSIT': { icon: 'fas fa-arrow-down', color: 'var(--success-color)' },
            'PURCHASE': { icon: 'fas fa-shopping-cart', color: 'var(--primary-color)' },
            'AUTO_DEPOSIT': { icon: 'fas fa-bolt', color: 'var(--warning-color)' },
            'AUTO_ACCUMULATED': { icon: 'fas fa-coins', color: 'var(--info-color)' }
        };

        return icons[type] || { icon: 'fas fa-exchange-alt', color: 'var(--text-muted)' };
    }

    getTransactionType(type) {
        const types = {
            'DEPOSIT': 'Depósito',
            'PURCHASE': 'Compra',
            'AUTO_DEPOSIT': 'Depósito Automático',
            'AUTO_ACCUMULATED': 'Acumulado Automático'
        };

        return types[type] || type;
    }

    getStatusBadge(status) {
        const badges = {
            'completed': '<span class="status-badge completed">Completado</span>',
            'pending': '<span class="status-badge pending">Pendiente</span>',
            'rejected': '<span class="status-badge failed">Rechazado</span>',
            'verifying': '<span class="status-badge pending">Verificando</span>'
        };

        return badges[status] || `<span class="status-badge">${status}</span>`;
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

    truncateId(id, start = 8, end = 4) {
        if (!id || id === 'N/A' || id.length <= start + end) return id;
        return `${id.substring(0, start)}...${id.substring(id.length - end)}`;
    }

    showNotification(message, type = 'info') {
        window.showNotification?.(message, type);
    }

    showError(title, message) {
        this.showNotification(`${title}: ${message}`, 'error');
    }
}

// Inicializar cuando se cargue la página de historial
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('history-page')) {
        window.historyManager = new HistoryManager();
        
        // Event listener para botones de detalles
        document.addEventListener('click', (e) => {
            if (e.target.closest('.view-details')) {
                const txId = e.target.closest('.view-details').getAttribute('data-id');
                window.historyManager?.showTransactionDetails(txId);
            }
        });
    }
});
