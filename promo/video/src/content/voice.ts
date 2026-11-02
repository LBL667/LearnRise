/**
 * Voice configuration — the single source of narration timbre.
 *
 * Switching voice must not touch a single scene file:
 *
 *   ACTIVE_VOICE=xiaoxiao npm run tts:all
 *   ACTIVE_VOICE=xiaoxiao npm run timeline:check
 *   ACTIVE_VOICE=xiaoxiao npm run render
 *
 * `VOICE` below always resolves to the active profile, so TTS scripts can
 * consume one object. Audio is stored per profile under
 * `out/audio/<profile>/sXX.mp3`, which keeps both cuts side by side for A/B.
 */

declare const process:
  | { readonly env?: Readonly<Record<string, string | undefined>> }
  | undefined;

export type VoiceProfileName = 'yunyang' | 'xiaoxiao';

export interface VoiceProfile {
  /** edge-tts voice id. */
  readonly voice: string;
  /** edge-tts rate parameter, e.g. `+0%`. */
  readonly rate: string;
  /** edge-tts pitch parameter, e.g. `-2Hz`. */
  readonly pitch: string;
  /** edge-tts volume parameter, e.g. `+0%`. */
  readonly volume: string;
  /** Human label used by the audition pack and the SRT header. */
  readonly label: string;
}

export const VOICES = {
  yunyang: {
    voice: 'zh-CN-YunyangNeural',
    rate: '+0%',
    pitch: '-2Hz',
    volume: '+0%',
    label: 'Yunyang / 成熟男声',
  },
  xiaoxiao: {
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    label: 'Xiaoxiao / 温暖女声',
  },
} as const satisfies Record<VoiceProfileName, VoiceProfile>;

const requested =
  typeof process === 'undefined' ? undefined : process.env?.ACTIVE_VOICE;

/** `ACTIVE_VOICE=xiaoxiao` selects the female profile; anything else is Yunyang. */
export const ACTIVE_VOICE: VoiceProfileName =
  requested === 'xiaoxiao' ? 'xiaoxiao' : 'yunyang';

/** The active timbre. Scenes never import this file; only TTS/render scripts do. */
export const VOICE: VoiceProfile = VOICES[ACTIVE_VOICE];

export const VOICE_PROFILE_NAMES: readonly VoiceProfileName[] = [
  'yunyang',
  'xiaoxiao',
];
