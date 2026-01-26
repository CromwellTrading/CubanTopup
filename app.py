import os
import re
import time
import json
import threading
import logging
from datetime import datetime, timezone

from flask import Flask, request, jsonify
import requests
from dotenv import load_dotenv
from supabase import create_client

# Carga .env
load_dotenv()

# Config logging (para ver todo en Render)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger()

# ENV
APP_URL = os.getenv("APP_URL", "")
PORT = int(os.getenv("PORT", "5000"))
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ADMIN_GROUP = os.getenv("ADMIN_GROUP")  # grupo donde se envían los tickets
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
MI_TARJETA = os.getenv("MI_TARJETA", "9227069995328054")

MIN_CUP = float(os.getenv("MIN_CUP", "1000"))
MAX_CUP = float(os.getenv("MAX_CUP", "50000"))
MIN_SALDO = float(os.getenv("MIN_SALDO", "500"))
MAX_SALDO = float(os.getenv("MAX_SALDO", "5000"))
MIN_USDT = float(os.getenv("MIN_USDT", "10"))
MAX_USDT = float(os.getenv("MAX_USDT", "100"))

FIRST_DEP_CUP_PERCENT = float(os.getenv("FIRST_DEP_CUP_PERCENT", "20"))
FIRST_DEP_SALDO_PERCENT = float(os.getenv("FIRST_DEP_SALDO_PERCENT", "10"))
FIRST_DEP_USDT_PERCENT = float(os.getenv("FIRST_DEP_USDT_PERCENT", "5"))

if not (TELEGRAM_BOT_TOKEN and ADMIN_GROUP and SUPABASE_URL and SUPABASE_KEY):
    log.error("Faltan variables de entorno esenciales. Rellena .env (TELEGRAM_BOT_TOKEN, ADMIN_GROUP, SUPABASE_URL, SUPABASE_KEY).")
    # no salir para que al menos el dev vea el error en logs; depende de cómo quieras deployar

# Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

app = Flask(__name__)

# Util: enviar mensaje telegram
def send_telegram(chat_id, text, parse_mode="Markdown"):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code != 200:
            log.warning("Telegram send failed: %s -> %s", r.status_code, r.text)
        return r.json()
    except Exception as e:
        log.exception("Error enviando telegram: %s", e)
        return None

def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()

def generate_request_id(prefix="REQ"):
    token = hex(int(time.time()*1000))[2:]
    rnd = os.urandom(3).hex()
    return f"{prefix}-{token.upper()}-{rnd.upper()}"

# Helper DB: Buscar usuario por phone (guarda llamadas a supabase)
def find_user_by_phone(phone):
    if not phone:
        return None
    try:
        resp = supabase.table("users").select("*").ilike("phone_number", f"%{phone}%").limit(1).execute()
        if resp and resp.data and len(resp.data) > 0:
            return resp.data[0]
    except Exception as e:
        log.exception("Supabase find_user_by_phone error: %s", e)
    return None

def insert_pending_sms(tx_id, amount, raw_message):
    try:
        resp = supabase.table("pending_sms_payments").insert({
            "tx_id": tx_id,
            "amount": amount,
            "raw_message": raw_message
        }).execute()
        if resp.error:
            log.error("Error insert pending_sms_payments: %s", resp.error)
    except Exception as e:
        log.exception("Error insert_pending_sms: %s", e)

def create_transaction_record(user_telegram_id, currency, amount, status="waiting_payment", tx_id=None, extra=None):
    rec = {
        "user_id": user_telegram_id,
        "type": "DEPOSIT",
        "currency": currency,
        "amount_requested": float(amount),
        "status": status,
        "tx_id": tx_id or generate_request_id("TX"),
        "created_at": now_iso()
    }
    if extra:
        rec.update(extra)
    try:
        resp = supabase.table("transactions").insert(rec).execute()
        if resp.error:
            log.error("Error creating transaction: %s", resp.error)
            return None
        return resp.data[0]
    except Exception as e:
        log.exception("Error create_transaction_record: %s", e)
        return None

def update_transaction_status(tx_db_id, data):
    try:
        resp = supabase.table("transactions").update(data).eq("id", tx_db_id).execute()
        if resp.error:
            log.error("Error update tx: %s", resp.error)
            return False
        return True
    except Exception as e:
        log.exception("update_transaction_status error: %s", e)
        return False

def apply_credit_logic_and_finalize(user, tx_record):
    """
    user: supabase user record
    tx_record: transaction db record
    Returns dict with result.
    """
    currency = tx_record.get("currency")
    amt = float(tx_record.get("amount_requested") or 0)
    log.info("Aplicando credit logic: user=%s currency=%s amt=%s", user.get("telegram_id"), currency, amt)

    # CUP special pending_balance behavior
    if currency == "cup":
        pending = float(user.get("pending_balance_cup", 0) or 0)
        total = pending + amt
        if total < MIN_CUP:
            # actualizar pending_balance_cup
            supabase.table("users").update({"pending_balance_cup": total}).eq("telegram_id", user["telegram_id"]).execute()
            update_transaction_status(tx_record["id"], {"status": "pending_minimum"})
            return {"credited": False, "reason": "below_minimum", "pending": total}
        else:
            # aplicar bono si first_dep_cup True
            first_dep = bool(user.get("first_dep_cup", True))
            bonus_pct = FIRST_DEP_CUP_PERCENT if first_dep else 0
            bonus = total * (bonus_pct/100)
            final = total + bonus
            # actualizar balance y flags
            new_bal = (float(user.get("balance_cup") or 0) + final)
            supabase.table("users").update({
                "balance_cup": new_bal,
                "pending_balance_cup": 0,
                "first_dep_cup": False
            }).eq("telegram_id", user["telegram_id"]).execute()
            update_transaction_status(tx_record["id"], {"status": "completed"})
            return {"credited": True, "amount_credited": final, "bonus": bonus, "new_balance": new_bal}

    elif currency == "saldo":
        if amt < MIN_SALDO:
            update_transaction_status(tx_record["id"], {"status": "pending_minimum"})
            return {"credited": False, "reason": "below_minimum"}
        first_dep = bool(user.get("first_dep_saldo", True))
        bonus_pct = FIRST_DEP_SALDO_PERCENT if first_dep else 0
        bonus = amt * (bonus_pct/100)
        final = amt + bonus
        new_bal = (float(user.get("balance_saldo") or 0) + final)
        supabase.table("users").update({
            "balance_saldo": new_bal,
            "first_dep_saldo": False
        }).eq("telegram_id", user["telegram_id"]).execute()
        update_transaction_status(tx_record["id"], {"status": "completed"})
        return {"credited": True, "amount_credited": final, "bonus": bonus, "new_balance": new_bal}

    elif currency == "usdt":
        if amt < MIN_USDT:
            update_transaction_status(tx_record["id"], {"status": "pending_minimum"})
            return {"credited": False, "reason": "below_minimum"}
        first_dep = bool(user.get("first_dep_usdt", True))
        bonus_pct = FIRST_DEP_USDT_PERCENT if first_dep else 0
        bonus = amt * (bonus_pct/100)
        final = amt + bonus
        new_bal = (float(user.get("balance_usdt") or 0) + final)
        supabase.table("users").update({
            "balance_usdt": new_bal,
            "first_dep_usdt": False
        }).eq("telegram_id", user["telegram_id"]).execute()
        update_transaction_status(tx_record["id"], {"status": "completed"})
        return {"credited": True, "amount_credited": final, "bonus": bonus, "new_balance": new_bal}

    else:
        return {"credited": False, "reason": "unknown_currency"}

# ROUTES

@app.route("/keepalive", methods=["GET"])
def keepalive():
    return "I am alive", 200

@app.route("/webhook", methods=["POST"])
def webhook_sms():
    """
    Endpoint que recibe los mensajes JSON desde Deku SMS.
    Debe coincidir con el formato real que muestras en logs.
    """
    try:
        data = request.get_json(force=True)
        log.info("\n--- NUEVO MENSAJE RECIBIDO ---")
        log.info(json.dumps(data, indent=2, ensure_ascii=False))

        # campos comunes
        direccion = (data.get("dirección") or data.get("address") or data.get("from") or "").upper()
        texto = (data.get("text") or data.get("body") or data.get("message") or "").strip()

        # Filtro básico: interesan mensajes que provengan de "PAGO" o que contengan "Transaccion" etc.
        if "PAGO" not in direccion and not re.search(r'TRANSACCION|TRANSACCION|TMW|T\d', texto, re.IGNORECASE):
            log.info("❌ Mensaje no relacionado con pagos. Ignorado.")
            return ("ignored", 200)

        # Extraer monto (ej: "de 50.00 CUP")
        monto_match = re.search(r'(\d+(?:[.,]\d+)?)\s*CUP', texto, re.IGNORECASE)
        monto = float(monto_match.group(1).replace(",", ".")) if monto_match else None

        # Extraer ID transaccion (TMW..., T260..., KW...)
        id_match = re.search(r'(TMW\d+|KW\w+|T\d+[A-Z0-9]+)', texto, re.IGNORECASE)
        tx_id = id_match.group(1) if id_match else None

        # Extraer teléfono tras "El titular del teléfono "
        tel_match = re.search(r'El titular del teléfono\s*([0-9]{6,12})', texto, re.IGNORECASE)
        telefono = tel_match.group(1) if tel_match else None

        # Detectar tipo:
        tipo = "DESCONOCIDO"
        t_upper = texto.upper()

        # Si empieza con "Monedero MiTransfer" (sin titular), es tarjeta->monedero (no hay número)
        if texto.startswith("Monedero MiTransfer") or t_upper.startswith("MONEDERO MITRANSFER"):
            tipo = "TARJETA_A_MONEDERO"
        # Si contiene "AL MONEDERO MITRANSFER" después de titular -> monedero->monedero
        elif "AL MONEDERO MITRANSFER" in t_upper or "AL MONEDERO MITRANSFER" in t_upper:
            tipo = "MONEDERO_A_MONEDERO"
        # Si contiene "A LA CUENTA" o "A LA CUENTA" -> tarjeta->tarjeta o monedero->tarjeta según presencia MI_TARJETA
        elif "A LA CUENTA" in t_upper or "A LA CUENTA" in texto:
            # si aparece tu tarjeta completa -> tarjeta->tarjeta
            if MI_TARJETA and MI_TARJETA in texto:
                tipo = "TARJETA_A_TARJETA"
            else:
                # si aparece cuenta enmascarada (9227XXXX...): monedero->tarjeta
                tipo = "MONEDERO_A_TARJETA"
        # fallback: si hay titular y texto menciona transferencia -> con_titular
        elif telefono:
            tipo = "CON_TITULAR"

        # Log legible
        log.info(f"✅ PAGO DETECTADO -> Tipo: {tipo} | Monto: {monto} | Tel: {telefono or 'NO DISPONIBLE'} | TX_ID: {tx_id}")

        # Si es tarjeta->monedero y no hay teléfono: guardar pending_sms_payments
        if tipo == "TARJETA_A_MONEDERO" and not telefono:
            pending_id = tx_id or generate_request_id("PEND")
            insert_pending_sms(pending_id, monto if monto else None, texto)
            # Notificar admin con ticket
            ticket_id = generate_request_id("TICKET")
            ts = now_iso()
            text = (
                f"🔔 *Nuevo Pago (Tarjeta→Monedero) - SIN TITULAR*\n"
                f"Ticket: `{ticket_id}`\n"
                f"Monto: `{monto or 'desconocido'}` CUP\n"
                f"TX (transferencia): `{tx_id or 'N/A'}`\n"
                f"Método: `Tarjeta→Monedero`\n"
                f"Hora: `{ts}`\n"
                f"Número cliente: `NO DISPONIBLE`\n\n"
                f"Mensaje original:\n`{texto}`"
            )
            send_telegram(ADMIN_GROUP, text)
            return ("ok", 200)

        # Si hay teléfono: intentar vincular usuario y buscar transaccion waiting_payment
        if telefono:
            user = find_user_by_phone(telefono)
            if not user:
                # notificar admin que llegó pago pero no hay usuario vinculado
                ticket_id = generate_request_id("TICKET")
                ts = now_iso()
                text = (
                    f"⚠️ *Pago detectado pero SIN usuario vinculado*\n"
                    f"Ticket: `{ticket_id}`\n"
                    f"Tel: `{telefono}`\n"
                    f"Monto: `{monto or 'desconocido'}` CUP\n"
                    f"TX: `{tx_id or 'N/A'}`\n"
                    f"Método: `{tipo}`\n"
                    f"Hora: `{ts}`\n\n"
                    f"Mensaje original:\n`{texto}`"
                )
                send_telegram(ADMIN_GROUP, text)
                return ("no_user", 200)

            # Buscar transacción pendiente del usuario (status waiting_payment o pending_minimum)
            try:
                txs_resp = supabase.table("transactions").select("*").eq("user_id", user["telegram_id"]).in_("status", ["waiting_payment", "pending_minimum"]).order("created_at", {"ascending": False}).limit(10).execute()
                txs = txs_resp.data if txs_resp and txs_resp.data else []
            except Exception as e:
                log.exception("Error buscando transacciones pendientes: %s", e)
                txs = []

            # intento de emparejar por monto exacto si posible, sino la más reciente waiting_payment
            candidate_tx = None
            if monto is not None:
                for t in txs:
                    if float(t.get("amount_requested", 0) or 0) == float(monto):
                        candidate_tx = t
                        break
            if not candidate_tx and txs:
                candidate_tx = txs[0]

            # Si no hay tx pendiente -> notificar admin y usuario
            if not candidate_tx:
                ticket_id = generate_request_id("TICKET")
                ts = now_iso()
                text = (
                    f"⚠️ *Pago detectado pero sin orden abierta*\n"
                    f"Ticket: `{ticket_id}`\n"
                    f"Usuario: `{user.get('first_name','')} ({user.get('telegram_id')})`\n"
                    f"Tel: `{telefono}`\n"
                    f"Monto: `{monto or 'desconocido'}` CUP\n"
                    f"TX: `{tx_id or 'N/A'}`\n"
                    f"Hora: `{ts}`\n\n"
                    f"Mensaje original:\n`{texto}`"
                )
                send_telegram(ADMIN_GROUP, text)
                # también avisar al usuario
                send_telegram(user["telegram_id"], f"⚠️ Hemos detectado un pago de *{monto or 'desconocido'} CUP* en tu número {telefono}, pero no encontramos una orden abierta en el sistema. Si hiciste una recarga, contacta al admin.", parse_mode="Markdown")
                return ("no_tx", 200)

            # Si hay candidate_tx, actualizar tx_id si no lo tiene y aplicar lógica de acreditación
            # Actualizar tx con tx_id si viene
            if tx_id:
                update_transaction_status(candidate_tx["id"], {"tx_id": tx_id})

            # Aplicar lógica de acreditación
            result = apply_credit_logic_and_finalize(user, candidate_tx)
            if result.get("credited"):
                # notificar usuario y admin
                msg_user = (
                    f"✨ Se ha agregado *{result.get('amount_credited')} {candidate_tx.get('currency','CUP').upper()}* a tu cuenta.\n"
                    f"Detalle: bono `{result.get('bonus')}` (si corresponde).\n"
                    f"Saldo actual: `{result.get('new_balance')}`"
                )
                send_telegram(user["telegram_id"], msg_user, parse_mode="Markdown")
                ts = now_iso()
                msg_admin = (
                    f"✅ *Pago acreditado*\n"
                    f"Usuario: `{user.get('first_name')} ({user.get('telegram_id')})`\n"
                    f"Tel: `{telefono}`\n"
                    f"TX SMS: `{tx_id or 'N/A'}`\n"
                    f"Monto detectado: `{monto}`\n"
                    f"Metodo: `{tipo}`\n"
                    f"Hora: `{ts}`\n"
                    f"Acreditado total: `{result.get('amount_credited')}`\n"
                )
                send_telegram(ADMIN_GROUP, msg_admin, parse_mode="Markdown")
                return ("credited", 200)
            else:
                # pendiente por debajo del minimo
                ts = now_iso()
                send_telegram(user["telegram_id"], f"⚠️ Hemos recibido *{monto or candidate_tx.get('amount_requested')}* pero está por debajo del mínimo. Se ha quedado en pendiente. Te avisaremos cuando se acredite.", parse_mode="Markdown")
                send_telegram(ADMIN_GROUP, f"ℹ️ Pago pendiente por debajo del mínimo para `{user.get('first_name')} ({user.get('telegram_id')})`. TX: `{tx_id or candidate_tx.get('tx_id')}` Monto: `{monto}` Hora: `{ts}`", parse_mode="Markdown")
                return ("pending_minimum", 200)

        # Caso fallback: guardar en pending_sms_payments
        pending_id = tx_id or generate_request_id("PEND")
        insert_pending_sms(pending_id, monto if monto else None, texto)
        ticket_id = generate_request_id("TICKET")
        ts = now_iso()
        text = (
            f"⚠️ *Pago recibido — Falta info para conciliar*\n"
            f"Ticket: `{ticket_id}`\n"
            f"Monto: `{monto or 'desconocido'}`\n"
            f"TX: `{tx_id or 'N/A'}`\n"
            f"Hora: `{ts}`\n"
            f"Mensaje:\n`{texto}`"
        )
        send_telegram(ADMIN_GROUP, text, parse_mode="Markdown")
        return ("saved_pending", 200)

    except Exception as e:
        log.exception("Error procesando webhook: %s", e)
        return ("error", 500)


@app.route("/create_request", methods=["POST"])
def create_request():
    """
    Endpoint para que tu bot Node (o front) cree la orden de recarga.
    Body JSON:
    {
      "telegram_id": 12345678,
      "currency": "cup" | "saldo" | "usdt",
      "amount": 1000
    }
    Respuesta:
    { "ok": true, "request_id": "REQ-..." }
    """
    try:
        body = request.get_json(force=True)
        tg = body.get("telegram_id")
        currency = body.get("currency")
        amount = float(body.get("amount") or 0)

        if currency not in ("cup", "saldo", "usdt"):
            return jsonify({"ok": False, "error": "currency inválida"}), 400

        # Validar límites
        if currency == "cup" and not (MIN_CUP <= amount <= MAX_CUP):
            return jsonify({"ok": False, "error": f"monto fuera de límites {MIN_CUP}-{MAX_CUP}"}), 400
        if currency == "saldo" and not (MIN_SALDO <= amount <= MAX_SALDO):
            return jsonify({"ok": False, "error": f"monto fuera de límites {MIN_SALDO}-{MAX_SALDO}"}), 400
        if currency == "usdt" and not (MIN_USDT <= amount <= MAX_USDT):
            return jsonify({"ok": False, "error": f"monto fuera de límites {MIN_USDT}-{MAX_USDT}"}), 400

        request_id = generate_request_id("REQ")
        tx = create_transaction_record(tg, currency, amount, status="waiting_payment", tx_id=request_id)
        if not tx:
            return jsonify({"ok": False, "error": "Error DB creando orden"}), 500

        # Buscar número de teléfono del usuario (si existe)
        user = None
        try:
            resp = supabase.table("users").select("*").eq("telegram_id", tg).limit(1).execute()
            user = resp.data[0] if resp and resp.data and len(resp.data) > 0 else None
        except Exception:
            user = None

        # Enviar ticket al ADMIN_GROUP (sin capturas)
        ts = now_iso()
        phone = user.get("phone_number") if user else "NO DISPONIBLE"
        text = (
            f"🧾 *Nueva Solicitud de Recarga*\n"
            f"Ticket: `{request_id}`\n"
            f"Usuario: `{user.get('first_name') if user else 'Desconocido'} ({tg})`\n"
            f"Nro cliente: `{phone}`\n"
            f"Monto: `{amount}` {currency.upper()}\n"
            f"Método: `Seleccionar en el bot`\n"
            f"Hora: `{ts}`\n"
            f"TX interno: `{request_id}`\n\n"
            f"Cuando llegue el SMS con la transacción lo procesaremos automáticamente si coincide."
        )
        send_telegram(ADMIN_GROUP, text)
        return jsonify({"ok": True, "request_id": request_id}), 200

    except Exception as e:
        log.exception("Error create_request: %s", e)
        return jsonify({"ok": False, "error": "exception"}), 500

# Keepalive ping interno cada 5 minutos (hilo separado)
def internal_keepalive():
    while True:
        try:
            if APP_URL:
                url = f"{APP_URL}/keepalive"
                r = requests.get(url, timeout=8)
                log.info("Keepalive ping -> %s %s", r.status_code, r.text[:80])
            else:
                log.info("APP_URL no configurada; skip keepalive ping.")
        except Exception as e:
            log.warning("Keepalive ping falló: %s", e)
        time.sleep(60 * 5)

# Lanzar keepalive en hilo daemon
t = threading.Thread(target=internal_keepalive, daemon=True)
t.start()

if __name__ == "__main__":
    log.info("Arrancando servicio en puerto %s", PORT)
    app.run(host="0.0.0.0", port=PORT)
