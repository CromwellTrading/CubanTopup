// Configuración
const API_BASE_URL = window.location.origin;
const SESSION_CHECK_INTERVAL = 30000; // 30 segundos

// Elementos del DOM
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const identifierInput = document.getElementById('identifier');
const passwordInput = document.getElementById('password');
const regIdentifierInput = document.getElementById('regIdentifier');
const regPasswordInput = document.getElementById('regPassword');
const regConfirmPasswordInput = document.getElementById('regConfirmPassword');
const termsLink = document.getElementById('termsLink');
const termsModal = document.getElementById('termsModal');
const notification = document.getElementById('notification');
const notificationText = document.getElementById('notificationText');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Variables globales
let currentSession = null;
let sessionCheckInterval = null;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    checkExistingSession();
    loadTermsAndConditions();
});

// Inicializar event listeners
function initEventListeners() {
    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Formulario de login
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Formulario de registro
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    // Mostrar/ocultar contraseñas
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function() {
            const input = this.parentElement.querySelector('input');
            const icon = this.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fas fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fas fa-eye';
            }
        });
    });
    
    // Validación de fortaleza de contraseña
    if (regPasswordInput) {
        regPasswordInput.addEventListener('input', validatePasswordStrength);
    }
    
    // Términos y condiciones
    if (termsLink) {
        termsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showTermsModal();
        });
    }
    
    // Cerrar modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('active');
            });
        });
    });
    
    // Cerrar modal al hacer clic fuera
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

// Cambiar tab
function switchTab(tabId) {
    // Actualizar tabs activos
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    
    // Mostrar contenido activo
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
    });
}

// Verificar sesión existente
async function checkExistingSession() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.authenticated) {
            // Redirigir al dashboard
            window.location.href = '/dashboard';
        }
    } catch (error) {
        console.error('Error verificando sesión:', error);
    }
}

// Manejar login
async function handleLogin(e) {
    e.preventDefault();
    
    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;
    
    if (!identifier || !password) {
        showNotification('Por favor, completa todos los campos', 'error');
        return;
    }
    
    const loginBtn = document.getElementById('loginBtn');
    const spinner = document.getElementById('loginSpinner');
    
    // Mostrar estado de carga
    loginBtn.disabled = true;
    spinner.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ identifier, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (data.needsRegistration) {
                // Necesita registro
                showNotification('Debes registrar una contraseña primero', 'info');
                regIdentifierInput.value = identifier;
                switchTab('register');
            } else {
                // Login exitoso
                showNotification('¡Inicio de sesión exitoso!', 'success');
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 1000);
            }
        } else {
            showNotification(data.error || 'Error en el inicio de sesión', 'error');
        }
    } catch (error) {
        console.error('Error en login:', error);
        showNotification('Error de conexión. Intenta de nuevo.', 'error');
    } finally {
        // Restaurar estado del botón
        loginBtn.disabled = false;
        spinner.classList.add('hidden');
    }
}

// Manejar registro
async function handleRegister(e) {
    e.preventDefault();
    
    const identifier = regIdentifierInput.value.trim();
    const password = regPasswordInput.value;
    const confirmPassword = regConfirmPasswordInput.value;
    const acceptTerms = document.getElementById('acceptTerms').checked;
    
    // Validaciones
    if (!identifier || !password || !confirmPassword) {
        showNotification('Por favor, completa todos los campos', 'error');
        return;
    }
    
    if (password.length < 8) {
        showNotification('La contraseña debe tener al menos 8 caracteres', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showNotification('Las contraseñas no coinciden', 'error');
        return;
    }
    
    if (!acceptTerms) {
        showNotification('Debes aceptar los términos y condiciones', 'error');
        return;
    }
    
    const registerBtn = document.getElementById('registerBtn');
    const spinner = document.getElementById('registerSpinner');
    
    // Mostrar estado de carga
    registerBtn.disabled = true;
    spinner.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/register-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier, password, confirmPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('¡Contraseña registrada exitosamente! Ahora puedes iniciar sesión.', 'success');
            setTimeout(() => {
                // Limpiar formulario y volver al login
                registerForm.reset();
                switchTab('login');
                identifierInput.value = identifier;
                passwordInput.focus();
            }, 2000);
        } else {
            showNotification(data.error || 'Error en el registro', 'error');
        }
    } catch (error) {
        console.error('Error en registro:', error);
        showNotification('Error de conexión. Intenta de nuevo.', 'error');
    } finally {
        // Restaurar estado del botón
        registerBtn.disabled = false;
        spinner.classList.add('hidden');
    }
}

// Validar fortaleza de contraseña
function validatePasswordStrength() {
    const password = regPasswordInput.value;
    const strengthBar = document.querySelector('.strength-bar');
    const strengthText = document.querySelector('.strength-text');
    
    let strength = 0;
    let messages = [];
    
    // Longitud
    if (password.length >= 8) strength += 20;
    if (password.length >= 12) strength += 20;
    
    // Complejidad
    if (/[A-Z]/.test(password)) strength += 20;
    if (/[a-z]/.test(password)) strength += 20;
    if (/[0-9]/.test(password)) strength += 20;
    if (/[^A-Za-z0-9]/.test(password)) strength += 20;
    
    // Limitar a 100%
    strength = Math.min(strength, 100);
    
    // Actualizar barra
    strengthBar.style.width = `${strength}%`;
    
    // Actualizar texto y color
    if (strength < 40) {
        strengthBar.style.background = 'var(--danger-color)';
        strengthText.textContent = 'Seguridad: Débil';
        strengthText.style.color = 'var(--danger-color)';
    } else if (strength < 70) {
        strengthBar.style.background = 'var(--warning-color)';
        strengthText.textContent = 'Seguridad: Media';
        strengthText.style.color = 'var(--warning-color)';
    } else {
        strengthBar.style.background = 'var(--success-color)';
        strengthText.textContent = 'Seguridad: Fuerte';
        strengthText.style.color = 'var(--success-color)';
    }
}

// Mostrar términos y condiciones
function showTermsModal() {
    termsModal.classList.add('active');
}

// Cargar términos y condiciones
async function loadTermsAndConditions() {
    const termsContent = document.querySelector('#termsModal .modal-body');
    
    if (!termsContent) return;
    
    // Términos estáticos (en producción podrían venir de una API)
    const terms = `
        <h3>Términos y Condiciones de Cromwell Store</h3>
        
        <p><strong>Última actualización:</strong> ${new Date().toLocaleDateString()}</p>
        
        <h4>1. Aceptación de Términos</h4>
        <p>Al acceder y utilizar los servicios de Cromwell Store, aceptas cumplir con estos términos y condiciones. Si no estás de acuerdo con alguna parte de estos términos, no utilices nuestros servicios.</p>
        
        <h4>2. Definiciones</h4>
        <ul>
            <li><strong>Wallet:</strong> Billetera digital multipropósito de Cromwell Store</li>
            <li><strong>CUP:</strong> Pesos Cubanos (moneda nacional)</li>
            <li><strong>Saldo Móvil:</strong> Saldo de telefonía móvil</li>
            <li><strong>USDT:</strong> Tether (criptomoneda estable)</li>
            <li><strong>CWS:</strong> Cromwell Wallet Saldo (tokens por saldo móvil)</li>
            <li><strong>CWT:</strong> Cromwell Wallet Tether (tokens por USDT)</li>
            <li><strong>Depósito:</strong> Transferencia de fondos a tu wallet</li>
        </ul>
        
        <h4>3. Propósito del Servicio</h4>
        <p>La wallet Cromwell Store es exclusivamente para realizar pagos y compras dentro de la plataforma Cromwell Store. Los fondos depositados no son retirables en efectivo. Los bonos y tokens son utilizables únicamente para compras dentro de la plataforma.</p>
        
        <h4>4. Requisitos de Depósito</h4>
        <ul>
            <li><strong>CUP:</strong> Mínimo $1,000.00 - Máximo $50,000.00</li>
            <li><strong>Saldo Móvil:</strong> Mínimo $500.00 - Máximo $10,000.00</li>
            <li><strong>USDT:</strong> Mínimo 10.00 - Máximo 1,000.00</li>
        </ul>
        
        <h4>5. Bonos y Tokens</h4>
        <ul>
            <li><strong>Bono primer depósito CUP:</strong> 10% adicional</li>
            <li><strong>Bono primer depósito Saldo Móvil:</strong> 10% adicional + tokens CWS</li>
            <li><strong>Bono primer depósito USDT:</strong> 5% adicional + tokens CWT</li>
            <li><strong>CWS:</strong> 10 tokens por cada $100 de saldo móvil</li>
            <li><strong>CWT:</strong> 0.5 tokens por cada 10 USDT</li>
            <li><strong>Mínimo uso CWS:</strong> 100 tokens</li>
            <li><strong>Mínimo uso CWT:</strong> 5 tokens</li>
        </ul>
        
        <h4>6. Seguridad y Responsabilidades</h4>
        <ul>
            <li>Debes vincular tu número de teléfono para depósitos automáticos</li>
            <li>Activa "Mostrar número al destinatario" en Transfermóvil</li>
            <li>Toma capturas de pantalla de todas las transacciones</li>
            <li>ETECSA puede fallar en el envío de SMS de confirmación</li>
            <li>Tus capturas son tu respaldo en caso de problemas</li>
            <li>No compartas tus credenciales de acceso</li>
        </ul>
        
        <h4>7. Política de Reembolsos</h4>
        <p>Si realizas un depósito y no se acredita en tu wallet:</p>
        <ol>
            <li>Contacta al soporte dentro de las 24 horas</li>
            <li>Proporciona captura de pantalla válida del pago</li>
            <li>Incluye tu ID de Telegram y número de teléfono</li>
            <li>El caso se resolverá en un máximo de 48 horas</li>
        </ol>
        
        <h4>8. Prohibiciones</h4>
        <ul>
            <li>Uso fraudulento o creación de múltiples cuentas</li>
            <li>Actividades ilegales o lavado de dinero</li>
            <li>Spam o abuso del sistema</li>
            <li>Uso de VPNs o proxies para evadir restricciones</li>
        </ul>
        
        <h4>9. Modificaciones</h4>
        <p>Nos reservamos el derecho de modificar estos términos. Los cambios serán notificados con 72 horas de anticipación a través del bot de Telegram y la web.</p>
        
        <h4>10. Contacto</h4>
        <p><strong>Soporte:</strong> @cromwell_support en Telegram</p>
        <p><strong>Bot:</strong> @cromwell_store_bot</p>
        <p><strong>Web:</strong> ${window.location.hostname}</p>
        
        <div class="terms-signature">
            <p><strong>Al aceptar estos términos, confirmas que:</strong></p>
            <ul>
                <li>Has leído y comprendido todos los puntos</li>
                <li>Aceptas el propósito no retirable de los fondos</li>
                <li>Entiendes la política de bonos y tokens</li>
                <li>Conoces y aceptas los mínimos de depósito</li>
                <li>Aceptas tu responsabilidad de guardar comprobantes</li>
            </ul>
        </div>
    `;
    
    termsContent.innerHTML = terms;
}

// Mostrar notificación
function showNotification(message, type = 'info') {
    notificationText.textContent = message;
    notification.className = 'notification';
    
    switch (type) {
        case 'success':
            notification.classList.add('success');
            notification.querySelector('i').className = 'fas fa-check-circle';
            break;
        case 'error':
            notification.classList.add('error');
            notification.querySelector('i').className = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            notification.classList.add('warning');
            notification.querySelector('i').className = 'fas fa-exclamation-triangle';
            break;
        default:
            notification.querySelector('i').className = 'fas fa-info-circle';
    }
    
    notification.classList.add('show');
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}

// Verificar conexión a internet
function checkInternetConnection() {
    return navigator.onLine;
}

// Sistema de notificaciones push
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Permiso para notificaciones concedido');
            }
        });
    }
}

// Mostrar notificación push
function showPushNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: '/assets/icon-192.png'
        });
    }
}

// Inicializar notificaciones push
if ('serviceWorker' in navigator && 'PushManager' in window) {
    navigator.serviceWorker.register('/sw.js')
        .then(registration => {
            console.log('ServiceWorker registrado:', registration);
        })
        .catch(error => {
            console.error('Error registrando ServiceWorker:', error);
        });
}

// Manejar errores de fetch
function handleFetchError(error) {
    if (!checkInternetConnection()) {
        showNotification('Sin conexión a internet. Verifica tu conexión.', 'error');
    } else {
        showNotification('Error de servidor. Intenta de nuevo.', 'error');
    }
    console.error('Fetch error:', error);
}

// Formatear moneda
function formatCurrency(amount, currency = 'CUP') {
    const formatter = new Intl.NumberFormat('es-CU', {
        style: 'currency',
        currency: 'CUP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    
    if (currency === 'USDT') {
        return `${parseFloat(amount).toFixed(2)} USDT`;
    } else if (currency === 'SALDO') {
        return `$${parseFloat(amount).toFixed(2)} Saldo`;
    }
    
    return formatter.format(amount);
}

// Generar ID aleatorio
function generateRandomId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Exportar funciones globales
window.CromwellAuth = {
    showNotification,
    formatCurrency,
    generateRandomId,
    checkInternetConnection
};
