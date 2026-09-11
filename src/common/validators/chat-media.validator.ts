import { BadRequestException } from '@nestjs/common';
import { fa } from '../../i18n/fa';

const DATA_URL_RE = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

export const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mpeg', 'mpg']);
export const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'aac',
  'flac',
]);

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/mov',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
};

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

export type ChatMediaKind = 'video' | 'audio';

export interface ParsedChatMedia {
  kind: ChatMediaKind;
  ext: string;
  mime: string;
  buffer: Buffer;
  filename: string;
  dataUrl: string;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

function isIsoBmf(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp';
}

function isWebm(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
}

function isMpegPs(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    (buffer[3] === 0xba || buffer[3] === 0xb3)
  );
}

function isWav(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  );
}

function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  if (buffer.toString('ascii', 0, 3) === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function isOgg(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS';
}

function isFlac(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC';
}

function matchesVideoMagic(buffer: Buffer, ext: string): boolean {
  if (ext === 'webm') return isWebm(buffer);
  if (ext === 'mpeg' || ext === 'mpg') return isMpegPs(buffer) || isIsoBmf(buffer);
  return isIsoBmf(buffer);
}

function matchesAudioMagic(buffer: Buffer, ext: string): boolean {
  if (ext === 'wav') return isWav(buffer);
  if (ext === 'mp3') return isMp3(buffer);
  if (ext === 'ogg') return isOgg(buffer);
  if (ext === 'flac') return isFlac(buffer);
  if (ext === 'm4a' || ext === 'aac') return isIsoBmf(buffer) || isMp3(buffer);
  return false;
}

export function isVideoFilename(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(extOf(filename));
}

export function isAudioFilename(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(extOf(filename));
}

export function parseChatMediaDataUrl(
  dataUrl: string,
  filename: string,
): ParsedChatMedia | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  const ext = extOf(filename);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return {
      kind: 'video',
      ext,
      mime: VIDEO_MIME[ext] ?? 'video/mp4',
      buffer,
      filename,
      dataUrl,
    };
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return {
      kind: 'audio',
      ext,
      mime: AUDIO_MIME[ext] ?? 'audio/mpeg',
      buffer,
      filename,
      dataUrl,
    };
  }
  return null;
}

function validateOne(
  file: { data: string; filename: string },
  kind: ChatMediaKind,
  maxSizeMb: number,
): ParsedChatMedia {
  const parsed = parseChatMediaDataUrl(file.data, file.filename);
  if (!parsed || parsed.kind !== kind) {
    throw new BadRequestException(
      kind === 'video' ? fa.chatMedia.invalidVideo : fa.chatMedia.invalidAudio,
    );
  }
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (parsed.buffer.length === 0 || parsed.buffer.length > maxBytes) {
    throw new BadRequestException(
      kind === 'video'
        ? fa.chatMedia.videoTooLarge(maxSizeMb)
        : fa.chatMedia.audioTooLarge(maxSizeMb),
    );
  }
  const magicOk =
    kind === 'video'
      ? matchesVideoMagic(parsed.buffer, parsed.ext)
      : matchesAudioMagic(parsed.buffer, parsed.ext);
  if (!magicOk) {
    throw new BadRequestException(fa.chatMedia.contentMismatch);
  }
  return parsed;
}

export function validateChatVideos(
  files: { data: string; filename: string }[],
  opts: { maxSizeMb: number; maxCount: number },
): ParsedChatMedia[] {
  if (files.length > opts.maxCount) {
    throw new BadRequestException(fa.chatMedia.tooManyVideos(opts.maxCount));
  }
  return files.map((f) => validateOne(f, 'video', opts.maxSizeMb));
}

export function validateChatAudios(
  files: { data: string; filename: string }[],
  opts: { maxSizeMb: number; maxCount: number },
): ParsedChatMedia[] {
  if (files.length > opts.maxCount) {
    throw new BadRequestException(fa.chatMedia.tooManyAudios(opts.maxCount));
  }
  return files.map((f) => validateOne(f, 'audio', opts.maxSizeMb));
}
