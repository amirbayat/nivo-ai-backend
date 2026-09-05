import type { CaptionSegment } from './ass-subtitle-builder';

// docs/PRD-video-auto-captions.md §۸.۲ — خروجی فایل زیرنویس خام (SRT/VTT)، جدا از نسخه‌ی
// سوزانده‌شده. هر دو از همون segments مشترک ساخته می‌شوند (خروجی ASS از buildAssSubtitle
// موجود در ass-subtitle-builder.ts می‌آید) — نیازی به منطق جدا برای هر فرمت نیست.

function srtTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const millis = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function vttTime(ms: number): string {
  return srtTime(ms).replace(',', '.');
}

export function buildSrt(segments: CaptionSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${srtTime(seg.startMs)} --> ${srtTime(seg.endMs)}\n${seg.text}\n`)
    .join('\n');
}

export function buildVtt(segments: CaptionSegment[]): string {
  const body = segments
    .map((seg) => `${vttTime(seg.startMs)} --> ${vttTime(seg.endMs)}\n${seg.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}
