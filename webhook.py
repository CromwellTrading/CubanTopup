Tarjetasiguracióniguraciónetparserasche flask import Flask, request, jsonify
import re
import json
import requests
import os
import threading
import time
import schedule
from datetime import datetime
import unicodedata

app = Flask(__name__)

# ==========================================
# CONFIGURACIÓN
# ==========================================

# 1. Configuración de la RUTA SECRETA
# Si no se define en .env, usa la ruta segura que pediste por defecto
WEBHOOK_PATH = os.getenv("WEBHOOK_PATH")

# 2. Configuración de Tarjetas
TARJETAS_WEBHOOKS_JSON = os.getenv("TARJETAS_WEBHOOKS", "{}")

try:
    TARJETAS_WEBHOOKS = json.loads(TARJETAS_WEBHOOKS_JSON)
except json.JSONDecodeError:
    print("❌ Error al parsear TARJETAS_WEBHOOKS. Usando diccionario vacío.")
    TARJETAS_WEBHOOKS = {}

MI_TARJETA_DEFAULT = os.getenv("MI_TARJETA_DEFAULT")
if not MI_TARJETA_DEFAULT and TARJETAS_WEBHOOKS:
    MI_TARJETA_DEFAULT = list(TARJETAS_WEBHOOKS.keys())[0]

print(f"💳 Tarjetas configuradas: {list(TARJETAS_WEBHOOKS.keys())}")
print(f"🔑 Tarjeta default: {MI_TARJETA_DEFAULT}")

# ==========================================
# FUNCIONES AUXILIARES
# ==========================================

def remove_accents(text):
    """Elimina tildes y caracteres especiales del texto"""
    text = unicodedata.normalize('NFD', text)
    text = text.encode('ascii', 'ignore').decode('utf-8')
    return text

def get_webhook_config_for_card(card_number):
    """Obtiene la configuración de webhook para una tarjeta específica"""
    # Si la tarjeta está en el diccionario
    if card_number in TARJETAS_WEBHOOKS:
        config = TARJETAS_WEBHOOKS[card_number]
        # print(f"✅ Config encontrada para {card_number}")
        return {
            "webhook_url": config.get("webhook"),
            "secret_key": config.get("secret")
        }
    
    # Si la tarjeta no está, buscar coincidencia parcial (últimos 4 dígitos)
    for stored_card, config in TARJETAS_WEBHOOKS.items():
        if card_number.endswith(stored_card[-4:]):
            print(f"🔄 Usando config de {stored_card} para {card_number} (coincidencia parcial)")
            return {
                "webhook_url": config.get("webhook"),
                "secret_key": config.get("secret")
            }
    
    # Si no encuentra, usar configuración por defecto
    webhook_default = os.getenv("WEBHOOK_DEFAULT")
    secret_default = os.getenv("WEBHOOK_SECRET_DEFAULT")
    
    print(f"⚠️ Usando config por defecto para {card_number}")
    return {
        "webhook_url": webhook_default,
        "secret_key": secret_default
    }

def send_to_webhook(payload, card_number):
    """Envía datos al webhook específico de la tarjeta con autenticación"""
    config = get_webhook_config_for_card(card_number)
    
    if not config["webhook_url"]:
        print(f"❌ No hay webhook configurado para tarjeta: {card_number}")
        return False
    
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Auth-Token": config["secret_key"]
        }
        
        # Siempre incluir el token en el payload también por seguridad
        payload["auth_token"] = config["secret_key"]
        payload["source"] = "python_sms_parser_secure" # Identificador actualizado
        payload["card_destination"] = card_number
        payload["timestamp"] = datetime.now().isoformat()
        
        print(f"📤 Enviando a webhook: {config['webhook_url']}")
        
        response = requests.post(
            config["webhook_url"], 
            json=payload, 
            headers=headers, 
            timeout=15
        )
        
        print(f"✅ Respuesta del webhook {card_number}: {response.status_code}")
        
        if response.status_code != 200:
            print(f"⚠️ Respuesta del webhook: {response.text}")
        
        return response.status_code == 200
    except requests.exceptions.Timeout:
        print(f"❌ Timeout enviando al webhook de {card_number}")
        return False
    except Exception as e:
        print(f"❌ Error enviando al webhook de {card_number}: {e}")
        return False

def extraer_tipo_pago_y_datos(mensaje):
    """Analiza el mensaje para determinar el tipo de pago y extraer datos"""
    
    mensaje_sin_tildes = remove_accents(mensaje)
    mensaje_upper = mensaje_sin_tildes.upper()
    
    # Buscar todas las tarjetas configuradas en el mensaje
    tarjetas_encontradas = []
    for tarjeta in TARJETAS_WEBHOOKS.keys():
        if tarjeta in mensaje or (len(tarjeta) >= 4 and tarjeta[-4:] in mensaje):
            tarjetas_encontradas.append(tarjeta)
    
    if not tarjetas_encontradas and MI_TARJETA_DEFAULT:
        tarjetas_encontradas = [MI_TARJETA_DEFAULT]
    
    # 1. Tarjeta a Tarjeta
    if "EL TITULAR DEL TELEFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        for tarjeta in tarjetas_encontradas:
            if tarjeta in mensaje or (len(tarjeta) >= 4 and tarjeta[-4:] in mensaje):
                tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
                telefono = tel_match.group(1) if tel_match else None
                
                monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
                monto = float(monto_match.group(1)) if monto_match else 0.0
                
                id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
                if not id_match: id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
                if not id_match: id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje_sin_tildes, re.IGNORECASE)
                trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
                
                return {
                    "tipo": "TARJETA_TARJETA",
                    "tarjeta_destino": tarjeta,
                    "telefono": telefono,
                    "monto": monto,
                    "trans_id": trans_id,
                    "currency": "cup"
                }
    
    # 2. Tarjeta a Monedero
    elif mensaje_upper.startswith("MONEDERO MITRANSFER") or "MONEDERO MITRANSFER:" in mensaje_upper:
        monto_match = re.search(r'RECARGADO CON:\s*(\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        if not monto_match: monto_match = re.search(r'CON:\s*(\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        if not monto_match: monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        if not id_match: id_match = re.search(r'ID TRANSACCION:\s*(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        if not id_match: id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
        
        tarjeta_destino = tarjetas_encontradas[0] if tarjetas_encontradas else MI_TARJETA_DEFAULT
        
        return {
            "tipo": "TARJETA_MONEDERO",
            "tarjeta_destino": tarjeta_destino,
            "telefono": None,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "saldo"
        }
    
    # 3. Monedero a Monedero
    elif "EL TITULAR DEL TELEFONO" in mensaje_upper and "AL MONEDERO MITRANSFER" in mensaje_upper:
        tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        if not id_match: id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
        
        tarjeta_destino = tarjetas_encontradas[0] if tarjetas_encontradas else MI_TARJETA_DEFAULT
        
        return {
            "tipo": "MONEDERO_MONEDERO",
            "tarjeta_destino": tarjeta_destino,
            "telefono": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "saldo"
        }
    
    # 4. Monedero a Tarjeta (enmascarada)
    elif "EL TITULAR DEL TELEFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper and ("XXXX" in mensaje_upper or "9227XXXXXXXX" in mensaje_upper):
        ultimos_4_match = re.search(r'(\d{4})\s*\.', mensaje_sin_tildes)
        if ultimos_4_match:
            ultimos_4 = ultimos_4_match.group(1)
            for tarjeta in tarjetas_encontradas:
                if tarjeta.endswith(ultimos_4):
                    tarjeta_destino = tarjeta
                    break
            else:
                tarjeta_destino = MI_TARJETA_DEFAULT
        else:
            tarjeta_destino = MI_TARJETA_DEFAULT
        
        tel_match = re.search(r'EL TITULAR DEL TELEFONO (\d+)', mensaje_sin_tildes, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje_sin_tildes, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        if not id_match: id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje_sin_tildes, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
        
        return {
            "tipo": "MONEDERO_TARJETA",
            "tarjeta_destino": tarjeta_destino,
            "telefono": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "cup"
        }
    
    return None

# ==========================================
# RUTAS DE LA API
# ==========================================

# 🔒 AQUÍ ESTÁ EL CAMBIO IMPORTANTE: Usamos WEBHOOK_PATH
@app.route(WEBHOOK_PATH, methods=['POST'])
def gateway():
    try:
        data = request.get_json()
        
        print(f"\n{'='*60}")
        print(f"🔒 ACCESO A RUTA SEGURA: {WEBHOOK_PATH}")
        print(f"📱 NUEVO SMS RECIBIDO - {datetime.now().strftime('%H:%M:%S')}")
        
        remitente = data.get("dirección", "")
        mensaje = data.get("text", "")
        
        # Filtrar solo mensajes de PAGO
        if "PAGO" not in remitente.upper():
            print(f"❌ Mensaje ignorado (no es de PAGO): {remitente}")
            return "OK", 200
        
        print(f"✅ ¡PAGO DETECTADO! De: {remitente}")
        
        datos_pago = extraer_tipo_pago_y_datos(mensaje)
        
        if not datos_pago:
            print("❌ Tipo de pago no reconocido")
            return "OK", 200
        
        if datos_pago["monto"] <= 0:
            print("❌ Monto inválido")
            return "OK", 200
        
        print(f"📊 Datos extraídos: {datos_pago['tipo']} | ${datos_pago['monto']} | Tx: {datos_pago['trans_id']}")
        
        tarjeta_destino = datos_pago.get("tarjeta_destino", MI_TARJETA_DEFAULT)
        
        payload = {
            "type": "SMS_PAYMENT_DETECTED",
            "amount": datos_pago["monto"],
            "currency": datos_pago["currency"],
            "tx_id": datos_pago["trans_id"],
            "tipo_pago": datos_pago["tipo"],
            "phone": datos_pago["telefono"],
            "tarjeta_destino": tarjeta_destino,
            "raw_message": mensaje,
            "timestamp": datetime.now().isoformat()
        }
        
        print(f"🚀 Reenviando al bot...")
        success = send_to_webhook(payload, tarjeta_destino)
        
        if success:
            print(f"✅ Enviado exitosamente")
        else:
            print(f"❌ Error al enviar al bot")
            # Lógica de reintento/guardado en DB (Simplificada para mantener el código limpio)
            # Aquí iría tu lógica de guardar en Supabase si falla
        
        print(f"{'='*60}\n")
        return "OK", 200
        
    except Exception as e:
        print(f"❌ Error crítico en gateway: {e}")
        import traceback
        traceback.print_exc()
        return "ERROR", 500

@app.route('/keepalive', methods=['GET'])
def keep_alive():
    return jsonify({
        "status": "online",
        "service": "transfermovil-parser-secure",
        "webhook_path": WEBHOOK_PATH # Informar de la ruta actual
    }), 200

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"}), 200

# ==========================================
# INICIO DEL SERVIDOR
# ==========================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    
    print(f"\n{'='*60}")
    print(f"🌐 PARSER PYTHON - Transfermóvil SMS Parser (SECURE MODE)")
    print(f"🔧 Puerto: {port}")
    print(f"🔒 RUTA SECRETA ACTIVA: {WEBHOOK_PATH}")
    print(f"📝 Configura tu App Deku/SMS Forwarder a esta ruta.")
    print(f"💳 Tarjetas configuradas: {len(TARJETAS_WEBHOOKS)}")
    print(f"{'='*60}\n")
    
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
