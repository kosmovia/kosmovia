"""Bot nativo: polling, SQLite y límites persistentes, sin servidor web."""
import asyncio
import base64
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import random
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env', encoding='utf-8-sig', override=False)
FOOTER = 'Hecho por una persona que te quiere mucho. ♡'
WELCOME = '¡Holaaa! 🌷\nEste pequeño espacio está hecho para sacarte una sonrisa cuando lo necesites.\n¿Qué te gustaría recibir hoy?'
CHOICES = {'love': '💌 Mensaje bonito', 'motivation': '🌻 Motívame', 'inspiration': '✨ Inspírame', 'surprise': '🌷 Una sorpresa', 'image': '🎨 Imagen bonita', 'today': '☀️ Algo para hoy'}
SEEDS = {
    'love': ['Qué bonito coincidir contigo.', 'Hay personas que hacen más ligero el día. Tú eres una de ellas.', 'Me gusta esa forma tan tuya de mirar el mundo.', 'Ojalá hoy encuentres una razón pequeña para sonreír.'],
    'motivation': ['Un paso pequeño también te acerca.', 'Hoy puedes avanzar a tu ritmo.', 'No tienes que resolverlo todo de una vez.', 'Descansar también es parte del camino.'],
    'inspiration': ['Las cosas bonitas suelen empezar con algo sencillo.', 'Deja un poquito de espacio para lo inesperado.', 'A veces una pausa cambia la perspectiva.', 'Sigue aquello que despierta tu curiosidad.'],
    'surprise': ['Mini misión: busca algo bonito que normalmente pasa desapercibido.', 'Pon tu canción favorita y regálate esos minutos.', 'Una flor imaginaria para acompañar tu día. 🌷', 'Hoy cuenta también esa pequeña alegría.'],
    'image': ['Florece a tu ritmo.', 'Aquí cabe un respiro.', 'Lo sencillo también ilumina.', 'Un poquito de calma para ti.'],
}


def bolivia_period(now=None):
    hour = (now or datetime.now(ZoneInfo('America/La_Paz'))).hour
    return 'mañana' if 5 <= hour < 12 else 'tarde' if 12 <= hour < 19 else 'noche'


def reply_text(text):
    return f'{text.strip()}\n\n{FOOTER}'


def menu():
    buttons = [InlineKeyboardButton(label, callback_data=key) for key, label in CHOICES.items()]
    return InlineKeyboardMarkup([buttons[i:i + 2] for i in range(0, 6, 2)])


def again(category):
    return InlineKeyboardMarkup([[InlineKeyboardButton('🔄 Otra más', callback_data=category), InlineKeyboardButton('🏠 Inicio', callback_data='home')]])


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS history (user_id INTEGER, category TEXT, digest TEXT, text TEXT, created REAL);
            CREATE INDEX IF NOT EXISTS history_user ON history(user_id, category);
            CREATE TABLE IF NOT EXISTS usage (user_id INTEGER, day TEXT, requests INTEGER DEFAULT 0, images INTEGER DEFAULT 0, last REAL DEFAULT 0, PRIMARY KEY(user_id,day));
            CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, requests INTEGER DEFAULT 0, reserved_usd REAL DEFAULT 0);
        ''')

    def authorized(self, uid, claim=False):
        allowed = {int(x.strip()) for x in os.getenv('AUTHORIZED_IDS', '').split(',') if x.strip()}
        if allowed:
            return uid in allowed
        return True

    def reserve(self, uid, image=False):
        day = datetime.now(ZoneInfo('America/La_Paz')).date().isoformat()
        now = time.time()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO usage(user_id,day) VALUES(?,?)', (uid, day))
            count, images, last = self.db.execute('SELECT requests,images,last FROM usage WHERE user_id=? AND day=?', (uid, day)).fetchone()
            if now - last < int(os.getenv('COOLDOWN_SECONDS', '8')):
                return 'Un pequeño respiro y seguimos. Intenta en unos segundos. 🌿'
            if count >= int(os.getenv('DAILY_LIMIT', '30')) or (image and images >= int(os.getenv('DAILY_IMAGE_LIMIT', '5'))):
                return 'Por hoy llegamos al límite. Mañana habrá más cosas bonitas. 🌷'
            self.db.execute('UPDATE usage SET requests=requests+1,images=images+?,last=? WHERE user_id=? AND day=?', (int(image), now, uid, day))
        return None

    def reserve_ai(self, cost=0):
        day = datetime.now(ZoneInfo('America/La_Paz')).date().isoformat()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO ai_usage(day) VALUES(?)', (day,))
            count, total = self.db.execute('SELECT requests,reserved_usd FROM ai_usage WHERE day=?', (day,)).fetchone()
            if count >= int(os.getenv('DAILY_AI_LIMIT', '40')) or total + cost > float(os.getenv('DAILY_BUDGET_USD', '0')):
                return False
            self.db.execute('UPDATE ai_usage SET requests=requests+1,reserved_usd=reserved_usd+? WHERE day=?', (cost, day))
        return True

    def recent(self, uid, category):
        return [r[0] for r in self.db.execute('SELECT text FROM history WHERE user_id=? AND category=? ORDER BY created DESC LIMIT 100', (uid, category))]

    def remember(self, uid, category, text):
        digest = hashlib.sha256(text.casefold().strip().encode()).hexdigest()
        with self.db:
            self.db.execute('INSERT INTO history VALUES(?,?,?,?,?)', (uid, category, digest, text, time.time()))
            self.db.execute('DELETE FROM history WHERE rowid IN (SELECT rowid FROM history WHERE user_id=? ORDER BY created DESC LIMIT -1 OFFSET 600)', (uid,))


class Content:
    def __init__(self, store):
        self.store = store
        self.personal = json.loads((ROOT / 'messages.json').read_text(encoding='utf-8'))
        for category, values in self.personal.items():
            if category not in CHOICES or not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() or len(value) > (70 if category == 'image' else 300) for value in values):
                raise ValueError('messages.json: categorías válidas y frases cortas no vacías requeridas.')

    async def gemini(self, model, body):
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            response = await client.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', headers={'x-goog-api-key': os.getenv('GEMINI_API_KEY', '')}, json=body)
            response.raise_for_status()
            return response.json()

    async def text(self, uid, category):
        recent = self.store.recent(uid, category)
        period = bolivia_period()
        if os.getenv('GEMINI_FREE_TIER_CONFIRMED', 'false').lower() == 'true' and os.getenv('GEMINI_API_KEY') and self.store.reserve_ai():
            prompt = f'Escribe solo un mensaje español, cálido, aesthetic, cariño sutil, sin cursilería, sin intensidad, sin promesas ni presión romántica. Máximo 35 palabras (imagen: máximo 8). Categoría {category}. Hora en Bolivia: {period}. No uses saludos largos ni firmas. No repitas estos mensajes: {json.dumps(recent[-20:], ensure_ascii=False)}'
            try:
                data = await self.gemini('gemini-3.1-flash-lite', {'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'maxOutputTokens': 512, 'temperature': 1.0, 'thinkingConfig': {'thinkingLevel': 'minimal'}}})
                value = ''.join(p.get('text', '') for p in data.get('candidates', [{}])[0].get('content', {}).get('parts', [])).strip()
                value = value.replace(FOOTER, '').strip()
                if value and len(value) <= (70 if category == 'image' else 300) and value.casefold() not in {x.casefold() for x in recent}:
                    return value
            except Exception:
                logging.warning('Texto IA no disponible; usando contenido local.')
        pool = list(SEEDS.get(category, [])) + self.personal.get(category, [])
        if category == 'today':
            pool += {'mañana': ['Que esta mañana empiece sin prisa.', 'Un vaso de agua, un respiro y un comienzo suave.', 'Ojalá encuentres un ratito de sol esta mañana.'], 'tarde': ['Haz una pausa pequeña esta tarde. Te la mereces.', 'Todavía cabe algo bonito en esta tarde.', 'Estira los hombros y disfruta un ratito de calma.'], 'noche': ['Por hoy, puedes soltar un poquito.', 'Que esta noche te encuentre en calma.', 'No necesitas terminarlo todo antes de descansar.']}[period]
        options = [x for x in pool if x not in recent]
        if not options:
            # Evita repetir incluso al agotar la biblioteca; mezcla piezas naturales.
            options = [f'{a} {b}' for a in pool for b in ['Un respiro para ti. 🌿', 'Que te acompañe algo bonito. 🌷', 'A tu ritmo, siempre.', 'Hoy también cuenta lo pequeño.'] if f'{a} {b}' not in recent]
        return random.choice(options or [f'Un detalle para tu {period}: mira alrededor y encuentra algo que te dé calma.'])

    async def postcard(self, text):
        background = None
        if os.getenv('ALLOW_PAID_IMAGES', 'false').lower() == 'true' and self.store.reserve_ai(0.10):
            try:
                data = await self.gemini('gemini-3.1-flash-image', {'contents': [{'parts': [{'text': 'Create exactly one minimal watercolor postcard background, pastel cream sage pink, tiny wildflowers, soft nature, generous blank center. No text, no letters, no people.'}]}], 'generationConfig': {'responseModalities': ['IMAGE'], 'candidateCount': 1, 'imageConfig': {'imageSize': '1K', 'aspectRatio': '1:1'}}})
                for part in data.get('candidates', [{}])[0].get('content', {}).get('parts', []):
                    if 'inlineData' in part:
                        background = Image.open(io.BytesIO(base64.b64decode(part['inlineData']['data']))).convert('RGB').resize((1000, 1000))
            except Exception:
                logging.warning('Imagen IA no disponible; usando postal local.')
        return render_postcard(text, background)


def render_postcard(text, background=None):
    image = background or Image.new('RGB', (1000, 1000), random.choice(['#F7F0E8', '#EFF4ED', '#F8ECEF']))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((90, 240, 910, 700), radius=40, fill='#FAF8F2')
    for x, y in [(180, 810), (800, 180), (830, 820)]:
        draw.line((x, y, x - 20, y + 90), fill='#8CA58C', width=5)
        draw.ellipse((x - 35, y + 25, x - 5, y + 45), fill='#AABC9F')
        for dx, dy in [(0, -18), (-18, 0), (18, 0), (0, 18)]:
            draw.ellipse((x + dx - 16, y + dy - 16, x + dx + 16, y + dy + 16), fill='#E4B8C4')
        draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill='#DFC88C')
    font = None
    for path in [os.getenv('POSTCARD_FONT', ''), 'C:/Windows/Fonts/georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if path and Path(path).exists():
            font = ImageFont.truetype(path, 48)
            break
    font = font or ImageFont.load_default(size=48)
    words, lines, line = text.split(), [], ''
    for word in words:
        candidate = f'{line} {word}'.strip()
        if draw.textlength(candidate, font=font) > 730 and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    lines.append(line)
    for i, line in enumerate(lines):
        draw.text((500, 470 - len(lines) * 32 + i * 64), line, font=font, fill='#496151', anchor='mm')
    output = io.BytesIO()
    image.save(output, 'PNG')
    output.seek(0)
    output.name = 'una-postal-para-ti.png'
    return output


async def access(update, context, claim=False):
    private = update.effective_chat and update.effective_chat.type == 'private'
    if private and context.application.bot_data['store'].authorized(update.effective_user.id, claim):
        return True
    if update.callback_query:
        await update.callback_query.answer('Este espacio es privado.', show_alert=True)
    elif update.effective_message:
        await update.effective_message.reply_text(reply_text('Este espacio es privado. 🌿'), reply_markup=again('home'))
    return False


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if await access(update, context, claim=True):
        await update.effective_message.reply_text(reply_text(WELCOME), reply_markup=menu())


async def identity(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type == 'private':
        await update.effective_message.reply_text(reply_text(f'Tu ID de Telegram: {update.effective_user.id}'), reply_markup=again('home'))


async def callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await access(update, context):
        return
    query = update.callback_query
    await query.answer()
    category = query.data
    if category == 'home':
        await query.message.reply_text(reply_text(WELCOME), reply_markup=menu())
        return
    if category not in CHOICES:
        return
    store = context.application.bot_data['store']
    uid = update.effective_user.id
    denied = store.reserve(uid, category == 'image')
    if denied:
        await query.message.reply_text(reply_text(denied), reply_markup=again(category))
        return
    content = context.application.bot_data['content']
    text = await content.text(uid, category)
    if category == 'image':
        photo = await content.postcard(text)
        await query.message.reply_photo(photo, caption=reply_text(text), reply_markup=again(category))
    else:
        await query.message.reply_text(reply_text(text), reply_markup=again(category))
    store.remember(uid, category, text)


async def error(update, context):
    # No registrar excepciones, URLs, payloads ni datos de usuarios: pueden contener tokens.
    logging.error('Operación fallida (%s).', type(context.error).__name__)
    if isinstance(update, Update) and update.effective_message:
        try:
            await update.effective_message.reply_text(reply_text('Se me escapó este intento. Probemos otra vez en un ratito. 🌷'), reply_markup=again('home'))
        except Exception:
            pass


async def connected(app):
    await app.bot.get_updates(timeout=0, limit=1, allowed_updates=['message', 'callback_query'])
    logging.warning('Conexión real con Telegram verificada; iniciando polling.')


class SecretFilter(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        for name in ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY']:
            secret = os.getenv(name)
            if secret:
                message = message.replace(secret, '[SECRETO]')
        record.msg, record.args, record.exc_info, record.exc_text = message, (), None, None
        return True


def build_app():
    token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:
        raise RuntimeError('Falta TELEGRAM_BOT_TOKEN en .env.')
    store = Store(os.getenv('DB_PATH', str(ROOT / 'data' / 'bot.sqlite3')))
    app = Application.builder().token(token).concurrent_updates(False).post_init(connected).build()
    app.bot_data.update(store=store, content=Content(store))
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('id', identity))
    app.add_handler(CallbackQueryHandler(callback))
    app.add_error_handler(error)
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING, format='%(levelname)s %(message)s')
    for handler in logging.getLogger().handlers:
        handler.addFilter(SecretFilter())
    logging.getLogger('httpx').setLevel(logging.CRITICAL)
    logging.getLogger('httpcore').setLevel(logging.CRITICAL)
    try:
        build_app().run_polling(allowed_updates=['message', 'callback_query'], drop_pending_updates=False)
    except Exception as exc:
        logging.critical('No se pudo iniciar (%s). Revisa credenciales y conexión.', type(exc).__name__)
        raise SystemExit(1) from None
