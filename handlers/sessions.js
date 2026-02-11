const activeSessions = {};

function setSession(chatId, sessionData) {
    activeSessions[chatId] = {
        ...sessionData,
        lastActivity: Date.now()
    };
}

function getSession(chatId) {
    return activeSessions[chatId];
}

function clearSession(chatId) {
    delete activeSessions[chatId];
}

function cleanupOldSessions() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000;
    
    for (const [chatId, session] of Object.entries(activeSessions)) {
        if (session.lastActivity && (now - session.lastActivity) > timeout) {
            delete activeSessions[chatId];
            console.log(`🧹 Sesión limpiada para ${chatId}`);
        }
    }
}

module.exports = {
    setSession,
    getSession,
    clearSession,
    cleanupOldSessions
};
