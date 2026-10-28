import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// defaultCameras lives in record.html's inline script; pull out just that function.
const html = readFileSync(join(import.meta.dirname, '..', 'public', 'record.html'), 'utf8');
const src = html.match(/function defaultCameras\(cameras\) \{[\s\S]*?\n\}/)![0];
const defaultCameras = new Function(`${src}; return defaultCameras;`)() as (c: { deviceId: string; label: string }[]) => { face?: string; hands?: string };

describe('record.html camera defaults', () => {
  it('face is the Anker USB camera, hands is the MacBook Desk View', () => {
    const cams = [
      { deviceId: 'mbp', label: 'MacBook Pro Camera' },
      { deviceId: 'desk', label: 'MacBook Pro Desk View Camera' },
      { deviceId: 'anker', label: 'Anker PowerConf C200 (291a:3369)' },
    ];
    expect(defaultCameras(cams)).toEqual({ face: 'anker', hands: 'desk' });
  });

  it('without an Anker, face is any non-built-in camera; never the built-in or Desk View', () => {
    const cams = [
      { deviceId: 'mbp', label: 'FaceTime HD Camera' },
      { deviceId: 'desk', label: 'MacBook Pro Desk View Camera' },
      { deviceId: 'usb', label: 'USB Camera' },
    ];
    expect(defaultCameras(cams)).toEqual({ face: 'usb', hands: 'desk' });
    expect(defaultCameras([{ deviceId: 'mbp', label: 'MacBook Pro Camera' }])).toEqual({ face: undefined, hands: undefined });
  });
});
