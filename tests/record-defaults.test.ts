import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// defaultCameras lives in record.html's inline script; pull out just that function.
const html = readFileSync(join(import.meta.dirname, '..', 'public', 'record.html'), 'utf8');
const src = html.match(/function defaultCameras\(cameras\) \{[\s\S]*?\n\}/)![0];
const defaultCameras = new Function(`${src}; return defaultCameras;`)() as (c: { deviceId: string; label: string }[]) => { face?: string; hands?: string };

describe('record.html camera defaults', () => {
  it('face is the MacBook camera, hands is the Anker looking down at the iPad', () => {
    const cams = [
      { deviceId: 'mbp', label: 'MacBook Pro Camera (0000:0001)' },
      { deviceId: 'desk', label: 'MacBook Pro Desk View Camera' },
      { deviceId: 'anker', label: 'Anker PowerConf C200 (291a:3369)' },
    ];
    expect(defaultCameras(cams)).toEqual({ face: 'mbp', hands: 'anker' });
  });

  it('without an Anker, hands is any other USB camera, then Desk View; face is never Desk View', () => {
    expect(defaultCameras([
      { deviceId: 'mbp', label: 'FaceTime HD Camera' },
      { deviceId: 'desk', label: 'MacBook Pro Desk View Camera' },
      { deviceId: 'usb', label: 'USB Camera' },
    ])).toEqual({ face: 'mbp', hands: 'usb' });
    expect(defaultCameras([
      { deviceId: 'mbp', label: 'MacBook Pro Camera' },
      { deviceId: 'desk', label: 'MacBook Pro Desk View Camera' },
    ])).toEqual({ face: 'mbp', hands: 'desk' });
    expect(defaultCameras([{ deviceId: 'desk', label: 'MacBook Pro Desk View Camera' }]).face).toBeUndefined();
  });
});
