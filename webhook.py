from flask import Flask, request, jsonify
import re
import json
import requests
import os
from datetime import datetime
import unicodedata

app = Flask(__name__)

# ==========================================
# CONFIGURACIÓN DESDE VARIABLES DE ENTORNO
# ==========================================

# Mapeo token -> tarjeta (para Transfermóvil)
TOKEN_TARJETA_MAP_JSON = os.getenv("TOKEN_TARJETA_MAP", "{}")
try:
    TOKEN_TARJETA_MAP = json.loads(TOKEN_TARJETA_MAP_JSON)
except json.JSONDecodeError:
    print("❌ Error al parsear TOKEN_TARJETA_MAP. Usando vacío.")
    TOKEN_TARJETA_MAP = {}

# Mapeo tarjeta -> webhook destino (para Transfermóvil)
TARJETAS_WEBHOOKS_JSON = os.getenv("TARJETAS_WEBHOOKS", "{}")
try:
    TARJETAS_WEBHOOKS = json.loads(TARJETAS_WEBHOOKS_JSON)
except json.JSONDecodeError:
    print("❌ Error al parsear TARJETAS_WEBHOOKS. Usando vacío.")
    TARJETAS_WEBHOOKS = {}

# Mapeo token -> webhook destino (para Cubacel)
TOKEN_WEBHOOK_MAP_JSON = os.getenv("TOKEN_WEBHOOK_MAP", "{}")
try:
    TOKEN_WEBHOOK_MAP = json.loads(TOKEN_WEBHOOK_MAP_JSON)
except json.JSONDecodeError:
    print("❌ Error al parsear TOKEN_WEBHOOK_MAP. Usando vacío.")
    TOKEN_WEBHOOK_MAP = {}

# ==========================================
# FUNCIONES AUXILIARES COMUNES
# ==========================================

def remove_accents(text):
    """Elimina tildes y caracteres especiales del texto"""
    text = unicodedata.normalize('NFD', text)
    text = text.encode('ascii', 'ignore').decode('utf-8')
    return text

def send_to_webhook(payload, webhook_url, secret_key):
    """Envía datos al webhook con autenticación (X-Auth-Token)"""
    if not webhook_url:
        print("❌ No hay webhook configurado")
        return False
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Auth-Token": secret_key
        }
        # Añadir metadatos de timestamp y origen
        payload["_metadata"] = {
            "timestamp": datetime.now().isoformat(),
            "source": "sms_parser_unified"
        }
        print(f"📤 Enviando a webhook: {webhook_url}")
        response = requests.post(webhook_url, json=payload, headers=headers, timeout=15)
        print(f"✅ Respuesta: {response.status_code}")
        if response.status_code != 200:
            print(f"⚠️ Contenido: {response.text}")
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Error enviando: {e}")
        return False

# ==========================================
# PARSEO DE TRANSFERMÓVIL (PAGOxMOVIL)
# ==========================================

def extraer_tipo_pago_y_datos(mensaje):
    """Analiza el mensaje de Transfermóvil y extrae los datos del pago"""
    mensaje_sin_tildes = remove_accents(mensaje)
    mensaje_upper = mensaje_sin_tildes.upper()

    # 1. Tarjeta a Tarjeta (pago identificado)
    if "EL TITULAR DEL TELEFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None

        cuenta_match = re.search(r'A LA CUENTA\s+([\dX]+)', mensaje_sin_tildes, re.IGNORECASE)
        cuenta_destino = cuenta_match.group(1) if cuenta_match else None

        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0

        id_match = re.search(r'(?:NRO\.?\s*TRANSACCION|TRANSACCION)[:\s]+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(datetime.now().timestamp())}"

        return {
            "tipo": "TARJETA_TARJETA",
            "tarjeta_destino": cuenta_destino,
            "telefono_origen": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "CUP"
        }

    # 2. Monedero a Tarjeta (cuenta enmascarada)
    elif "EL TITULAR DEL TELEFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper and "XXXX" in mensaje_upper:
        tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None

        # Buscar los últimos 4 dígitos de la cuenta destino
        ultimos_4_match = re.search(r'(\d{4})\s*\.', mensaje_sin_tildes)
        ultimos_4 = ultimos_4_match.group(1) if ultimos_4_match else None

        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0

        id_match = re.search(r'(?:NRO\.?\s*TRANSACCION|TRANSACCION)[:\s]+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(datetime.now().timestamp())}"

        return {
            "tipo": "MONEDERO_TARJETA",
            "tarjeta_destino_mask": ultimos_4,
            "telefono_origen": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "CUP"
        }

    # 3. Tarjeta a Monedero
    elif "MONEDERO MITRANSFER" in mensaje_upper:
        monto_match = re.search(r'(?:RECARGADO CON|CON:|DE)\s*(\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0

        id_match = re.search(r'(?:TRANSACCION|ID TRANSACCION|NRO\.?\s*TRANSACCION)[:\s]+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(datetime.now().timestamp())}"

        return {
            "tipo": "TARJETA_MONEDERO",
            "monto": monto,
            "trans_id": trans_id,
            "currency": "SALDO"
        }

    # 4. Monedero a Monedero
    elif "EL TITULAR DEL TELEFONO" in mensaje_upper and "AL MONEDERO MITRANSFER" in mensaje_upper:
        tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None

        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0

        id_match = re.search(r'(?:NRO\.?\s*TRANSACCION|TRANSACCION)[:\s]+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(datetime.now().timestamp())}"

        return {
            "tipo": "MONEDERO_MONEDERO",
            "telefono_origen": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "SALDO"
        }

    # Si no coincide con ningún patrón conocido
    return None

# ==========================================
# PARSEO DE CUBACEL (solo recepciones)
# ==========================================

def parse_cubacel_recibido(mensaje):
    """Extrae monto y remitente de un SMS de Cubacel de tipo 'Usted ha recibido'"""
    mensaje_sin_tildes = remove_accents(mensaje)
    # Patrón: "Usted ha recibido <monto> CUP del numero <remitente>."
    patron = r'Usted ha recibido\s+([\d\.]+)\s*CUP\s+del\s+numero\s+(\d+)'
    match = re.search(patron, mensaje_sin_tildes, re.IGNORECASE)
    if match:
        monto = float(match.group(1))
        remitente = match.group(2)
        return {"monto": monto, "remitente": remitente}
    return None

# ==========================================
# RUTA PRINCIPAL
# ==========================================

@app.route('/webhook/<token>', methods=['POST'])
def gateway(token):
    try:
        data = request.get_json()
        print(f"\n{'='*60}")
        print(f"📱 NUEVO SMS RECIBIDO - {datetime.now().strftime('%H:%M:%S')}")
        print(f"🔑 Token usado: {token}")
        print("📦 JSON recibido:")
        print(json.dumps(data, indent=2, ensure_ascii=False))

        # Extraer campos según la estructura que envía Deku
        remitente = data.get("address") or data.get("dirección") or ""
        mensaje = data.get("body") or data.get("text") or ""
        print(f"📞 Remitente original: {remitente}")
        print(f"📨 Texto completo: {mensaje}")

        # --- FILTRO POR REMITENTE: solo PAGOxMOVIL y Cubacel ---
        if remitente not in ["PAGOxMOVIL", "Cubacel"]:
            print("ℹ️ Remitente no reconocido, mensaje ignorado.")
            return "OK", 200

        # --- VARIABLES QUE SE LLENARÁN SEGÚN EL CASO ---
        webhook_url = None
        secret_key = None
        payload = None

        # --- CASO TRANSFERMÓVIL ---
        if remitente == "PAGOxMOVIL":
            # Obtener la tarjeta asociada al token
            tarjeta = TOKEN_TARJETA_MAP.get(token)
            if not tarjeta:
                print(f"❌ Token {token} no está mapeado a ninguna tarjeta.")
                return "OK", 200

            # Obtener configuración de webhook para esa tarjeta
            config = TARJETAS_WEBHOOKS.get(tarjeta)
            if not config:
                print(f"❌ Tarjeta {tarjeta} no tiene webhook configurado.")
                return "OK", 200

            webhook_url = config.get("webhook")
            secret_key = config.get("secret")

            # Parsear mensaje de Transfermóvil
            datos_pago = extraer_tipo_pago_y_datos(mensaje)
            if not datos_pago:
                print("ℹ️ No se pudo extraer información de pago.")
                return "OK", 200

            # Construir payload específico para Transfermóvil
            payload = {
                "type": "TRANSFERMOVIL_PAGO",
                "source": "PAGOxMOVIL",
                "data": datos_pago,
                "token_used": token,
                "card_number": tarjeta
            }
            print(f"✅ Pago Transfermóvil detectado: {datos_pago}")

        # --- CASO CUBACEL ---
        elif remitente == "Cubacel":
            # Obtener configuración directa del token
            config = TOKEN_WEBHOOK_MAP.get(token)
            if not config:
                print(f"❌ Token {token} no está mapeado a ningún webhook para Cubacel.")
                return "OK", 200

            webhook_url = config.get("webhook")
            secret_key = config.get("secret")

            # Parsear mensaje de Cubacel (solo recepciones)
            datos_recibido = parse_cubacel_recibido(mensaje)
            if not datos_recibido:
                print("ℹ️ No es un mensaje de recepción de saldo (probablemente es transferencia enviada o no reconocido).")
                return "OK", 200

            # Construir payload específico para Cubacel
            payload = {
                "type": "CUBACEL_SALDO_RECIBIDO",
                "source": "Cubacel",
                "data": {
                    "monto": datos_recibido["monto"],
                    "remitente": datos_recibido["remitente"],
                    "currency": "CUP"
                },
                "token_used": token
            }
            print(f"✅ Recepción de saldo detectada: {datos_recibido}")

        # --- SI TODO OK, ENVIAR AL WEBHOOK DESTINO ---
        if payload and webhook_url and secret_key:
            success = send_to_webhook(payload, webhook_url, secret_key)
            if success:
                print("✅ Enviado correctamente")
            else:
                print("❌ Falló el envío")
        else:
            print("⚠️ No se pudo completar el envío (faltan datos).")

        print(f"{'='*60}\n")
        return "OK", 200

    except Exception as e:
        print(f"❌ Error crítico: {e}")
        import traceback
        traceback.print_exc()
        return "ERROR", 500

# ==========================================
# RUTAS DE SALUD
# ==========================================

@app.route('/keepalive', methods=['GET'])
def keep_alive():
    return jsonify({"status": "online"}), 200

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"}), 200

# ==========================================
# INICIO DEL SERVIDOR
# ==========================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    print(f"\n🌐 Servidor iniciado en puerto {port}")
    print(f"🔒 Tokens para Transfermóvil: {list(TOKEN_TARJETA_MAP.keys())}")
    print(f"🔒 Tokens para Cubacel: {list(TOKEN_WEBHOOK_MAP.keys())}")
    print(f"💳 Tarjetas configuradas: {list(TARJETAS_WEBHOOKS.keys())}")
    app.run(host='0.0.0.0', port=port, debug=debug)
