from flask import Flask, request, jsonify
import re
import json
import requests
import os
import threading
import time
import schedule
from datetime import datetime

app = Flask(__name__)

# CONFIGURACIÓN DESDE .ENV
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

def get_webhook_config_for_card(card_number):
    """Obtiene la configuración de webhook para una tarjeta específica"""
    # Si la tarjeta está en el diccionario
    if card_number in TARJETAS_WEBHOOKS:
        config = TARJETAS_WEBHOOKS[card_number]
        print(f"✅ Config encontrada para {card_number}: {config.get('webhook')}")
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
        payload["source"] = "python_sms_parser"
        payload["card_destination"] = card_number
        payload["timestamp"] = datetime.now().isoformat()
        
        print(f"📤 Enviando a webhook: {config['webhook_url']}")
        print(f"🔑 Token usado: {config['secret_key'][:10]}...")
        print(f"📦 Payload completo:")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        
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
        import traceback
        traceback.print_exc()
        return False

def extraer_tipo_pago_y_datos(mensaje):
    """Analiza el mensaje para determinar el tipo de pago y extraer datos"""
    
    mensaje_upper = mensaje.upper()
    
    # Buscar todas las tarjetas configuradas en el mensaje
    tarjetas_encontradas = []
    for tarjeta in TARJETAS_WEBHOOKS.keys():
        # Buscar la tarjeta completa en el mensaje
        if tarjeta in mensaje:
            tarjetas_encontradas.append(tarjeta)
        # Buscar los últimos 4 dígitos en mensajes enmascarados
        elif len(tarjeta) >= 4 and tarjeta[-4:] in mensaje:
            tarjetas_encontradas.append(tarjeta)
    
    print(f"🔍 Tarjetas encontradas en mensaje: {tarjetas_encontradas}")
    
    # Si no hay tarjetas configuradas, usar la por defecto
    if not tarjetas_encontradas and MI_TARJETA_DEFAULT:
        tarjetas_encontradas = [MI_TARJETA_DEFAULT]
        print(f"🔍 Usando tarjeta default: {MI_TARJETA_DEFAULT}")
    
    # 1. Tarjeta a Tarjeta (con número visible)
    if "EL TITULAR DEL TELÉFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        for tarjeta in tarjetas_encontradas:
            if tarjeta in mensaje or (len(tarjeta) >= 4 and tarjeta[-4:] in mensaje):
                print(f"🔍 Detectado: TARJETA A TARJETA para {tarjeta}")
                
                tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
                telefono = tel_match.group(1) if tel_match else None
                
                monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
                monto = float(monto_match.group(1)) if monto_match else 0.0
                
                id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
                if not id_match:
                    id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
                if not id_match:
                    id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
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
        print("🔍 Detectado: TARJETA A MONEDERO")
        
        monto_match = re.search(r'RECARGADO CON:\s*(\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        if not monto_match:
            monto_match = re.search(r'CON:\s*(\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        if not monto_match:
            monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'ID TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
        
        # Para tarjeta a monedero, usar la primera tarjeta configurada
        tarjeta_destino = tarjetas_encontradas[0] if tarjetas_encontradas else MI_TARJETA_DEFAULT
        
        return {
            "tipo": "TARJETA_MONEDERO",
            "tarjeta_destino": tarjeta_destino,
            "telefono": None,  # No hay teléfono en este tipo
            "monto": monto,
            "trans_id": trans_id,
            "currency": "saldo"
        }
    
    # 3. Monedero a Monedero
    elif "EL TITULAR DEL TELÉFONO" in mensaje_upper and "AL MONEDERO MITRANSFER" in mensaje_upper:
        print("🔍 Detectado: MONEDERO A MONEDERO")
        
        tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
        
        # Para monedero a monedero, usar la primera tarjeta configurada
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
    elif "EL TITULAR DEL TELÉFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        if "XXXX" in mensaje or "9227XXXXXXXX" in mensaje:
            print("🔍 Detectado: MONEDERO A TARJETA (enmascarada)")
            
            # Intentar extraer los últimos 4 dígitos
            ultimos_4_match = re.search(r'(\d{4})\s*\.', mensaje)
            if ultimos_4_match:
                ultimos_4 = ultimos_4_match.group(1)
                # Buscar tarjeta que termine con esos 4 dígitos
                for tarjeta in tarjetas_encontradas:
                    if tarjeta.endswith(ultimos_4):
                        tarjeta_destino = tarjeta
                        break
                else:
                    tarjeta_destino = MI_TARJETA_DEFAULT
            else:
                tarjeta_destino = MI_TARJETA_DEFAULT
            
            tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
            telefono = tel_match.group(1) if tel_match else None
            
            monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
            monto = float(monto_match.group(1)) if monto_match else 0.0
            
            id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
            if not id_match:
                id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
            trans_id = id_match.group(1) if id_match else f"UNKNOWN_{int(time.time())}"
            
            return {
                "tipo": "MONEDERO_TARJETA",
                "tarjeta_destino": tarjeta_destino,
                "telefono": telefono,
                "monto": monto,
                "trans_id": trans_id,
                "currency": "cup"
            }
    
    print(f"❌ No se pudo identificar tipo de pago en mensaje")
    return None

@app.route('/webhook', methods=['POST'])
def gateway():
    try:
        data = request.get_json()
        
        print(f"\n{'='*60}")
        print(f"📱 NUEVO SMS RECIBIDO")
        print(f"🕐 Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"📨 Datos crudos recibidos:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"{'='*60}")
        
        remitente = data.get("dirección", "")
        mensaje = data.get("text", "")
        
        # Filtrar solo mensajes de PAGO
        if "PAGO" not in remitente.upper():
            print(f"❌ Mensaje ignorado (no es de PAGO): {remitente}")
            return "OK", 200
        
        print(f"✅ ¡PAGO DETECTADO! De: {remitente}")
        print(f"📝 Mensaje: {mensaje}")
        
        datos_pago = extraer_tipo_pago_y_datos(mensaje)
        
        if not datos_pago:
            print("❌ Tipo de pago no reconocido")
            return "OK", 200
        
        if datos_pago["monto"] <= 0:
            print("❌ Monto inválido")
            return "OK", 200
        
        print(f"📊 Datos extraídos del SMS:")
        print(f"   Tipo: {datos_pago['tipo']}")
        print(f"   Teléfono: {datos_pago['telefono']}")
        print(f"   Monto: {datos_pago['monto']} {datos_pago['currency']}")
        print(f"   ID Transacción: {datos_pago['trans_id']}")
        print(f"   Tarjeta Destino: {datos_pago['tarjeta_destino']}")
        
        # Determinar tarjeta destino para el webhook
        tarjeta_destino = datos_pago.get("tarjeta_destino", MI_TARJETA_DEFAULT)
        
        # Crear payload para el bot - SOLO DATOS DEL SMS, NO user_id
        payload = {
            "type": "SMS_PAYMENT_DETECTED",
            "amount": datos_pago["monto"],
            "currency": datos_pago["currency"],
            "tx_id": datos_pago["trans_id"],
            "tipo_pago": datos_pago["tipo"],
            "phone": datos_pago["telefono"],  # Solo el teléfono
            "tarjeta_destino": tarjeta_destino,
            "raw_message": mensaje,
            "timestamp": datetime.now().isoformat()
        }
        
        # Enviar al webhook correspondiente
        print(f"\n🚀 Enviando datos al bot...")
        success = send_to_webhook(payload, tarjeta_destino)
        
        if success:
            print(f"✅ Datos enviados exitosamente al bot")
        else:
            print(f"❌ Error enviando datos al bot")
            
            # Guardar en una tabla de fallos para reintento posterior
            try:
                import requests as req
                DB_URL = os.getenv("DB_URL")
                DB_KEY = os.getenv("DB_KEY")
                
                if DB_URL and DB_KEY:
                    headers = {
                        "apikey": DB_KEY,
                        "Authorization": f"Bearer {DB_KEY}",
                        "Content-Type": "application/json"
                    }
                    
                    retry_payload = {
                        "phone": datos_pago["telefono"],
                        "amount": datos_pago["monto"],
                        "currency": datos_pago["currency"],
                        "tx_id": datos_pago["trans_id"],
                        "tipo_pago": datos_pago["tipo"],
                        "tarjeta_destino": tarjeta_destino,
                        "raw_message": mensaje,
                        "status": "failed_to_send",
                        "retry_count": 0,
                        "created_at": datetime.now().isoformat()
                    }
                    
                    req.post(
                        f"{DB_URL}/rest/v1/failed_payments",
                        headers=headers,
                        json=retry_payload
                    )
                    print(f"📝 Pago fallido guardado para reintento")
            except Exception as db_error:
                print(f"⚠️ Error guardando pago fallido: {db_error}")
        
        print(f"{'='*60}\n")
        return "OK", 200
        
    except Exception as e:
        print(f"❌ Error procesando datos: {e}")
        import traceback
        traceback.print_exc()
        return "ERROR", 500

@app.route('/keepalive', methods=['GET'])
def keep_alive():
    return jsonify({
        "status": "online",
        "service": "transfermovil-parser",
        "time": datetime.now().isoformat(),
        "tarjetas_configuradas": list(TARJETAS_WEBHOOKS.keys())
    }), 200

@app.route('/test', methods=['GET'])
def test():
    """Endpoint para probar el parser manualmente"""
    test_messages = [
        "El titular del telefono 5359190241 le ha realizado una transferencia a la cuenta: 9227069995328054 de 1000.00 CUP. Nro. Transaccion TMW164182151",
        "MONEDERO MITRANSFER: RECARGADO CON: 1500.00 CUP. TRANSACCION: TMX123456789. FECHA: 06/02/2026.",
        "El titular del telefono 5351234567 le ha realizado una transferencia al monedero mitransfer de 500.00 CUP. Nro. Transaccion TMW987654321"
    ]
    
    results = []
    for msg in test_messages:
        result = extraer_tipo_pago_y_datos(msg)
        results.append({
            "message": msg,
            "result": result
        })
    
    return jsonify({
        "test": "success",
        "results": results,
        "config": {
            "tarjetas": list(TARJETAS_WEBHOOKS.keys()),
            "default": MI_TARJETA_DEFAULT
        }
    }), 200

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    
    print(f"\n{'='*60}")
    print(f"🌐 PARSER PYTHON - Transfermóvil SMS Parser")
    print(f"🔧 Puerto: {port}")
    print(f"🐛 Debug: {debug}")
    print(f"💳 Tarjetas configuradas: {len(TARJETAS_WEBHOOKS)}")
    
    for tarjeta, config in TARJETAS_WEBHOOKS.items():
        webhook = config.get('webhook', 'No configurado')
        print(f"   - {tarjeta[:4]}...{tarjeta[-4:]} -> {webhook}")
    
    print(f"{'='*60}\n")
    
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
