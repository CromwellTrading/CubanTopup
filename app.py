from flask import Flask, request
import json
from parser import parse_payment
from telegram import send_ticket

app = Flask(__name__)

@app.route("/keepalive", methods=["GET"])
def keepalive():
    return "OK", 200


@app.route("/webhook", methods=["POST"])
def webhook():
    data = request.get_json()

    print("\n--- NUEVO MENSAJE RECIBIDO ---")
    print(json.dumps(data, indent=2, ensure_ascii=False))

    result = parse_payment(data)

    if not result:
        print("❌ Mensaje no válido")
        return "OK", 200

    send_ticket(result)
    return "OK", 200


if __name__ == "__main__":
    app.run()
