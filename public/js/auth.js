// Configuration
const API_BASE_URL = window.location.origin;
const SESSION_CHECK_INTERVAL = 30000; // 30 seconds

// DOM elements
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

// Global variables
let currentSession = null;
let sessionCheckInterval = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    checkExistingSession();
    loadTermsAndConditions();
});

// Initialize event listeners
function initEventListeners() {
    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Login form
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Register form
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    // Show/hide passwords
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
    
    // Password strength validation
    if (regPasswordInput) {
        regPasswordInput.addEventListener('input', validatePasswordStrength);
    }
    
    // Terms and conditions
    if (termsLink) {
        termsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showTermsModal();
        });
    }
    
    // Close modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('active');
            });
        });
    });
    
    // Close modal when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

// Switch tab
function switchTab(tabId) {
    // Update active tabs
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    
    // Show active content
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
    });
}

// Check existing session
async function checkExistingSession() {
    try {
        console.log('🔍 Checking existing session...');
        
        const response = await fetch('/api/check-session', {
            credentials: 'include',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (!response.ok) {
            console.log('❌ Session not valid or error in response:', response.status);
            return;
        }
        
        const data = await response.json();
        console.log('🔍 check-session response:', data);
        
        if (data.authenticated) {
            console.log('✅ Valid session found, redirecting to dashboard...');
            
            // Verify session is really working by getting user data
            const userDataResponse = await fetch('/api/user-data', {
                credentials: 'include'
            });
            
            if (userDataResponse.ok) {
                console.log('✅ Session confirmed, redirecting...');
                // Small delay to ensure session is established
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 100);
            } else {
                console.log('❌ Could not get user data, session might be invalid');
                // Clear any invalid session
                await fetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
            }
        } else {
            console.log('❌ No active session found');
        }
    } catch (error) {
        console.error('Error checking session:', error);
    }
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;
    
    if (!identifier || !password) {
        showNotification('Please complete all fields', 'error');
        return;
    }
    
    const loginBtn = document.getElementById('loginBtn');
    const spinner = document.getElementById('loginSpinner');
    
    // Show loading state
    loginBtn.disabled = true;
    spinner.classList.remove('hidden');
    
    try {
        console.log('🔐 Attempting login with identifier:', identifier);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ identifier, password })
        });
        
        console.log('🔐 Login response status:', response.status);
        
        const data = await response.json();
        console.log('🔐 Login response data:', data);
        
        if (response.ok) {
            if (data.needsRegistration) {
                // Needs registration
                showNotification('You must register a password first', 'info');
                regIdentifierInput.value = identifier;
                switchTab('register');
            } else if (data.success) {
                // Successful login
                showNotification('Login successful! Redirecting...', 'success');
                
                console.log('✅ Login successful, verifying session...');
                
                // Wait a moment for session to establish
                setTimeout(async () => {
                    try {
                        // Verify session is working
                        const sessionCheck = await fetch('/api/check-session', {
                            credentials: 'include',
                            headers: {
                                'Cache-Control': 'no-cache'
                            }
                        });
                        
                        const sessionData = await sessionCheck.json();
                        console.log('🔍 Session check after login:', sessionData);
                        
                        if (sessionData.authenticated) {
                            console.log('✅ Session confirmed, redirecting to dashboard');
                            window.location.href = '/dashboard';
                        } else {
                            console.error('❌ Session not confirmed after login');
                            showNotification('Session error. Please try again.', 'error');
                        }
                    } catch (sessionError) {
                        console.error('Error verifying session:', sessionError);
                        // Try to redirect anyway
                        window.location.href = '/dashboard';
                    }
                }, 1000);
            } else {
                showNotification(data.error || 'Login error', 'error');
            }
        } else {
            showNotification(data.error || 'Login error', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('Connection error. Please try again.', 'error');
    } finally {
        // Restore button state
        loginBtn.disabled = false;
        spinner.classList.add('hidden');
    }
}

// Handle registration
async function handleRegister(e) {
    e.preventDefault();
    
    const identifier = regIdentifierInput.value.trim();
    const password = regPasswordInput.value;
    const confirmPassword = regConfirmPasswordInput.value;
    const acceptTerms = document.getElementById('acceptTerms').checked;
    
    // Validations
    if (!identifier || !password || !confirmPassword) {
        showNotification('Please complete all fields', 'error');
        return;
    }
    
    if (password.length < 8) {
        showNotification('Password must be at least 8 characters', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showNotification('Passwords do not match', 'error');
        return;
    }
    
    if (!acceptTerms) {
        showNotification('You must accept the terms and conditions', 'error');
        return;
    }
    
    const registerBtn = document.getElementById('registerBtn');
    const spinner = document.getElementById('registerSpinner');
    
    // Show loading state
    registerBtn.disabled = true;
    spinner.classList.remove('hidden');
    
    try {
        console.log('📝 Attempting registration for identifier:', identifier);
        
        const response = await fetch('/api/register-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier, password, confirmPassword })
        });
        
        console.log('📝 Registration response status:', response.status);
        
        const data = await response.json();
        console.log('📝 Registration response data:', data);
        
        if (response.ok) {
            showNotification('Password registered successfully! You can now log in.', 'success');
            
            // Clear form and switch to login tab
            setTimeout(() => {
                registerForm.reset();
                switchTab('login');
                identifierInput.value = identifier;
                passwordInput.value = '';
                passwordInput.focus();
            }, 2000);
        } else {
            showNotification(data.error || 'Registration error', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showNotification('Connection error. Please try again.', 'error');
    } finally {
        // Restore button state
        registerBtn.disabled = false;
        spinner.classList.add('hidden');
    }
}

// Validate password strength
function validatePasswordStrength() {
    const password = regPasswordInput.value;
    const strengthBar = document.querySelector('.strength-bar');
    const strengthText = document.querySelector('.strength-text');
    
    let strength = 0;
    
    // Length
    if (password.length >= 8) strength += 20;
    if (password.length >= 12) strength += 20;
    
    // Complexity
    if (/[A-Z]/.test(password)) strength += 20;
    if (/[a-z]/.test(password)) strength += 20;
    if (/[0-9]/.test(password)) strength += 20;
    if (/[^A-Za-z0-9]/.test(password)) strength += 20;
    
    // Limit to 100%
    strength = Math.min(strength, 100);
    
    // Update bar
    strengthBar.style.width = `${strength}%`;
    
    // Update text and color
    if (strength < 40) {
        strengthBar.style.background = 'var(--danger-color)';
        strengthText.textContent = 'Security: Weak';
        strengthText.style.color = 'var(--danger-color)';
    } else if (strength < 70) {
        strengthBar.style.background = 'var(--warning-color)';
        strengthText.textContent = 'Security: Medium';
        strengthText.style.color = 'var(--warning-color)';
    } else {
        strengthBar.style.background = 'var(--success-color)';
        strengthText.textContent = 'Security: Strong';
        strengthText.style.color = 'var(--success-color)';
    }
}

// Show terms and conditions modal
function showTermsModal() {
    termsModal.classList.add('active');
}

// Load terms and conditions
async function loadTermsAndConditions() {
    const termsContent = document.querySelector('#termsModal .modal-body');
    
    if (!termsContent) return;
    
    // Static terms (in production could come from an API)
    const terms = `
        <h3>Cromwell Store Terms and Conditions</h3>
        
        <p><strong>Last update:</strong> ${new Date().toLocaleDateString()}</p>
        
        <h4>1. Acceptance of Terms</h4>
        <p>By accessing and using Cromwell Store services, you agree to comply with these terms and conditions. If you do not agree with any part of these terms, do not use our services.</p>
        
        <h4>2. Definitions</h4>
        <ul>
            <li><strong>Wallet:</strong> Multipurpose digital wallet of Cromwell Store</li>
            <li><strong>CUP:</strong> Cuban Pesos (national currency)</li>
            <li><strong>Mobile Balance:</strong> Mobile phone balance</li>
            <li><strong>USDT:</strong> Tether (stable cryptocurrency)</li>
            <li><strong>CWS:</strong> Cromwell Wallet Saldo (tokens for mobile balance)</li>
            <li><strong>CWT:</strong> Cromwell Wallet Tether (tokens for USDT)</li>
            <li><strong>Deposit:</strong> Transfer of funds to your wallet</li>
        </ul>
        
        <h4>3. Service Purpose</h4>
        <p>The Cromwell Store wallet is exclusively for making payments and purchases within the Cromwell Store platform. Deposited funds are not withdrawable in cash. Bonuses and tokens are usable only for purchases within the platform.</p>
        
        <h4>4. Deposit Requirements</h4>
        <ul>
            <li><strong>CUP:</strong> Minimum $1,000.00 - Maximum $50,000.00</li>
            <li><strong>Mobile Balance:</strong> Minimum $500.00 - Maximum $10,000.00</li>
            <li><strong>USDT:</strong> Minimum 10.00 - Maximum 1,000.00</li>
        </ul>
        
        <h4>5. Bonuses and Tokens</h4>
        <ul>
            <li><strong>First deposit bonus CUP:</strong> 10% additional</li>
            <li><strong>First deposit bonus Mobile Balance:</strong> 10% additional + CWS tokens</li>
            <li><strong>First deposit bonus USDT:</strong> 5% additional + CWT tokens</li>
            <li><strong>CWS:</strong> 10 tokens per each $100 of mobile balance</li>
            <li><strong>CWT:</strong> 0.5 tokens per each 10 USDT</li>
            <li><strong>Minimum to use CWS:</strong> 100 tokens</li>
            <li><strong>Minimum to use CWT:</strong> 5 tokens</li>
        </ul>
        
        <h4>6. Security and Responsibilities</h4>
        <ul>
            <li>You must link your phone number for automatic deposits</li>
            <li>Activate "Show number to recipient" in Transfermóvil</li>
            <li>Take screenshots of all transactions</li>
            <li>ETECSA may fail to send SMS confirmation</li>
            <li>Your screenshots are your backup in case of problems</li>
            <li>Do not share your access credentials</li>
        </ul>
        
        <h4>7. Refund Policy</h4>
        <p>If you make a deposit and it is not credited to your wallet:</p>
        <ol>
            <li>Contact support within 24 hours</li>
            <li>Provide valid screenshot of the payment</li>
            <li>Include your Telegram ID and phone number</li>
            <li>The case will be resolved within 48 hours maximum</li>
        </ol>
        
        <h4>8. Prohibitions</h4>
        <ul>
            <li>Fraudulent use or creation of multiple accounts</li>
            <li>Illegal activities or money laundering</li>
            <li>Spam or system abuse</li>
            <li>Use of VPNs or proxies to evade restrictions</li>
        </ul>
        
        <h4>9. Modifications</h4>
        <p>We reserve the right to modify these terms. Changes will be notified 72 hours in advance through the Telegram bot and the web.</p>
        
        <h4>10. Contact</h4>
        <p><strong>Support:</strong> @cromwell_support on Telegram</p>
        <p><strong>Bot:</strong> @cromwell_store_bot</p>
        <p><strong>Web:</strong> ${window.location.hostname}</p>
        
        <div class="terms-signature">
            <p><strong>By accepting these terms, you confirm that:</strong></p>
            <ul>
                <li>You have read and understood all points</li>
                <li>You accept the non-withdrawable purpose of funds</li>
                <li>You understand the bonus and token policy</li>
                <li>You know and accept the deposit minimums</li>
                <li>You accept your responsibility to save receipts</li>
            </ul>
        </div>
    `;
    
    termsContent.innerHTML = terms;
}

// Show notification
function showNotification(message, type = 'info') {
    notificationText.textContent = message;
    notification.className = 'notification';
    
    // Remove previous timeout if exists
    if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
    }
    
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
    
    // Auto-hide after 5 seconds
    notification.timeoutId = setTimeout(() => {
        notification.classList.remove('show');
        notification.timeoutId = null;
    }, 5000);
}

// Check internet connection
function checkInternetConnection() {
    return navigator.onLine;
}

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Permission for notifications granted');
            }
        });
    }
}

// Show push notification
function showPushNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: '/assets/icon-192.png'
        });
    }
}

// Initialize push notifications
if ('serviceWorker' in navigator && 'PushManager' in window) {
    navigator.serviceWorker.register('/sw.js')
        .then(registration => {
            console.log('ServiceWorker registered:', registration);
        })
        .catch(error => {
            console.error('Error registering ServiceWorker:', error);
        });
}

// Handle fetch errors
function handleFetchError(error) {
    if (!checkInternetConnection()) {
        showNotification('No internet connection. Check your connection.', 'error');
    } else {
        showNotification('Server error. Please try again.', 'error');
    }
    console.error('Fetch error:', error);
}

// Format currency
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
        return `$${parseFloat(amount).toFixed(2)} Balance`;
    }
    
    return formatter.format(amount);
}

// Generate random ID
function generateRandomId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Start session checker
function startSessionChecker() {
    // Check session periodically
    sessionCheckInterval = setInterval(() => {
        checkExistingSession();
    }, SESSION_CHECK_INTERVAL);
}

// Stop session checker
function stopSessionChecker() {
    if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
        sessionCheckInterval = null;
    }
}

// Debug function to view cookies
function debugCookies() {
    console.log('🍪 Current cookies:', document.cookie);
}

// Initialize session checker when on login page
if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    startSessionChecker();
}

// Export global functions
window.CromwellAuth = {
    showNotification,
    formatCurrency,
    generateRandomId,
    checkInternetConnection,
    debugCookies,
    checkExistingSession
};

// Add global error handler
window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
    showNotification('An unexpected error occurred. Please refresh the page.', 'error');
});

// Add offline/online handlers
window.addEventListener('offline', () => {
    showNotification('You are offline. Some features may not work.', 'warning');
});

window.addEventListener('online', () => {
    showNotification('You are back online.', 'success');
    // Recheck session when coming back online
    checkExistingSession();
});
