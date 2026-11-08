import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ImageResponse } from '@vercel/og';
import { cardElement, countChanges, releaseCard } from '../api/preview.js';
import { deviceStats } from '../api/push.js';
import { devicePlatform } from '../public/pwa.js';

const note = `## Car wash

### 1. [HCUS-1656](https://example.test) · Fully booked slots

- Fixed capacity.

**Evidence:** [QA](https://example.test)

### 2. [HCUS-1691](https://example.test) · WhatsApp payment

- Faster payment.`;

test('Release previews count numbered changes and list the verticals that changed', () => {
  assert.equal(countChanges(note), 2);
  assert.equal(countChanges('Plain text without numbered changes'), 0);
  const card = releaseCard({
    platform: 'Customer App',
    version: '5.11.0',
    publishedAt: '2026-10-30T12:00:00Z',
    entries: [
      { vertical: 'Auto Care', body: note },
      { vertical: 'Products', body: '' },
      { vertical: 'Value Added Services', body: '### 1. VAS-1 · New add-on' },
    ],
  });
  assert.equal(card.headline, 'v5.11.0');
  assert.equal(card.eyebrow, 'Release notes · Customer App');
  assert.equal(card.meta, 'Released 30 Oct 2026 · 3 changes');
  assert.deepEqual(card.chips, ['Auto Care', 'Value Added Services']);
  assert.equal(card.pageTitle, 'Customer App v5.11.0 · Release notes');
  assert.match(card.description, /across Auto Care and Value Added Services\./);
  // Previews describe the release, never the note text itself.
  assert.doesNotMatch(card.description, /capacity|HCUS/);
});

test('An unpublished release link says so instead of inventing a date', () => {
  const card = releaseCard({ platform: 'Admin Panel', version: '6.0.0', publishedAt: null });
  assert.equal(card.meta, 'Not published yet');
  assert.deepEqual(card.chips, []);
});

test('Preview images render at 1200 × 630 with the brand fonts', async () => {
  const font = (weight) =>
    readFile(new URL(`../public/loader/plus-jakarta-sans-${weight}.ttf`, import.meta.url));
  const mark = await readFile(new URL('../public/hoora-mark.png', import.meta.url));
  const card = releaseCard({
    platform: 'Customer App',
    version: '5.11.0',
    publishedAt: '2026-10-30T12:00:00Z',
    entries: [{ vertical: 'Auto Care', body: note }],
  });
  const image = new ImageResponse(
    cardElement(card, `data:image/png;base64,${mark.toString('base64')}`, 'hoora-docs.vercel.app'),
    {
      width: 1200,
      height: 630,
      fonts: await Promise.all(
        [500, 700, 800].map(async (weight) => ({
          name: 'Jakarta',
          data: await font(weight),
          weight,
          style: 'normal',
        })),
      ),
    },
  );
  const png = Buffer.from(await image.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 300_000, 'WhatsApp shows large previews only for small images');
});

test('Install and notification counts include only devices used in the last 30 days', () => {
  const now = Date.parse('2026-11-08T00:00:00Z');
  const days = (n) => new Date(now - n * 86400000).toISOString();
  const stats = deviceStats(
    [
      { user_id: 'a', last_seen_at: days(1) },
      { user_id: 'a', last_seen_at: days(3) },
      { user_id: 'b', last_seen_at: days(45) },
    ],
    [{ user_id: 'c', last_seen_at: days(2) }],
    now,
  );
  assert.deepEqual(stats.installs, { active: 2, people: 1, total: 3 });
  assert.deepEqual(stats.notifications, { active: 1, people: 1, total: 1 });
  assert.equal(stats.activeDays, 30);
});

test('Installed devices are grouped by platform', () => {
  assert.equal(devicePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), 'android');
  assert.equal(devicePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'ios');
  assert.equal(devicePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios');
  assert.equal(devicePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'macos');
  assert.equal(devicePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0), 'windows');
  assert.equal(devicePlatform('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 0), 'linux');
});
