import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

const DOCS_IMG_DIR = path.join(__dirname, '../../../docs/static/img');

function getOutputPath(subdir: string, name: string, mobile: boolean): string {
  const suffix = mobile ? '-mobile' : '';
  const dir = path.join(DOCS_IMG_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}${suffix}.webp`);
}

type Clip = { x: number; y: number; width: number; height: number };

/** Viewport-relative bounding box for annotation (e.g. from element.boundingBox()). */
export type HighlightBox = { x: number; y: number; width: number; height: number };

/** A single highlight with an optional color (hex or CSS color). Default red. */
export type ColoredHighlight = { box: HighlightBox; color?: string };

/**
 * Takes a screenshot and writes it to packages/docs/static/img as WebP.
 * Uses PNG capture then converts to WebP for smaller size and doc compatibility.
 * Prefer passing `page` with `clip` for viewport/bounded shots; avoid screenshotting
 * large scrollable locators (e.g. [role=main]) as that can hang.
 * Optional `highlight` draws a red box; or use `highlights` for multiple boxes with colors.
 */
export async function saveScreenshot(
  target: Page | Locator,
  subdir: string,
  name: string,
  options: {
    mobile?: boolean;
    clip?: Clip;
    highlight?: HighlightBox;
    highlights?: ColoredHighlight[];
  } = {},
): Promise<void> {
  const { mobile = false, clip, highlight, highlights } = options;
  const outPath = getOutputPath(subdir, name, mobile);

  let buffer: Buffer;
  if (clip && 'screenshot' in target && typeof (target as Page).screenshot === 'function') {
    buffer = await (target as Page).screenshot({ type: 'png', clip });
  } else {
    const screenshotable = target as {
      screenshot: (opts: { type: 'png' }) => Promise<Buffer>;
    };
    buffer = await screenshotable.screenshot({ type: 'png' });
  }

  const { default: sharp } = await import('sharp');
  const sharpInstance = sharp(buffer);
  const { width: imgWidth, height: imgHeight } = await sharpInstance.metadata();
  const width = clip?.width ?? imgWidth ?? 0;
  const height = clip?.height ?? imgHeight ?? 0;

  let pipeline = sharpInstance;

  const toDraw: ColoredHighlight[] =
    highlights && highlights.length > 0
      ? highlights
      : highlight
        ? [{ box: highlight, color: 'red' }]
        : [];

  if (toDraw.length > 0 && width > 0 && height > 0) {
    const rects = toDraw
      .map(({ box, color = 'red' }) => {
        const hx = clip ? box.x - clip.x : box.x;
        const hy = clip ? box.y - clip.y : box.y;
        return `<rect x="${hx}" y="${hy}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="3"/>`;
      })
      .join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
    const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
    pipeline = pipeline.composite([{ input: overlay, left: 0, top: 0 }]);
  }

  await pipeline.webp({ quality: 85 }).toFile(outPath);
}

/**
 * Stitches two screenshots side-by-side and saves as WebP. Use when two different UI states
 * must be shown in one image (e.g. notes open on left, hover state on right).
 * Optional highlightOnRight is drawn on the right image (coordinates relative to that image).
 */
export async function saveScreenshotComposite(
  leftBuffer: Buffer,
  rightBuffer: Buffer,
  subdir: string,
  name: string,
  options: { mobile?: boolean; highlightOnRight?: HighlightBox } = {},
): Promise<void> {
  const { mobile = false, highlightOnRight } = options;
  const outPath = getOutputPath(subdir, name, mobile);

  const { default: sharp } = await import('sharp');
  const leftImg = sharp(leftBuffer);
  const rightImg = sharp(rightBuffer);
  const [leftMeta, rightMeta] = await Promise.all([
    leftImg.metadata(),
    rightImg.metadata(),
  ]);
  const w1 = leftMeta.width ?? 0;
  const h1 = leftMeta.height ?? 0;
  const w2 = rightMeta.width ?? 0;
  const h2 = rightMeta.height ?? 0;
  const h = Math.max(h1, h2);

  let rightFinal = rightImg;
  if (highlightOnRight && w2 > 0 && h2 > 0) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w2}" height="${h2}" viewBox="0 0 ${w2} ${h2}">
      <rect x="${highlightOnRight.x}" y="${highlightOnRight.y}" width="${highlightOnRight.width}" height="${highlightOnRight.height}"
        fill="none" stroke="red" stroke-width="3"/>
    </svg>`;
    const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
    rightFinal = rightImg.composite([{ input: overlay, left: 0, top: 0 }]);
  }

  const [leftExtended, rightProcessed] = await Promise.all([
    h1 < h ? leftImg.extend({ bottom: h - h1 }).toBuffer() : leftImg.toBuffer(),
    h2 < h ? rightFinal.extend({ bottom: h - h2 }).toBuffer() : rightFinal.toBuffer(),
  ]);

  await sharp({
    create: {
      width: w1 + w2,
      height: h,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: leftExtended, left: 0, top: 0 },
      { input: rightProcessed, left: w1, top: 0 },
    ])
    .webp({ quality: 85 })
    .toFile(outPath);
}

export const DOCS_IMG_BASE = DOCS_IMG_DIR;
