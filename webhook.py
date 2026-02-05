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
# Diccionario de tarjetas y webhooks asociados
# Formato en .env: TARJETAS_WEBHOOKS='{"9227069995328054": {"webhook": "https://webhook1.com", "secret": "clave1"}, "9227111111111111": {"webhook": "https://webhook2.com", "secret": "clave2"}}'
TARJETAS_WEBHOOKS_JSON = os.getenv("TARJETAS_WEBHOOKS", "{}")

try:
    TARJETAS_WEBHOOKS = json.loads(TARJETAS_WEBHOOKS_JSON)
except json.JSONDecodeError:
    print("❌ Error al parsear TARJETAS_WEBHOOKS. Usando diccionario vacío.")
    TARJETAS_WEBHOOKS = {}

# Tarjeta por defecto (la primera del diccionario o una específica)
MI_TARJETA_DEFAULT = os.getenv("MI_TARJETA_DEFAULT")
if not MI_TARJETA_DEFAULT and TARJETAS_WEBHOOKS:
    MI_TARJETA_DEFAULT = list(TARJETAS_WEBHOOKS.keys())[0]

SUPABASE_URL = os.getenv("DB_URL")
SUPABASE_KEY = os.getenv("DB_KEY")
TELEGRAM_ADMIN_ID = os.getenv("ADMIN_GROUP")

# Validar variables críticas
if not all([SUPABASE_URL, SUPABASE_KEY]):
    raise ValueError("❌ Faltan variables de entorno críticas. Verifica DB_URL, DB_KEY")

# Headers para Supabase
supabase_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def get_webhook_config_for_card(card_number):
    """Obtiene la configuración de webhook para una tarjeta específica"""
    if card_number in TARJETAS_WEBHOOKS:
        config = TARJETAS_WEBHOOKS[card_number]
        return {
            "webhook_url": config.get("webhook"),
            "secret_key": config.get("secret")
        }
    
    # Si no encuentra la tarjeta, usar configuración por defecto
    webhook_default = os.getenv("WEBHOOK_DEFAULT")
    secret_default = os.getenv("WEBHOOK_SECRET_DEFAULT")
    
    return {
        "webhook_url": webhook_default,
        "secret_key": secret_default
    }

def send_to_webhook(payload, card_number):
    """Envía datos al webhook específico de la tarjeta con autenticación"""
    config = get_webhook_config_for_card(card_number)
    
    if not config["webhook_url"] or not config["secret_key"]:
        print(f"❌ No hay webhook configurado para tarjeta: {card_number}")
        return False
    
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Auth-Token": config["secret_key"]
        }
        
        # Agregar token al payload también
        payload["auth_token"] = config["secret_key"]
        payload["source"] = "python_sms_parser"
        payload["card_destination"] = card_number
        
        response = requests.post(
            config["webhook_url"], 
            json=payload, 
            headers=headers, 
            timeout=10
        )
        
        print(f"✅ Enviado a webhook de {card_number}: {response.status_code}")
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Error enviando al webhook de {card_number}: {e}")
        return False

@app.route('/keepalive', methods=['GET'])
def keep_alive():
    return "I am alive", 200

def extraer_tipo_pago_y_datos(mensaje, remitente):
    """Analiza el mensaje para determinar el tipo de pago y extraer datos"""
    
    mensaje_upper = mensaje.upper()
    
    # Buscar todas las tarjetas configuradas en el mensaje
    tarjetas_encontradas = []
    for tarjeta in TARJETAS_WEBHOOKS.keys():
        # Buscar la tarjeta completa o los últimos 4 dígitos
        if tarjeta in mensaje or tarjeta[-4:] in mensaje:
            tarjetas_encontradas.append(tarjeta)
    
    # Si no hay tarjetas configuradas, usar la por defecto
    if not TARJETAS_WEBHOOKS and MI_TARJETA_DEFAULT:
        tarjetas_encontradas = [MI_TARJETA_DEFAULT]
    
    # 1. Tarjeta a Tarjeta
    if "EL TITULAR DEL TELÉFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        for tarjeta in tarjetas_encontradas:
            if tarjeta in mensaje:
                print(f"🔍 Detectado: TARJETA A TARJETA para {tarjeta}")
                
                tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
                telefono = tel_match.group(1) if tel_match else None
                
                monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
                monto = float(monto_match.group(1)) if monto_match else 0.0
                
                id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
                if not id_match:
                    id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
                trans_id = id_match.group(1) if id_match else None
                
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
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'ID TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else None
        
        # Para tarjeta a monedero, usar la primera tarjeta configurada
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
    elif "EL TITULAR DEL TELÉFONO" in mensaje_upper and "AL MONEDERO MITRANSFER" in mensaje_upper:
        print("🔍 Detectado: MONEDERO A MONEDERO")
        
        tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else None
        
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
        if "XXXX" in mensaje:
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
            trans_id = id_match.group(1) if id_match else None
            
            return {
                "tipo": "MONEDERO_TARJETA",
                "tarjeta_destino": tarjeta_destino,
                "telefono": telefono,
                "monto": monto,
                "trans_id": trans_id,
                "currency": "cup"
            }
    
    return None

def ping_webhook_service(webhook_url):
    """Hace ping a un servicio webhook para mantenerlo activo"""
    if not webhook_url:
        return False
    
    try:
        keepalive_url = webhook_url.replace("/payment-notification", "/keepalive")
        response = requests.get(keepalive_url, timeout=10)
        print(f"✅ Ping a {keepalive_url}: {response.status_code}")
        return True
    except Exception as e:
        print(f"⚠️ No se pudo hacer ping a {webhook_url}: {e}")
        return False

def self_ping():
    """Hace ping a sí mismo para mantenerse activo"""
    base_url = os.getenv("PYTHON_WEBHOOK_URL")
    if not base_url:
        return False
    
    try:
        response = requests.get(f"{base_url}/keepalive", timeout=10)
        print(f"✅ Self-ping exitoso: {response.status_code}")
        return True
    except Exception as e:
        print(f"⚠️ Self-ping falló: {e}")
        return False

def keep_alive_job():
    """Tarea programada para mantener servicios activos"""
    print(f"\n🔄 Ejecutando Keep Alive - {datetime.now().strftime('%H:%M:%S')}")
    
    # Ping a todos los webhooks configurados
    webhooks_ok = []
    for tarjeta, config in TARJETAS_WEBHOOKS.items():
        webhook_url = config.get("webhook")
        if webhook_url:
            ok = ping_webhook_service(webhook_url)
            webhooks_ok.append(ok)
            if ok:
                print(f"✅ Webhook de {tarjeta[:4]}...{tarjeta[-4:]}: ACTIVO")
            else:
                print(f"⚠️ Webhook de {tarjeta[:4]}...{tarjeta[-4:]}: INACTIVO")
    
    # Ping por defecto si existe
    webhook_default = os.getenv("WEBHOOK_DEFAULT")
    if webhook_default:
        ok = ping_webhook_service(webhook_default)
        webhooks_ok.append(ok)
        print(f"✅ Webhook por defecto: {'ACTIVO' if ok else 'INACTIVO'}")
    
    # Self-ping
    self_ok = self_ping()
    
    # Resumen
    todos_ok = all(webhooks_ok) if webhooks_ok else True
    if todos_ok and self_ok:
        print("✅ Todos los servicios responden correctamente")
    else:
        print("⚠️ Algunos servicios tienen problemas")
    
    print("-" * 50)

def start_keep_alive_scheduler():
    """Inicia el programador de keep alive"""
    print("🚀 Iniciando Keep Alive Scheduler...")
    
    schedule.every(4).minutes.do(keep_alive_job)
    keep_alive_job()
    
    def run_scheduler():
        while True:
            schedule.run_pending()
            time.sleep(60)
    
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    print("✅ Keep Alive Scheduler iniciado (cada 4 minutos)")

@app.route('/webhook', methods=['POST'])
def gateway():
    try:
        data = request.get_json()
        
        print(f"--- NUEVO MENSAJE RECIBIDO ---")
        print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(json.dumps(data, indent=2))
        
        remitente = data.get("dirección", "")
        mensaje = data.get("text", "")
        
        if "PAGO" not in remitente.upper():
            print(f"❌ Mensaje ignorado de: {remitente}")
            return "OK", 200
        
        print(f"✅ ¡PAGO DETECTADO! De: {remitente}")
        
        datos_pago = extraer_tipo_pago_y_datos(mensaje, remitente)
        
        if not datos_pago:
            print("❌ Tipo de pago no reconocido")
            return "OK", 200
        
        if datos_pago["monto"] <= 0:
            print("❌ Monto inválido")
            return "OK", 200
        
        if not datos_pago["trans_id"]:
            print("❌ ID de transacción no encontrado")
            return "OK", 200
        
        print(f"📊 Datos extraídos: {datos_pago}")
        
        user_id = None
        if datos_pago["telefono"]:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/users?phone_number=eq.{datos_pago['telefono']}",
                headers=supabase_headers
            )
            
            if response.status_code == 200:
                users = response.json()
                if users:
                    user_id = users[0]['telegram_id']
                    print(f"✅ Usuario encontrado: {user_id}")
                else:
                    print(f"⚠️ Usuario no encontrado con teléfono: {datos_pago['telefono']}")
            else:
                print(f"❌ Error buscando usuario: {response.text}")
        
        # Determinar tarjeta destino para el webhook
        tarjeta_destino = datos_pago.get("tarjeta_destino", MI_TARJETA_DEFAULT)
        
        if datos_pago["tipo"] == "TARJETA_MONEDERO":
            payload = {
                "tx_id": datos_pago["trans_id"],
                "amount": datos_pago["monto"],
                "raw_message": mensaje,
                "claimed": False,
                "currency": datos_pago["currency"],
                "phone": datos_pago["telefono"],
                "tipo_pago": datos_pago["tipo"],
                "tarjeta_destino": tarjeta_destino
            }
            
            response = requests.post(
                f"{SUPABASE_URL}/rest/v1/pending_sms_payments",
                headers=supabase_headers,
                json=payload
            )
            
            if response.status_code == 201:
                print(f"✅ Pago pendiente guardado: {datos_pago['trans_id']}")
                
                admin_payload = {
                    "type": "PENDING_PAYMENT",
                    "tx_id": datos_pago["trans_id"],
                    "amount": datos_pago["monto"],
                    "currency": datos_pago["currency"],
                    "tipo_pago": datos_pago["tipo"],
                    "telefono": datos_pago["telefono"],
                    "tarjeta_destino": tarjeta_destino,
                    "message": f"📥 Pago pendiente de {datos_pago['monto']} {datos_pago['currency']}\nTipo: {datos_pago['tipo']}\nID: {datos_pago['trans_id']}\nTarjeta: {tarjeta_destino}"
                }
                
                send_to_webhook(admin_payload, tarjeta_destino)
            else:
                print(f"❌ Error guardando pago pendiente: {response.text}")
        
        elif user_id:
            payload = {
                "type": "AUTO_PAYMENT",
                "user_id": user_id,
                "amount": datos_pago["monto"],
                "currency": datos_pago["currency"],
                "tx_id": datos_pago["trans_id"],
                "tipo_pago": datos_pago["tipo"],
                "phone": datos_pago["telefono"],
                "tarjeta_destino": tarjeta_destino,
                "message": mensaje
            }
            
            if not send_to_webhook(payload, tarjeta_destino):
                print("❌ Error enviando al webhook, guardando reintento...")
                
                retry_payload = {
                    "user_id": user_id,
                    "amount": datos_pago["monto"],
                    "currency": datos_pago["currency"],
                    "tx_id": datos_pago["trans_id"],
                    "tarjeta_destino": tarjeta_destino,
                    "status": "pending",
                    "retry_count": 0,
                    "tipo_pago": datos_pago["tipo"]
                }
                
                try:
                    requests.post(
                        f"{SUPABASE_URL}/rest/v1/payment_retries",
                        headers=supabase_headers,
                        json=retry_payload
                    )
                except Exception as db_error:
                    print(f"❌ Error guardando reintento: {db_error}")
        
        else:
            print(f"⚠️ Pago sin usuario identificable. Tipo: {datos_pago['tipo']}, Monto: {datos_pago['monto']}")
            
            unknown_payload = {
                "tx_id": datos_pago["trans_id"],
                "amount": datos_pago["monto"],
                "currency": datos_pago["currency"],
                "raw_message": mensaje,
                "phone": datos_pago["telefono"],
                "tarjeta_destino": tarjeta_destino,
                "type": datos_pago["tipo"]
            }
            
            try:
                response = requests.post(
                    f"{SUPABASE_URL}/rest/v1/unknown_payments",
                    headers=supabase_headers,
                    json=unknown_payload
                )
                
                if response.status_code == 201:
                    print(f"✅ Pago no identificado guardado: {datos_pago['trans_id']}")
            except Exception as db_error:
                print(f"❌ Error guardando pago no identificado: {db_error}")
        
        return "OK", 200
        
    except Exception as e:
        print(f"❌ Error procesando datos: {e}")
        import traceback
        traceback.print_exc()
        return "ERROR", 500

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        "status": "online",
        "service": "transfermovil-webhook",
        "time": datetime.now().isoformat(),
        "tarjetas_configuradas": len(TARJETAS_WEBHOOKS),
        "tarjeta_default": MI_TARJETA_DEFAULT,
        "webhook_default": bool(os.getenv("WEBHOOK_DEFAULT"))
    }), 200

@app.route('/test-webhook', methods=['POST'])
def test_webhook():
    try:
        test_data = {
            "dirección": "PAGOxMOVIL",
            "text": "El titular del teléfono 5351239793 le ha realizado una transferencia a la cuenta 9227069995328054 de 1500.00 CUP. Nro. Transaccion T2602600000MT. Fecha: 26/1/2026."
        }
        
        print("🔧 Probando webhook con datos de prueba...")
        result = extraer_tipo_pago_y_datos(test_data["text"], test_data["dirección"])
        
        return jsonify({
            "test": "success",
            "data": test_data,
            "result": result,
            "tarjetas_configuradas": list(TARJETAS_WEBHOOKS.keys())
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    start_keep_alive_scheduler()
    
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    
    print(f"🌐 Servicio Python Webhook iniciando en puerto {port}")
    print(f"🔧 Debug mode: {debug}")
    print(f"💳 Tarjetas configuradas: {len(TARJETAS_WEBHOOKS)}")
    for tarjeta, config in TARJETAS_WEBHOOKS.items():
        print(f"   - {tarjeta[:4]}...{tarjeta[-4:]} -> {config.get('webhook', 'Sin webhook')}")
    
    app.run(host='0.0.0.0', port=port, debug=debug)
