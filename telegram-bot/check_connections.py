"""Comprobación real sin enviar mensajes ni generar contenido de pago."""
import asyncio
import os
import httpx
import bot  # carga .env sin imprimir secretos


async def main():
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            response = await client.get(f'https://api.telegram.org/bot{os.getenv("TELEGRAM_BOT_TOKEN", "")}/getMe')
            data = response.json()
            print('Telegram:', response.status_code, 'válido' if data.get('ok') else 'rechazado')
            if data.get('ok'):
                print('Bot: @' + data['result']['username'])
                webhook = await client.get(f'https://api.telegram.org/bot{os.getenv("TELEGRAM_BOT_TOKEN", "")}/getWebhookInfo')
                print('Webhook existente:', bool(webhook.json().get('result', {}).get('url')))
        except Exception as exc:
            print('Telegram: conexión fallida (' + type(exc).__name__ + ')')
        try:
            response = await client.get('https://generativelanguage.googleapis.com/v1beta/models', headers={'x-goog-api-key': os.getenv('GEMINI_API_KEY', '')})
            print('Gemini:', response.status_code, 'válido' if response.is_success else 'rechazado')
        except Exception as exc:
            print('Gemini: conexión fallida (' + type(exc).__name__ + ')')


if __name__ == '__main__':
    asyncio.run(main())
