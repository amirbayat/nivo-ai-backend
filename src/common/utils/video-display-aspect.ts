export type SnappedAspectRatio = '9:16' | '16:9' | '1:1';

export function rotationFromProbeStream(stream: {
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}): number {
  const tagRotate = Number(stream.tags?.rotate ?? 0);
  const sideDataRotate = stream.side_data_list?.find(
    (d) => typeof d.rotation === 'number',
  )?.rotation;
  const raw = tagRotate || sideDataRotate || 0;
  return ((raw % 360) + 360) % 360;
}

export function isQuarterTurnRotation(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

export function displaySizeAfterRotation(
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } {
  if (isQuarterTurnRotation(rotation)) return { width: height, height: width };
  return { width, height };
}

export function snapDisplayAspectRatio(
  width: number,
  height: number,
): SnappedAspectRatio {
  if (height > width) return '9:16';
  if (width > height) return '16:9';
  return '1:1';
}

export function clampAspectRatioToOptions(
  detected: string,
  options: string[],
): string {
  if (options.length === 0) return detected;
  if (options.includes(detected)) return detected;
  if (options.includes('16:9')) return '16:9';
  if (options.includes('9:16')) return '9:16';
  return options[0];
}
