from flask import Flask, request, jsonify
import re
import json
import requests
import os
from datetime import datetime

app = Flask(__name__)

# CONFIGURACIÓN
MI_TARJETA = os.getenv("MI_TARJETA", "9227069995328054")
SUPABASE_URL = os.getenv("DB_URL")
SUPABASE_KEY = os.getenv("DB_KEY")
NODEJS_WEBHOOK_URL = os.getenv("NODEJS_WEBHOOK_URL", "http://localhost:3000/payment-notification")
TELEGRAM_ADMIN_ID = os.getenv("ADMIN_GROUP", "-1001234567890")

# Headers para Supabase
supabase_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

@app.route('/keepalive', methods=['GET'])
def keep_alive():
    return "I am alive", 200

def extraer_tipo_pago_y_datos(mensaje, remitente):
    """Analiza el mensaje para determinar el tipo de pago y extraer datos"""
    
    mensaje_upper = mensaje.upper()
    
    # 1. Tarjeta a Tarjeta
    # Ejemplo: "El titular del teléfono 5351239793 le ha realizado una transferencia a la cuenta 9227069995328054 de 5.00 CUP. Nro. Transaccion T2602600000MT. Fecha: 26/1/2026."
    if "EL TITULAR DEL TELÉFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper and MI_TARJETA in mensaje:
        print("🔍 Detectado: TARJETA A TARJETA")
        
        # Extraer teléfono
        tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        # Extraer monto
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        # Extraer ID de transacción
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else None
        
        return {
            "tipo": "TARJETA_TARJETA",
            "telefono": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "cup"
        }
    
    # 2. Tarjeta a Monedero (NO aparece el número del titular)
    # Ejemplo: "Monedero MiTransfer: Su monedero CUP ha sido recargado con: 50 CUP. Id Transaccion: TMW162915233."
    elif mensaje_upper.startswith("MONEDERO MITRANSFER") or "MONEDERO MITRANSFER:" in mensaje_upper:
        print("🔍 Detectado: TARJETA A MONEDERO")
        
        # Extraer monto
        monto_match = re.search(r'RECARGADO CON:\s*(\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        if not monto_match:
            monto_match = re.search(r'CON:\s*(\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        # Extraer ID de transacción
        id_match = re.search(r'TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'ID TRANSACCION:\s*(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else None
        
        return {
            "tipo": "TARJETA_MONEDERO",
            "telefono": None,  # No aparece el teléfono en este caso
            "monto": monto,
            "trans_id": trans_id,
            "currency": "saldo"
        }
    
    # 3. Monedero a Monedero
    # Ejemplo: "El titular del teléfono 5363806513 le ha realizado una transferencia al Monedero MiTransfer 59190241 de 3920.00 CUP. Nro. Transaccion TMW162171568. Fecha: 19/1/2026."
    elif "EL TITULAR DEL TELÉFONO" in mensaje_upper and "AL MONEDERO MITRANSFER" in mensaje_upper:
        print("🔍 Detectado: MONEDERO A MONEDERO")
        
        # Extraer teléfono
        tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None
        
        # Extraer monto
        monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
        monto = float(monto_match.group(1)) if monto_match else 0.0
        
        # Extraer ID de transacción
        id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        if not id_match:
            id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
        trans_id = id_match.group(1) if id_match else None
        
        return {
            "tipo": "MONEDERO_MONEDERO",
            "telefono": telefono,
            "monto": monto,
            "trans_id": trans_id,
            "currency": "saldo"
        }
    
    # 4. Monedero a Tarjeta (tarjeta enmascarada)
    # Ejemplo: "El titular del teléfono XXXX le ha realizado una transferencia a la cuenta 9227XXXXXXXX8054 de X CUP. Nro. Transaccion XXXX."
    elif "EL TITULAR DEL TELÉFONO" in mensaje_upper and "A LA CUENTA" in mensaje_upper:
        # Verificar si la tarjeta está enmascarada (contiene XXXX)
        if "XXXX" in mensaje:
            print("🔍 Detectado: MONEDERO A TARJETA (enmascarada)")
            
            # Extraer teléfono
            tel_match = re.search(r'EL TITULAR DEL TELÉFONO (\d+)', mensaje, re.IGNORECASE)
            telefono = tel_match.group(1) if tel_match else None
            
            # Extraer monto
            monto_match = re.search(r'DE (\d+\.?\d*)\s*CUP', mensaje, re.IGNORECASE)
            monto = float(monto_match.group(1)) if monto_match else 0.0
            
            # Extraer ID de transacción
            id_match = re.search(r'TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
            if not id_match:
                id_match = re.search(r'NRO\.?\s*TRANSACCION\s+(\w+)', mensaje, re.IGNORECASE)
            trans_id = id_match.group(1) if id_match else None
            
            return {
                "tipo": "MONEDERO_TARJETA",
                "telefono": telefono,
                "monto": monto,
                "trans_id": trans_id,
                "currency": "cup"
            }
    
    # No reconocido
    return None

@app.route('/webhook', methods=['POST'])
def gateway():
    try:
        data = request.get_json()
        
        # Log para debug
        print(f"--- NUEVO MENSAJE RECIBIDO ---")
        print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(json.dumps(data, indent=2))
        
        # Extraer datos del mensaje
        remitente = data.get("dirección", "")
        mensaje = data.get("text", "")
        
        # Verificar si es un PAGO-MOVIL
        if "PAGO" not in remitente.upper():
            print(f"❌ Mensaje ignorado de: {remitente}")
            return "OK", 200
        
        print(f"✅ ¡PAGO DETECTADO! De: {remitente}")
        
        # Extraer tipo de pago y datos
        datos_pago = extraer_tipo_pago_y_datos(mensaje, remitente)
        
        if not datos_pago:
            print("❌ Tipo de pago no reconocido")
            return "OK", 200
        
        # Validar datos básicos
        if datos_pago["monto"] <= 0:
            print("❌ Monto inválido")
            return "OK", 200
        
        if not datos_pago["trans_id"]:
            print("❌ ID de transacción no encontrado")
            return "OK", 200
        
        print(f"📊 Datos extraídos: {datos_pago}")
        
        # Buscar usuario en Supabase si tenemos teléfono
        user_id = None
        if datos_pago["telefono"]:
            # Buscar usuario por phone_number
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
        
        # Procesar según el tipo de pago
        if datos_pago["tipo"] == "TARJETA_MONEDERO":
            # Guardar en pending_sms_payments para que el usuario lo reclame
            payload = {
                "tx_id": datos_pago["trans_id"],
                "amount": datos_pago["monto"],
                "raw_message": mensaje,
                "claimed": False,
                "currency": datos_pago["currency"],
                "phone": datos_pago["telefono"],
                "tipo_pago": datos_pago["tipo"]
            }
            
            response = requests.post(
                f"{SUPABASE_URL}/rest/v1/pending_sms_payments",
                headers=supabase_headers,
                json=payload
            )
            
            if response.status_code == 201:
                print(f"✅ Pago pendiente guardado: {datos_pago['trans_id']}, Monto: {datos_pago['monto']} {datos_pago['currency']}")
                
                # Notificar al admin
                admin_payload = {
                    "type": "PENDING_PAYMENT",
                    "tx_id": datos_pago["trans_id"],
                    "amount": datos_pago["monto"],
                    "currency": datos_pago["currency"],
                    "tipo_pago": datos_pago["tipo"],
                    "telefono": datos_pago["telefono"],
                    "message": f"📥 Pago pendiente de {datos_pago['monto']} {datos_pago['currency']}\nTipo: {datos_pago['tipo']}\nID: {datos_pago['trans_id']}\nEl usuario debe reclamarlo usando el botón '🎁 Reclamar Pago' en el bot"
                }
                
                try:
                    response = requests.post(NODEJS_WEBHOOK_URL, json=admin_payload, timeout=5)
                    print(f"✅ Notificación enviada a Node.js: {response.status_code}")
                except Exception as e:
                    print(f"⚠️ No se pudo notificar al bot de Node.js: {e}")
            else:
                print(f"❌ Error guardando pago pendiente: {response.text}")
        
        elif user_id:
            # Notificar al bot de Node.js para procesar el pago automático
            payload = {
                "type": "AUTO_PAYMENT",
                "user_id": user_id,
                "amount": datos_pago["monto"],
                "currency": datos_pago["currency"],
                "tx_id": datos_pago["trans_id"],
                "tipo_pago": datos_pago["tipo"],
                "phone": datos_pago["telefono"],
                "message": mensaje
            }
            
            try:
                response = requests.post(NODEJS_WEBHOOK_URL, json=payload, timeout=5)
                print(f"✅ Notificación enviada a Node.js: {response.status_code}")
            except Exception as e:
                print(f"❌ Error enviando a Node.js: {e}")
                
                # Guardar en tabla de reintentos
                retry_payload = {
                    "user_id": user_id,
                    "amount": datos_pago["monto"],
                    "currency": datos_pago["currency"],
                    "tx_id": datos_pago["trans_id"],
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
            
            # Guardar en una tabla de pagos no identificados
            unknown_payload = {
                "tx_id": datos_pago["trans_id"],
                "amount": datos_pago["monto"],
                "currency": datos_pago["currency"],
                "raw_message": mensaje,
                "phone": datos_pago["telefono"],
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
        "mi_tarjeta": MI_TARJETA
    }), 200

@app.route('/test-webhook', methods=['POST'])
def test_webhook():
    """Endpoint para probar el webhook con datos de ejemplo"""
    try:
        test_data = {
            "dirección": "PAGOxMOVIL",
            "text": "El titular del teléfono 5351239793 le ha realizado una transferencia a la cuenta 9227069995328054 de 1500.00 CUP. Nro. Transaccion T2602600000MT. Fecha: 26/1/2026."
        }
        
        print("🔧 Probando webhook con datos de prueba...")
        result = extraer_tipo_pago_y_datos(test_data["text"], test_data["dirección"])
        print(f"🔧 Resultado de prueba: {result}")
        
        return jsonify({
            "test": "success",
            "data": test_data,
            "result": result
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    app.run(host='0.0.0.0', port=port, debug=debug)
