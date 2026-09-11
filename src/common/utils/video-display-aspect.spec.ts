import {
  clampAspectRatioToOptions,
  displaySizeAfterRotation,
  isQuarterTurnRotation,
  rotationFromProbeStream,
  snapDisplayAspectRatio,
} from './video-display-aspect';

describe('video-display-aspect', () => {
  it('normalizes iPhone rotate=90 and Display Matrix -90 to a quarter turn', () => {
    expect(rotationFromProbeStream({ tags: { rotate: '90' } })).toBe(90);
    expect(
      rotationFromProbeStream({ side_data_list: [{ rotation: -90 }] }),
    ).toBe(270);
    expect(isQuarterTurnRotation(90)).toBe(true);
    expect(isQuarterTurnRotation(270)).toBe(true);
    expect(isQuarterTurnRotation(0)).toBe(false);
  });

  it('swaps coded landscape size to display portrait after 90/270', () => {
    expect(displaySizeAfterRotation(1920, 1080, 90)).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(displaySizeAfterRotation(1920, 1080, 0)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('snaps display size to the nearest Omni-style ratio', () => {
    expect(snapDisplayAspectRatio(1080, 1920)).toBe('9:16');
    expect(snapDisplayAspectRatio(1920, 1080)).toBe('16:9');
    expect(snapDisplayAspectRatio(1080, 1080)).toBe('1:1');
  });

  it('clamps 1:1 onto Omni 16:9/9:16 options', () => {
    expect(clampAspectRatioToOptions('9:16', ['16:9', '9:16'])).toBe('9:16');
    expect(clampAspectRatioToOptions('1:1', ['16:9', '9:16'])).toBe('16:9');
  });
});
