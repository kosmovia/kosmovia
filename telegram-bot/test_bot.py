import asyncio
from datetime import datetime
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo
from PIL import Image
import bot


class BotTests(unittest.TestCase):
    def setUp(self):
        (bot.ROOT / 'data').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=bot.ROOT / 'data')
        self.store = bot.Store(Path(self.temp.name) / 'history.sqlite3')

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_public_and_allowlist(self):
        with patch.dict(os.environ, {'AUTHORIZED_IDS': ''}):
            self.assertTrue(self.store.authorized(11))
            self.assertTrue(self.store.authorized(22))
        with patch.dict(os.environ, {'AUTHORIZED_IDS': '11, 33'}):
            self.assertTrue(self.store.authorized(11))
            self.assertFalse(self.store.authorized(22))

    def test_persistent_limits_and_user_isolation(self):
        with patch.dict(os.environ, {'DAILY_LIMIT': '1', 'COOLDOWN_SECONDS': '0'}):
            self.assertIsNone(self.store.reserve(1))
            self.assertIsNotNone(self.store.reserve(1))
            self.assertIsNone(self.store.reserve(2))
            reopened = bot.Store(Path(self.temp.name) / 'history.sqlite3')
            self.assertIsNotNone(reopened.reserve(1))
            reopened.db.close()

    def test_cooldown_and_images(self):
        with patch.dict(os.environ, {'COOLDOWN_SECONDS': '8'}):
            self.assertIsNone(self.store.reserve(1))
            self.assertIsNotNone(self.store.reserve(1))
        with patch.dict(os.environ, {'COOLDOWN_SECONDS': '0', 'DAILY_IMAGE_LIMIT': '1'}):
            self.assertIsNone(self.store.reserve(2, True))
            self.assertIsNotNone(self.store.reserve(2, True))

    def test_global_ai_budget(self):
        with patch.dict(os.environ, {'DAILY_BUDGET_USD': '0', 'DAILY_AI_LIMIT': '1'}):
            self.assertFalse(self.store.reserve_ai(0.10))
            self.assertTrue(self.store.reserve_ai())
            self.assertFalse(self.store.reserve_ai())

    def test_bolivia_boundaries(self):
        for hour, expected in [(4, 'noche'), (5, 'mañana'), (11, 'mañana'), (12, 'tarde'), (18, 'tarde'), (19, 'noche')]:
            self.assertEqual(bot.bolivia_period(datetime(2026, 10, 11, hour, tzinfo=ZoneInfo('America/La_Paz'))), expected)

    def test_no_repetition_and_provider_failure(self):
        content = bot.Content(self.store)
        with patch.dict(os.environ, {'GEMINI_FREE_TIER_CONFIRMED': 'false'}):
            values = []
            for _ in range(15):
                value = asyncio.run(content.text(1, 'love'))
                self.assertNotIn(value, values)
                self.store.remember(1, 'love', value)
                values.append(value)
        with patch.dict(os.environ, {'GEMINI_FREE_TIER_CONFIRMED': 'true', 'GEMINI_API_KEY': 'test'}), patch.object(content, 'gemini', AsyncMock(side_effect=RuntimeError('secret'))):
            self.assertTrue(asyncio.run(content.text(2, 'love')))

    def test_postcard_and_menu(self):
        picture = bot.render_postcard('Florece a tu ritmo.')
        image = Image.open(picture)
        self.assertEqual(image.size, (1000, 1000))
        self.assertTrue(all(len(row) == 2 for row in bot.menu().inline_keyboard))
        self.assertEqual(bot.reply_text('Hola').split('\n\n')[-1], bot.FOOTER)
        self.assertEqual([b.text for b in bot.again('love').inline_keyboard[0]], ['🔄 Otra más', '🏠 Inicio'])

    def test_start_and_six_callbacks(self):
        content = bot.Content(self.store)
        message = SimpleNamespace(reply_text=AsyncMock(), reply_photo=AsyncMock())
        update = SimpleNamespace(effective_chat=SimpleNamespace(type='private'), effective_user=SimpleNamespace(id=77), effective_message=message, callback_query=None)
        context = SimpleNamespace(application=SimpleNamespace(bot_data={'store': self.store, 'content': content}))
        with patch.dict(os.environ, {'AUTHORIZED_IDS': '', 'GEMINI_FREE_TIER_CONFIRMED': 'false', 'ALLOW_PAID_IMAGES': 'false', 'COOLDOWN_SECONDS': '0'}):
            asyncio.run(bot.start(update, context))
            self.assertEqual(message.reply_text.call_args.args[0], bot.reply_text(bot.WELCOME))
            for category in bot.CHOICES:
                update.callback_query = SimpleNamespace(data=category, answer=AsyncMock(), message=message)
                asyncio.run(bot.callback(update, context))
            self.assertEqual(message.reply_photo.call_count, 1)
            self.assertTrue(message.reply_photo.call_args.kwargs['caption'].endswith(bot.FOOTER))
            for call in message.reply_text.call_args_list:
                self.assertTrue(call.args[0].endswith(bot.FOOTER))
            self.assertEqual(self.store.db.execute('SELECT count(*) FROM history').fetchone()[0], 6)

    def test_secret_filter(self):
        import logging
        with patch.dict(os.environ, {'TELEGRAM_BOT_TOKEN': 'test-secret'}):
            record = logging.LogRecord('test', 40, '', 0, 'URL %s', ('test-secret',), None)
            bot.SecretFilter().filter(record)
            self.assertNotIn('test-secret', record.getMessage())


if __name__ == '__main__':
    unittest.main()
