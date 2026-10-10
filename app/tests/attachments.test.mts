import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { checkMarkers, joinContent, splitContent, sameMarkers, previewText, checkLinkable, canReadAttachment, sniffFile } from '../lib/core/attachments-rules.ts';
import { processUpload } from '../lib/core/attachments-process.ts';
const id = '11111111-1111-4111-8111-111111111111';
test('adjuntos: texto opcional, previews y edición sin tocar archivos', () => {
  assert.deepEqual(splitContent(joinContent([id], ' hola ')), { ids: [id], text: 'hola' });
  assert.equal(previewText(joinContent([id], '')), '📎 Archivo');
  assert.equal(sameMarkers(joinContent([id], 'uno'), joinContent([id], 'dos')), true);
  assert.equal(sameMarkers(joinContent([id], 'uno'), 'dos'), false);
  assert.equal(checkMarkers(joinContent([id,id], '')).ok, false);
  assert.equal(checkMarkers(joinContent(Array(5).fill(id), '')).ok, false);
});
test('adjuntos: el archivo solo puede vincularlo el autor en su destino una vez', () => {
  const row = { id, uploader_id: 'alice', scope: 'dm', channel_id: null, dm_thread_id: 'thread', message_id: null };
  assert.equal(checkLinkable([row], [id], { profileId: 'alice', scope: 'dm', targetId: 'thread' }).ok, true);
  assert.equal(checkLinkable([row], [id], { profileId: 'bob', scope: 'dm', targetId: 'thread' }).ok, false);
  assert.equal(checkLinkable([row], [id], { profileId: 'alice', scope: 'dm', targetId: 'other' }).ok, false);
  assert.equal(checkLinkable([{...row, message_id: 'sent'}], [id], { profileId: 'alice', scope: 'dm', targetId: 'thread' }).ok, false);
  assert.equal(canReadAttachment(row, 'bob', true), false);
  assert.equal(canReadAttachment({...row, message_id: 'sent'}, 'bob', true), true);
});
test('adjuntos: imagen real se recodifica, reduce y elimina metadatos', async () => {
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#14b8a6' } }).jpeg().withMetadata().toBuffer();
  const result = await processUpload(input, 'foto.jpg');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mime, 'image/webp');
  assert.equal(result.value.width, 2048);
  assert.equal(result.value.height, 1024);
  assert.ok(result.value.thumb);
  const metadata = await sharp(result.value.data).metadata();
  assert.equal(metadata.exif, undefined);
  assert.ok((await sharp(result.value.thumb!).metadata()).width! <= 400);
});
test('adjuntos: rechaza HTML disfrazado y archivos vacíos o mayores a 5 MB', async () => {
  assert.equal(sniffFile(Buffer.from('<html>')), null);
  assert.equal((await processUpload(Buffer.from('<html>'), 'foto.png')).ok, false);
  assert.equal((await processUpload(Buffer.alloc(0), 'vacio.png')).ok, false);
  assert.equal((await processUpload(Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.png')).ok, false);
});
